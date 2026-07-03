// Supervisor daemon (ADR-002 monolith): koordinasi lifecycle — rekonsiliasi orphan saat start,
// heartbeat berkala, dan server IPC (ADR-015). Timer/sinyal OS hidup di entrypoint tipis
// (`cli/commands/daemon.ts`); modul ini logika inti yang testable tanpa proses nyata.

import { isProcessAlive } from '../shared/proc.js';
import type { DatabaseInstance } from '../store/db.js';
import { createEventsRepo } from '../store/repositories/events.js';
import { createMetaRepo } from '../store/repositories/meta.js';
import { createSessionsRepo } from '../store/repositories/sessions.js';
import { createIpcServer } from './ipc-server.js';
import { reconcileOrphans } from './reconcile.js';

export interface SupervisorDeps {
  db: DatabaseInstance;
  socketPath: string;
  now: () => number;
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

  const ipcServer = createIpcServer({
    ping: () => ({ pong: true, pid: process.pid, at: deps.now() }),
    status: () => sessions.listActive(),
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
    },

    async stop(): Promise<void> {
      await ipcServer.close();
    },

    heartbeat,
  };
}
