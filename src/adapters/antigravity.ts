import { discoverLocalPorts } from '../shared/port-discovery.js';
import { safeFetch } from '../shared/http.js';
import type { UsageSnapshot } from '../shared/types.js';
import { isTransientRetry, matchAgyLimit, matchOverload } from './patterns.js';
import { parseAgyUserStatus } from './usage.js';
import type { Adapter, DetectionResult, DetectSignal, SpawnSpec } from './types.js';

const GET_USER_STATUS_PATH = '/exa.language_server_pb.LanguageServerService/GetUserStatus';

export const antigravityAdapter: Adapter = {
  tool: 'antigravity',
  buildSpawn(args: string[]): SpawnSpec {
    return { file: 'agy', args };
  },
  async probeUsage(context?: { sessionPid?: number }): Promise<UsageSnapshot> {
    if (!context?.sessionPid) {
      throw new Error('agy probeUsage requires sessionPid (sesi hidup ber-PTY)');
    }
    const pid = context.sessionPid;
    const ports = discoverLocalPorts(pid);
    if (ports.length === 0) {
      throw new Error(`agy LS ports not found for PID ${pid}`);
    }

    // agy bind gRPC + HTTP di dua port random tanpa urutan terjamin — coba semua port, terima yang
    // pertama membalas dengan limits non-kosong (itu port HTTP-nya). Tak pernah bocorkan body respons
    // ke pesan error (injection/PII firewall — ADR-013/G-9).
    let fallback: UsageSnapshot | undefined;
    let lastStatus = '';
    for (const port of ports) {
      let resp: Response;
      try {
        resp = await safeFetch(`http://127.0.0.1:${port}${GET_USER_STATUS_PATH}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
      } catch (err) {
        lastStatus = err instanceof Error ? err.message : String(err);
        continue;
      }
      if (!resp.ok) {
        lastStatus = `${resp.status} ${resp.statusText}`;
        continue;
      }
      const snapshot = parseAgyUserStatus(await resp.json(), Date.now());
      if (snapshot.limits.length > 0) return snapshot;
      fallback = fallback ?? snapshot;
    }
    if (fallback) return fallback;
    throw new Error(`agy usage probe failed on all discovered ports (last: ${lastStatus})`);
  },
  resumeCmd(sessionId: string, cwd: string): SpawnSpec {
    return { file: 'agy', args: ['--conversation', sessionId], cwd };
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
