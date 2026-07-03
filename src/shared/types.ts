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
