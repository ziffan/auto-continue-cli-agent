import { isAbsolute } from 'node:path';
import * as pty from 'node-pty';
import { createInjectHandler } from './inject-continue.js';
import { sendCommand } from './ipc-client.js';
import { createIpcServer } from './ipc-server.js';
import { createLimitWatcher } from './limit-watcher.js';
import { scheduleProbeForLimit } from './schedule-reset.js';
import { foregroundIsAgent } from '../shared/foreground.js';
import { genSessionId } from '../shared/ids.js';
import { createIdleTracker } from '../shared/idle-tracker.js';
import { runtimeSocketPath, sessionControlSocketPath } from '../shared/paths.js';
import { nowMs } from '../shared/time.js';
import { which } from '../shared/which.js';
import type { Tool } from '../shared/types.js';
import type { EventsRepo } from '../store/repositories/events.js';
import type { ScheduledJobsRepo } from '../store/repositories/scheduled-jobs.js';
import type { SessionsRepo } from '../store/repositories/sessions.js';

export interface RunSessionSpec {
  file: string;
  args: string[];
  cwd: string;
  tool: Tool;
  /** I-14: bila sesi ini adalah hasil resume-by-id dari sesi lain, id sesi ASAL. Disimpan di
   *  `sessions.resumed_from` supaya `status`/riwayat bisa menautkan rantai resume. `undefined`
   *  untuk sesi baru biasa (`acca run`). */
  resumedFrom?: string;
}

export interface RunSessionDeps {
  sessions: SessionsRepo;
  events: EventsRepo;
  jobs: ScheduledJobsRepo;
}

export interface RunSessionResult {
  sessionId: string;
  /** Resolve dengan exit code CLI target saat proses (bungkusan PTY) selesai. */
  waitForExit: Promise<number>;
}

/**
 * I-10: beri tahu daemon HIDUP (bila ada) agar memuat ulang `scheduled_jobs` & arm timer setelah
 * proses INI menulis job baru lintas-proses. **Best-effort & non-fatal:** tak ada daemon
 * (`DaemonNotRunningError`) / timeout → di-swallow. Recovery-saat-`start()` daemon tetap menjamin
 * job tak hilang (AC-7) — notify ini hanya memangkas latensi "sampai restart" jadi "seketika".
 */
export async function notifyDaemonRearm(socketPath: string = runtimeSocketPath()): Promise<void> {
  try {
    await sendCommand(socketPath, 'rearm', undefined, { timeoutMs: 2000 });
  } catch {
    // Daemon tak berjalan / tak menjawab → jalur ini memang opsional; abaikan.
  }
}

/**
 * Inti spawn CLI target via PTY — engine process-wrapper (MAP: `daemon/process-wrapper.ts`).
 * Dipanggil oleh `cli/commands/run.ts` (jalur user) DAN `daemon/supervisor.ts` (actuation
 * resume-by-id, I-12 poin 2). Dipisah dari command wrapper supaya bisa dipanggil langsung di
 * integration test tanpa TTY nyata (raw-mode dilewati otomatis bila `process.stdin.isTTY` falsy).
 */
export function runSession(spec: RunSessionSpec, deps: RunSessionDeps): RunSessionResult {
  const id = genSessionId();

  deps.sessions.createSession({
    id,
    tool: spec.tool,
    cwd: spec.cwd,
    status: 'RUNNING',
    proc_state: 'alive',
    resumed_from: spec.resumedFrom ?? null,
  });
  deps.events.append({ session_id: id, type: 'status_change', payload: { to: 'RUNNING' } });

  const cols = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;

  let ptyProcess;
  try {
    // node-pty (Windows) tak resolve PATH/PATHEXT — butuh path absolut (G-12).
    // Path yang sudah absolut/mengandung separator dipakai apa adanya (mis. process.execPath di test).
    const looksLikePath = isAbsolute(spec.file) || spec.file.includes('/') || spec.file.includes('\\');
    const resolvedFile = looksLikePath ? spec.file : which(spec.file);
    if (resolvedFile === null) {
      throw new Error(`Executable tak ditemukan di PATH: ${spec.file}`);
    }
    ptyProcess = pty.spawn(resolvedFile, spec.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: spec.cwd,
      env: process.env,
    });
  } catch (err) {
    // Kegagalan sinkron (mis. binary tak ditemukan) → sesi tak boleh tersisa RUNNING selamanya.
    deps.sessions.markFailed(id);
    deps.events.append({
      session_id: id,
      type: 'status_change',
      payload: { to: 'FAILED', reason: err instanceof Error ? err.message : String(err) },
    });
    return { sessionId: id, waitForExit: Promise.reject(err instanceof Error ? err : new Error(String(err))) };
  }

  deps.sessions.setPid(id, ptyProcess.pid);

  // M3d.7 / I-12 poin 1 — kanal inject-continue: wrapper (pemilik PTY) meng-host handler `inject` di
  // socket kontrol per-sesi supaya daemon bisa minta melanjutkan sesi HIDUP ini (limit != exit,
  // ADR-014 §1). Token yang ditulis = literal `CONTINUE_TOKEN` di dalam handler — TAK PERNAH dari IPC
  // args maupun output (injection firewall struktural). Non-fatal by design: bila host socket gagal,
  // sesi user (jalur utama) tetap jalan, hanya kehilangan kemampuan auto-inject (surface via event).
  // Idle-tracker (gating ADR-014 poin iii): dilacak dari stream output PTY (di-feed di `onData` bawah)
  // supaya handler inject bisa menolak saat sesi mid-turn. Foreground (poin ii) dihitung on-demand dari
  // `/proc` (Linux) atas PID child. Keduanya `undefined` = unknown → tak memblokir (injection-firewall
  // token literal tetap berlaku).
  const idleTracker = createIdleTracker({ tool: spec.tool });

  // M3d.1 — seam Detector→sesi live: engine murni (tak akses store/IPC, ADR-008/013), transisi
  // state dilakukan di sini oleh pemanggil saat `onLimit` menyala (sekali per latch). Didefinisikan
  // SEBELUM control server supaya handler inject (`onInjected`) bisa memanggil `watcher.unlatch()` (R3).
  const watcher = createLimitWatcher({
    tool: spec.tool,
    onLimit: (result) => {
      const at = nowMs();
      const transitioned = deps.sessions.markLimitHit(id, { source: result.source ?? 'output', detectedAt: at });
      if (!transitioned) return; // sesi sudah keluar dari RUNNING (race exit) → jangan emit/enqueue.
      deps.events.append({
        session_id: id,
        type: 'status_change',
        payload: { to: 'LIMIT_HIT', source: result.source, evidence: result.evidence?.slice(0, 200) },
      });
      const scheduled = scheduleProbeForLimit(
        { sessionId: id, detectedAt: at, now: at, resetHint: result.resetHint },
        { sessions: deps.sessions, jobs: deps.jobs, events: deps.events },
      );
      // I-10: job `probe` baru saja ditulis dari proses wrapper INI (bukan daemon). Beri tahu daemon
      // hidup agar re-arm seketika (best-effort; fire-and-forget). Hanya bila benar-benar ter-enqueue
      // (scheduled !== null → setReset sukses, bukan race exit).
      if (scheduled) void notifyDaemonRearm();
    },
  });

  let exited = false;
  const controlPath = sessionControlSocketPath(id);
  const controlServer = createIpcServer({
    inject: createInjectHandler({
      isAlive: () => !exited,
      write: (text) => ptyProcess.write(text),
      foregroundIsAgent: () => foregroundIsAgent(ptyProcess.pid),
      idle: () => idleTracker.isIdle(),
      // R3 (I-21): inject sukses → kembalikan sesi HIDUP ini ke RUNNING + un-latch watcher supaya
      // siklus limit BERIKUTNYA (persona sesi panjang kena limit >1×) terdeteksi lagi. Wrapper =
      // penulis sah lifecycle sesinya (ADR-017); daemon hanya mencatat audit + notifikasi RESUMED.
      onInjected: () => {
        const back = deps.sessions.markRunningAfterInject(id);
        if (back) {
          deps.events.append({
            session_id: id,
            type: 'status_change',
            payload: { to: 'RUNNING', reason: 'inject_continue' },
          });
        }
        watcher.unlatch();
      },
    }),
  });
  controlServer
    .listen(controlPath)
    .then(() => {
      // Race listen-vs-exit: bila proses sudah keluar sebelum listen selesai, tutup segera supaya
      // tak ada socket/pipe menggantung (mencegah handle bocor yang menahan event-loop).
      if (exited) void controlServer.close();
    })
    .catch((err: unknown) => {
      deps.events.append({
        session_id: id,
        type: 'control_socket_error',
        payload: { error: err instanceof Error ? err.message : String(err) },
      });
    });

  const dataSub = ptyProcess.onData((data: string) => {
    process.stdout.write(data);
    watcher.feedOutput(data);
    idleTracker.feed(data);
  });

  let restoreStdin: (() => void) | undefined;
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onStdinData = (chunk: Buffer): void => {
      ptyProcess.write(chunk.toString('utf8'));
    };
    process.stdin.on('data', onStdinData);

    const onResize = (): void => {
      ptyProcess.resize(process.stdout.columns ?? 80, process.stdout.rows ?? 24);
    };
    process.stdout.on('resize', onResize);

    restoreStdin = (): void => {
      process.stdin.off('data', onStdinData);
      process.stdout.off('resize', onResize);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
  }

  const waitForExit = new Promise<number>((resolve) => {
    ptyProcess.onExit(({ exitCode }) => {
      exited = true;
      dataSub.dispose();
      restoreStdin?.();
      void controlServer.close();
      deps.sessions.markExited(id);
      deps.events.append({
        session_id: id,
        type: 'status_change',
        payload: { to: 'EXITED', exitCode },
      });
      resolve(exitCode);
    });
  });

  return { sessionId: id, waitForExit };
}
