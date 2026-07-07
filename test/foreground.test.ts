// Gating inject-continue poin (ii) ADR-014 — foreground = agent bukan shell (I-13).

import { describe, expect, it, vi } from 'vitest';
import {
  classifyForeground,
  foregroundIsAgent,
  parseStatPgrpTpgid,
} from '../src/shared/foreground.js';

/** Bangun isi `/proc/<pid>/stat` realistis. Field: pid (comm) state ppid pgrp session tty_nr tpgid ... */
function stat(opts: { pid?: number; comm?: string; pgrp: number; tpgid: number }): string {
  const { pid = 4242, comm = 'node', pgrp, tpgid } = opts;
  // sesudah tpgid, ada banyak field lain — sertakan beberapa agar realistis.
  return `${pid} (${comm}) S 1000 ${pgrp} ${pgrp} 34816 ${tpgid} 4194304 0 0 0 20 0 1 0 998877`;
}

describe('parseStatPgrpTpgid', () => {
  it('parses pgrp (field 5) and tpgid (field 8)', () => {
    expect(parseStatPgrpTpgid(stat({ pgrp: 4242, tpgid: 4242 }))).toEqual({ pgrp: 4242, tpgid: 4242 });
    expect(parseStatPgrpTpgid(stat({ pgrp: 100, tpgid: 200 }))).toEqual({ pgrp: 100, tpgid: 200 });
  });

  it('handles a comm containing spaces and parentheses (parse from LAST paren)', () => {
    const s = `77 (weird ) name) S 1 55 55 0 -1 0 0 0 0 20 0 1 0 1`;
    expect(parseStatPgrpTpgid(s)).toEqual({ pgrp: 55, tpgid: -1 });
  });

  it('returns null on malformed input', () => {
    expect(parseStatPgrpTpgid('')).toBeNull();
    expect(parseStatPgrpTpgid('no parens here')).toBeNull();
    expect(parseStatPgrpTpgid('1 (node) S 1')).toBeNull(); // terlalu sedikit field
    expect(parseStatPgrpTpgid('1 (node) S x y z w q')).toBeNull(); // non-numeric
  });
});

describe('classifyForeground', () => {
  it('true when tpgid == pgrp (agent group owns terminal foreground)', () => {
    expect(classifyForeground({ pgrp: 4242, tpgid: 4242 })).toBe(true);
  });

  it('false when a different group (>0) owns the foreground (drop-to-shell)', () => {
    expect(classifyForeground({ pgrp: 4242, tpgid: 4300 })).toBe(false);
  });

  it('undefined when tpgid <= 0 (no foreground / not a tty)', () => {
    expect(classifyForeground({ pgrp: 4242, tpgid: -1 })).toBeUndefined();
    expect(classifyForeground({ pgrp: 4242, tpgid: 0 })).toBeUndefined();
  });
});

describe('foregroundIsAgent', () => {
  it('true on Linux when the child group is foreground', () => {
    const readFile = vi.fn((p: string) => {
      expect(p).toBe('/proc/4242/stat');
      return stat({ pid: 4242, pgrp: 4242, tpgid: 4242 });
    });
    expect(foregroundIsAgent(4242, { platform: () => 'linux', readFile })).toBe(true);
  });

  it('false on Linux when a subshell group holds the foreground', () => {
    const readFile = () => stat({ pgrp: 4242, tpgid: 4300 });
    expect(foregroundIsAgent(4242, { platform: () => 'linux', readFile })).toBe(false);
  });

  it('undefined on Windows (no simple tpgid) without reading /proc', () => {
    const readFile = vi.fn(() => 'should not be called');
    expect(foregroundIsAgent(4242, { platform: () => 'win32', readFile })).toBeUndefined();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('undefined (never throws) when /proc read fails — process gone / race', () => {
    const readFile = () => {
      throw new Error('ENOENT');
    };
    expect(foregroundIsAgent(4242, { platform: () => 'linux', readFile })).toBeUndefined();
  });

  it('undefined when stat is malformed', () => {
    expect(foregroundIsAgent(4242, { platform: () => 'linux', readFile: () => 'garbage' })).toBeUndefined();
  });
});
