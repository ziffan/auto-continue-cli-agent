import { describe, expect, it } from 'vitest';
import {
  renderInlineBadge,
  renderSplash,
  resolveBannerCaps,
  type BannerCaps,
} from '../src/shared/banner.js';
import { stripAnsi } from '../src/shared/ansi.js';
import { matchAgyLimit, matchLimit } from '../src/adapters/patterns.js';

const caps = (over: Partial<BannerCaps>): BannerCaps => ({
  enabled: true,
  color: false,
  unicode: true,
  ...over,
});

const isPureAscii = (s: string): boolean => [...s].every((c) => c.charCodeAt(0) < 128);

// ── resolveBannerCaps (boundary impur, di-inject penuh) ───────────────────────────────────────

describe('resolveBannerCaps — gating ADR-027', () => {
  it('non-TTY → semua mati (banner tak boleh cetak saat di-pipe/redirect)', () => {
    const c = resolveBannerCaps({ isTTY: false, platform: 'linux', env: {} });
    expect(c).toEqual({ enabled: false, color: false, unicode: false });
  });

  it('TTY + linux + tanpa NO_COLOR → semua nyala', () => {
    const c = resolveBannerCaps({ isTTY: true, platform: 'linux', env: {} });
    expect(c).toEqual({ enabled: true, color: true, unicode: true });
  });

  it('--no-banner (opts.noBanner) → enabled mati walau TTY', () => {
    const c = resolveBannerCaps({ isTTY: true, noBanner: true, platform: 'linux', env: {} });
    expect(c.enabled).toBe(false);
  });

  it('NO_COLOR di-set → warna mati, banner tetap boleh', () => {
    const c = resolveBannerCaps({ isTTY: true, platform: 'linux', env: { NO_COLOR: '1' } });
    expect(c.color).toBe(false);
    expect(c.enabled).toBe(true);
  });

  it('NO_COLOR="" (string kosong) diperlakukan TAK-set → warna tetap boleh', () => {
    const c = resolveBannerCaps({ isTTY: true, platform: 'linux', env: { NO_COLOR: '' } });
    expect(c.color).toBe(true);
  });

  it('Windows legacy (win32 tanpa WT_SESSION/TERM_PROGRAM/WSL) → unicode KONSERVATIF mati', () => {
    const c = resolveBannerCaps({ isTTY: true, platform: 'win32', env: {} });
    expect(c.unicode).toBe(false);
    expect(c.enabled).toBe(true); // banner tetap tampil, hanya varian ASCII
  });

  it('Windows Terminal (WT_SESSION) → unicode nyala', () => {
    const c = resolveBannerCaps({ isTTY: true, platform: 'win32', env: { WT_SESSION: 'abc' } });
    expect(c.unicode).toBe(true);
  });
});

// ── renderSplash ──────────────────────────────────────────────────────────────────────────────

describe('renderSplash', () => {
  it('banner tak diizinkan (enabled:false) → string kosong', () => {
    expect(renderSplash(caps({ enabled: false }))).toBe('');
  });

  it('unicode → memuat glyph ∞ + box-drawing + tagline', () => {
    const out = renderSplash(caps({ unicode: true }));
    expect(out).toContain('c∞c');
    expect(out).toContain('┏');
    expect(out).toContain('never lose a session to a limit.');
  });

  it('ASCII fallback → BEBAS non-ASCII (nol mojibake) + pakai <> dan +-|', () => {
    const out = renderSplash(caps({ unicode: false, color: false }));
    expect(isPureAscii(out)).toBe(true);
    expect(out).toContain('c<>c');
    expect(out).toContain('+--');
    expect(out).not.toContain('∞');
    expect(out).not.toContain('·'); // koreksi middle-dot BRANDING → '.'
  });

  it('color:false → nol sekuens ANSI (ESC)', () => {
    expect(renderSplash(caps({ color: false }))).not.toContain('\x1b');
  });

  it('color:true → ada sekuens ANSI, tapi teks tanpa-ANSI tetap sama isinya', () => {
    const colored = renderSplash(caps({ color: true }));
    expect(colored).toContain('\x1b');
    expect(stripAnsi(colored)).toContain('c∞c');
  });
});

// ── renderInlineBadge ─────────────────────────────────────────────────────────────────────────

describe('renderInlineBadge', () => {
  it('banner tak diizinkan → "" (jalur data status TETAP bersih saat di-pipe)', () => {
    expect(renderInlineBadge(caps({ enabled: false }))).toBe('');
  });

  it('unicode → gauge ▓░ + em-dash + label', () => {
    const out = renderInlineBadge(caps({ unicode: true, color: false }));
    expect(out).toContain('▓▓▓░░');
    expect(out).toContain('—');
    expect(out).toContain('auto-continue on reset');
  });

  it('ASCII fallback → [###..] + hyphen ASCII, BEBAS non-ASCII', () => {
    const out = renderInlineBadge(caps({ unicode: false, color: false }));
    expect(isPureAscii(out)).toBe(true);
    expect(out).toContain('[###..]');
    expect(out).not.toContain('—');
  });
});

// ── Keamanan lintas-modul: brand output TAK boleh memicu detektor limit (firewall/gate) ─────────

describe('brand output tak memicu detektor limit', () => {
  const variants = [
    renderSplash(caps({ unicode: true, color: true })),
    renderSplash(caps({ unicode: false, color: false })),
    renderInlineBadge(caps({ unicode: true, color: true })),
    renderInlineBadge(caps({ unicode: false, color: false })),
  ];

  it('matchLimit / matchAgyLimit → null untuk semua varian banner', () => {
    for (const v of variants) {
      expect(matchLimit(stripAnsi(v))).toBeNull();
      expect(matchAgyLimit(stripAnsi(v))).toBeNull();
    }
  });
});
