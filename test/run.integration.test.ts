import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, openDb, type DatabaseInstance } from '../src/store/db.js';
import { createEventsRepo } from '../src/store/repositories/events.js';
import { createScheduledJobsRepo } from '../src/store/repositories/scheduled-jobs.js';
import { createSessionsRepo } from '../src/store/repositories/sessions.js';
import { runSession } from '../src/cli/run-core.js';

const tempDir = join(tmpdir(), `acca-run-test-${randomBytes(4).toString('hex')}`);
process.env.ACCA_DATA_DIR = tempDir;

let db: DatabaseInstance;

beforeAll(() => {
  db = openDb();
});

afterAll(() => {
  closeDb(db);
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.ACCA_DATA_DIR;
});

describe('runSession integration', () => {
  it(
    'spawns a process, records the session, and marks it EXITED on exit',
    async () => {
      const sessions = createSessionsRepo(db);
      const events = createEventsRepo(db);
      const jobs = createScheduledJobsRepo(db);

      // Non-TTY under vitest → raw mode is skipped automatically inside runSession.
      const { sessionId, waitForExit } = runSession(
        {
          file: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: process.cwd(),
          tool: 'claude',
        },
        { sessions, events, jobs },
      );

      const createdImmediately = sessions.getById(sessionId);
      expect(createdImmediately?.status).toBe('RUNNING');
      expect(createdImmediately?.proc_state).toBe('alive');

      const exitCode = await waitForExit;
      expect(exitCode).toBe(0);

      const finalRow = sessions.getById(sessionId);
      expect(finalRow?.status).toBe('EXITED');
      expect(finalRow?.proc_state).toBe('exited');

      const active = sessions.listActive();
      expect(active.some((s) => s.id === sessionId && s.status === 'EXITED')).toBe(true);
    },
    10_000,
  );

  it('marks the session FAILED instead of leaving it RUNNING when spawn throws synchronously', async () => {
    const sessions = createSessionsRepo(db);
    const events = createEventsRepo(db);
    const jobs = createScheduledJobsRepo(db);

    const { sessionId, waitForExit } = runSession(
      {
        file: 'this-binary-does-not-exist-acca-smoke-test',
        args: [],
        cwd: process.cwd(),
        tool: 'claude',
      },
      { sessions, events, jobs },
    );

    await expect(waitForExit).rejects.toBeTruthy();

    const finalRow = sessions.getById(sessionId);
    expect(finalRow?.status).toBe('FAILED');
    expect(finalRow?.proc_state).toBe('exited');
  });
});
