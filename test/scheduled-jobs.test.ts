import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, openDb, type DatabaseInstance } from '../src/store/db.js';
import { createScheduledJobsRepo } from '../src/store/repositories/scheduled-jobs.js';
import { createSessionsRepo } from '../src/store/repositories/sessions.js';

const tempDir = join(tmpdir(), `acca-jobs-test-${randomBytes(4).toString('hex')}`);
process.env.ACCA_DATA_DIR = tempDir;

let db: DatabaseInstance;

beforeAll(() => {
  db = openDb();
  // Parent session wajib ada dulu — scheduled_jobs.session_id adalah FK (foreign_keys=ON).
  const sessions = createSessionsRepo(db);
  sessions.createSession({
    id: 'sjob',
    tool: 'claude',
    cwd: '/tmp/scheduled-jobs-project',
    status: 'LIMIT_HIT',
    proc_state: 'alive',
  });
});

afterAll(() => {
  closeDb(db);
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.ACCA_DATA_DIR;
});

describe('scheduled-jobs repo', () => {
  it('enqueue returns full row with numeric id, attempts 0, defaults', () => {
    const jobs = createScheduledJobsRepo(db);
    const row = jobs.enqueue({ session_id: 'sjob', run_at: 1000, kind: 'probe' });

    expect(typeof row.id).toBe('number');
    expect(row.session_id).toBe('sjob');
    expect(row.run_at).toBe(1000);
    expect(row.kind).toBe('probe');
    expect(row.attempts).toBe(0);
    expect(row.next_backoff_ms).toBeNull();
    expect(typeof row.created_at).toBe('number');
  });

  it('enqueue honors explicit next_backoff_ms', () => {
    const jobs = createScheduledJobsRepo(db);
    const row = jobs.enqueue({ session_id: 'sjob', run_at: 2000, kind: 'resume', next_backoff_ms: 300_000 });
    expect(row.next_backoff_ms).toBe(300_000);
  });

  it('listPending orders by run_at ASC then id ASC', () => {
    const jobs = createScheduledJobsRepo(db);
    const a = jobs.enqueue({ session_id: 'sjob', run_at: 5000, kind: 'probe' });
    const b = jobs.enqueue({ session_id: 'sjob', run_at: 3000, kind: 'probe' });
    const c = jobs.enqueue({ session_id: 'sjob', run_at: 3000, kind: 'resume' });

    const pending = jobs.listPending();
    const relevant = pending.filter((j) => j.id === a.id || j.id === b.id || j.id === c.id);
    // run_at 3000 duluan (b sebelum c karena id lebih kecil), lalu run_at 5000 (a).
    expect(relevant.map((j) => j.id)).toEqual([b.id, c.id, a.id]);
  });

  it('due(now) boundary: run_at == now is due, run_at > now is not', () => {
    const jobs = createScheduledJobsRepo(db);
    const exact = jobs.enqueue({ session_id: 'sjob', run_at: 10_000, kind: 'probe' });
    const future = jobs.enqueue({ session_id: 'sjob', run_at: 10_001, kind: 'probe' });

    const due = jobs.due(10_000);
    const dueIds = due.map((j) => j.id);
    expect(dueIds).toContain(exact.id);
    expect(dueIds).not.toContain(future.id);
  });

  it('getById fetches a single row; missing id returns undefined', () => {
    const jobs = createScheduledJobsRepo(db);
    const row = jobs.enqueue({ session_id: 'sjob', run_at: 20_000, kind: 'resume' });
    expect(jobs.getById(row.id)).toEqual(row);
    expect(jobs.getById(999_999)).toBeUndefined();
  });

  it('remove deletes the row by id', () => {
    const jobs = createScheduledJobsRepo(db);
    const row = jobs.enqueue({ session_id: 'sjob', run_at: 30_000, kind: 'probe' });
    jobs.remove(row.id);
    expect(jobs.getById(row.id)).toBeUndefined();
  });

  it('reschedule updates run_at, attempts, next_backoff_ms', () => {
    const jobs = createScheduledJobsRepo(db);
    const row = jobs.enqueue({ session_id: 'sjob', run_at: 40_000, kind: 'probe' });
    jobs.reschedule(row.id, 40_300_000, 1, 300_000);

    const updated = jobs.getById(row.id);
    expect(updated?.run_at).toBe(40_300_000);
    expect(updated?.attempts).toBe(1);
    expect(updated?.next_backoff_ms).toBe(300_000);
    // kind/session_id/created_at tak boleh berubah oleh reschedule.
    expect(updated?.kind).toBe('probe');
    expect(updated?.session_id).toBe('sjob');
    expect(updated?.created_at).toBe(row.created_at);
  });
});
