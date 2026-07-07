import { discoverLocalPorts } from '../shared/port-discovery.js';
import { loopbackHttpsPostJson, type LoopbackResponse } from '../shared/http.js';
import type { UsageSnapshot } from '../shared/types.js';
import { isTransientRetry, matchAgyLimit, matchOverload } from './patterns.js';
import { parseAgyQuotaSummary } from './usage.js';
import type { Adapter, DetectionResult, DetectSignal, SpawnSpec } from './types.js';

// I-16/G-31 (live-verify 7 Jul): kuota agy yang BENAR untuk keputusan resume = `RetrieveUserQuotaSummary`
// (window MINGGUAN + 5-jam per grup). `GetUserStatus` HANYA memuat 5-jam → buta weekly → dispatch
// `every(usedFraction<1)` bisa keliru resume saat weekly habis. Karena itu probe pindah ke endpoint ini.
const RETRIEVE_QUOTA_SUMMARY_PATH = '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary';

// G-23 (live-verify Ubuntu + Windows): tepat setelah LS bind, endpoint kuota balas Connect-error
// (cascade/quota belum terisi) selama ~2–4s sampai refresh token in-memory selesai — baru HTTP 200
// ber-kuota. Probe wajib RETRY sampai 200-berkuota, jangan simpulkan "tak ada kuota" dari
// attempt pertama. Cap konservatif ~15s.
const AGY_PROBE_MAX_WAIT_MS = 15000;
const AGY_PROBE_INTERVAL_MS = 2000;

/** Boundary I/O di-inject supaya retry-loop probe teruji tanpa jaringan/proses nyata. */
export interface AgyProbeDeps {
  discover?: (pid: number) => number[];
  post?: (url: string, jsonBody: string) => Promise<LoopbackResponse>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxWaitMs?: number;
  intervalMs?: number;
}

/**
 * Probe usage agy dari sesi hidup ber-PTY (ADR-010 opsi #2). Alur (G-23): discoverLocalPorts →
 * untuk tiap port coba `POST RetrieveUserQuotaSummary` via **https loopback** (`rejectUnauthorized:false`;
 * agy LS = TLS self-signed) → retry ~tiap 2s sampai satu port balas **HTTP 200 ber-kuota**
 * (limits non-kosong = window weekly+5h per grup, I-16/G-31), cap ~15s. Salah-port (HTTP plaintext /
 * gRPC-h2) gagal senyap (ECONNRESET/EPROTO) → coba port lain. **PII/injection firewall (G-9/ADR-013):**
 * body respons TAK PERNAH masuk pesan error (`lastStatus` hanya kode/`error.message` jaringan); ekstraksi
 * kuota lewat `parseAgyQuotaSummary` (allowlist ketat, tak sentuh displayName/PII). Standalone (bukan
 * method) supaya deps injectable di test.
 */
export async function probeAgyUsage(
  context: { sessionPid?: number } | undefined,
  deps: AgyProbeDeps = {},
): Promise<UsageSnapshot> {
  if (!context?.sessionPid) {
    throw new Error('agy probeUsage requires sessionPid (sesi hidup ber-PTY)');
  }
  const pid = context.sessionPid;
  const discover = deps.discover ?? ((p) => discoverLocalPorts(p));
  const post = deps.post ?? ((url, body) => loopbackHttpsPostJson(url, body));
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => Date.now());
  const maxWaitMs = deps.maxWaitMs ?? AGY_PROBE_MAX_WAIT_MS;
  const intervalMs = deps.intervalMs ?? AGY_PROBE_INTERVAL_MS;

  const ports = discover(pid);
  if (ports.length === 0) {
    throw new Error(`agy LS ports not found for PID ${pid}`);
  }

  const deadline = now() + maxWaitMs;
  let lastStatus = 'belum ada respons';
  for (;;) {
    for (const port of ports) {
      let resp: LoopbackResponse;
      try {
        resp = await post(`https://127.0.0.1:${port}${RETRIEVE_QUOTA_SUMMARY_PATH}`, '{}');
      } catch (err) {
        // error.message jaringan (ECONNRESET/EPROTO/timeout) — tak pernah memuat body respons.
        lastStatus = err instanceof Error ? err.message : String(err);
        continue;
      }
      if (resp.status !== 200) {
        lastStatus = `HTTP ${resp.status}`; // Connect-error sebelum LS siap (G-23) — retry.
        continue;
      }
      let json: unknown;
      try {
        json = JSON.parse(resp.body);
      } catch {
        lastStatus = 'respons 200 non-JSON';
        continue;
      }
      const snapshot = parseAgyQuotaSummary(json, now());
      if (snapshot.limits.length > 0) return snapshot; // groups/buckets terisi → selesai.
      lastStatus = 'HTTP 200 tapi quota summary kosong (LS belum siap)';
    }
    if (now() >= deadline) break;
    await sleep(intervalMs);
  }
  throw new Error(
    `agy usage probe: tak ada HTTP 200 ber-kuota dalam ${maxWaitMs}ms (last: ${lastStatus})`,
  );
}

export const antigravityAdapter: Adapter = {
  tool: 'antigravity',
  buildSpawn(args: string[]): SpawnSpec {
    return { file: 'agy', args };
  },
  async probeUsage(context?: { sessionPid?: number }): Promise<UsageSnapshot> {
    return probeAgyUsage(context);
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
