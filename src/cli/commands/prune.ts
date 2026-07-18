import type { Command } from 'commander';
import { closeDb, openDb } from '../../store/db.js';
import { createSessionsRepo } from '../../store/repositories/sessions.js';
import { createEventsRepo } from '../../store/repositories/events.js';
import { isProcessAlive } from '../../shared/proc.js';
import type { Session, SessionStatus } from '../../shared/types.js';

// Status "dipantau" (JANGAN diarsip default): sesi hidup / menunggu reset. Sisanya = terminal.
export const MONITORED_STATUSES: readonly SessionStatus[] = ['RUNNING', 'LIMIT_HIT', 'WAITING'];

export function isMonitored(status: SessionStatus): boolean {
  return MONITORED_STATUSES.includes(status);
}

export interface PruneOpts {
  ids: string[];
  all: boolean;
  force: boolean;
  isAlive: (pid: number) => boolean;
}

export interface PruneSelection {
  toArchive: Session[];
  skipped: { id: string; reason: string }[];
}

/** True bila sesi masih "hidup" (pid ada + proses jalan) — jangan diarsip tanpa --force (race daemon). */
function isAliveSession(s: Session, isAlive: (pid: number) => boolean): boolean {
  return s.pid !== null && isAlive(s.pid);
}

/** PURE: tentukan sesi mana yang diarsip (soft, ADR-004 — TAK hard-delete). `active` = sesi belum
 *  ter-arsip (`listActive`). Semantik:
 *   • `--all`      → semua sesi aktif (termasuk yang dipantau/hidup — eksplisit, ber-peringatan di caller).
 *   • `ids` diberi → hanya id itu; id dipantau/hidup di-SKIP kecuali `--force`; id tak ada → skip.
 *   • default      → hanya sesi TERMINAL & tak-hidup (dipantau/hidup di-sisakan). */
export function selectPrunable(active: Session[], opts: PruneOpts): PruneSelection {
  const byId = new Map(active.map((s) => [s.id, s]));

  if (opts.all) {
    return { toArchive: active, skipped: [] };
  }

  if (opts.ids.length > 0) {
    const toArchive: Session[] = [];
    const skipped: { id: string; reason: string }[] = [];
    for (const id of opts.ids) {
      const s = byId.get(id);
      if (s === undefined) {
        skipped.push({ id, reason: 'tak ada di sesi aktif (sudah diarsip / tak dikenal)' });
        continue;
      }
      if (!opts.force && (isMonitored(s.status) || isAliveSession(s, opts.isAlive))) {
        const why = isMonitored(s.status) ? `dipantau (${s.status})` : 'proses masih hidup';
        skipped.push({ id, reason: `${why} — pakai --force untuk memaksa` });
        continue;
      }
      toArchive.push(s);
    }
    return { toArchive, skipped };
  }

  // Default: terminal & tak-hidup.
  const toArchive = active.filter((s) => !isMonitored(s.status) && !isAliveSession(s, opts.isAlive));
  return { toArchive, skipped: [] };
}

/** `acca prune [ids...]` — arsipkan (SOFT, ADR-004) sesi supaya `acca status` tetap relevan.
 *  Data TIDAK dihapus (archived_at di-set; row tetap di DB untuk audit/retensi never-purge). */
export function registerPruneCommand(program: Command): void {
  program
    .command('prune')
    .argument('[ids...]', 'id sesi spesifik untuk diarsip (opsional)')
    .option('--all', 'arsipkan SEMUA sesi (termasuk yang dipantau/hidup)')
    .option('--force', 'paksa arsip id dipantau/hidup')
    .option('--dry-run', 'tampilkan yang AKAN diarsip tanpa mengubah apa pun')
    .description('Arsipkan sesi (soft, tak hapus) agar status tetap relevan; default: sesi terminal saja')
    .action((ids: string[], opts: { all?: boolean; force?: boolean; dryRun?: boolean }) => {
      const db = openDb();
      try {
        const sessions = createSessionsRepo(db);
        const events = createEventsRepo(db);
        const active = sessions.listActive();

        if (active.length === 0) {
          console.log('Tak ada sesi aktif untuk diarsip.');
          return;
        }

        const sel = selectPrunable(active, {
          ids,
          all: opts.all ?? false,
          force: opts.force ?? false,
          isAlive: isProcessAlive,
        });

        for (const sk of sel.skipped) {
          console.log(`  dilewati #${sk.id}: ${sk.reason}`);
        }

        if (sel.toArchive.length === 0) {
          console.log('Tak ada sesi yang cocok untuk diarsip.');
          return;
        }

        if (opts.dryRun) {
          console.log(`[dry-run] akan mengarsip ${sel.toArchive.length} sesi:`);
          for (const s of sel.toArchive) console.log(`  #${s.id}  ${s.tool}  ${s.status}`);
          return;
        }

        // Peringatan bila mengarsip sesi yang masih dipantau/hidup (--all / --force).
        for (const s of sel.toArchive) {
          if (isMonitored(s.status) || isAliveSession(s, isProcessAlive)) {
            console.log(`  ⚠ mengarsip sesi yang masih aktif: #${s.id} (${s.status})`);
          }
          sessions.archive(s.id);
          // Audit (append-only, ADR-004/NFR): catat aksi arsip + status sebelumnya. `from`/`source`
          // ada di SUMMARY_ALLOWLIST log.ts → tampil di `acca log` (bukan payload mentah).
          events.append({ session_id: s.id, type: 'session_archived', payload: { source: 'prune', from: s.status } });
        }

        console.log(`Diarsip ${sel.toArchive.length} sesi (soft — data tetap ada, hilang dari status).`);
      } finally {
        closeDb(db);
      }
    });
}
