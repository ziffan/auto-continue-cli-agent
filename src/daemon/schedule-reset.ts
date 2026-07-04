// M3d.2 — reaksi pasca-LIMIT_HIT: estimasi reset_at (reset-estimator) → persist ke sesi →
// enqueue job `probe` di scheduled_jobs. Murni atas repo yang di-inject (tak ada akses DB langsung,
// tak ada Date.now() — `now` di-inject, CONVENTIONS.md).

import { estimateReset } from './reset-estimator.js';
import type { ResetHint } from '../adapters/types.js';
import type { ResetSource } from '../shared/types.js';
import type { EventsRepo } from '../store/repositories/events.js';
import type { ScheduledJobsRepo } from '../store/repositories/scheduled-jobs.js';
import type { SessionsRepo } from '../store/repositories/sessions.js';

export interface ScheduleProbeDeps {
  sessions: SessionsRepo;
  jobs: ScheduledJobsRepo;
  events: EventsRepo;
}

export interface ScheduleProbeInput {
  sessionId: string;
  detectedAt: number;
  now: number;
  resetHint?: ResetHint;
}

export interface ScheduleProbeResult {
  resetAt: number;
  source: ResetSource;
  jobId: number;
}

/** Reaksi pasca-LIMIT_HIT: estimasi reset_at (reset-estimator, presedensi exact→heuristik→backoff)
 *  → persist ke sesi (setReset) → enqueue job `probe` di run_at=resetAt (+event audit `probe_scheduled`).
 *  Return null bila setReset gagal (sesi tak lagi LIMIT_HIT — mis. race exit) → JANGAN enqueue probe yatim.
 *  Catatan: windowHint (5h/7d) belum diberikan di sini — tanpa hint reset yang exact-resolvable, estimator
 *  jatuh ke backoff (probe lagi ~5m); klasifikasi window akurat menyusul saat usage-probe (M3d.5). */
export function scheduleProbeForLimit(
  input: ScheduleProbeInput,
  deps: ScheduleProbeDeps,
): ScheduleProbeResult | null {
  const est = estimateReset(input.resetHint, { now: input.now, detectedAt: input.detectedAt });
  const persisted = deps.sessions.setReset(input.sessionId, { resetAt: est.resetAt, resetSource: est.source });
  if (!persisted) return null;
  const job = deps.jobs.enqueue({ session_id: input.sessionId, run_at: est.resetAt, kind: 'probe' });
  deps.events.append({
    session_id: input.sessionId,
    type: 'probe_scheduled',
    payload: { runAt: est.resetAt, resetSource: est.source, jobId: job.id },
  });
  return { resetAt: est.resetAt, source: est.source, jobId: job.id };
}
