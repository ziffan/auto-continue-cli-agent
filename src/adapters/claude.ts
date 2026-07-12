import { extractClaudeToken, loadClaudeCredentials } from '../shared/credentials.js';
import { safeFetch } from '../shared/http.js';
import type { UsageSnapshot } from '../shared/types.js';
import { buildClaudeHookSettings } from './claude-hooks.js';
import { isTransientRetry, matchLimit, matchOverload } from './patterns.js';
import { parseClaudeOAuthUsage } from './usage.js';
import type {
  Adapter,
  DetectionResult,
  DetectSignal,
  SpawnSpec,
  SupervisorHooksInput,
  SupervisorHooksPlan,
} from './types.js';

/** Nilai `error` StopFailure yang berarti overload transient (429/5xx/529) — RESEARCH §2c. */
const OVERLOAD_STOPFAILURE_ERRORS = new Set(['overloaded', 'server_error']);

export const claudeAdapter: Adapter = {
  tool: 'claude',
  buildSpawn(args: string[]): SpawnSpec {
    return { file: 'claude', args };
  },
  // `context` diabaikan: probe CC adalah panggilan HTTP standalone (token dari kredensial disk),
  // tak butuh PID sesi seperti agy (port-discovery).
  async probeUsage(): Promise<UsageSnapshot> {
    const token = extractClaudeToken(loadClaudeCredentials());
    const resp = await safeFetch('https://api.anthropic.com/api/oauth/usage', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
    });
    if (!resp.ok) {
      throw new Error(`CC usage probe failed: ${resp.status} ${resp.statusText}`);
    }
    return parseClaudeOAuthUsage(await resp.json(), Date.now());
  },
  resumeCmd(sessionId: string, cwd: string): SpawnSpec {
    return { file: 'claude', args: ['--resume', sessionId], cwd };
  },
  supervisorHooks(input: SupervisorHooksInput): SupervisorHooksPlan {
    return {
      settingsContent: JSON.stringify(buildClaudeHookSettings(input.forwarder)),
      // Disisipkan ke DEPAN args user: `claude --settings <path> <args...>`.
      extraArgs: ['--settings', input.settingsPath],
    };
  },
  detect(signal: DetectSignal): DetectionResult {
    switch (signal.type) {
      case 'stopfailure': {
        if (signal.error === 'rate_limit') {
          return { kind: 'limit', source: 'stopfailure', evidence: 'rate_limit' };
        }
        if (OVERLOAD_STOPFAILURE_ERRORS.has(signal.error)) {
          return { kind: 'overload', source: 'stopfailure', evidence: signal.error };
        }
        // authentication_failed | oauth_org_not_allowed | billing_error | invalid_request |
        // model_not_found | max_output_tokens | unknown | nilai lain tak dikenal → bukan sinyal aksi.
        return { kind: 'none', source: null };
      }
      case 'output': {
        // Guard dulu: retry internal CC yang sedang berjalan bukan limit/overload.
        if (isTransientRetry(signal.text)) return { kind: 'none', source: null };
        const overload = matchOverload(signal.text);
        if (overload) return { kind: 'overload', source: 'output', evidence: overload };
        const limit = matchLimit(signal.text);
        if (limit) {
          return { kind: 'limit', source: 'output', evidence: limit.evidence, resetHint: limit.resetHint };
        }
        return { kind: 'none', source: null };
      }
      case 'exitcode': {
        if (signal.code !== 0 && signal.recentOutput !== undefined) {
          const limit = matchLimit(signal.recentOutput);
          if (limit) {
            return { kind: 'limit', source: 'exitcode', evidence: limit.evidence, resetHint: limit.resetHint };
          }
        }
        return { kind: 'none', source: null };
      }
    }
  },
};
