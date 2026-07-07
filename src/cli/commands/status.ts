import type { Command } from 'commander';
import { closeDb, openDb } from '../../store/db.js';
import { createSessionsRepo } from '../../store/repositories/sessions.js';
import { isProcessAlive } from '../../shared/proc.js';
import type { Session } from '../../shared/types.js';

const COLUMNS = ['#id', 'tool', 'status', 'proc', 'pid', 'cwd', 'updated'] as const;

function toRow(session: Session): string[] {
  // Sesi 'alive' yang PID-nya sudah mati = orphan (wrapper mati keras sebelum markExited,
  // ISSUES I-1/I-3). Tandai di tampilan; jangan menulis DB (status = read-only).
  const stale =
    session.proc_state === 'alive' && session.pid !== null && !isProcessAlive(session.pid);
  // I-14: sesi hasil resume-by-id menautkan sesi asalnya (rantai resume) — tampilkan `#new<-#old`.
  const idCell = session.resumed_from ? `#${session.id}<-#${session.resumed_from}` : `#${session.id}`;
  return [
    idCell,
    session.tool,
    stale ? `${session.status} (basi)` : session.status,
    session.proc_state,
    session.pid === null ? '-' : String(session.pid),
    session.cwd,
    new Date(session.updated_at).toISOString(),
  ];
}

function renderTable(rows: string[][]): string {
  const widths = COLUMNS.map((header, colIndex) =>
    Math.max(header.length, ...rows.map((row) => (row[colIndex] ?? '').length)),
  );
  const renderLine = (cells: readonly string[]): string =>
    cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join('  ');

  const lines = [renderLine(COLUMNS), ...rows.map((row) => renderLine(row))];
  return lines.join('\n');
}

/** `acca status` — daftar sesi aktif (archived_at IS NULL), empty-state ramah bila kosong. */
export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Tampilkan sesi aktif yang tercatat di store')
    .action(() => {
      const db = openDb();
      try {
        const sessions = createSessionsRepo(db);
        const active = sessions.listActive();

        if (active.length === 0) {
          console.log('Belum ada sesi. Jalankan: acca run -- <cli>');
          return;
        }

        console.log(renderTable(active.map(toRow)));
      } finally {
        closeDb(db);
      }
    });
}
