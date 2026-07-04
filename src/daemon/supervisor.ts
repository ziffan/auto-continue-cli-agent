// Supervisor daemon (ADR-002 monolith): koordinasi lifecycle — rekonsiliasi orphan saat start,
// heartbeat berkala, dan server IPC (ADR-015). Timer/sinyal OS hidup di entrypoint tipis
// (`cli/commands/daemon.ts`); modul ini logika inti yang testable tanpa proses nyata.

import { isProcessAlive } from '../shared/proc.js';
import type { DatabaseInstance } from '../store/db.js';
import { createEventsRepo } from '../store/repositories/events.js';
import { createMetaRepo } from '../store/repositories/meta.js';
import { createScheduledJobsRepo } from '../store/repositories/scheduled-jobs.js';
import { createSessionsRepo } from '../store/repositories/sessions.js';
import { createIpcServer } from './ipc-server.js';
import { reconcileOrphans } from './reconcile.js';
import { createScheduler, type JobDispatch, type TimerHandle } from './scheduler.js';

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

  const dispatch: JobDispatch =
    deps.dispatch ??
    ((job) => {
      // Placeholder M3d.5: probeUsage()/resume nyata belum ada. 'retry' → job tetap tersimpan &
      // dijadwal ulang (backoff), tidak dihapus, sampai M3d.5 memberi dispatch sungguhan.
      events.append({ session_id: job.session_id, type: 'job_dispatch_pending', payload: { jobId: job.id, kind: job.kind, note: 'M3d.5' } });
      return 'retry';
    });

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
