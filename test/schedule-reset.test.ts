import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scheduleProbeForLimit } from '../src/daemon/schedule-reset.js';
import { closeDb, openDb, type DatabaseInstance } from '../src/store/db.js';
import { createEventsRepo, type EventsRepo } from '../src/store/repositories/events.js';
import { createScheduledJobsRepo, type ScheduledJobsRepo } from '../src/store/repositories/scheduled-jobs.js';
import { createSessionsRepo, type SessionsRepo } from '../src/store/repositories/sessions.js';

const tempDir = join(tmpdir(), `acca-schedule-reset-test-${randomBytes(4).toString('hex')}`);
process.env.ACCA_DATA_DIR = tempDir;

let db: DatabaseInstance;
let sessions: SessionsRepo;
let jobs: ScheduledJobsRepo;
let events: EventsRepo;

beforeAll(() => {
  db = openDb();
  sessions = createSessionsRepo(db);
  jobs = createScheduledJobsRepo(db);
  events = createEventsRepo(db);
});

afterAll(() => {
  closeDb(db);
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.ACCA_DATA_DIR;
});

function eventRows(sessionId: string, type: string): Array<{ session_id: string | null; type: string }> {
  return db
    .prepare<[string, string], { session_id: string | null; type: string }>(
      'SELECT session_id, type FROM events WHERE session_id = ? AND type = ?',
    )
    .all(sessionId, type);
}

describe('scheduleProbeForLimit', () => {
  it('exact: resetHint clockTime resolves via reset-estimator, persists reset + enqueues probe job', () => {
    const id = `sess-${randomBytes(4).toString('hex')}`;
    sessions.createSession({ id, tool: 'claude', cwd: process.cwd(), status: 'LIMIT_HIT', proc_state: 'alive' });

    const NOW = Date.UTC(2026, 6, 4, 0, 20, 0);
    const result = scheduleProbeForLimit(
      { sessionId: id, detectedAt: NOW, now: NOW, resetHint: { clockTime: '7:30am', timezone: 'Asia/Jakarta' } },
      { sessions, jobs, events },
    );

    expect(result).not.toBeNull();
    expect(result?.source).toBe('exact');
    // Asia/Jakarta = UTC+7, no DST → 7:30am WIB = 00:30 UTC.
    expect(result?.resetAt).toBe(Date.UTC(2026, 6, 4, 0, 30, 0));

    const row = sessions.getById(id);
    expect(row?.reset_at).toBe(result?.resetAt);
    expect(row?.reset_source).toBe('exact');

    const pending = jobs.listPending().filter((j) => j.session_id === id);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.kind).toBe('probe');
    expect(pending[0]?.run_at).toBe(result?.resetAt);

    expect(eventRows(id, 'probe_scheduled')).toHaveLength(1);
  });

  it('backoff: no resetHint → falls back to backoff (+5m from now)', () => {
    const id = `sess-${randomBytes(4).toString('hex')}`;
    sessions.createSession({ id, tool: 'claude', cwd: process.cwd(), status: 'LIMIT_HIT', proc_state: 'alive' });

    const NOW = Date.UTC(2026, 6, 4, 1, 0, 0);
    const result = scheduleProbeForLimit({ sessionId: id, detectedAt: NOW, now: NOW }, { sessions, jobs, events });

    expect(result).not.toBeNull();
    expect(result?.source).toBe('backoff');
    expect(result?.resetAt).toBe(NOW + 300_000);

    const pending = jobs.listPending().filter((j) => j.session_id === id);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.kind).toBe('probe');
    expect(pending[0]?.run_at).toBe(NOW + 300_000);
  });

  it('guard: session not LIMIT_HIT (e.g. RUNNING) → returns null, no job enqueued, reset_at stays null', () => {
    const id = `sess-${randomBytes(4).toString('hex')}`;
    sessions.createSession({ id, tool: 'claude', cwd: process.cwd(), status: 'RUNNING', proc_state: 'alive' });

    const NOW = Date.UTC(2026, 6, 4, 2, 0, 0);
    const result = scheduleProbeForLimit({ sessionId: id, detectedAt: NOW, now: NOW }, { sessions, jobs, events });

    expect(result).toBeNull();

    const pending = jobs.listPending().filter((j) => j.session_id === id);
    expect(pending).toHaveLength(0);

    const row = sessions.getById(id);
    expect(row?.reset_at).toBeNull();
  });
});
