import type { DatabaseInstance } from '../db.js';
import { nowMs } from '../../shared/time.js';

export interface AppendEventInput {
  session_id: string | null;
  type: string;
  payload: unknown;
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
  };
}

export type EventsRepo = ReturnType<typeof createEventsRepo>;
