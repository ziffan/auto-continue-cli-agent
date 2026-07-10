import type { DatabaseInstance } from '../db.js';
import { nowMs } from '../../shared/time.js';

export interface AppendEventInput {
  session_id: string | null;
  type: string;
  payload: unknown;
}

/** Baris mentah tabel `events` — `payload` TETAP string JSON mentah (parsing = urusan pemanggil,
 *  bukan repo; lihat firewall di `notify/notifier.ts` & formatter di `cli/commands/log.ts`). */
export interface StoredEvent {
  id: number;
  session_id: string | null;
  type: string;
  payload: string;
  created_at: number;
}

/** Repositori `events` — append-only (tak ada UPDATE/DELETE), CONVENTIONS.md. */
export function createEventsRepo(db: DatabaseInstance) {
  return {
    append(input: AppendEventInput): void {
      db.prepare(
        'INSERT INTO events (session_id, type, payload, created_at) VALUES (@session_id, @type, @payload, @created_at)',
      ).run({
        session_id: input.session_id,
        type: input.type,
        payload: JSON.stringify(input.payload),
        created_at: nowMs(),
      });
    },

    listRecent(limit: number): StoredEvent[] {
      return db
        .prepare<[number], StoredEvent>('SELECT * FROM events ORDER BY created_at DESC, id DESC LIMIT ?')
        .all(limit);
    },

    listBySession(sessionId: string, limit: number): StoredEvent[] {
      return db
        .prepare<[string, number], StoredEvent>(
          'SELECT * FROM events WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
        )
        .all(sessionId, limit);
    },
  };
}

export type EventsRepo = ReturnType<typeof createEventsRepo>;
