import type { DatabaseInstance } from '../db.js';
import { nowMs } from '../../shared/time.js';
import type { ProcState, Session, SessionStatus, Tool } from '../../shared/types.js';

export interface CreateSessionInput {
  id: string;
  tool: Tool;
  cwd: string;
  status: SessionStatus;
  proc_state: ProcState;
  cli_session_id?: string | null;
  pid?: number | null;
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
      };
      db.prepare(
        `INSERT INTO sessions (
          id, tool, cli_session_id, cwd, pid, status, proc_state,
          detected_at, detect_source, reset_at, reset_source,
          created_at, updated_at, archived_at
        ) VALUES (
          @id, @tool, @cli_session_id, @cwd, @pid, @status, @proc_state,
          @detected_at, @detect_source, @reset_at, @reset_source,
          @created_at, @updated_at, @archived_at
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
