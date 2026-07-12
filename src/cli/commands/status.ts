import type { Command } from 'commander';
import { closeDb, openDb } from '../../store/db.js';
import { createSessionsRepo } from '../../store/repositories/sessions.js';
import { createMetaRepo } from '../../store/repositories/meta.js';
import { isProcessAlive } from '../../shared/proc.js';
import type { Session, Tool, UsageLimit } from '../../shared/types.js';

const COLUMNS = ['#id', 'tool', 'status', 'reset', 'proc', 'pid', 'cwd', 'updated'] as const;

// ── Usage-view (M4/AC-4) — helper PURE, unit-testable tanpa DB/commander ──────────────────────

/** `tool` → label tampilan. */
function toolLabel(tool: Tool): string {
  return tool === 'claude' ? 'CLAUDE CODE' : 'ANTIGRAVITY CLI';
}

/** Clamp fraction ke [0,1]; NaN/nilai tak-finite → 0. */
function clampFraction(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  if (fraction < 0) return 0;
  if (fraction > 1) return 1;
  return fraction;
}

/** Umur snapshot relatif dari `nowMs - capturedAt`: <60s → `${s}s`, else → `${m}m`.
 *  Negatif/tak-finite (clock skew, data rusak) → `?`. */
function relativeAge(nowMsVal: number, capturedAt: number): string {
  const diffMs = nowMsVal - capturedAt;
  if (!Number.isFinite(diffMs) || diffMs < 0) return '?';
  const diffS = Math.floor(diffMs / 1000);
  if (diffS < 60) return `${diffS}s`;
  return `${Math.floor(diffS / 60)}m`;
}

/** Render bar usage `▓`/`░` sepanjang `width` (default 10) dari `usedFraction` (0..1, di-clamp). */
export function renderUsageBar(usedFraction: number, width = 10): string {
  const clamped = clampFraction(usedFraction);
  const filled = Math.round(clamped * width);
  return '▓'.repeat(filled) + '░'.repeat(width - filled);
}

/** Pure: format snapshot usage mentah (raw JSON string dari `meta.usage_snapshot_<tool>`) jadi
 *  baris-baris teks siap-cetak. Parse DEFENSIF — snapshot rusak/tak dikenal tak boleh crash `status`.
 *
 *  FIREWALL (G-9): HANYA `tool`, `limit.kind`, bar usage, dan persen yang dirender. `scope` (bisa
 *  berisi display-name model) & field lain APA PUN tidak pernah disurface di sini. */
export function formatUsageLines(tool: Tool, raw: string | undefined, nowMs: number): string[] {
  const label = toolLabel(tool);

  if (raw === undefined) {
    return [`${label}  (usage belum ada — jalankan \`acca daemon\`)`];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [`${label}  (usage tak terbaca)`];
  }

  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { limits?: unknown }).limits)) {
    return [`${label}  (usage tak terbaca)`];
  }

  const snapshot = parsed as { limits: UsageLimit[]; capturedAt: number };
  const age = relativeAge(nowMs, snapshot.capturedAt);
  const lines = [`${label}  (diperbarui ${age} lalu)`];

  if (snapshot.limits.length === 0) {
    lines.push('  (tak ada window aktif)');
    return lines;
  }

  const kindWidth = Math.max(...snapshot.limits.map((l) => String(l.kind).length));
  for (const limit of snapshot.limits) {
    const kind = String(limit.kind).padEnd(kindWidth);
    const pct = Math.round(clampFraction(limit.usedFraction) * 100);
    lines.push(`  ${kind}  ${renderUsageBar(limit.usedFraction)}  ${pct}%`);
  }
  return lines;
}

/** Nama hari ringkas (lokal) untuk sel reset jangka-jauh — konsisten wireframe §5 ("resume ~Sen"). */
const DAY_NAMES = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'] as const;
const MS_PER_DAY = 86_400_000;

/** I-24 (audit A-6): format sel `reset` tabel sesi — `HH:MM` waktu LOKAL + sumber dalam kurung.
 *  `resetAt === null` → sesi belum punya jadwal reset diketahui. Pakai getHours/getMinutes LOKAL
 *  (bukan toISOString UTC) karena wireframe §5 menampilkan waktu lokal ("resume 03:15 WIB").
 *
 *  B-2 (audit followup 12 Jul): reset window MINGGUAN (agy weekly / CC seven_day) bisa 6 hari lagi —
 *  `HH:MM` saja terbaca "malam ini" & MENYESATKAN. Bila reset > 24 jam dari sekarang → sertakan nama
 *  hari lokal (`Sen 03:15`) supaya jelas ini bukan hari ini; ≤ 24 jam tetap `HH:MM` (ringkas). */
export function formatResetCell(resetAt: number | null, resetSource: string | null, nowMs: number): string {
  if (resetAt === null) return '-';
  const d = new Date(resetAt);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const hhmm = `${hh}:${mm}`;
  const time = resetAt - nowMs > MS_PER_DAY ? `${DAY_NAMES[d.getDay()]} ${hhmm}` : hhmm;
  return resetSource === null ? time : `${time} (${resetSource})`;
}

/** I-24 (audit A-6): baris liveness daemon dicetak sebelum tabel sesi — `acca status` sebelumnya
 *  tak pernah menyatakan hidup/mati-nya daemon (AC-4 over-claim, audit). Pure: `isAlive` di-inject
 *  agar testable tanpa `process.kill` nyata. */
export function formatDaemonLiveness(
  hb: { at: number; pid: number } | undefined,
  nowMs: number,
  isAlive: (pid: number) => boolean,
): string {
  if (hb === undefined) return 'daemon: belum pernah jalan (jalankan `acca daemon`)';
  const age = relativeAge(nowMs, hb.at);
  if (isAlive(hb.pid)) return `daemon: HIDUP (pid ${hb.pid}, heartbeat ${age} lalu)`;
  return `daemon: MATI (heartbeat ${age} lalu, pid ${hb.pid} tak hidup)`;
}

function toRow(session: Session, nowMs: number): string[] {
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
    formatResetCell(session.reset_at, session.reset_source, nowMs),
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
        const meta = createMetaRepo(db);
        for (const tool of ['claude', 'antigravity'] as const) {
          for (const line of formatUsageLines(tool, meta.get(`usage_snapshot_${tool}`), Date.now())) {
            console.log(line);
          }
        }
        console.log('');

        console.log(formatDaemonLiveness(meta.getHeartbeat(), Date.now(), isProcessAlive));
        console.log('');

        const sessions = createSessionsRepo(db);
        const active = sessions.listActive();

        if (active.length === 0) {
          console.log('Belum ada sesi. Jalankan: acca run -- <cli>');
          return;
        }

        const now = Date.now();
        console.log(renderTable(active.map((s) => toRow(s, now))));
      } finally {
        closeDb(db);
      }
    });
}
