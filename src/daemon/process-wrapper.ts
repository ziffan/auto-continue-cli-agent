import { writeFileSync, unlinkSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import * as pty from 'node-pty';
import { adapters } from '../adapters/index.js';
import { claudeMaxBindingUsedFraction } from '../adapters/usage.js';
import { createHookHandler } from './hook-relay.js';
import { createInjectHandler } from './inject-continue.js';
import { createSessionIdCapturer } from './session-id-capture.js';
import { sendCommand } from './ipc-client.js';
import { createIpcServer } from './ipc-server.js';
import { createLimitWatcher } from './limit-watcher.js';
import type { UsageCorroboration } from './limit-watcher.js';
import { scheduleProbeForLimit } from './schedule-reset.js';
import { foregroundIsAgent } from '../shared/foreground.js';
import { genUniqueSessionId } from '../shared/ids.js';
import { createIdleTracker } from '../shared/idle-tracker.js';
import { runtimeSocketPath, sessionControlSocketPath, sessionHookSettingsPath } from '../shared/paths.js';
import { nowMs } from '../shared/time.js';
import { which } from '../shared/which.js';
import type { Tool, UsageLimit } from '../shared/types.js';
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
  /** I-35: pembaca JSON snapshot usage terakhir (`meta.usage_snapshot_<tool>`), untuk korroborasi
   *  sinyal limit dari OUTPUT. Disuntik (bukan `meta` repo utuh) supaya wrapper tetap sempit &
   *  teruji tanpa store. **Opsional:** absen/undefined/JSON rusak → korroborasi mati → perilaku
   *  pra-I-35 (latch). Wajib di-wire di kedua pemanggil produksi (`cli/commands/run.ts` +
   *  `daemon/supervisor.ts`) — kalau lupa, fitur mati SENYAP ke sisi aman, bukan ke sisi salah. */
  usageSnapshotJson?: (tool: Tool) => string | undefined;
}

export interface RunSessionResult {
  sessionId: string;
  /** Resolve dengan exit code CLI target saat proses (bungkusan PTY) selesai. */
  waitForExit: Promise<number>;
}

/**
 * I-35: baca snapshot usage terakhir dari store lalu mampatkan jadi `UsageCorroboration` untuk engine.
 * **Setiap** jalur gagal — dep tak di-wire, snapshot belum pernah ditulis, JSON rusak, skema tak dikenal,
 * `limits` kosong — mengembalikan `null` yang engine artikan "tak tahu" → TAK men-suppress → latch
 * (perilaku pra-I-35). Ragu tak pernah boleh jatuh ke "berarti tak limit": false-negative = sesi limit
 * asli menggantung selamanya tanpa error, jauh lebih mahal daripada false-positive yang berisik.
 * JSON di sini tulisan kita sendiri (`saveSnapshot`), tapi tetap divalidasi — ia melewati disk & bisa
 * berasal dari versi skema lain (G-42: DB dibaca lintas-proses).
 */
export function readUsageCorroboration(
  tool: Tool,
  usageSnapshotJson: ((tool: Tool) => string | undefined) | undefined,
): UsageCorroboration | null {
  // CC-only, STRUKTURAL (bukan sekadar mengandalkan guard di limit-watcher): `claudeMaxBindingUsedFraction`
  // memakai definisi window-mengikat CC (global + scoped-aktif, I-25). agy BEDA — dual-limit per grup,
  // SEMUA bucket mengikat (G-31) — jadi angka itu akan salah arti untuk agy. Guard di sini menutup jalur
  // itu andai guard engine kelak dilonggarkan.
  if (tool !== 'claude') return null;
  const raw = usageSnapshotJson?.(tool);
  if (raw === undefined) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const capturedAt = record['capturedAt'];
  const limitsRaw = record['limits'];
  if (typeof capturedAt !== 'number' || !Number.isFinite(capturedAt)) return null;
  if (!Array.isArray(limitsRaw)) return null;

  const limits: UsageLimit[] = [];
  for (const entry of limitsRaw) {
    if (typeof entry !== 'object' || entry === null) return null;
    const e = entry as Record<string, unknown>;
    const usedFraction = e['usedFraction'];
    const kind = e['kind'];
    if (typeof usedFraction !== 'number' || !Number.isFinite(usedFraction)) return null;
    if (typeof kind !== 'string') return null;
    limits.push({
      kind,
      usedFraction,
      resetAt: null, // korroborasi tak memakai resetAt — jangan pura-pura mem-parse-nya.
      ...(typeof e['scope'] === 'string' ? { scope: e['scope'] } : {}),
      ...(typeof e['isActive'] === 'boolean' ? { isActive: e['isActive'] } : {}),
    });
  }

  const maxBindingUsedFraction = claudeMaxBindingUsedFraction({ tool, limits, capturedAt });
  if (maxBindingUsedFraction === null) return null;
  return { capturedAt, maxBindingUsedFraction };
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
  // I-27 (A-9): id unik dgn retry — cegah tabrakan PK (id 4-char + retensi never-purge) yang
  // membuat createSession throw & `acca run` gagal misterius.
  const id = genUniqueSessionId((cand) => deps.sessions.getById(cand) !== undefined);

  deps.sessions.createSession({
    id,
    tool: spec.tool,
    cwd: spec.cwd,
    status: 'RUNNING',
    proc_state: 'alive',
    resumed_from: spec.resumedFrom ?? null,
  });
  deps.events.append({ session_id: id, type: 'status_change', payload: { to: 'RUNNING' } });

  const adapter = adapters[spec.tool];

  // I-23 — pasang hook supervisor CC (StopFailure = deteksi limit PRIMER ADR-001/§7; SessionStart =
  // sumber `cli_session_id` CC I-20/R2b) via `--settings <file>` terisolasi. Forwarder = perintah
  // internal `acca __hook <id>` (exec-form: node + entry acca INI, tak bergantung PATH). agy →
  // `supervisorHooks` undefined → dilewati. **Non-fatal:** gagal tulis settings → sesi tetap jalan
  // tanpa hook (fallback deteksi = output-scrape `limit-watcher`).
  let spawnArgs = spec.args;
  let hookSettingsPath: string | undefined;
  const candidateSettingsPath = sessionHookSettingsPath(id);
  const hookPlan = adapter.supervisorHooks?.({
    sessionId: id,
    forwarder: { command: process.execPath, args: [process.argv[1] ?? '', '__hook', id] },
    settingsPath: candidateSettingsPath,
  });
  if (hookPlan) {
    try {
      writeFileSync(candidateSettingsPath, hookPlan.settingsContent);
      hookSettingsPath = candidateSettingsPath;
      spawnArgs = [...hookPlan.extraArgs, ...spec.args];
    } catch (err) {
      deps.events.append({
        session_id: id,
        type: 'control_socket_error',
        payload: { error: `hook_settings: ${err instanceof Error ? err.message : String(err)}` },
      });
    }
  }
  const cleanupHookSettings = (): void => {
    if (hookSettingsPath === undefined) return;
    try {
      unlinkSync(hookSettingsPath);
    } catch {
      // File settings sementara sudah hilang / tak bisa dihapus → non-fatal (bukan state/transcript).
    }
  };

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
    ptyProcess = pty.spawn(resolvedFile, spawnArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: spec.cwd,
      env: process.env,
    });
  } catch (err) {
    // Kegagalan sinkron (mis. binary tak ditemukan) → sesi tak boleh tersisa RUNNING selamanya.
    cleanupHookSettings();
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

  // I-20/R2b — tangkap `cli_session_id` milik CLI dari output (agy = resume-cmd yang agy cetak saat
  // exit, G-36) → persist supaya resume-by-id sesi MATI (`agy --conversation <id>`) tak lagi BLOCKED
  // (paruh korektness R2a sudah pakai `cli_session_id`; ini yang MENGISINYA). Adapter yang tak
  // memakai jalur output (CC: sumber id = hook `SessionStart`, I-23) → `captureSessionId` undefined →
  // capturer tak dipasang. Engine murni; wrapper (penulis lifecycle sesinya, ADR-017) yang menulis DB.
  const idCapturer = adapter.captureSessionId
    ? createSessionIdCapturer({
        // Panggil via objek adapter (bukan ekstrak referensi) — captureSessionId murni, tapi memanggil
        // sebagai method menjaga eslint unbound-method senang. `!` aman: dijaga guard di atas.
        capture: (line) => adapter.captureSessionId!(line),
        onCapture: (cliId) => {
          deps.sessions.setCliSessionId(id, cliId);
          // Audit-only (tak di-surface Notifier). Id = uuid percakapan (bukan PII); tak di-echo di
          // payload event untuk jaga log ramping — id tersimpan di kolom `sessions.cli_session_id`.
          deps.events.append({ session_id: id, type: 'cli_session_id_captured', payload: { source: 'output_resume_cmd' } });
        },
      })
    : undefined;

  // M3d.1 — seam Detector→sesi live: engine murni (tak akses store/IPC, ADR-008/013), transisi
  // state dilakukan di sini oleh pemanggil saat `onLimit` menyala (sekali per latch). Didefinisikan
  // SEBELUM control server supaya handler inject (`onInjected`) bisa memanggil `watcher.unlatch()` (R3).
  const watcher = createLimitWatcher({
    tool: spec.tool,
    now: nowMs,
    // I-31 (G-37): banner limit LAMA yang di-repaint CC pasca-inject ditolak grace-window OUTPUT-CC →
    // audit-only (bukan LIMIT_HIT). Tak menurunkan aksi dari isi (firewall utuh). Membantu konfirmasi
    // fix saat live-verify berikutnya (I-15).
    onOutputSuppressed: (result) => {
      deps.events.append({
        session_id: id,
        type: 'limit_suppressed',
        payload: { reason: 'post_unlatch_output_grace', source: result.source, evidence: result.evidence?.slice(0, 200) },
      });
    },
    // I-35: korroborasi — engine bertanya "berapa usage terakhir yang diketahui?", wrapper yang
    // membacanya dari store. Engine tetap murni (tak menyentuh store/IPC, ADR-008/013).
    usageSnapshot: () => readUsageCorroboration(spec.tool, deps.usageSnapshotJson),
    onUsageContradiction: (result, corroboration) => {
      deps.events.append({
        session_id: id,
        type: 'limit_suppressed',
        payload: {
          reason: 'usage_contradicts',
          source: result.source,
          evidence: result.evidence?.slice(0, 200),
          maxBindingUsedFraction: corroboration.maxBindingUsedFraction,
          snapshotAgeMs: nowMs() - corroboration.capturedAt,
        },
      });
    },
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
    // I-23 — kanal DATA hook CC (forwarder `acca __hook`). Deteksi limit PRIMER (StopFailure→feedSignal)
    // + capture cli_session_id (SessionStart). Injection firewall ADR-013: lihat `daemon/hook-relay.ts`.
    hook: createHookHandler({
      feedStopFailure: (error) => watcher.feedSignal({ type: 'stopfailure', error }),
      captureCcSessionId: (ccSessionId) => {
        deps.sessions.setCliSessionId(id, ccSessionId);
        deps.events.append({ session_id: id, type: 'cli_session_id_captured', payload: { source: 'hook_sessionstart' } });
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
    idCapturer?.feedOutput(data);
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
      cleanupHookSettings();
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
