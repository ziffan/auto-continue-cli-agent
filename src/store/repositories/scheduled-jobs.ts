import type { DatabaseInstance } from '../db.js';
import { nowMs } from '../../shared/time.js';
import type { JobKind, ScheduledJob } from '../../shared/types.js';

export interface EnqueueJobInput {
  session_id: string;
  run_at: number;
  kind: JobKind;
  next_backoff_ms?: number | null;
}

/** Repositori `scheduled_jobs` — satu-satunya jalur akses tabel `scheduled_jobs` (CONVENTIONS.md). */
export function createScheduledJobsRepo(db: DatabaseInstance) {
  return {
    enqueue(input: EnqueueJobInput): ScheduledJob {
      const now = nowMs();
      const result = db
        .prepare(
          `INSERT INTO scheduled_jobs (
            session_id, run_at, kind, attempts, next_backoff_ms, created_at
          ) VALUES (
            @session_id, @run_at, @kind, 0, @next_backoff_ms, @created_at
          )`,
        )
        .run({
          session_id: input.session_id,
          run_at: input.run_at,
          kind: input.kind,
          next_backoff_ms: input.next_backoff_ms ?? null,
          created_at: now,
        });

      // lastInsertRowid selalu ada setelah INSERT sukses — baca balik baris utuh sebagai sumber kebenaran.
      const row = db
        .prepare<[number | bigint], ScheduledJob>('SELECT * FROM scheduled_jobs WHERE id = ?')
        .get(result.lastInsertRowid);
      if (!row) throw new Error('scheduled_jobs: insert sukses tapi baris tak terbaca kembali');
      return row;
    },

    listPending(): ScheduledJob[] {
      return db
        .prepare<[], ScheduledJob>('SELECT * FROM scheduled_jobs ORDER BY run_at ASC, id ASC')
        .all();
    },

    due(now: number): ScheduledJob[] {
      return db
        .prepare<[number], ScheduledJob>(
          'SELECT * FROM scheduled_jobs WHERE run_at <= ? ORDER BY run_at ASC, id ASC',
        )
        .all(now);
    },

    getById(id: number): ScheduledJob | undefined {
      return db.prepare<[number], ScheduledJob>('SELECT * FROM scheduled_jobs WHERE id = ?').get(id);
    },

    /** I-35: apakah ada job `kind` yang masih pending untuk sesi ini? Dipakai men-dedup enqueue `verify`
     *  — sinyal limit OUTPUT-CC yang di-suppress bisa datang PER BARIS (prosa multi-literal, mis. membaca
     *  `patterns.ts`/docs → banyak match dalam satu episode), tanpa guard ini tiap baris meng-enqueue satu
     *  verify (storm N probe redundan). Satu verify per episode cukup. */
    hasPendingKind(sessionId: string, kind: JobKind): boolean {
      const row = db
        .prepare<[string, JobKind], { n: number }>('SELECT COUNT(*) AS n FROM scheduled_jobs WHERE session_id = ? AND kind = ?')
        .get(sessionId, kind);
      return (row?.n ?? 0) > 0;
    },

    remove(id: number): void {
      db.prepare('DELETE FROM scheduled_jobs WHERE id = ?').run(id);
    },

    reschedule(id: number, runAt: number, attempts: number, nextBackoffMs: number | null): void {
      db.prepare(
        'UPDATE scheduled_jobs SET run_at = @run_at, attempts = @attempts, next_backoff_ms = @next_backoff_ms WHERE id = @id',
      ).run({ id, run_at: runAt, attempts, next_backoff_ms: nextBackoffMs });
    },
  };
}

export type ScheduledJobsRepo = ReturnType<typeof createScheduledJobsRepo>;
