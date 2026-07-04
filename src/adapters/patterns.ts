// Korpus regex bersama untuk Detector (RESEARCH §2b — pola pesan limit CC; §2c — taxonomy
// overload-vs-usage-limit). Data murni + helper kecil; tak ada akses store/IPC di sini
// (klasifikasi saja — ADR-008/013, deteksi tak pernah menurunkan aksi dari isi output).

import type { ResetHint } from './types.js';

/**
 * Error transient (HTTP 429/5xx/529) — CC & agy sama-sama retry internal untuk ini.
 * BUKAN usage-limit; harus tetap `overload`, tak pernah naik jadi `limit` (RESEARCH §2c).
 */
const OVERLOAD_PATTERNS: RegExp[] = [/API Error:\s*(?:429|500|502|503|504|529)/i, /overloaded_error/i];

/**
 * Indikator retry internal CC yang sedang berjalan, mis. `(esc to interrupt · Retrying in 3s…)`.
 * Bentuk: sesuatu dalam kurung yang memuat "Retrying". False-positive guard — TAK PERNAH
 * diklasifikasi apa pun (harus `none`), diperiksa SEBELUM pola overload/limit lain.
 */
const TRANSIENT_RETRY_PATTERN = /\([^)]*Retrying[^)]*\)/i;

/**
 * Pola pesan usage-limit Claude Code (RESEARCH §2b, korpus komunitas). Sengaja KONSERVATIF —
 * bentuk kanonik saja, supaya prosa yang sekadar menyebut kata "limit"/"usage" (dokumentasi,
 * transcript yang mengutip) tidak ikut match (AC false-positive < 1/100, lihat test/fixtures/cc-noise.txt).
 */
const CC_LIMIT_PATTERNS: RegExp[] = [
  /\b\d+-hour limit reached\b/i,
  /\busage limit reached\b/i,
  /\bout of extra usage\b/i,
  // Varian NYATA (terkonfirmasi lokal 4 Jul 2026 dari limit 5-jam asli): "You've hit your session
  // limit · resets 7:30am (Asia/Jakarta)". Claude Code menyisipkan qualifier ("session"/"weekly")
  // antara "your" dan "limit" → pola wajib izinkan satu kata opsional, bukan "hit your limit" kontigu
  // (kalau kontigu, pesan asli LOLOS = false-negative). Mencakup juga "you've hit your limit". G-15, RESEARCH §2b.
  /\bhit your (?:\w+ )?limit\b/i,
  /\brate limit hit\b/i,
  /\bplease try again in \d+ hours?\b/i,
];

/**
 * PROVISIONAL: korpus agy belum diverifikasi dari terminal nyata (RESEARCH §6 TODO #2).
 * Antigravity tak punya hook/transcript JSONL seperti CC (transcript = protobuf, RESEARCH §4d)
 * — hanya output/exit-code yang bisa diperiksa. Pola dijaga minimal & konservatif; revisi begitu
 * korpus asli tertangkap dari sesi nyata.
 */
const AGY_LIMIT_PATTERNS: RegExp[] = [
  /\bquota\s+(?:exhausted|reached|exceeded)\b/i,
  /\bweekly limit\b/i,
  /\bquota\b[^.\n]{0,40}\bresets\b/i,
];

/** Jam dinding + timezone opsional dalam kurung: "3pm (UTC)" / "2:30pm (America/New_York)". */
const CLOCK_TIME_PATTERN = /(\d{1,2}(?::\d{2})?\s*[ap]m)(?:\s*\(([^)]+)\))?/i;

/** Relatif: "in 5 hours" / "in 5 hour". */
const RELATIVE_HOURS_PATTERN = /\bin (\d+) hours?\b/i;

/** Cocokkan overload/transient (429/5xx/529). Return substring yang match, atau null. */
export function matchOverload(text: string): string | null {
  for (const pattern of OVERLOAD_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  return null;
}

/** True bila baris adalah indikator retry internal CC yang sedang berjalan (bukan limit/overload). */
export function isTransientRetry(text: string): boolean {
  return TRANSIENT_RETRY_PATTERN.test(text);
}

/** Ekstrak reset-hint (clockTime/timezone/relativeHours) dari baris yang sudah diklasifikasi limit. */
function extractResetHint(text: string): ResetHint | undefined {
  const hint: ResetHint = {};

  const relative = RELATIVE_HOURS_PATTERN.exec(text);
  const relativeValue = relative?.[1];
  if (relativeValue !== undefined) {
    hint.relativeHours = Number(relativeValue);
  }

  const clock = CLOCK_TIME_PATTERN.exec(text);
  const clockValue = clock?.[1];
  if (clockValue !== undefined) {
    hint.clockTime = clockValue.trim();
    const tzValue = clock?.[2];
    if (tzValue !== undefined) hint.timezone = tzValue.trim();
  }

  return Object.keys(hint).length > 0 ? hint : undefined;
}

/** Cocokkan pola usage-limit Claude Code. Return evidence + resetHint jika match, else null. */
export function matchLimit(text: string): { evidence: string; resetHint?: ResetHint } | null {
  for (const pattern of CC_LIMIT_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return { evidence: match[0], resetHint: extractResetHint(text) };
  }
  return null;
}

/** Cocokkan pola usage-limit Antigravity (PROVISIONAL — lihat komentar AGY_LIMIT_PATTERNS). */
export function matchAgyLimit(text: string): { evidence: string; resetHint?: ResetHint } | null {
  for (const pattern of AGY_LIMIT_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return { evidence: match[0], resetHint: extractResetHint(text) };
  }
  return null;
}
