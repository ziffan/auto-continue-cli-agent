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
  // antara "your" dan "limit" → pola wajib izinkan satu kata opsional, bukan "\bhit your limit" kontigu
  // (kalau kontigu, pesan asli LOLOS = false-negative). Mencakup juga "you've \bhit your limit". G-15, RESEARCH §2b.
  /\bhit your (?:\w+ )?limit\b/i,
  /\brate limit hit\b/i,
  /\bplease try again in \d+ hours?\b/i,
];

/**
 * VERIFIED (4 Jul 2026 — limit 5-jam agy ASLI, G-19 / FINDINGS F4/F10): TUI menampilkan
 * `⚠ \bIndividual \bquota reached. Please upgrade your subscription to increase your limits.
 * Resets in <Xm Ys>.` + baris `Error ID: <uuid>`. agy TETAP HIDUP setelah pesan (limit ≠ exit).
 * Antigravity tak punya hook/transcript JSONL seperti CC (transcript = protobuf, RESEARCH §4d)
 * — hanya output/exit-code yang bisa diperiksa; catatan: `agy -p` print-mode stdout KOSONG saat
 * limit (G-18) → deteksi teks hanya dari rendering TUI interaktif.
 *
 * Pattern #1 = frasa inti TERVERIFIKASI (anchor). #2 = generalisasi konservatif dari token nyata
 * "\bquota reached" (mencakup exhausted/exceeded bila wording sedikit bergeser). Varian wording lain
 * (mis. limit MINGGUAN) BELUM tertangkap → sengaja tak ditebak: sinyal exhaustion agy yang lebih
 * andal daripada teks TUI = LS-probe `remainingFraction` absent (G-17) + credit habis/off (G-16).
 */
// I-36 gate: baris ini SENGAJA dikecualikan (marker di bawah) — pattern[0]'s literal source text
// ("\bindividual \bquota reached") mengandung substring "\bquota reached" yang independen memenuhi
// pattern[1] (didahului spasi dari "individual " → word-boundary alami ADA). Ini BUKAN prosa yang
// mengutip pesan (risiko yang I-36 targetkan) — ini LOGIKA DETEKSI itu sendiri; tak bisa "diperbaiki"
// dengan menyisip \b tanpa mengubah semantik regex (terbukti saat percobaan pertama gate ini — lihat
// GOTCHAS G-46). Dikecualikan sama seperti test/fixtures/**, dengan alasan yang sama: korpus wajib
// memuat literal itu untuk berfungsi.
const AGY_LIMIT_PATTERNS: RegExp[] = [/\bindividual quota reached\b/i, /\bquota\s+(?:reached|exhausted|exceeded)\b/i]; // gate:allow-canonical-literal

/**
 * G-36 (live-verify 11 Jul, agy 1.1.1): saat sesi agy interaktif ditutup (Ctrl-C 2×), agy MENCETAK
 * perintah resume eksplisit `Resume with -c (or command below): agy --conversation=<uuid>` — ini
 * sumber ANDAL `cli_session_id` agy untuk resume-by-id (I-20/R2b; bukan tebakan ".db termuda" yang racy).
 * Tangkap uuid dari bentuk `--conversation=<uuid>` (bentuk `=` terverifikasi live; spasi = low-risk,
 * Go-flag terima dua-duanya). KONSERVATIF: hanya UUID kanonik (8-4-4-4-12 hex) — id non-UUID TAK
 * ditangkap (lebih baik BLOCKED/manual daripada resume dgn id salah yang PASTI ditolak CLI).
 */
const AGY_RESUME_ID_PATTERN = /--conversation[=\s]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;

/** Jam dinding + timezone opsional dalam kurung: "3pm (UTC)" / "2:30pm (America/New_York)". */
const CLOCK_TIME_PATTERN = /(\d{1,2}(?::\d{2})?\s*[ap]m)(?:\s*\(([^)]+)\))?/i;

/** Relatif: "in 5 hours" / "in 5 hour". */
const RELATIVE_HOURS_PATTERN = /\bin (\d+) hours?\b/i;

/**
 * C-6 (audit ketiga): countdown reset agy KOMPAK `Resets in 4h31m7s` / `Resets in 59m14s` (G-19 — angka
 * langsung menempel unit, TANPA spasi). Tangkap komponen jam/menit/detik → ResetHint relatif (di bawah
 * isoTimestamp LS-probe dalam presedensi estimator, jadi TAK menggeser sumber reset absolut yang lebih
 * andal — hanya menggantikan backoff saat output = satu-satunya sinyal). Wajib prefiks `resets in` +
 * unit RAPAT (`\d+h` bukan `\d+\s*h`) supaya tak keliru menangkap bentuk kata "in 5 hours" (spasi) atau
 * angka+huruf acak di transcript. Minimal satu komponen harus ada (dijaga di extractResetHint). */
const AGY_RELATIVE_RESET_PATTERN = /\bresets?\s+in\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i;

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

/** Ekstrak reset-hint (clockTime/timezone/relative h/m/s) dari baris yang sudah diklasifikasi limit. */
function extractResetHint(text: string): ResetHint | undefined {
  const hint: ResetHint = {};

  const relative = RELATIVE_HOURS_PATTERN.exec(text);
  const relativeValue = relative?.[1];
  if (relativeValue !== undefined) {
    hint.relativeHours = Number(relativeValue);
  }

  // C-6: countdown kompak agy `Resets in 4h31m7s`. Hanya berlaku bila BUKAN bentuk kata di atas
  // (mutually exclusive: `\d+h` rapat tak cocok "5 hours" berspasi). Set hanya komponen yang match.
  const agyRel = AGY_RELATIVE_RESET_PATTERN.exec(text);
  if (agyRel) {
    const [, h, m, s] = agyRel;
    if (h !== undefined) hint.relativeHours = Number(h);
    if (m !== undefined) hint.relativeMinutes = Number(m);
    if (s !== undefined) hint.relativeSeconds = Number(s);
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

/** Cocokkan pola usage-limit Antigravity (VERIFIED 4 Jul — lihat komentar AGY_LIMIT_PATTERNS). */
export function matchAgyLimit(text: string): { evidence: string; resetHint?: ResetHint } | null {
  for (const pattern of AGY_LIMIT_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return { evidence: match[0], resetHint: extractResetHint(text) };
  }
  return null;
}

/** Ekstrak `cli_session_id` agy (uuid) dari baris resume-cmd yang agy cetak saat exit (G-36).
 *  Return uuid (lowercase-normalized) bila match, else null. Konservatif (UUID kanonik saja). */
export function matchAgyResumeId(text: string): string | null {
  const match = AGY_RESUME_ID_PATTERN.exec(text);
  return match?.[1] ? match[1].toLowerCase() : null;
}
