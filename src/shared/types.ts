// Tipe umum lintas-modul. Enum status/proc_state = union string literal `as const`,
// cocokkan `CHECK` di store/migrations (DATA-MODEL.md).

export const SESSION_STATUSES = [
  'RUNNING',
  'LIMIT_HIT',
  'WAITING',
  'RESUMED',
  'EXITED',
  'BLOCKED',
  'FAILED',
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const PROC_STATES = ['alive', 'exited'] as const;
export type ProcState = (typeof PROC_STATES)[number];

export const TOOLS = ['claude', 'antigravity'] as const;
export type Tool = (typeof TOOLS)[number];

export const RESET_SOURCES = ['exact', 'heuristic', 'backoff'] as const;
export type ResetSource = (typeof RESET_SOURCES)[number];

export const JOB_KINDS = ['probe', 'resume'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/** Baris tabel `sessions` (DATA-MODEL.md). Waktu = epoch ms (number), bukan Date naif. */
export interface Session {
  id: string;
  tool: Tool;
  cli_session_id: string | null;
  cwd: string;
  pid: number | null;
  status: SessionStatus;
  proc_state: ProcState;
  detected_at: number | null;
  detect_source: string | null;
  reset_at: number | null;
  reset_source: ResetSource | null;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  /** I-14: id sesi ASAL bila sesi ini hasil resume-by-id (rantai resume); null untuk sesi biasa. */
  resumed_from: string | null;
}

/** Baris tabel `scheduled_jobs` (DATA-MODEL.md). Waktu = epoch ms. */
export interface ScheduledJob {
  id: number;
  session_id: string;
  run_at: number;
  kind: JobKind;
  attempts: number;
  next_backoff_ms: number | null;
  created_at: number;
}

/** Satu window/limit usage ternormalisasi (lintas-tool). `usedFraction` 0..1 (dinormalisasi:
 * CC pakai percent/utilization 0..100 → /100; agy pakai remainingFraction 0..1 → 1 - remaining). */
export interface UsageLimit {
  kind: string; // CC: 'session'|'weekly_all'|'weekly_scoped'; agy: nama model
  usedFraction: number; // 0..1 (terpakai). Display/monitor only — bukan aritmetika uang (ADR-004).
  resetAt: number | null; // epoch ms UTC (null bila sumber tak beri)
  scope?: string; // CC weekly_scoped: display_name model; agy: nama model
  isActive?: boolean; // CC: window yang sedang mengikat (limits[].is_active)
}

/** Snapshot usage ternormalisasi lintas-tool (Usage Probe — M3c). `capturedAt` = `now` di-inject
 * oleh pemanggil, bukan `Date.now()` langsung (testability + kontrak eksplisit). */
export interface UsageSnapshot {
  tool: Tool;
  limits: UsageLimit[];
  capturedAt: number; // epoch ms saat di-parse (now di-inject)
}
