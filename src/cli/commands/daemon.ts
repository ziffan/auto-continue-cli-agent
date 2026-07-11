import type { Command } from 'commander';
import { runtimeSocketPath } from '../../shared/paths.js';
import { DaemonAlreadyRunningError, createSupervisor } from '../../daemon/supervisor.js';
import { closeDb, openDb } from '../../store/db.js';

const HEARTBEAT_INTERVAL_MS = 5000;

/** `acca daemon` — jalankan supervisor daemon foreground (ADR-002 monolith; dijalankan sebagai
 * service OS di produksi — ADR-007). Entrypoint tipis: semua logika hidup di `daemon/supervisor.ts`. */
export function registerDaemonCommand(program: Command): void {
  program
    .command('daemon')
    .description('Jalankan supervisor daemon (foreground) — IPC + rekonsiliasi orphan + heartbeat')
    .action(async () => {
      const db = openDb();
      const supervisor = createSupervisor({
        db,
        socketPath: runtimeSocketPath(),
        now: () => Date.now(),
        startUsageMonitor: true, // I-17: probe usage periodik saat RUNNING (proximity + cache status).
      });

      try {
        await supervisor.start();
      } catch (err) {
        closeDb(db);
        if (err instanceof DaemonAlreadyRunningError) {
          console.error(err.message);
          process.exit(1);
        }
        throw err;
      }

      const heartbeatTimer = setInterval(() => supervisor.heartbeat(), HEARTBEAT_INTERVAL_MS);

      const shutdown = (): void => {
        clearInterval(heartbeatTimer);
        supervisor
          .stop()
          .then(() => {
            closeDb(db);
            process.exit(0);
          })
          .catch((err: unknown) => {
            console.error(err instanceof Error ? err.message : String(err));
            closeDb(db);
            process.exit(1);
          });
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      console.log(`acca daemon berjalan (pid ${process.pid}).`);
    });
}
