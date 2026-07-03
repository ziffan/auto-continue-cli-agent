import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classify } from '../src/daemon/detector.js';
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

describe('AC-1: Antigravity provisional corpus (agy-limit.txt) → kind:"limit"', () => {
  it.each(agyLimitLines)('classifies "%s" as limit', (line) => {
    const result = classify('antigravity', { type: 'output', text: line });
    expect(result.kind).toBe('limit');
    expect(result.source).toBe('output');
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
