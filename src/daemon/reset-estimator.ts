// Estimasi reset_at (epoch ms UTC) dari ResetHint. Murni — `now` di-inject (test deterministik),
// TAK PERNAH panggil Date.now() di sini (CONVENTIONS.md). Presedensi (yang pertama usable menang):
// epochSeconds > isoTimestamp > relativeHours > clockTime(+tz) > heuristik windowHint > backoff.

import type { ResetHint } from '../adapters/types.js';
import type { ResetSource } from '../shared/types.js';

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const FIVE_HOUR_WINDOW_MS = 5 * MS_PER_HOUR;
const SEVEN_DAY_WINDOW_MS = 7 * 24 * MS_PER_HOUR;

/** Backoff berjenjang (NFR): attempt 0→5m, 1→15m, 2→60m, ≥3→60m (cap — indeks terakhir diulang). */
const BACKOFF_SCHEDULE_MS: readonly number[] = [5 * MS_PER_MINUTE, 15 * MS_PER_MINUTE, 60 * MS_PER_MINUTE];

export interface ResetEstimate {
  resetAt: number; // epoch ms UTC
  source: ResetSource;
}

export interface EstimateOpts {
  now: number; // epoch ms — INJECTED (deterministic tests)
  detectedAt: number; // epoch ms
  attempt?: number; // untuk backoff (default 0)
  windowHint?: '5h' | '7d';
}

function backoffMs(attempt: number): number {
  const idx = Math.min(Math.max(attempt, 0), BACKOFF_SCHEDULE_MS.length - 1);
  // idx di-clamp ke rentang array yang valid → indexing selalu aman.
  return BACKOFF_SCHEDULE_MS[idx] as number;
}

/** "3pm" / "2:30pm" / "11am" → jam 0-23 + menit. Null bila bentuk tak dikenali. */
function parseClockTime(text: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*([ap])m$/i.exec(text.trim());
  if (!match) return null;
  const rawHourText = match[1];
  const meridiem = match[3];
  if (rawHourText === undefined || meridiem === undefined) return null;

  const rawHour = Number(rawHourText);
  const minuteText = match[2];
  const minute = minuteText !== undefined ? Number(minuteText) : 0;
  if (!Number.isFinite(rawHour) || rawHour < 1 || rawHour > 12 || minute > 59) return null;

  let hour = rawHour % 12; // 12am → 0, 12pm → 12 (basis sebelum tambah offset pm)
  if (meridiem.toLowerCase() === 'p') hour += 12;
  return { hour, minute };
}

/** Ubah `Intl.DateTimeFormatPart[]` jadi map `{type: value}`, buang bagian `literal`. */
function partsToMap(parts: Intl.DateTimeFormatPart[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return map;
}

/**
 * Offset UTC (ms) suatu zona IANA PADA instant `utcMs` tertentu (DST-correct: offset dihitung
 * di tanggal kandidat, bukan offset sekarang). Teknik: format instant di zona target, baca ulang
 * wall-clock hasilnya seolah-olah UTC, selisihnya = offset zona pada instant itu.
 */
function getTimeZoneOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map = partsToMap(dtf.formatToParts(new Date(utcMs)));
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - utcMs;
}

/** Tanggal kalender (Y/M0-indexed/D) suatu instant di zona `timeZone`. */
function getDatePartsInZone(utcMs: number, timeZone: string): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const map = partsToMap(dtf.formatToParts(new Date(utcMs)));
  return { year: Number(map.year), month: Number(map.month) - 1, day: Number(map.day) };
}

/** Instant UTC (ms) untuk wall-clock `Y-M-D hour:minute` di zona `timeZone`. */
function resolveWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const utcGuess = Date.UTC(year, month, day, hour, minute, 0, 0);
  const offsetMs = getTimeZoneOffsetMs(utcGuess, timeZone);
  return utcGuess - offsetMs;
}

/**
 * Resolusi `clockTime` (+ `timezone` opsional) ke instant UTC berikutnya relatif `now`.
 * Return null bila format tak terparse / zona IANA tak valid → caller jatuh ke heuristik.
 */
function resolveClockTime(clockTime: string, timezone: string | undefined, now: number): number | null {
  const parsed = parseClockTime(clockTime);
  if (parsed === null) return null;

  const tz = timezone?.trim();
  const isUtc = tz === undefined || tz === '' || /^(utc|gmt)$/i.test(tz);

  if (isUtc) {
    const nowDate = new Date(now);
    let candidate = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate(), parsed.hour, parsed.minute, 0, 0);
    // UTC tak ber-DST → "next occurrence" = tambah 24 jam mentah aman.
    if (candidate <= now) candidate += MS_PER_DAY;
    return candidate;
  }

  try {
    const today = getDatePartsInZone(now, tz);
    let candidate = resolveWallClockToUtc(today.year, today.month, today.day, parsed.hour, parsed.minute, tz);
    if (candidate <= now) {
      // "Next occurrence" DST-correct (I-4/G-13): wall-clock SAMA di tanggal kalender berikutnya pada
      // zona, dengan offset dihitung ulang DI tanggal itu — BUKAN menambah MS_PER_DAY mentah (yang
      // meleset ±1 jam di hari transisi DST karena hari lokal = 23/25 jam, bukan tepat 24).
      const next = new Date(Date.UTC(today.year, today.month, today.day + 1));
      candidate = resolveWallClockToUtc(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate(), parsed.hour, parsed.minute, tz);
    }
    return candidate;
  } catch {
    // RangeError: zona IANA tak dikenal Intl → tak bisa resolusi exact.
    return null;
  }
}

export function estimateReset(hint: ResetHint | undefined, opts: EstimateOpts): ResetEstimate {
  if (hint?.epochSeconds !== undefined) {
    return { resetAt: hint.epochSeconds * MS_PER_SECOND, source: 'exact' };
  }

  if (hint?.isoTimestamp !== undefined) {
    const parsed = Date.parse(hint.isoTimestamp);
    if (!Number.isNaN(parsed)) return { resetAt: parsed, source: 'exact' };
    // ISO tak valid → jatuh ke hint berikutnya, bukan langsung heuristik.
  }

  if (hint?.relativeHours !== undefined) {
    return { resetAt: opts.now + hint.relativeHours * MS_PER_HOUR, source: 'exact' };
  }

  if (hint?.clockTime !== undefined) {
    const resolved = resolveClockTime(hint.clockTime, hint.timezone, opts.now);
    if (resolved !== null) return { resetAt: resolved, source: 'exact' };
    // Tak terparse/zona invalid → jatuh ke heuristik/backoff di bawah.
  }

  if (opts.windowHint === '5h') {
    return { resetAt: opts.detectedAt + FIVE_HOUR_WINDOW_MS, source: 'heuristic' };
  }
  if (opts.windowHint === '7d') {
    return { resetAt: opts.detectedAt + SEVEN_DAY_WINDOW_MS, source: 'heuristic' };
  }

  return { resetAt: opts.now + backoffMs(opts.attempt ?? 0), source: 'backoff' };
}
