// Payload `GET /api/status` (ADR-028 / M-web) — PURE. KUNCI keamanan (T-W1): endpoint loopback
// terjangkau proses lokal lain → payload HANYA memakai proyeksi ter-firewall yang SUDAH ADA, tak
// pernah menyusun ulang data mentah. NOL jalur data baru:
//   • usage  → formatUsageLines (G-9: hanya tool/kind/bar/pct; `scope`/field lain tak pernah keluar)
//   • daemon → formatDaemonLiveness
//   • sesi   → SessionStatusView (toSessionStatusView: TANPA cli_session_id/cwd/field audit)
//   • events → formatEventLine (SUMMARY_ALLOWLIST: nol payload/evidence mentah)
import { formatDaemonLiveness, formatUsageLines } from '../cli/commands/status.js';
import { formatEventLine } from '../cli/commands/log.js';
import type { SessionStatusView } from '../store/repositories/sessions.js';
import type { StoredEvent } from '../store/repositories/events.js';

export interface StatusPayload {
  now: number;
  usage: { claude: string[]; antigravity: string[] };
  daemon: string;
  sessions: SessionStatusView[];
  events: string[];
}

export interface StatusPayloadInput {
  usageClaudeRaw: string | undefined;
  usageAntigravityRaw: string | undefined;
  heartbeat: { at: number; pid: number } | undefined;
  sessions: SessionStatusView[];
  events: StoredEvent[];
  nowMs: number;
  isAlive: (pid: number) => boolean;
}

/** Rakit payload status dari proyeksi ter-firewall (lihat catatan modul). Semua sub-nilai sudah
 *  di-minimize di sumbernya — fungsi ini tak menambah field sensitif apa pun. */
export function buildStatusPayload(input: StatusPayloadInput): StatusPayload {
  return {
    now: input.nowMs,
    usage: {
      claude: formatUsageLines('claude', input.usageClaudeRaw, input.nowMs),
      antigravity: formatUsageLines('antigravity', input.usageAntigravityRaw, input.nowMs),
    },
    daemon: formatDaemonLiveness(input.heartbeat, input.nowMs, input.isAlive),
    sessions: input.sessions,
    events: input.events.map(formatEventLine),
  };
}
