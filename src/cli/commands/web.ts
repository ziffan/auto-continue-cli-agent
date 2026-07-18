import type { Command } from 'commander';
import { closeDb, openDb } from '../../store/db.js';
import { createMetaRepo } from '../../store/repositories/meta.js';
import { createSessionsRepo, toSessionStatusView } from '../../store/repositories/sessions.js';
import { createEventsRepo } from '../../store/repositories/events.js';
import { isProcessAlive } from '../../shared/proc.js';
import { buildStatusPayload } from '../../web/status-json.js';
import { renderPage } from '../../web/page.js';
import { DEFAULT_WEB_PORT, WEB_HOST, startWebServer } from '../../web/server.js';

const EVENT_TAIL = 50;

/** Resolve port: `--port` > env `ACCA_WEB_PORT` > default. Invalid → throw (pesan jelas). */
export function resolveWebPort(flag: string | undefined, env: string | undefined): number {
  const raw = flag ?? env;
  if (raw === undefined || raw === '') return DEFAULT_WEB_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Port tak valid: "${raw}" (harus 1..65535)`);
  }
  return port;
}

/** `acca web` — Web UI monitor read-only (ADR-028). Opt-in; bind 127.0.0.1 saja; nol mutasi.
 *  Membaca store LANGSUNG (seperti `acca status`) — daemon tak wajib hidup (usage bisa stale/kosong). */
export function registerWebCommand(program: Command): void {
  program
    .command('web')
    .description('Jalankan Web UI monitor read-only (opt-in, bind 127.0.0.1 saja)')
    .option('-p, --port <n>', 'port (default 4599; atau env ACCA_WEB_PORT)')
    .action(async (opts: { port?: string }) => {
      const port = resolveWebPort(opts.port, process.env.ACCA_WEB_PORT);
      const db = openDb();
      const meta = createMetaRepo(db);
      const sessions = createSessionsRepo(db);
      const events = createEventsRepo(db);

      // Boundary impur: baca snapshot SEGAR tiap request (read-only). Proyeksi ter-firewall (T-W1).
      const readStatus = () =>
        buildStatusPayload({
          usageClaudeRaw: meta.get('usage_snapshot_claude'),
          usageAntigravityRaw: meta.get('usage_snapshot_antigravity'),
          heartbeat: meta.getHeartbeat(),
          sessions: sessions.listActive().map(toSessionStatusView),
          events: events.listRecent(EVENT_TAIL),
          nowMs: Date.now(),
          isAlive: isProcessAlive,
        });

      let server;
      try {
        server = await startWebServer(port, { readStatus, renderPage });
      } catch (err) {
        closeDb(db);
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Gagal bind Web UI di ${WEB_HOST}:${port} — ${msg}`);
        process.exit(1);
      }

      console.log(`acca web (read-only) → http://${WEB_HOST}:${port}  [Ctrl-C untuk berhenti]`);

      const shutdown = (): void => {
        server.close(() => {
          closeDb(db);
          process.exit(0);
        });
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
}
