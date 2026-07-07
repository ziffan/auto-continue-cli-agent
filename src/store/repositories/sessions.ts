import type { DatabaseInstance } from '../db.js';
import { nowMs } from '../../shared/time.js';
import type { ProcState, ResetSource, Session, SessionStatus, Tool } from '../../shared/types.js';

export interface CreateSessionInput {
  id: string;
  tool: Tool;
  cwd: string;
  status: SessionStatus;
  proc_state: ProcState;
  cli_session_id?: string | null;
  pid?: number | null;
  /** I-14: id sesi ASAL bila baris ini hasil resume-by-id (rantai resume). */
  resumed_from?: string | null;
}

/** Repositori `sessions` — satu-satunya jalur akses tabel `sessions` (CONVENTIONS.md). */
export function createSessionsRepo(db: DatabaseInstance) {
  return {
    createSession(input: CreateSessionInput): Session {
      const now = nowMs();
      const row: Session = {
        id: input.id,
        tool: input.tool,
        cli_session_id: input.cli_session_id ?? null,
        cwd: input.cwd,
        pid: input.pid ?? null,
        status: input.status,
        proc_state: input.proc_state,
        detected_at: null,
        detect_source: null,
        reset_at: null,
        reset_source: null,
        created_at: now,
        updated_at: now,
        archived_at: null,
        resumed_from: input.resumed_from ?? null,
      };
      db.prepare(
        `INSERT INTO sessions (
          id, tool, cli_session_id, cwd, pid, status, proc_state,
          detected_at, detect_source, reset_at, reset_source,
          created_at, updated_at, archived_at, resumed_from
        ) VALUES (
          @id, @tool, @cli_session_id, @cwd, @pid, @status, @proc_state,
          @detected_at, @detect_source, @reset_at, @reset_source,
          @created_at, @updated_at, @archived_at, @resumed_from
        )`,
      ).run(row);
      return row;
    },

    setPid(id: string, pid: number): void {
      db.prepare('UPDATE sessions SET pid = @pid, updated_at = @updated_at WHERE id = @id').run({
        id,
        pid,
        updated_at: nowMs(),
      });
    },

    markExited(id: string): void {
      db.prepare(
        `UPDATE sessions
         SET status = 'EXITED', proc_state = 'exited', updated_at = @updated_at
         WHERE id = @id`,
      ).run({ id, updated_at: nowMs() });
    },

    /** Tandai sesi gagal spawn (mis. binary CLI target tak ditemukan) — tak pernah sempat alive. */
    markFailed(id: string): void {
      db.prepare(
        `UPDATE sessions
         SET status = 'FAILED', proc_state = 'exited', updated_at = @updated_at
         WHERE id = @id`,
      ).run({ id, updated_at: nowMs() });
    },

    /** Tandai sesi orphan (proc_state='alive' tapi PID pemiliknya sudah mati — wrapper mati keras
     * sebelum sempat `markExited`, ISSUES I-3). RUNNING → EXITED; status lain (mis. LIMIT_HIT/
     * WAITING) dipertahankan supaya continue-engine berikutnya tahu harus resume-by-id
     * (proc_state='exited'), bukan diam-diam kehilangan info "sedang menunggu reset". */
    markOrphanExited(id: string): void {
      db.prepare(
        `UPDATE sessions
         SET proc_state = 'exited',
             status = CASE WHEN status = 'RUNNING' THEN 'EXITED' ELSE status END,
             updated_at = @updated_at
         WHERE id = @id`,
      ).run({ id, updated_at: nowMs() });
    },

    /** Transisi RUNNING → LIMIT_HIT saat Detector menandai limit pada sesi HIDUP (limit != exit,
     *  ADR-014/RESEARCH §2c) → proc_state DIBIARKAN 'alive'. Guard `status='RUNNING'` = idempoten
     *  (sinyal limit berulang tak menulis ulang) + tak meng-clobber EXITED/FAILED (mis. race exit). */
    markLimitHit(id: string, opts: { source: string; detectedAt: number }): boolean {
      const info = db
        .prepare(
          `UPDATE sessions
           SET status = 'LIMIT_HIT', detected_at = @detectedAt, detect_source = @source, updated_at = @updatedAt
           WHERE id = @id AND status = 'RUNNING'`,
        )
        .run({ id, source: opts.source, detectedAt: opts.detectedAt, updatedAt: nowMs() });
      return info.changes > 0;
    },

    /** Persist reset_at + reset_source pada sesi yang sedang LIMIT_HIT (dipanggil tepat setelah
     *  markLimitHit sukses). Guard status='LIMIT_HIT' → tak menulis reset ke sesi yang sudah keluar
     *  dari kondisi limit (mis. race exit). Return true bila terupdate. */
    setReset(id: string, opts: { resetAt: number; resetSource: ResetSource }): boolean {
      const info = db
        .prepare(
          `UPDATE sessions
           SET reset_at = @resetAt, reset_source = @resetSource, updated_at = @updatedAt
           WHERE id = @id AND status = 'LIMIT_HIT'`,
        )
        .run({ id, resetAt: opts.resetAt, resetSource: opts.resetSource, updatedAt: nowMs() });
      return info.changes > 0;
    },

    /** Tandai sesi RESUMED setelah continue-engine berhasil melanjutkannya (M3d.6 resume-by-id ATAU
     *  M3d.7 inject-continue). `proc_state` SENGAJA tak disentuh: inject-continue melanjutkan proses
     *  yang sama (tetap 'alive'); resume-by-id spawn wrapper baru (sesi barunya sendiri). Guard
     *  `id` saja (transisi eksplisit oleh dispatch, bukan race liveness). Return true bila terupdate. */
    markResumed(id: string): boolean {
      const info = db
        .prepare(
          `UPDATE sessions
           SET status = 'RESUMED', updated_at = @updated_at
           WHERE id = @id`,
        )
        .run({ id, updated_at: nowMs() });
      return info.changes > 0;
    },

    listActive(): Session[] {
      return db
        .prepare<[], Session>(
          'SELECT * FROM sessions WHERE archived_at IS NULL ORDER BY updated_at DESC',
        )
        .all();
    },

    getById(id: string): Session | undefined {
      return db.prepare<[string], Session>('SELECT * FROM sessions WHERE id = ?').get(id);
    },
  };
}

export type SessionsRepo = ReturnType<typeof createSessionsRepo>;
