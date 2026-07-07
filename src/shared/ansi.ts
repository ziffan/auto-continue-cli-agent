// Strip sekuens ANSI/CSI dari output PTY. Stream `onData` node-pty (terutama ConPTY di Windows)
// menyisipkan warna/kursor (mis. "\x1b[31m", "\x1b[?25l") di sekitar/di dalam baris "polos" (G-20)
// → cocokkan frasa (limit / footer TUI) atas teks yang SUDAH di-strip, bukan mentah.
// Cakupan = CSI (ESC "[" params... final-byte); OSC/charset belum di-strip (perluas bila perlu).

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;?]*[a-zA-Z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}
