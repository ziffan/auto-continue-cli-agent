// Strip sekuens ANSI/escape dari output PTY. Stream `onData` node-pty (terutama ConPTY di Windows)
// menyisipkan warna/kursor (mis. "\x1b[31m", "\x1b[?25l") di sekitar/di dalam baris "polos" (G-20)
// → cocokkan frasa (limit / footer TUI) atas teks yang SUDAH di-strip, bukan mentah.
// I-28 (A-15): cakupan diperluas dari CSI-saja ke juga OSC (mis. judul window `\x1b]0;...\x07`) &
// designasi charset — supaya teks di dalam/di sekitar sekuens itu tak salah lolos ke detektor
// limit / idle-tracker (G-20 watch ditutup). Cakupan:
//   • CSI:      ESC "[" params(0-9;?) final-byte(alpha)      → warna/kursor
//   • OSC:      ESC "]" ... terminator BEL(\x07) atau ST(ESC \)  → judul window / hyperlink
//   • charset:  ESC "(" | ")" + (A|B|0)                       → designasi G0/G1
// (DEC private mode `\x1b[?25l` sudah tercakup CSI karena `?` diizinkan di params.)

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][AB0]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

// ── Warna ANSI minimal (zero-dep — ADR-027) ──────────────────────────────────────────────────
// Dipakai banner/splash. Wrapping selalu opt-in via parameter `enabled` supaya jalur non-TTY /
// NO_COLOR mengeluarkan teks polos (unit-testable tanpa TTY nyata, tak menarik chalk/kleur).
const RESET = '\x1b[0m';
export const ANSI = { dim: '\x1b[2m', bold: '\x1b[1m', cyan: '\x1b[36m' } as const;

/** Bungkus `text` dengan kode ANSI `code` bila `enabled`; else kembalikan teks apa adanya. */
export function paint(text: string, code: string, enabled: boolean): string {
  return enabled ? `${code}${text}${RESET}` : text;
}
