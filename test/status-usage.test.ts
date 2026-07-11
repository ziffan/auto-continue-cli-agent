import { describe, expect, it } from 'vitest';
import { formatUsageLines, renderUsageBar } from '../src/cli/commands/status.js';

describe('renderUsageBar', () => {
  it('0 → semua kosong', () => {
    expect(renderUsageBar(0)).toBe('░░░░░░░░░░');
  });

  it('1 → semua terisi', () => {
    expect(renderUsageBar(1)).toBe('▓▓▓▓▓▓▓▓▓▓');
  });

  it('0.5 → 5 terisi dari 10', () => {
    expect(renderUsageBar(0.5)).toBe('▓▓▓▓▓░░░░░');
  });

  it('clamp: >1 → dianggap 1', () => {
    expect(renderUsageBar(1.5)).toBe('▓▓▓▓▓▓▓▓▓▓');
  });

  it('clamp: <0 → dianggap 0', () => {
    expect(renderUsageBar(-0.3)).toBe('░░░░░░░░░░');
  });

  it('clamp: NaN → dianggap 0', () => {
    expect(renderUsageBar(Number.NaN)).toBe('░░░░░░░░░░');
  });

  it('width custom', () => {
    expect(renderUsageBar(0.5, 4)).toBe('▓▓░░');
    expect(renderUsageBar(1, 20)).toBe('▓'.repeat(20));
  });
});

describe('formatUsageLines', () => {
  it('raw undefined → satu baris label + "belum ada"', () => {
    const lines = formatUsageLines('claude', undefined, 1_000);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('CLAUDE CODE');
    expect(lines[0]).toContain('belum ada');
  });

  it('snapshot valid (2 limit) → header + satu baris per kind dengan persen benar', () => {
    const nowMsVal = 1_000_000;
    const raw = JSON.stringify({
      tool: 'claude',
      capturedAt: nowMsVal - 5_000,
      limits: [
        { kind: 'session', usedFraction: 0.37, resetAt: null },
        { kind: 'weekly_all', usedFraction: 0.9, resetAt: null },
      ],
    });
    const lines = formatUsageLines('claude', raw, nowMsVal);
    expect(lines[0]).toContain('CLAUDE CODE');
    expect(lines[0]).toContain('diperbarui');

    const sessionLine = lines.find((l) => l.includes('session'));
    const weeklyLine = lines.find((l) => l.includes('weekly_all'));
    expect(sessionLine).toBeDefined();
    expect(weeklyLine).toBeDefined();
    expect(sessionLine).toContain('37%');
    expect(weeklyLine).toContain('90%');
    // bar 10 karakter: 37% → round(3.7)=4 terisi; 90% → 9 terisi.
    expect(sessionLine).toContain('▓▓▓▓░░░░░░');
    expect(weeklyLine).toContain('▓▓▓▓▓▓▓▓▓░');
  });

  it('FIREWALL: scope tak pernah disurface', () => {
    const nowMsVal = 1_000_000;
    const raw = JSON.stringify({
      tool: 'claude',
      capturedAt: nowMsVal,
      limits: [{ kind: 'weekly_scoped', usedFraction: 0.5, resetAt: null, scope: 'Claude-Opus-SECRET-modelname' }],
    });
    const lines = formatUsageLines('claude', raw, nowMsVal);
    const joined = lines.join('\n');
    expect(joined).not.toContain('SECRET');
    expect(joined).not.toContain('Claude-Opus');
  });

  it('raw non-JSON → baris "tak terbaca", tak crash', () => {
    expect(() => formatUsageLines('claude', 'not json', 1_000)).not.toThrow();
    const lines = formatUsageLines('claude', 'not json', 1_000);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('tak terbaca');
  });

  it('raw JSON objek tapi limits bukan array → "tak terbaca"', () => {
    const lines = formatUsageLines('antigravity', JSON.stringify({ tool: 'antigravity', limits: 'nope' }), 1_000);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('ANTIGRAVITY CLI');
    expect(lines[0]).toContain('tak terbaca');
  });

  it('limits: [] → baris "(tak ada window aktif)"', () => {
    const nowMsVal = 1_000_000;
    const raw = JSON.stringify({ tool: 'claude', capturedAt: nowMsVal, limits: [] });
    const lines = formatUsageLines('claude', raw, nowMsVal);
    expect(lines.some((l) => l.includes('tak ada window aktif'))).toBe(true);
  });

  it('umur: capturedAt = nowMs-90000 → baris header memuat "1m"', () => {
    const nowMsVal = 1_000_000;
    const raw = JSON.stringify({
      tool: 'claude',
      capturedAt: nowMsVal - 90_000,
      limits: [{ kind: 'session', usedFraction: 0.1, resetAt: null }],
    });
    const lines = formatUsageLines('claude', raw, nowMsVal);
    expect(lines[0]).toContain('1m');
  });

  it('antigravity label benar', () => {
    const lines = formatUsageLines('antigravity', undefined, 1_000);
    expect(lines[0]).toContain('ANTIGRAVITY CLI');
  });
});
