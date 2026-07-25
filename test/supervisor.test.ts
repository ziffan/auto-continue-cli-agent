import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDaemonTimer, createSupervisor } from '../src/daemon/supervisor.js';
import type { JobDispatch, JobResult, TimerHandle } from '../src/daemon/scheduler.js';
import { closeDb, openDb, type DatabaseInstance } from '../src/store/db.js';
import { createScheduledJobsRepo } from '../src/store/repositories/scheduled-jobs.js';
import { createSessionsRepo } from '../src/store/repositories/sessions.js';
import type { ScheduledJob } from '../src/shared/types.js';

/** Path socket/pipe unik per test — hindari bentrok antar-run dan lintas-platform (pola ipc.integration.test.ts). */
function uniqueSocketPath(): string {
  const rand = randomBytes(4).toString('hex');
  return process.platform === 'win32' ? `\\\\.\\pipe\\acca-supervisor-test-${rand}` : join(tmpdir(), `acca-supervisor-test-${rand}.sock`);
}

/** Timer manual — mirror `createManualTimer` di test/scheduler.test.ts, tanpa menyentuh wall-clock nyata. */
function createManualTimer() {
  let seq = 0;
  const timers = new Map<number, { fn: () => unknown; delay: number }>();
  return {
    setTimer: (fn: () => void, delayMs: number): TimerHandle => {
      const id = ++seq;
      timers.set(id, { fn, delay: delayMs });
      return id as unknown as TimerHandle;
    },
    clearTimer: (h: TimerHandle): void => {
      timers.delete(h as unknown as number);
    },
    fire: async (): Promise<void> => {
      const entries = [...timers.entries()];
      const last = entries[entries.length - 1];
      if (!last) throw new Error('no timer armed to fire');
      const [id, t] = last;
      timers.delete(id);
      await t.fn();
    },
    armedDelay: (): number | undefined => {
      const entries = [...timers.values()];
      return entries.length > 0 ? entries[entries.length - 1]?.delay : undefined;
    },
    armedCount: (): number => timers.size,
  };
}

describe('supervisor scheduler recovery', () => {
  let tempDir: string | undefined;
  let db: DatabaseInstance | undefined;
  let socketPath: string | undefined;

  afterEach(() => {
    if (db) {
      closeDb(db);
      db = undefined;
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
    if (socketPath && process.platform !== 'win32') {
      rmSync(socketPath, { force: true });
    }
    socketPath = undefined;
    delete process.env.ACCA_DATA_DIR;
  });

  it('start() re-arms a pending job from persistence, and stop() tears down cleanly', async () => {
    tempDir = join(tmpdir(), `acca-supervisor-test-${randomBytes(4).toString('hex')}`);
    process.env.ACCA_DATA_DIR = tempDir;
    db = openDb();
    socketPath = uniqueSocketPath();

    const sessions = createSessionsRepo(db);
    sessions.createSession({ id: 'sup-sess', tool: 'claude', cwd: process.cwd(), status: 'LIMIT_HIT', proc_state: 'alive' });
    const jobs = createScheduledJobsRepo(db);
    const seeded = jobs.enqueue({ session_id: 'sup-sess', run_at: 42_000, kind: 'probe' });

    const manual = createManualTimer();
    const dispatchLog: ScheduledJob[] = [];
    const capturingDispatch: JobDispatch = (job): JobResult => {
      dispatchLog.push(job);
      return 'done';
    };

    // `now` mutable (mirror nowRef di test/scheduler.test.ts): mulai di 2_000 (untuk asersi
    // armedDelay = 42_000 - 2_000), lalu digerakkan ke run_at job sebelum fire() supaya
    // `jobs.due(now())` di dalam scheduler benar-benar menganggap job ini due (bukan asersi semu).
    const nowRef = { value: 2_000 };

    const supervisor = createSupervisor({
      db,
      socketPath,
      now: () => nowRef.value,
      setTimer: manual.setTimer,
      clearTimer: manual.clearTimer,
      dispatch: capturingDispatch,
    });

    await supervisor.start();

    expect(manual.armedCount()).toBe(1);
    expect(manual.armedDelay()).toBe(42_000 - 2_000);

    nowRef.value = 42_000;
    await manual.fire();
    expect(dispatchLog).toHaveLength(1);
    expect(dispatchLog[0]?.id).toBe(seeded.id);
    expect(dispatchLog[0]?.kind).toBe('probe');

    await supervisor.stop();
  });
});

describe('createDaemonTimer (I-6)', () => {
  it('captures an async rejection from fn() via onError, instead of an unhandledRejection', async () => {
    const spy = vi.fn();
    const t = createDaemonTimer(spy);
    t(() => Promise.reject(new Error('boom')) as unknown as void, 0);

    await new Promise((r) => setTimeout(r, 10));

    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0]?.[0] as Error).message).toContain('boom');
  });

  it('captures a synchronous throw from fn() via onError', async () => {
    const spy = vi.fn();
    const t = createDaemonTimer(spy);
    t(() => {
      throw new Error('sync-x');
    }, 0);

    await new Promise((r) => setTimeout(r, 10));

    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0]?.[0] as Error).message).toContain('sync-x');
  });
});
