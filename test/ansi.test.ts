import { describe, expect, it } from 'vitest';
import { stripAnsi } from '../src/shared/ansi.js';

describe('stripAnsi', () => {
  it('strip CSI warna/kursor (baseline)', () => {
    expect(stripAnsi('\x1b[31mhalo\x1b[0m')).toBe('halo');
    expect(stripAnsi('\x1b[?25lteks\x1b[?25h')).toBe('teks'); // DEC private mode
  });

  it('I-28/A-15: strip OSC judul window (terminator BEL) tanpa memakan teks sesudahnya', () => {
    // ConPTY kerap kirim judul window `\x1b]0;<title>\x07` di depan baris polos.
    expect(stripAnsi('\x1b]0;Antigravity CLI\x07Individual quota reached')).toBe('Individual quota reached');
  });

  it('I-28/A-15: strip OSC dgn terminator ST (ESC backslash)', () => {
    expect(stripAnsi('\x1b]8;;https://x\x1b\\link')).toBe('link');
  });

  it('I-28/A-15: strip designasi charset G0/G1', () => {
    expect(stripAnsi('\x1b(Bteks\x1b)0')).toBe('teks');
  });

  it('teks polos tak berubah', () => {
    expect(stripAnsi('usage limit reached')).toBe('usage limit reached');
  });

  it('campuran CSI + OSC + charset dalam satu baris', () => {
    expect(stripAnsi('\x1b]0;title\x07\x1b[32m\x1b(Bhit your session limit\x1b[0m')).toBe(
      'hit your session limit',
    );
  });
});
