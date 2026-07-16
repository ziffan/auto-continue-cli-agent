// Estimasi reset_at (epoch ms UTC) dari ResetHint. Murni — `now` di-inject (test deterministik),
// TAK PERNAH panggil Date.now() di sini (CONVENTIONS.md). Presedensi (yang pertama usable menang):
// epochSeconds > isoTimestamp > relative(h/m/s) > clockTime(+tz) > heuristik windowHint > backoff.

import type { ResetHint } from '../adapters/types.js';
import type { ResetSource } from '../shared/types.js';

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const FIVE_HOUR_WINDOW_MS = 5 * MS_PER_HOUR;
const SEVEN_DAY_WINDOW_MS = 7 * 24 * MS_PER_HOUR;

/**
 * I-30 (live-verify 16 Jul): clock-time reset yang tampak SUDAH LEWAT sedikit = reset kemungkinan besar
 * BARU SAJA terjadi (mis. banner "resets 10:20pm" di-parse pukul 22:31 — 11 menit lewat), BUKAN besok.
 * Bila `now - candidate <= HORIZON` → jangan wrap +24 jam; jadwalkan probe near-now. `clockTime` (parseClockTime)
 * hanya HH:MM am/pm tanpa hari → memang untuk reset window pendek (5-jam); horizon 2 jam konservatif
 * membedakan "baru lewat / skew jam" dari occurrence besok yang sah (yang lewat jauh > horizon). Reversibel. */
const RECENT_PAST_HORIZON_MS = 2 * MS_PER_HOUR;
/** I-30: delay probe saat reset dinilai "baru saja lewat" — kuota semestinya sudah pulih; jeda kecil beri
 *  ruang propagasi reset sebelum probe. */
const RESET_JUST_ELAPSED_PROBE_DELAY_MS = 60 * MS_PER_SECOND;

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
 * `recentlyPast=true` (I-30): clock-time hari ini sudah lewat TAPI hanya baru saja (≤ HORIZON) →
 * reset dinilai baru terjadi, caller jadwalkan probe near-now alih-alih memakai `instant` (yang di-wrap besok).
 */
function resolveClockTime(
  clockTime: string,
  timezone: string | undefined,
  now: number,
): { instant: number; recentlyPast: boolean } | null {
  const parsed = parseClockTime(clockTime);
  if (parsed === null) return null;

  const tz = timezone?.trim();
  const isUtc = tz === undefined || tz === '' || /^(utc|gmt)$/i.test(tz);

  if (isUtc) {
    const nowDate = new Date(now);
    const today = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate(), parsed.hour, parsed.minute, 0, 0);
    if (today <= now) {
      // I-30: baru saja lewat → reset kemungkinan besar baru terjadi (bukan besok).
      if (now - today <= RECENT_PAST_HORIZON_MS) return { instant: today, recentlyPast: true };
      // Lewat jauh → "next occurrence". UTC tak ber-DST → tambah 24 jam mentah aman.
      return { instant: today + MS_PER_DAY, recentlyPast: false };
    }
    return { instant: today, recentlyPast: false };
  }

  try {
    const today = getDatePartsInZone(now, tz);
    const candidate = resolveWallClockToUtc(today.year, today.month, today.day, parsed.hour, parsed.minute, tz);
    if (candidate <= now) {
      // I-30: baru saja lewat → reset baru terjadi.
      if (now - candidate <= RECENT_PAST_HORIZON_MS) return { instant: candidate, recentlyPast: true };
      // "Next occurrence" DST-correct (I-4/G-13): wall-clock SAMA di tanggal kalender berikutnya pada
      // zona, dengan offset dihitung ulang DI tanggal itu — BUKAN menambah MS_PER_DAY mentah (yang
      // meleset ±1 jam di hari transisi DST karena hari lokal = 23/25 jam, bukan tepat 24).
      const next = new Date(Date.UTC(today.year, today.month, today.day + 1));
      const tomorrow = resolveWallClockToUtc(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate(), parsed.hour, parsed.minute, tz);
      return { instant: tomorrow, recentlyPast: false };
    }
    return { instant: candidate, recentlyPast: false };
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

  // Relatif h/m/s (C-6): CC "in 5 hours" (relativeHours) atau agy kompak "Resets in 4h31m7s"
  // (relativeHours+relativeMinutes+relativeSeconds). Jumlahkan komponen yang ada → now + total.
  if (
    hint?.relativeHours !== undefined ||
    hint?.relativeMinutes !== undefined ||
    hint?.relativeSeconds !== undefined
  ) {
    const relMs =
      (hint.relativeHours ?? 0) * MS_PER_HOUR +
      (hint.relativeMinutes ?? 0) * MS_PER_MINUTE +
      (hint.relativeSeconds ?? 0) * MS_PER_SECOND;
    return { resetAt: opts.now + relMs, source: 'exact' };
  }

  if (hint?.clockTime !== undefined) {
    const resolved = resolveClockTime(hint.clockTime, hint.timezone, opts.now);
    if (resolved !== null) {
      // I-30: clock-time baru saja lewat → JANGAN pakai instant (yang di-wrap besok = +24 jam meleset);
      // reset dinilai baru terjadi → probe near-now. Source 'heuristic' (bukan 'exact' yang menyesatkan).
      if (resolved.recentlyPast) {
        return { resetAt: opts.now + RESET_JUST_ELAPSED_PROBE_DELAY_MS, source: 'heuristic' };
      }
      return { resetAt: resolved.instant, source: 'exact' };
    }
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
