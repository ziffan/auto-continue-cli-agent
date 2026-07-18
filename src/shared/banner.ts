// Banner / splash `acca` (ADR-027, desain docs/BRANDING.md §3–5). Fungsi render = PURE: menerima
// `BannerCaps` yang sudah di-resolve, tak menyentuh `process` — supaya unit-testable tanpa TTY nyata
// DAN tak pernah mengontaminasi jalur data `acca status` (snapshot/pipe). Satu-satunya boundary impur
// = `resolveBannerCaps` (baca isTTY/env/platform). Gating WAJIB ADR-027:
//   • TTY-only        → banner hanya bila stdout TTY (di-pipe/redirect ⇒ '' polos)
//   • NO_COLOR        → nonaktifkan warna
//   • --plain/--no-banner → matikan eksplisit (via opts.noBanner)
//   • ASCII fallback  → glyph non-ASCII punya padanan; default KONSERVATIF ASCII bila kapabilitas ragu
//   • zero-dep        → helper ANSI kecil `shared/ansi.ts`, bukan chalk/kleur
import { ANSI, paint } from './ansi.js';

export interface BannerCaps {
  /** Boleh mencetak banner sama sekali (isTTY ∧ ¬--no-banner). */
  enabled: boolean;
  /** Boleh mencetak ANSI warna (enabled ∧ ¬NO_COLOR). */
  color: boolean;
  /** Boleh glyph non-ASCII (enabled ∧ terminal mampu). Ragu ⇒ false (default ASCII). */
  unicode: boolean;
}

// Env sebagai map biasa + platform sebagai `string` — sengaja HINDARI namespace ambient `NodeJS.*`
// (pola sama foreground.ts / port-discovery.ts; ambient global tak dikenal eslint no-undef).
type EnvMap = Record<string, string | undefined>;

export interface ResolveBannerOpts {
  isTTY?: boolean;
  noBanner?: boolean;
  env?: EnvMap;
  platform?: string;
}

/** Kapabilitas unicode terminal — KONSERVATIF (ADR-027 "default ASCII bila tak pasti").
 *  Non-Windows: terminal modern default UTF-8 → true. Windows: hanya host yang andal render glyph
 *  non-ASCII (Windows Terminal / VS Code / WSL); conhost legacy (CP437/CP1252) → ASCII (hindari mojibake). */
function detectUnicode(env: EnvMap, platform: string): boolean {
  if (platform !== 'win32') return true;
  return Boolean(env.WT_SESSION ?? env.TERM_PROGRAM ?? env.WSL_DISTRO_NAME);
}

/** Boundary impur: resolve gating dari isTTY/env/platform (di-inject penuh untuk test). */
export function resolveBannerCaps(opts: ResolveBannerOpts = {}): BannerCaps {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const isTTY = opts.isTTY ?? Boolean(process.stdout.isTTY);
  const enabled = isTTY && !opts.noBanner;
  // NO_COLOR: env standar — set (walau string kosong "0"/"") = nonaktif warna. Spec no-color.org:
  // "set to ANY value" → cukup keberadaannya. Kita perlakukan string-kosong = TAK set (opt-out longgar).
  const noColor = env.NO_COLOR !== undefined && env.NO_COLOR !== '';
  return { enabled, color: enabled && !noColor, unicode: enabled && detectUnicode(env, platform) };
}

// Tagline resmi (BRANDING §3.1). Dipilih supaya TAK cocok pola CC_LIMIT_PATTERNS/AGY_LIMIT_PATTERNS
// (patterns.ts) — dijaga oleh test/banner.test.ts + gate no-canonical-limit-literals (I-35/I-36).
const TAGLINE = 'never lose a session to a limit.';

// Wordmark "The Loop" (BRANDING §3.1). Dua varian sejajar: unicode (glyph ∞/box-drawing/·) + ASCII
// fallback (<>/+-|/.). Reproduksi verbatim dari BRANDING, dengan koreksi: middle-dot `·` (U+00B7)
// di varian "ASCII" BRANDING BUKAN ASCII → di sini diganti `.` agar benar-benar bebas mojibake.
const SPLASH_UNICODE = [
  '  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
  '  ┃   a ( c∞c ) a   ·  acca     ┃',
  '  ┃   auto-continue cli agent   ┃',
  '  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛',
];
const SPLASH_ASCII = [
  '  +-----------------------------+',
  '  |   a ( c<>c ) a   .  acca     |',
  '  |   auto-continue cli agent   |',
  '  +-----------------------------+',
];

/** Splash wordmark penuh — momen "kenalan" (BRANDING §4: `acca`/`--help`/`--version`/`daemon`-start
 *  + empty-state). Kembalikan '' bila banner tak diizinkan → caller cukup cetak apa adanya, nol cek ganda. */
export function renderSplash(caps: BannerCaps): string {
  if (!caps.enabled) return '';
  const box = caps.unicode ? SPLASH_UNICODE : SPLASH_ASCII;
  const lines = box.map((line, i) => (i === 1 ? paint(line, ANSI.bold + ANSI.cyan, caps.color) : line));
  lines.push(`  ${paint(TAGLINE, ANSI.dim, caps.color)}`);
  return lines.join('\n');
}

const GAUGE_FILLED = 3;
const GAUGE_WIDTH = 5;

/** Inline brand-badge 1-baris untuk header `acca status` (BRANDING §3.3, TTY-only). Kembalikan ''
 *  bila banner tak diizinkan → jalur data `status` (pipe/snapshot) TETAP bersih. Gauge = mark
 *  identitas TETAP (dekoratif), sengaja BEDA dari bar usage data di bawahnya — bukan angka usage. */
export function renderInlineBadge(caps: BannerCaps): string {
  if (!caps.enabled) return '';
  const gauge = caps.unicode
    ? '▓'.repeat(GAUGE_FILLED) + '░'.repeat(GAUGE_WIDTH - GAUGE_FILLED)
    : `[${'#'.repeat(GAUGE_FILLED)}${'.'.repeat(GAUGE_WIDTH - GAUGE_FILLED)}]`;
  const sep = caps.unicode ? '—' : '-';
  return `acca ${paint(gauge, ANSI.cyan, caps.color)} ${sep} auto-continue on reset`;
}
