import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, openDb, type DatabaseInstance } from '../src/store/db.js';
import { createEventsRepo } from '../src/store/repositories/events.js';
import { createScheduledJobsRepo } from '../src/store/repositories/scheduled-jobs.js';
import { createSessionsRepo } from '../src/store/repositories/sessions.js';
import { runSession } from '../src/daemon/process-wrapper.js';

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

  it('persists resumedFrom on the new session row (I-14 resume chain)', async () => {
    const sessions = createSessionsRepo(db);
    const events = createEventsRepo(db);
    const jobs = createScheduledJobsRepo(db);

    // Sesi ASAL harus ada — FK `resumed_from → sessions.id` ditegakkan (foreign_keys=ON).
    // Di produksi ini selalu terpenuhi (parent = sesi lama yang di-resume).
    sessions.createSession({
      id: 'origin-sess',
      tool: 'claude',
      cwd: process.cwd(),
      status: 'EXITED',
      proc_state: 'exited',
    });

    const { sessionId, waitForExit } = runSession(
      {
        file: process.execPath,
        args: ['-e', 'process.exit(0)'],
        cwd: process.cwd(),
        tool: 'claude',
        resumedFrom: 'origin-sess',
      },
      { sessions, events, jobs },
    );

    // Tautan resume tercatat sejak createSession, tak menunggu exit.
    expect(sessions.getById(sessionId)?.resumed_from).toBe('origin-sess');

    await waitForExit;
    expect(sessions.getById(sessionId)?.resumed_from).toBe('origin-sess');
  }, 10_000);

  it('I-20: captures agy cli_session_id from the resume cmd printed at exit (G-36)', async () => {
    const sessions = createSessionsRepo(db);
    const events = createEventsRepo(db);
    const jobs = createScheduledJobsRepo(db);

    const uuid = '4f9a8638-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
    // Proses palsu "agy": cetak baris resume-cmd yang agy CETAK saat exit (G-36) lalu keluar. tool
    // 'antigravity' → wrapper memasang capturer adapter agy pada stream output.
    const script = `process.stdout.write('Resume with -c (or command below): agy --conversation=${uuid}\\n'); process.exit(0)`;
    const { sessionId, waitForExit } = runSession(
      { file: process.execPath, args: ['-e', script], cwd: process.cwd(), tool: 'antigravity' },
      { sessions, events, jobs },
    );

    await waitForExit;

    // cli_session_id terisi dari output → resume-by-id sesi MATI tak lagi BLOCKED (mengisi paruh R2a).
    expect(sessions.getById(sessionId)?.cli_session_id).toBe(uuid);
    const captured = events
      .listBySession(sessionId, 50)
      .some((e) => e.type === 'cli_session_id_captured');
    expect(captured).toBe(true);
  }, 10_000);
});
