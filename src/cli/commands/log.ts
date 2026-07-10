import type { Command } from 'commander';
import { closeDb, openDb } from '../../store/db.js';
import { createEventsRepo, type StoredEvent } from '../../store/repositories/events.js';

/** Kunci payload yang boleh disurface di `summary` — semua label/enum/id yang KITA hasilkan sendiri
 *  (bukan teks bebas dari sumber tak tepercaya). Urutan di sini = urutan tampil. FIREWALL (G-9,
 *  ADR-008/013): `evidence` (snippet output PTY) & kunci APA PUN di luar daftar ini TIDAK PERNAH
 *  disurface — payload masa depan bisa membawa PII/rahasia dari output/probe. */
const SUMMARY_ALLOWLIST = [
  'to',
  'from',
  'source',
  'reason',
  'action',
  'status',
  'kind',
  'jobId',
  'newSessionId',
  'run_at',
  'attempts',
  'exitCode',
  'where',
  'reachable',
] as const;

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Pure: satu event → baris teks. Summary hanya dari ALLOWLIST field terkontrol (lihat firewall di
 *  atas) — payload mentah TAK PERNAH di-dump. Unit-testable tanpa DB. */
export function formatEventLine(e: StoredEvent): string {
  const payload = parsePayload(e.payload);
  const parts: string[] = [];
  for (const key of SUMMARY_ALLOWLIST) {
    const value = payload[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}=${String(value)}`);
    }
  }
  const summary = parts.join(' ');
  const sessionCell = e.session_id ? `#${e.session_id}` : '·';
  const iso = new Date(e.created_at).toISOString();
  return [iso, sessionCell, e.type, summary].join('  ').trimEnd();
}

/** `acca log [sessionId]` — riwayat event (audit trail) terbaru, opsional difilter ke satu sesi. */
export function registerLogCommand(program: Command): void {
  program
    .command('log')
    .argument('[sessionId]', 'filter ke satu sesi (opsional)')
    .option('-n, --limit <n>', 'jumlah maksimum event', '50')
    .description('Tampilkan riwayat event (audit trail) terbaru')
    .action((sessionId: string | undefined, opts: { limit: string }) => {
      const limit = Number.parseInt(opts.limit, 10);
      if (!Number.isInteger(limit) || limit <= 0) {
        console.error('--limit harus berupa integer positif');
        process.exitCode = 1;
        return;
      }

      const db = openDb();
      try {
        const events = createEventsRepo(db);
        const rows = sessionId ? events.listBySession(sessionId, limit) : events.listRecent(limit);

        if (rows.length === 0) {
          console.log(sessionId ? `Tak ada event untuk sesi #${sessionId}.` : 'Belum ada event tercatat.');
          return;
        }

        for (const row of rows) {
          console.log(formatEventLine(row));
        }
      } finally {
        closeDb(db);
      }
    });
}
