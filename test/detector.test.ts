import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classify } from '../src/daemon/detector.js';
import { estimateReset } from '../src/daemon/reset-estimator.js';
import type { DetectKind, StopFailureSignal } from '../src/adapters/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

/** Baca fixture teks: satu kasus per baris, skip blank & baris komentar `#`. */
function loadLines(relPath: string): string[] {
  return readFileSync(join(fixturesDir, relPath), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
}

interface StopFailurePayload {
  error: string;
  last_assistant_message?: string;
}

function loadStopFailure(fileName: string): StopFailureSignal {
  const raw = readFileSync(join(fixturesDir, 'cc-stopfailure', fileName), 'utf8');
  const payload = JSON.parse(raw) as StopFailurePayload;
  return { type: 'stopfailure', error: payload.error, lastAssistantMessage: payload.last_assistant_message };
}

const ccLimitLines = loadLines('cc-limit.txt');
const ccOverloadLines = loadLines('cc-overload.txt');
const agyLimitLines = loadLines('agy-limit.txt');
const ccNoiseLines = loadLines('cc-noise.txt');

describe('AC-1: Claude Code limit corpus (cc-limit.txt) → kind:"limit"', () => {
  it.each(ccLimitLines)('classifies "%s" as limit', (line) => {
    const result = classify('claude', { type: 'output', text: line });
    expect(result.kind).toBe('limit');
    expect(result.source).toBe('output');
  });
});

describe('AC-1: Antigravity VERIFIED corpus (agy-limit.txt, real 4 Jul) → kind:"limit"', () => {
  it.each(agyLimitLines)('classifies "%s" as limit', (line) => {
    const result = classify('antigravity', { type: 'output', text: line });
    expect(result.kind).toBe('limit');
    expect(result.source).toBe('output');
  });

  // Guard against regressing the corpus back to the invented provisional lines: the real signal
  // is "Individual quota reached" (G-19); the old guessed wording must be gone.
  it('corpus is the real message, not the old provisional guesses', () => {
    expect(agyLimitLines.some((l) => /individual quota reached/i.test(l))).toBe(true);
    expect(agyLimitLines.some((l) => /daily allowance|weekly limit has been reached/i.test(l))).toBe(false);
  });
});

describe('Pesan limit agy ASLI (terkonfirmasi 4 Jul 2026, kuota 5-jam Gemini habis — G-19)', () => {
  // Sumber: scratchpad agy-REAL-limit-message.txt. agy TETAP HIDUP di prompt setelah pesan ini
  // (limit != exit) → jalur continue = alive/inject (ADR-014). Reset "59m14s" = relatif; sumber
  // reset andal = resetTime absolut dari LS probe (bukan scrape teks ini), jadi tak ada resetHint.
  const real = '⚠ Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 59m14s.';

  it('terklasifikasi limit dgn evidence frasa terverifikasi', () => {
    const r = classify('antigravity', { type: 'output', text: real });
    expect(r.kind).toBe('limit');
    expect(r.source).toBe('output');
    expect(r.evidence).toMatch(/individual quota reached/i);
  });

  it('tak mengarang resetHint dari format relatif "59m14s" (reset andal = LS probe)', () => {
    const r = classify('antigravity', { type: 'output', text: real });
    expect(r.resetHint).toBeUndefined();
  });

  it('baris "Error ID: <uuid>" sendiri BUKAN sinyal limit (hanya uuid)', () => {
    const r = classify('antigravity', {
      type: 'output',
      text: 'Error ID: 3f9a2c1e-0b7d-4e2a-9c1f-8a6b5d4e3c2b',
    });
    expect(r.kind).toBe('none');
  });
});

describe('Overload firewall (cc-overload.txt): HTTP-error → overload, retry-guard → none, never limit', () => {
  it.each(ccOverloadLines)('classifies "%s" correctly', (line) => {
    const result = classify('claude', { type: 'output', text: line });
    const expectedKind: DetectKind = /Retrying/i.test(line) ? 'none' : 'overload';
    expect(result.kind).toBe(expectedKind);
    expect(result.kind).not.toBe('limit'); // firewall: HTTP-transient never becomes usage-limit
  });
});

describe('False-positive AC (cc-noise.txt): realistic noise must never classify as limit/overload', () => {
  it(`all ${ccNoiseLines.length} noise lines classify as none`, () => {
    const offenders = ccNoiseLines
      .map((line) => ({ line, result: classify('claude', { type: 'output', text: line }) }))
      .filter(({ result }) => result.kind !== 'none');

    if (offenders.length > 0) {
      const details = offenders.map((o) => `  - "${o.line}" → ${o.result.kind} (${o.result.evidence ?? ''})`).join('\n');
      throw new Error(`${offenders.length} false positive(s) out of ${ccNoiseLines.length} noise lines:\n${details}`);
    }
    expect(offenders.length).toBe(0);
    expect(ccNoiseLines.length).toBeGreaterThanOrEqual(100);
  });
});

describe('StopFailure taxonomy (RESEARCH §2c): error field → kind mapping', () => {
  it('rate_limit → limit', () => {
    const result = classify('claude', loadStopFailure('rate_limit.json'));
    expect(result).toMatchObject({ kind: 'limit', source: 'stopfailure', evidence: 'rate_limit' });
  });

  it('overloaded → overload', () => {
    const result = classify('claude', loadStopFailure('overloaded.json'));
    expect(result).toMatchObject({ kind: 'overload', source: 'stopfailure', evidence: 'overloaded' });
  });

  it('server_error → overload', () => {
    const result = classify('claude', loadStopFailure('server_error.json'));
    expect(result).toMatchObject({ kind: 'overload', source: 'stopfailure', evidence: 'server_error' });
  });

  it('model_not_found → none', () => {
    const result = classify('claude', loadStopFailure('model_not_found.json'));
    expect(result).toMatchObject({ kind: 'none', source: null });
  });

  it('unknown → none', () => {
    const result = classify('claude', loadStopFailure('unknown.json'));
    expect(result).toMatchObject({ kind: 'none', source: null });
  });

  it('lists exactly the 5 taxonomy fixtures (rate_limit, overloaded, server_error, model_not_found, unknown)', () => {
    const files = readdirSync(join(fixturesDir, 'cc-stopfailure'));
    expect(files.sort()).toEqual(
      ['model_not_found.json', 'overloaded.json', 'rate_limit.json', 'server_error.json', 'unknown.json'].sort(),
    );
  });
});

describe('Antigravity: stopfailure signal is not applicable (no hook for agy)', () => {
  it('always classifies none regardless of error value', () => {
    const result = classify('antigravity', { type: 'stopfailure', error: 'rate_limit' });
    expect(result).toMatchObject({ kind: 'none', source: null });
  });
});

describe('exitcode signal', () => {
  it('zero exit → none', () => {
    const result = classify('claude', { type: 'exitcode', code: 0, recentOutput: 'usage limit reached' });
    expect(result.kind).toBe('none');
  });

  it('non-zero exit + recentOutput matching limit pattern → limit', () => {
    const result = classify('claude', {
      type: 'exitcode',
      code: 1,
      recentOutput: 'Claude usage limit reached. Resets at 2pm',
    });
    expect(result).toMatchObject({ kind: 'limit', source: 'exitcode' });
  });

  it('non-zero exit + unrelated recentOutput → none', () => {
    const result = classify('claude', { type: 'exitcode', code: 1, recentOutput: 'segmentation fault' });
    expect(result.kind).toBe('none');
  });

  it('non-zero exit + no recentOutput → none', () => {
    const result = classify('claude', { type: 'exitcode', code: 1 });
    expect(result.kind).toBe('none');
  });
});

describe('unknown tool', () => {
  it('DetectorError thrown when tool not in adapters record', () => {
    // Cast bypasses the compile-time Tool union to simulate an untrusted runtime value (IPC/store).
    expect(() => classify('nope' as unknown as 'claude', { type: 'output', text: 'x' })).toThrow(
      /tool tidak dikenal/i,
    );
  });
});

describe('Pesan limit ASLI (terkonfirmasi lokal 4 Jul 2026, limit 5-jam nyata)', () => {
  // Regression guard: format nyata "hit your SESSION limit" sempat LOLOS detektor (qualifier
  // "session" menyisip; pola lama "hit your limit" kontigu tak match). Fixture asli dari transcript.
  const real = "You've hit your session limit · resets 7:30am (Asia/Jakarta)";

  it('terklasifikasi limit + reset hint terparse (jam + IANA tz)', () => {
    const r = classify('claude', { type: 'output', text: real });
    expect(r.kind).toBe('limit');
    expect(r.source).toBe('output');
    expect(r.resetHint?.clockTime).toBe('7:30am');
    expect(r.resetHint?.timezone).toBe('Asia/Jakarta');
  });

  it('reset hint → estimateReset exact (7:30am Asia/Jakarta = 00:30Z)', () => {
    const r = classify('claude', { type: 'output', text: real });
    const now = Date.UTC(2026, 6, 4, 0, 20, 0); // ~07:20 Jakarta, saat limit kena
    const est = estimateReset(r.resetHint, { now, detectedAt: now });
    expect(est.source).toBe('exact');
    // 7:30am Asia/Jakarta (UTC+7) = 00:30Z hari sama; > now (00:20Z) → hari ini, tak wrap.
    expect(est.resetAt).toBe(Date.UTC(2026, 6, 4, 0, 30, 0));
  });
});
