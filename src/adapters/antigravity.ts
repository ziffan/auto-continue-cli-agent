import { isTransientRetry, matchAgyLimit, matchOverload } from './patterns.js';
import type { Adapter, DetectionResult, DetectSignal, SpawnSpec } from './types.js';

export const antigravityAdapter: Adapter = {
  tool: 'antigravity',
  buildSpawn(args: string[]): SpawnSpec {
    return { file: 'agy', args };
  },
  detect(signal: DetectSignal): DetectionResult {
    switch (signal.type) {
      case 'stopfailure':
        // agy tak punya hook StopFailure (fitur khusus Claude Code) — sinyal ini tak berlaku di sini.
        return { kind: 'none', source: null };
      case 'output': {
        if (isTransientRetry(signal.text)) return { kind: 'none', source: null };
        const overload = matchOverload(signal.text);
        if (overload) return { kind: 'overload', source: 'output', evidence: overload };
        // VERIFIED (4 Jul): korpus agy dari limit 5-jam ASLI — "Individual quota reached" (G-19).
        const limit = matchAgyLimit(signal.text);
        if (limit) {
          return { kind: 'limit', source: 'output', evidence: limit.evidence, resetHint: limit.resetHint };
        }
        return { kind: 'none', source: null };
      }
      case 'exitcode': {
        if (signal.code !== 0 && signal.recentOutput !== undefined) {
          const limit = matchAgyLimit(signal.recentOutput);
          if (limit) {
            return { kind: 'limit', source: 'exitcode', evidence: limit.evidence, resetHint: limit.resetHint };
          }
        }
        return { kind: 'none', source: null };
      }
    }
  },
};
