import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createScheduler, type JobDispatch, type JobResult, type TimerHandle } from '../src/daemon/scheduler.js';
import { closeDb, openDb, type DatabaseInstance } from '../src/store/db.js';
import { createScheduledJobsRepo, type ScheduledJobsRepo } from '../src/store/repositories/scheduled-jobs.js';
import { createSessionsRepo } from '../src/store/repositories/sessions.js';

const tempDir = join(tmpdir(), `acca-scheduler-test-${randomBytes(4).toString('hex')}`);
process.env.ACCA_DATA_DIR = tempDir;

let db: DatabaseInstance;
let jobs: ScheduledJobsRepo;

beforeAll(() => {
  db = openDb();
  const sessions = createSessionsRepo(db);
  sessions.createSession({
    id: 'schd',
    tool: 'claude',
    cwd: '/tmp/scheduler-project',
    status: 'LIMIT_HIT',
    proc_state: 'alive',
  });
  jobs = createScheduledJobsRepo(db);
});

// Setiap test mulai dari tabel scheduled_jobs kosong — listPending()/due() tidak diskop per-sesi,
// jadi baris sisa dari test lain akan mengacaukan asersi "earliest pending" bila tidak dibersihkan.
beforeEach(() => {
  db.exec('DELETE FROM scheduled_jobs');
});

afterAll(() => {
  closeDb(db);
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.ACCA_DATA_DIR;
});

/**
 * Timer manual: `setTimer`/`clearTimer` injected ke scheduler tidak pernah menyentuh wall-clock nyata.
 * Test memicu job "due" dengan memanggil `fire()` sendiri, dan menggerakkan waktu lewat `nowRef.value`.
 * Karena `arm()` scheduler selalu clear timer lama sebelum membuat yang baru, hanya satu entri yang
 * hidup pada satu waktu — tapi map dipertahankan (bukan single slot) supaya asersi "timer di-clear lalu
 * di-set ulang" bisa diverifikasi lewat clearCount/armedCount bila suatu hari perlu.
 */
function createManualTimer() {
  let seq = 0;
  // fn disimpan sebagai `() => unknown`, bukan `() => void`: di runtime scheduler sesungguhnya lewat
  // `runDue` (async, mengembalikan Promise) meski tipe statis parameter `setTimer` adalah `() => void`
  // (TS void-return shorthand). Menyimpannya sebagai `unknown` membiarkan harness `await` hasil nyatanya
  // demi determinisme test, tanpa berbohong ke type-checker bahwa itu pasti thenable.
  const timers = new Map<number, { fn: () => unknown; delay: number }>();
  return {
    setTimer: (fn: () => void, delayMs: number): TimerHandle => {
      const id = ++seq;
      timers.set(id, { fn: fn as unknown as () => unknown, delay: delayMs });
      return id as unknown as TimerHandle;
    },
    clearTimer: (h: TimerHandle): void => {
      timers.delete(h as unknown as number);
    },
    /** Jalankan timer yang sedang armed (harus persis satu). */
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

interface Harness {
  timer: ReturnType<typeof createManualTimer>;
  nowRef: { value: number };
  dispatchLog: number[];
  dispatchResults: Map<number, JobResult>;
  throwIds: Set<number>;
  onErrorLog: Array<{ err: unknown; jobId: number }>;
  scheduler: ReturnType<typeof createScheduler>;
}

function setup(): Harness {
  const timer = createManualTimer();
  const nowRef = { value: 0 };
  const dispatchLog: number[] = [];
  const dispatchResults = new Map<number, JobResult>();
  const throwIds = new Set<number>();
  const onErrorLog: Array<{ err: unknown; jobId: number }> = [];

  const dispatch: JobDispatch = (job) => {
    dispatchLog.push(job.id);
    if (throwIds.has(job.id)) throw new Error(`dispatch failed for job ${job.id}`);
    return dispatchResults.get(job.id) ?? 'done';
  };

  const scheduler = createScheduler({
    jobs,
    now: () => nowRef.value,
    dispatch,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
    onError: (err, job) => onErrorLog.push({ err, jobId: job.id }),
  });

  return { timer, nowRef, dispatchLog, dispatchResults, throwIds, onErrorLog, scheduler };
}

describe('scheduler', () => {
  it('start() with two pre-seeded pending jobs arms a timer with delay = earliest.run_at - now', () => {
    const h = setup();
    jobs.enqueue({ session_id: 'schd', run_at: 10_000, kind: 'probe' });
    jobs.enqueue({ session_id: 'schd', run_at: 20_000, kind: 'resume' });
    h.nowRef.value = 1_000;

    h.scheduler.start();

    expect(h.timer.armedCount()).toBe(1);
    expect(h.timer.armedDelay()).toBe(10_000 - 1_000);
  });

  it('firing dispatches all due jobs in run_at order; done removed, retry rescheduled +5m, timer re-armed', async () => {
    const h = setup();
    const a = jobs.enqueue({ session_id: 'schd', run_at: 1_000, kind: 'probe' }); // will be 'done'
    const b = jobs.enqueue({ session_id: 'schd', run_at: 1_500, kind: 'resume' }); // will be 'retry'
    h.dispatchResults.set(a.id, 'done');
    h.dispatchResults.set(b.id, 'retry');

    h.nowRef.value = 0;
    h.scheduler.start();
    expect(h.timer.armedDelay()).toBe(1_000); // earliest = a

    h.nowRef.value = 2_000; // both a (1000) and b (1500) now due
    await h.timer.fire();

    expect(h.dispatchLog).toEqual([a.id, b.id]); // run_at ASC order

    expect(jobs.getById(a.id)).toBeUndefined(); // done -> removed

    const bAfter = jobs.getById(b.id);
    expect(bAfter?.attempts).toBe(1);
    expect(bAfter?.next_backoff_ms).toBe(300_000); // 5m
    expect(bAfter?.run_at).toBe(2_000 + 300_000);

    // re-armed for the rescheduled b.
    expect(h.timer.armedCount()).toBe(1);
    expect(h.timer.armedDelay()).toBe(bAfter!.run_at - 2_000);
  });

  it('backoff escalates across successive retries: 0->+5m, 1->+15m, 2->+60m, 3->+60m (cap)', async () => {
    const h = setup();
    const c = jobs.enqueue({ session_id: 'schd', run_at: 0, kind: 'resume' });
    h.dispatchResults.set(c.id, 'retry');

    h.nowRef.value = 0;
    h.scheduler.start();
    expect(h.timer.armedDelay()).toBe(0);

    const expectedBackoffs = [300_000, 900_000, 3_600_000, 3_600_000]; // 5m,15m,60m,60m(cap)
    let now = 0;
    for (const [i, expected] of expectedBackoffs.entries()) {
      h.nowRef.value = now;
      // Sengaja await berurutan dalam loop: tiap iterasi bergantung pada state hasil iterasi sebelumnya.
      await h.timer.fire();
      const row = jobs.getById(c.id);
      expect(row?.attempts).toBe(i + 1);
      expect(row?.next_backoff_ms).toBe(expected);
      expect(row?.run_at).toBe(now + expected);
      now = row!.run_at;
    }
  });

  it('enqueue re-arms when the new job is sooner than the currently armed one', () => {
    const h = setup();
    jobs.enqueue({ session_id: 'schd', run_at: 100_000, kind: 'probe' });
    h.nowRef.value = 0;
    h.scheduler.start();
    expect(h.timer.armedDelay()).toBe(100_000);

    const sooner = h.scheduler.enqueue({ session_id: 'schd', run_at: 5_000, kind: 'probe' });

    expect(h.timer.armedCount()).toBe(1); // old timer cleared, one new timer armed
    expect(h.timer.armedDelay()).toBe(5_000);
    expect(sooner.run_at).toBe(5_000);
  });

  it('a dispatch that throws is treated as retry and calls onError', async () => {
    const h = setup();
    const d = jobs.enqueue({ session_id: 'schd', run_at: 0, kind: 'probe' });
    h.throwIds.add(d.id);

    h.nowRef.value = 0;
    h.scheduler.start();
    await h.timer.fire();

    expect(h.onErrorLog).toHaveLength(1);
    expect(h.onErrorLog[0]?.jobId).toBe(d.id);
    expect((h.onErrorLog[0]?.err as Error).message).toContain('dispatch failed');

    const row = jobs.getById(d.id);
    expect(row?.attempts).toBe(1);
    expect(row?.next_backoff_ms).toBe(300_000);
  });

  it('recovery: scheduler over a repo with pre-existing pending rows arms from persisted state', () => {
    // Simulasikan restart daemon: baris sudah ada di store SEBELUM scheduler instance ini dibuat
    // (di-insert langsung lewat repo, bukan lewat scheduler.enqueue) — membuktikan start() membaca
    // dari persistence, bukan state in-memory.
    const preexisting = jobs.enqueue({ session_id: 'schd', run_at: 42_000, kind: 'resume' });

    const h = setup(); // scheduler baru, tak pernah memanggil enqueue()
    h.nowRef.value = 2_000;
    h.scheduler.start();

    expect(h.timer.armedCount()).toBe(1);
    expect(h.timer.armedDelay()).toBe(preexisting.run_at - 2_000);
  });

  it('stop() clears the armed timer', () => {
    const h = setup();
    jobs.enqueue({ session_id: 'schd', run_at: 10_000, kind: 'probe' });
    h.scheduler.start();
    expect(h.timer.armedCount()).toBe(1);

    h.scheduler.stop();
    expect(h.timer.armedCount()).toBe(0);
  });
});
