import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  claudeMaxBindingUsedFraction,
  claudeUsageAvailable,
  parseAgyQuotaSummary,
  parseAgyUserStatus,
  parseClaudeOAuthUsage,
  parseClaudeStatusLine,
  UsageParseError,
} from '../src/adapters/usage.js';
import type { UsageLimit, UsageSnapshot } from '../src/shared/types.js';

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
  const raw = loadFixture('agy-userstatus.json'); // capture LIVE Ubuntu 2026-07-05 (redaksi PII)

  it('parses per-model limits by real `label`, usedFraction = 1 - remainingFraction', () => {
    const snapshot = parseAgyUserStatus(raw, NOW);
    expect(snapshot.tool).toBe('antigravity');
    // Fixture live = 4 config, semua punya quotaInfo (3 ber-remainingFraction + 1 exhausted) → 4 limits.
    expect(snapshot.limits).toHaveLength(4);
    // Identitas model = `label` NYATA (bukan flat `model`; koreksi I-7).
    const opus = snapshot.limits.find((l) => l.kind === 'Claude Opus 4.6 (Thinking)');
    expect(opus?.usedFraction).toBeCloseTo(0, 10); // remainingFraction 1 → used 0
    const flash = snapshot.limits.find((l) => l.kind === 'Gemini 3.5 Flash (High)');
    expect(flash?.usedFraction).toBeCloseTo(1 - 0.8545074, 6);
  });

  it('resetAt parsed from ISO resetTime, distinct reset windows per model (ADR-010)', () => {
    const snapshot = parseAgyUserStatus(raw, NOW);
    const opus = snapshot.limits.find((l) => l.kind === 'Claude Opus 4.6 (Thinking)');
    expect(opus?.resetAt).toBe(Date.parse('2026-07-05T10:16:37Z'));
    const flash = snapshot.limits.find((l) => l.kind === 'Gemini 3.5 Flash (High)');
    expect(flash?.resetAt).toBe(Date.parse('2026-07-05T09:32:55Z'));
  });

  it('G-17: exhausted model (quotaInfo present, remainingFraction ABSENT) → usedFraction 1, NOT dropped', () => {
    const snapshot = parseAgyUserStatus(raw, NOW);
    // "Gemini 3.1 Pro (High)" di fixture = quotaInfo tanpa remainingFraction (hanya resetTime).
    const exhausted = snapshot.limits.find((l) => l.kind === 'Gemini 3.1 Pro (High)');
    expect(exhausted).toBeDefined(); // TIDAK di-skip — kalau di-skip, supervisor keliru resume.
    expect(exhausted?.usedFraction).toBe(1);
    expect(exhausted?.resetAt).toBe(Date.parse('2026-07-05T09:32:55Z'));
    // Konsekuensi consumer: dengan model habis terlihat, `every(usedFraction<1)` = false → tak resume.
    expect(snapshot.limits.every((l) => l.usedFraction < 1)).toBe(false);
  });

  it('config missing quotaInfo entirely is skipped (bukan model ber-kuota)', () => {
    const noQuota = {
      cascadeModelConfigData: {
        clientModelConfigs: [
          { label: 'has-quota', quotaInfo: { remainingFraction: 0.5, resetTime: null } },
          { label: 'no-quota-config', planInfo: { note: 'no quotaInfo → skip' } },
        ],
      },
    };
    const snapshot = parseAgyUserStatus(noQuota, NOW);
    expect(snapshot.limits).toHaveLength(1);
    expect(snapshot.limits.find((l) => l.kind === 'no-quota-config')).toBeUndefined();
  });

  it('remainingFraction present but non-finite (corrupt) → skip, not treated as exhausted', () => {
    const corrupt = {
      cascadeModelConfigData: {
        clientModelConfigs: [{ label: 'corrupt', quotaInfo: { remainingFraction: null, resetTime: '2026-07-05T09:32:55Z' } }],
      },
    };
    const snapshot = parseAgyUserStatus(corrupt, NOW);
    expect(snapshot.limits).toHaveLength(0);
  });

  it('reads modelOrAlias.model enum slug when no `label` field present', () => {
    const aliasOnly = {
      cascadeModelConfigData: {
        clientModelConfigs: [{ modelOrAlias: { model: 'MODEL_PLACEHOLDER_M26' }, quotaInfo: { remainingFraction: 0.5, resetTime: null } }],
      },
    };
    const snapshot = parseAgyUserStatus(aliasOnly, NOW);
    expect(snapshot.limits[0]?.kind).toBe('MODEL_PLACEHOLDER_M26');
  });

  it('PII firewall: serialized snapshot carries only quota, never name/email/credits/plan (G-9)', () => {
    const snapshot = parseAgyUserStatus(raw, NOW);
    const serialized = JSON.stringify(snapshot);
    // Bahkan placeholder PII yang sudah diredaksi di fixture tak ikut lewat → bukti ekstraksi ketat.
    expect(serialized).not.toContain('[REDACTED]');
    expect(serialized).not.toContain('Google AI Pro');
    expect(serialized).not.toContain('availablePromptCredits');
    expect(serialized).not.toContain('monthlyPromptCredits');
    expect(serialized).not.toContain('GOOGLE_ONE_AI');
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

describe('parseAgyQuotaSummary (RetrieveUserQuotaSummary — I-16/G-31)', () => {
  const raw = loadFixture('agy-quota-summary.json'); // capture LIVE Windows 2026-07-07 (redaksi PII)

  it('parses BOTH weekly + 5h buckets across all groups (4 limits) — the window GetUserStatus lacks', () => {
    const snapshot = parseAgyQuotaSummary(raw, NOW);
    expect(snapshot.tool).toBe('antigravity');
    expect(snapshot.limits).toHaveLength(4); // 2 grup × (weekly + 5h)
    const weeklies = snapshot.limits.filter((l) => l.kind === 'weekly');
    const fiveHours = snapshot.limits.filter((l) => l.kind === '5h');
    expect(weeklies).toHaveLength(2);
    expect(fiveHours).toHaveLength(2);
  });

  it('usedFraction = 1 - remainingFraction; scope = bucketId (non-PII)', () => {
    const snapshot = parseAgyQuotaSummary(raw, NOW);
    const geminiWeekly = snapshot.limits.find((l) => l.scope === 'gemini-weekly');
    expect(geminiWeekly?.kind).toBe('weekly');
    expect(geminiWeekly?.usedFraction).toBeCloseTo(1 - 0.26316896, 6);
    expect(geminiWeekly?.resetAt).toBe(Date.parse('2026-07-09T14:32:43Z'));
    const claudeWeekly = snapshot.limits.find((l) => l.scope === '3p-weekly');
    expect(claudeWeekly?.usedFraction).toBeCloseTo(1 - 0.39947107, 6);
  });

  it('the WHOLE POINT (I-16): a weekly bucket at 0 blocks resume even when 5h is full', () => {
    // Skenario nyata gap: 5-jam sudah reset (remainingFraction 1) tapi MINGGUAN habis.
    const weeklyExhausted = {
      response: {
        groups: [
          {
            buckets: [
              { bucketId: 'g-weekly', window: 'weekly', resetTime: '2026-07-09T00:00:00Z' }, // remainingFraction ABSENT = exhausted (G-17)
              { bucketId: 'g-5h', window: '5h', remainingFraction: 1, resetTime: '2026-07-07T20:00:00Z' },
            ],
          },
        ],
      },
    };
    const snapshot = parseAgyQuotaSummary(weeklyExhausted, NOW);
    const weekly = snapshot.limits.find((l) => l.kind === 'weekly');
    expect(weekly?.usedFraction).toBe(1); // exhausted, TIDAK di-skip
    // Consumer supervisor: `every(usedFraction<1)` = false → TAK resume. Inilah yang GetUserStatus tak bisa lihat.
    expect(snapshot.limits.every((l) => l.usedFraction < 1)).toBe(false);
  });

  it('a malformed bucket (no window & no bucketId) is skipped, NOT treated as exhausted', () => {
    const malformed = { response: { groups: [{ buckets: [{ remainingFraction: 1 }, { foo: 'bar' }] }] } };
    const snapshot = parseAgyQuotaSummary(malformed, NOW);
    expect(snapshot.limits).toHaveLength(0); // dua-duanya tak beridentitas → skip
  });

  it('remainingFraction present but non-finite (corrupt) → skip', () => {
    const corrupt = { response: { groups: [{ buckets: [{ window: 'weekly', remainingFraction: null }] }] } };
    const snapshot = parseAgyQuotaSummary(corrupt, NOW);
    expect(snapshot.limits).toHaveLength(0);
  });

  it('tolerates a flat response (no top-level `response` wrapper)', () => {
    const flat = { groups: [{ buckets: [{ window: '5h', bucketId: 'g-5h', remainingFraction: 0.5, resetTime: null }] }] };
    const snapshot = parseAgyQuotaSummary(flat, NOW);
    expect(snapshot.limits).toHaveLength(1);
    expect(snapshot.limits[0]?.usedFraction).toBeCloseTo(0.5, 10);
  });

  it('PII firewall (G-9): serialized snapshot never carries displayName/description/[REDACTED]', () => {
    const snapshot = parseAgyQuotaSummary(raw, NOW);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('[REDACTED]');
    expect(serialized).not.toContain('Models within this group');
    expect(serialized).not.toContain('weekly limit, it will fully refresh');
  });

  it('throws UsageParseError for non-object top-level input', () => {
    expect(() => parseAgyQuotaSummary(null, NOW)).toThrow(UsageParseError);
    expect(() => parseAgyQuotaSummary('nope', NOW)).toThrow(UsageParseError);
  });

  it('an object with no groups returns empty limits (no throw)', () => {
    expect(parseAgyQuotaSummary({ response: {} }, NOW)).toEqual({ tool: 'antigravity', limits: [], capturedAt: NOW });
    expect(parseAgyQuotaSummary({ unrelated: true }, NOW)).toEqual({ tool: 'antigravity', limits: [], capturedAt: NOW });
  });
});

describe('claudeUsageAvailable (I-25 — gate resume CC hanya window mengikat)', () => {
  function snap(limits: UsageLimit[]): UsageSnapshot {
    return { tool: 'claude', limits, capturedAt: NOW };
  }
  const lim = (kind: string, usedFraction: number, extra: Partial<UsageLimit> = {}): UsageLimit => ({
    kind,
    usedFraction,
    resetAt: null,
    ...extra,
  });

  it('AVAILABLE when globals are free even if an UNUSED model-scoped weekly is exhausted (the I-25 bug)', () => {
    // Sesi jalan Sonnet; weekly Opus (scoped, TAK aktif) habis → JANGAN blokir resume.
    const s = snap([
      lim('session', 0.37),
      lim('weekly_all', 0.36),
      lim('weekly_scoped', 1, { scope: 'Claude Opus 4.6', isActive: false }),
    ]);
    expect(claudeUsageAvailable(s)).toBe(true);
  });

  it('NOT available when a GLOBAL window (session/weekly_all) is exhausted', () => {
    expect(claudeUsageAvailable(snap([lim('session', 1), lim('weekly_all', 0.2)]))).toBe(false);
    expect(claudeUsageAvailable(snap([lim('session', 0.2), lim('weekly_all', 1)]))).toBe(false);
  });

  it('NOT available when the ACTIVE scoped model is exhausted (model actually in use is limited)', () => {
    const s = snap([
      lim('session', 0.2),
      lim('weekly_all', 0.2),
      lim('weekly_scoped', 1, { scope: 'Claude Sonnet 4.6', isActive: true }),
    ]);
    expect(claudeUsageAvailable(s)).toBe(false);
  });

  it('AVAILABLE when the active scoped model still has quota (globals + active scoped both free)', () => {
    const s = snap([
      lim('session', 0.5),
      lim('weekly_all', 0.5),
      lim('weekly_scoped', 0.8, { scope: 'Claude Sonnet 4.6', isActive: true }),
      lim('weekly_scoped', 1, { scope: 'Claude Opus 4.6', isActive: false }),
    ]);
    expect(claudeUsageAvailable(s)).toBe(true);
  });

  it('falls back to strict every() when NO gating window can be identified (all scoped, none active)', () => {
    // Skema tak dikenal (tak ada global, tak ada scoped-aktif) → sisi aman: blokir bila ada yang habis.
    const s = snap([
      lim('weekly_scoped', 1, { scope: 'Model A', isActive: false }),
      lim('weekly_scoped', 0.3, { scope: 'Model B', isActive: false }),
    ]);
    expect(claudeUsageAvailable(s)).toBe(false);
  });
});

describe('claudeMaxBindingUsedFraction (I-35 — korroborasi sinyal limit OUTPUT)', () => {
  function snap(limits: UsageLimit[]): UsageSnapshot {
    return { tool: 'claude', limits, capturedAt: NOW };
  }
  const lim = (kind: string, usedFraction: number, extra: Partial<UsageLimit> = {}): UsageLimit => ({
    kind,
    usedFraction,
    resetAt: null,
    ...extra,
  });

  it('mengambil MAX di antara window mengikat — bentuk snapshot NYATA saat FP live 17 Jul', () => {
    // Persis snapshot sesi z36i saat LIMIT_HIT palsu: session 0.55 + weekly_all 0.39 + scoped non-aktif.
    const s = snap([
      lim('session', 0.55, { isActive: true }),
      lim('weekly_all', 0.39, { isActive: false }),
      lim('weekly_scoped', 0, { scope: 'Fable', isActive: false }),
    ]);
    expect(claudeMaxBindingUsedFraction(s)).toBeCloseTo(0.55);
  });

  it('scoped NON-aktif yang habis TAK mengerek angka — konsisten dgn definisi mengikat I-25', () => {
    // Kalau scoped-non-aktif ikut dihitung, max jadi 1.0 → korroborasi mati & FP lolos.
    const s = snap([
      lim('session', 0.2),
      lim('weekly_scoped', 1, { scope: 'Claude Opus 4.6', isActive: false }),
    ]);
    expect(claudeMaxBindingUsedFraction(s)).toBeCloseTo(0.2);
  });

  it('scoped AKTIF ikut dihitung (window yang benar-benar mengikat sesi)', () => {
    const s = snap([
      lim('session', 0.2),
      lim('weekly_scoped', 0.97, { scope: 'Claude Sonnet 5', isActive: true }),
    ]);
    expect(claudeMaxBindingUsedFraction(s)).toBeCloseTo(0.97);
  });

  it('limits kosong → null (tak tahu) — pemanggil WAJIB latch, bukan menyimpulkan "tak limit"', () => {
    expect(claudeMaxBindingUsedFraction(snap([]))).toBeNull();
  });

  it('sepakat dgn claudeUsageAvailable soal window mana yang dihitung (satu definisi, tak menyimpang)', () => {
    const s = snap([lim('session', 0.99), lim('weekly_scoped', 1, { scope: 'X', isActive: false })]);
    expect(claudeUsageAvailable(s)).toBe(true); // window mengikat masih < 1
    expect(claudeMaxBindingUsedFraction(s)).toBeCloseTo(0.99); // dan angkanya dari window yang sama
  });
});
