// Supervisor daemon (ADR-002 monolith): koordinasi lifecycle — rekonsiliasi orphan saat start,
// heartbeat berkala, dan server IPC (ADR-015). Timer/sinyal OS hidup di entrypoint tipis
// (`cli/commands/daemon.ts`); modul ini logika inti yang testable tanpa proses nyata.

import { existsSync } from 'node:fs';
import { adapters } from '../adapters/index.js';
import type { SpawnSpec } from '../adapters/types.js';
import { runSession } from '../cli/run-core.js';
import { isProcessAlive } from '../shared/proc.js';
import { sessionControlSocketPath } from '../shared/paths.js';
import type { Session } from '../shared/types.js';
import type { DatabaseInstance } from '../store/db.js';
import { createEventsRepo } from '../store/repositories/events.js';
import { createMetaRepo } from '../store/repositories/meta.js';
import { createScheduledJobsRepo } from '../store/repositories/scheduled-jobs.js';
import { createSessionsRepo } from '../store/repositories/sessions.js';
import { requestInject, type InjectRequestResult } from './inject-continue.js';
import { createIpcServer } from './ipc-server.js';
import { reconcileOrphans } from './reconcile.js';
import { createScheduler, type JobDispatch, type JobResult, type TimerHandle } from './scheduler.js';

/** I-6: setTimer produksi yang MEMBUNGKUS rejection. `setTimeout` mengabaikan Promise yang
 *  dikembalikan fn (scheduler mem-pass `runDue` async), jadi tanpa .catch sebuah rejection (mis.
 *  arm()/listPending() gagal karena DB closed) menjadi unhandledRejection yang bisa mematikan
 *  daemon. Bungkus baik rejection async MAUPUN throw sinkron → onError. */
export function createDaemonTimer(onError: (err: unknown) => void): (fn: () => void, ms: number) => TimerHandle {
  return (fn, ms) =>
    setTimeout(() => {
      try {
        void Promise.resolve(fn()).catch(onError);
      } catch (err) {
        onError(err);
      }
    }, ms);
}

export interface SupervisorDeps {
  db: DatabaseInstance;
  socketPath: string;
  now: () => number;
  dispatch?: JobDispatch;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (h: TimerHandle) => void;
  /** Minta wrapper pemilik PTY sesi meng-inject continue (I-12 poin 1). Default = connect ke socket
   *  kontrol per-sesi (`sessionControlSocketPath`) via IPC. Di-inject di test → tanpa socket nyata. */
  requestInject?: (session: Session) => Promise<InjectRequestResult>;
  /** Spawn wrapper PTY baru untuk resume-by-id sesi yang `exited` (I-12 poin 2). Default = `runSession`
   *  in-process (spawn CLI target di `spec.cwd`, catat sesi baru, host socket kontrol → re-injectable).
   *  Di-inject di test → tak spawn proses nyata. */
  spawnResume?: (spec: SpawnSpec, session: Session) => ResumeSpawnResult;
}

/** Hasil spawn resume-by-id. `sessionId` = id sesi wrapper BARU yang melanjutkan percakapan lama. */
export interface ResumeSpawnResult {
  sessionId?: string;
}

/** Dilempar saat socket/pipe daemon sudah dipakai (instance daemon lain sudah berjalan). */
export class DaemonAlreadyRunningError extends Error {
  constructor(public readonly socketPath: string) {
    super(`Daemon lain sudah berjalan (socket "${socketPath}" sudah dipakai).`);
    this.name = 'DaemonAlreadyRunningError';
  }
}

export interface Supervisor {
  start(): Promise<void>;
  stop(): Promise<void>;
  heartbeat(): void;
}

/** Bangun supervisor dari `deps`. Repo dibuat sekali dari `deps.db` dan dipakai untuk handler IPC. */
export function createSupervisor(deps: SupervisorDeps): Supervisor {
  const sessions = createSessionsRepo(deps.db);
  const events = createEventsRepo(deps.db);
  const meta = createMetaRepo(deps.db);
  const jobs = createScheduledJobsRepo(deps.db);

  const ipcServer = createIpcServer({
    ping: () => ({ pong: true, pid: process.pid, at: deps.now() }),
    status: () => sessions.listActive(),
  });

  const daemonError = (err: unknown, where: string, extra?: Record<string, unknown>): void =>
    events.append({
      session_id: null,
      type: 'daemon_error',
      payload: { where, error: err instanceof Error ? err.message : String(err), ...extra },
    });

  // Sisi-daemon dari kanal inject-continue (I-12 poin 1). Default = connect ke socket kontrol
  // per-sesi yang di-host wrapper; test menyuntik pengganti tanpa socket nyata.
  const requestInjectFn = deps.requestInject ?? ((session: Session): Promise<InjectRequestResult> => requestInject(sessionControlSocketPath(session.id)));

  // Actuation resume-by-id (I-12 poin 2). Default = runSession in-process: spawn CLI target di cwd
  // asli (which/G-12), catat sesi wrapper BARU, host socket kontrol (re-injectable). Non-blocking —
  // `waitForExit` sengaja tak di-await. Test menyuntik pengganti supaya tak spawn proses nyata.
  const spawnResumeFn: (spec: SpawnSpec, session: Session) => ResumeSpawnResult =
    deps.spawnResume ??
    ((spec, session) => {
      const { sessionId: newId } = runSession(
        { file: spec.file, args: spec.args, cwd: spec.cwd ?? session.cwd, tool: session.tool },
        { sessions, events, jobs },
      );
      return { sessionId: newId };
    });

  // Dispatch nyata (M3d.5 probe + M3d.6 resume-by-id + M3d.7 inject-continue gating). Setiap
  // cabang menulis event audit (pola sudah ada di reconcile.ts/limit-watcher.ts); error tak
  // terduga dibungkus try/catch → event + 'retry' (job dipertahankan, dijadwal ulang via backoff).
  const realDispatch: JobDispatch = async (job): Promise<JobResult> => {
    try {
      if (job.kind === 'probe') {
        const session = sessions.getById(job.session_id);
        if (!session) {
          events.append({
            session_id: job.session_id,
            type: 'job_dispatch_done',
            payload: { jobId: job.id, action: 'skipped:session_not_found' },
          });
          return 'done';
        }

        const adapter = adapters[session.tool];
        if (!adapter?.probeUsage) {
          events.append({
            session_id: job.session_id,
            type: 'job_dispatch_pending',
            payload: { jobId: job.id, action: 'skipped:adapter_no_probe' },
          });
          return 'retry';
        }

        const usage = await adapter.probeUsage({ sessionPid: session.pid ?? undefined });

        if (usage.limits.length === 0) {
          // Tak bisa menentukan status usage dari respons ini — retry (backoff) sampai probe
          // berikutnya memberi data yang bisa dibaca.
          events.append({
            session_id: job.session_id,
            type: 'job_dispatch_pending',
            payload: { jobId: job.id, action: 'still_unknown', reason: 'limits_empty' },
          });
          return 'retry';
        }

        const hasAvailable = usage.limits.every((l) => l.usedFraction < 1);
        if (hasAvailable) {
          jobs.enqueue({ session_id: job.session_id, run_at: deps.now(), kind: 'resume', next_backoff_ms: null });
          events.append({
            session_id: job.session_id,
            type: 'job_dispatch_done',
            payload: { jobId: job.id, action: 'usage_available_enqueue_resume' },
          });
          return 'done';
        }

        events.append({
          session_id: job.session_id,
          type: 'job_dispatch_pending',
          payload: { jobId: job.id, action: 'still_limited' },
        });
        return 'retry';
      }

      // job.kind === 'resume'
      const session = sessions.getById(job.session_id);
      if (!session) {
        events.append({
          session_id: job.session_id,
          type: 'job_dispatch_done',
          payload: { jobId: job.id, action: 'skipped:session_not_found' },
        });
        return 'done';
      }

      if (session.proc_state === 'alive') {
        // Jalur preferred ADR-014: sesi masih hidup di PTY → inject "continue", bukan kill+respawn.
        // Daemon bukan pemilik PTY → minta wrapper (via socket kontrol per-sesi) yang melakukan gating
        // lokal + menulis token literal (I-12 poin 1). Token TAK PERNAH dilewatkan lewat IPC ini.
        const outcome = await requestInjectFn(session);
        if (outcome.injected) {
          sessions.markResumed(job.session_id);
          events.append({
            session_id: job.session_id,
            type: 'status_change',
            payload: { to: 'RESUMED', reason: 'inject_continue' },
          });
          events.append({
            session_id: job.session_id,
            type: 'job_dispatch_done',
            payload: { jobId: job.id, action: 'inject_continue' },
          });
          return 'done';
        }
        // Tak ter-inject (gating wrapper menolak ATAU wrapper tak terjangkau). 'done', bukan 'retry' —
        // hindari retry-spin tak berujung (bug yang menyebabkan percobaan sebelumnya di-revert).
        // Kondisi tetap terlihat via event audit; surface manual sesuai ADR-014 (jangan auto-kill).
        events.append({
          session_id: job.session_id,
          type: 'job_dispatch_pending',
          payload: { jobId: job.id, action: 'inject_skipped', reason: outcome.reason, reachable: outcome.reachable },
        });
        return 'done';
      }

      // session.proc_state === 'exited' → resume-by-id (M3d.6).
      if (!existsSync(session.cwd)) {
        // AC-8: cwd asli sesi hilang — tak ada tempat aman untuk melanjutkan. Terminal, jangan retry.
        events.append({
          session_id: job.session_id,
          type: 'job_dispatch_error',
          payload: { jobId: job.id, action: 'blocked', reason: 'cwd_missing', status: 'BLOCKED' },
        });
        return 'done';
      }

      const adapter = adapters[session.tool];
      if (!adapter?.resumeCmd) {
        events.append({
          session_id: job.session_id,
          type: 'job_dispatch_error',
          payload: { jobId: job.id, action: 'adapter_no_resumecmd' },
        });
        return 'retry';
      }

      const spec = adapter.resumeCmd(session.id, session.cwd);
      // Actuation spawn nyata (I-12 poin 2): jalankan wrapper PTY baru di `spec.cwd` (AC-8 — resume
      // WAJIB di direktori kerja sesi asli). Bila spawn gagal (mis. binary hilang), `spawnResumeFn`
      // melempar → ditangkap catch luar → event error + 'retry' (backoff berjenjang, tak spin cepat).
      const spawned = spawnResumeFn(spec, session);
      sessions.markResumed(job.session_id);
      events.append({
        session_id: job.session_id,
        type: 'job_dispatch_done',
        payload: { jobId: job.id, action: 'resume_spawned', newSessionId: spawned.sessionId, spec },
      });
      return 'done';
    } catch (err) {
      events.append({
        session_id: job.session_id,
        type: 'job_dispatch_error',
        payload: { jobId: job.id, kind: job.kind, error: err instanceof Error ? err.message : String(err) },
      });
      return 'retry';
    }
  };

  const dispatch: JobDispatch = deps.dispatch ?? realDispatch;

  const scheduler = createScheduler({
    jobs,
    now: deps.now,
    dispatch,
    setTimer: deps.setTimer ?? createDaemonTimer((err) => daemonError(err, 'scheduler_timer')),
    clearTimer: deps.clearTimer ?? ((h) => clearTimeout(h)),
    onError: (err, job) => daemonError(err, 'dispatch', { jobId: job.id }),
  });

  function heartbeat(): void {
    meta.setHeartbeat(deps.now(), process.pid);
  }

  return {
    async start(): Promise<void> {
      // Urutan wajib: rekonsiliasi dulu (I-3) → heartbeat awal → baru buka IPC, supaya klien
      // yang connect segera setelah listen melihat store yang sudah konsisten.
      reconcileOrphans({ sessions, events, isAlive: isProcessAlive });
      heartbeat();

      try {
        await ipcServer.listen(deps.socketPath);
      } catch (err) {
        // EADDRINUSE = kode yang sama di POSIX (unix socket) MAUPUN Windows (named pipe sudah
        // dipakai) — diverifikasi empiris (net.Server pada named pipe yang sudah bound
        // melempar error.code 'EADDRINUSE', bukan kode Windows lain). Jadi satu pengecekan
        // kode cukup untuk kedua OS, tak perlu branch platform di sini.
        // Cast tipis ke `{code?}` (pola `shared/proc.ts`) — hindari referensi namespace ambient
        // `NodeJS` (eslint no-undef tak mengenalinya di file TS ini).
        if ((err as { code?: string }).code === 'EADDRINUSE') {
          throw new DaemonAlreadyRunningError(deps.socketPath);
        }
        throw err;
      }

      // Scheduler diarm SETELAH listen sukses — kalau bind gagal (DaemonAlreadyRunningError)
      // tak boleh ada timer nyasar tertinggal armed dari instance yang gagal start.
      scheduler.start();
    },

    async stop(): Promise<void> {
      scheduler.stop();
      await ipcServer.close();
    },

    heartbeat,
  };
}
