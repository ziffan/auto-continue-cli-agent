import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseAgyUserStatus,
  parseClaudeOAuthUsage,
  parseClaudeStatusLine,
  UsageParseError,
} from '../src/adapters/usage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures', 'usage');

function loadFixture(fileName: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, fileName), 'utf8')) as unknown;
}

const NOW = 1_800_000_000_000; // titik waktu tetap yang di-inject — bukti `capturedAt` bukan `Date.now()` langsung.

describe('parseClaudeOAuthUsage (api/oauth/usage — RESEARCH §2 poin 2)', () => {
  const raw = loadFixture('cc-oauth-usage.json');

  it('parses limits[] entries, skipping the one missing `percent`', () => {
    const snapshot = parseClaudeOAuthUsage(raw, NOW);
    // Fixture punya 4 entri limits[], 1 malformed (tanpa percent) → 3 tersisa.
    expect(snapshot.limits).toHaveLength(3);
    expect(snapshot.tool).toBe('claude');
    expect(snapshot.capturedAt).toBe(NOW);
  });

  it('usedFraction = percent/100', () => {
    const snapshot = parseClaudeOAuthUsage(raw, NOW);
    const session = snapshot.limits.find((l) => l.kind === 'session');
    expect(session?.usedFraction).toBeCloseTo(0.52, 10);
    const weeklyAll = snapshot.limits.find((l) => l.kind === 'weekly_all');
    expect(weeklyAll?.usedFraction).toBeCloseTo(0.55, 10);
  });

  it('resetAt = Date.parse(ISO) — exact ms, not epoch-seconds path', () => {
    const snapshot = parseClaudeOAuthUsage(raw, NOW);
    const session = snapshot.limits.find((l) => l.kind === 'session');
    expect(session?.resetAt).toBe(Date.parse('2026-07-03T14:19:59.58+00:00'));
  });

  it('weekly_scoped carries scope = display_name and isActive mapped', () => {
    const snapshot = parseClaudeOAuthUsage(raw, NOW);
    const scoped = snapshot.limits.find((l) => l.kind === 'weekly_scoped');
    expect(scoped?.scope).toBe('Fable');
    expect(scoped?.usedFraction).toBeCloseTo(0.62, 10);
    expect(scoped?.isActive).toBe(true);
    const session = snapshot.limits.find((l) => l.kind === 'session');
    expect(session?.isActive).toBe(false);
  });

  it('the malformed entry (missing percent) is absent from output', () => {
    const snapshot = parseClaudeOAuthUsage(raw, NOW);
    const broken = snapshot.limits.find((l) => l.scope === 'Broken');
    expect(broken).toBeUndefined();
  });

  it('clamps an out-of-range percent (>100) to usedFraction 1', () => {
    const withOverflow = { limits: [{ kind: 'session', percent: 150, resets_at: null }] };
    const snapshot = parseClaudeOAuthUsage(withOverflow, NOW);
    expect(snapshot.limits[0]?.usedFraction).toBe(1);
  });

  it('throws UsageParseError for non-object top-level input', () => {
    expect(() => parseClaudeOAuthUsage(null, NOW)).toThrow(UsageParseError);
    expect(() => parseClaudeOAuthUsage(42, NOW)).toThrow(UsageParseError);
    expect(() => parseClaudeOAuthUsage('str', NOW)).toThrow(UsageParseError);
  });

  it('an object with no recognizable usage fields returns empty limits (no throw)', () => {
    const snapshot = parseClaudeOAuthUsage({ unrelated: true }, NOW);
    expect(snapshot).toEqual({ tool: 'claude', limits: [], capturedAt: NOW });
  });
});

describe('parseClaudeStatusLine (statusLine JSON — RESEARCH §2 poin 1)', () => {
  const raw = loadFixture('cc-statusline.json');

  it('parses five_hour + seven_day buckets', () => {
    const snapshot = parseClaudeStatusLine(raw, NOW);
    expect(snapshot.limits).toHaveLength(2);
    expect(snapshot.tool).toBe('claude');
  });

  it('resetAt = epoch_seconds * 1000 — exact, proving the ×1000 path (G-4, distinct from OAuth ISO path)', () => {
    const snapshot = parseClaudeStatusLine(raw, NOW);
    const fiveHour = snapshot.limits.find((l) => l.kind === 'five_hour');
    expect(fiveHour?.resetAt).toBe(1738425600 * 1000);
    const sevenDay = snapshot.limits.find((l) => l.kind === 'seven_day');
    expect(sevenDay?.resetAt).toBe(1738857600 * 1000);
  });

  it('fractional used_percentage parsed as fraction (23.5 → 0.235)', () => {
    const snapshot = parseClaudeStatusLine(raw, NOW);
    const fiveHour = snapshot.limits.find((l) => l.kind === 'five_hour');
    expect(fiveHour?.usedFraction).toBeCloseTo(0.235, 10);
  });

  it('an absent bucket (only five_hour present) is skipped, not defaulted', () => {
    const partial = { rate_limits: { five_hour: { used_percentage: 10, resets_at: 1000 } } };
    const snapshot = parseClaudeStatusLine(partial, NOW);
    expect(snapshot.limits).toHaveLength(1);
    expect(snapshot.limits[0]?.kind).toBe('five_hour');
  });

  it('throws UsageParseError for non-object top-level input', () => {
    expect(() => parseClaudeStatusLine(null, NOW)).toThrow(UsageParseError);
    expect(() => parseClaudeStatusLine(undefined, NOW)).toThrow(UsageParseError);
    expect(() => parseClaudeStatusLine([1, 2, 3], NOW)).toThrow(UsageParseError);
  });

  it('an object with no rate_limits field returns empty limits (no throw)', () => {
    const snapshot = parseClaudeStatusLine({ model: { id: 'x' } }, NOW);
    expect(snapshot).toEqual({ tool: 'claude', limits: [], capturedAt: NOW });
  });
});

describe('parseAgyUserStatus (GetUserStatus — ADR-010)', () => {
  const raw = loadFixture('agy-userstatus.json');

  it('parses per-model limits, usedFraction = 1 - remainingFraction', () => {
    const snapshot = parseAgyUserStatus(raw, NOW);
    expect(snapshot.tool).toBe('antigravity');
    // 3 configs di fixture, 1 tanpa quotaInfo → 2 tersisa.
    expect(snapshot.limits).toHaveLength(2);
    const claude = snapshot.limits.find((l) => l.kind === 'claude-sonnet-4-5');
    expect(claude?.usedFraction).toBeCloseTo(0.2, 10);
    const gemini = snapshot.limits.find((l) => l.kind === 'gemini-2.5-flash');
    expect(gemini?.usedFraction).toBeCloseTo(0.37, 10);
  });

  it('resetAt parsed from ISO resetTime, distinct reset windows per model (ADR-010)', () => {
    const snapshot = parseAgyUserStatus(raw, NOW);
    const claude = snapshot.limits.find((l) => l.kind === 'claude-sonnet-4-5');
    expect(claude?.resetAt).toBe(Date.parse('2026-07-03T14:55:00.000Z'));
    const gemini = snapshot.limits.find((l) => l.kind === 'gemini-2.5-flash');
    expect(gemini?.resetAt).toBe(Date.parse('2026-07-03T17:15:00.000Z'));
  });

  it('config missing quotaInfo is skipped', () => {
    const snapshot = parseAgyUserStatus(raw, NOW);
    const broken = snapshot.limits.find((l) => l.kind === 'gemini-2.5-pro-broken');
    expect(broken).toBeUndefined();
  });

  it('PII firewall: serialized snapshot never contains the fixture name or email (G-9)', () => {
    const snapshot = parseAgyUserStatus(raw, NOW);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('Ziffan Testuser');
    expect(serialized).not.toContain('ziffan.test@example.com');
    // Juga tak boleh bocor field noise lain (plan/credits) — bukti ekstraksi ketat, bukan hanya PII.
    expect(serialized).not.toContain('availableCredits');
    expect(serialized).not.toContain('monthlyPromptCredits');
  });

  it('tolerates a flat response (no top-level `userStatus` wrapper)', () => {
    const flat = {
      cascadeModelConfigData: {
        clientModelConfigs: [
          { model: 'claude-sonnet-4-5', quotaInfo: { remainingFraction: 0.5, resetTime: '2026-07-03T10:00:00.000Z' } },
        ],
      },
    };
    const snapshot = parseAgyUserStatus(flat, NOW);
    expect(snapshot.limits).toHaveLength(1);
    expect(snapshot.limits[0]?.usedFraction).toBeCloseTo(0.5, 10);
  });

  it('clamps an out-of-range remainingFraction (>1) to usedFraction 0', () => {
    const overflow = {
      cascadeModelConfigData: {
        clientModelConfigs: [{ model: 'x', quotaInfo: { remainingFraction: 1.5, resetTime: null } }],
      },
    };
    const snapshot = parseAgyUserStatus(overflow, NOW);
    expect(snapshot.limits[0]?.usedFraction).toBe(0);
    expect(snapshot.limits[0]?.resetAt).toBeNull();
  });

  it('missing model-label field falls back to positional label, not crash', () => {
    const noLabel = {
      cascadeModelConfigData: {
        clientModelConfigs: [{ quotaInfo: { remainingFraction: 0.9, resetTime: '2026-07-03T10:00:00.000Z' } }],
      },
    };
    const snapshot = parseAgyUserStatus(noLabel, NOW);
    expect(snapshot.limits[0]?.kind).toBe('model-0');
  });

  it('throws UsageParseError for non-object top-level input', () => {
    expect(() => parseAgyUserStatus(null, NOW)).toThrow(UsageParseError);
    expect(() => parseAgyUserStatus('nope', NOW)).toThrow(UsageParseError);
  });

  it('an object with no recognizable cascade data returns empty limits (no throw)', () => {
    const snapshot = parseAgyUserStatus({ name: 'x', email: 'y' }, NOW);
    expect(snapshot).toEqual({ tool: 'antigravity', limits: [], capturedAt: NOW });
    // Bukti tambahan firewall PII: bahkan pada payload minimal, name/email tak ikut lewat.
    expect(JSON.stringify(snapshot)).not.toContain('"x"');
  });
});
