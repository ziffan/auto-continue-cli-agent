// M3d.5/M3d.6/M3d.7 — dispatch NYATA (bukan stub) dari createSupervisor. Adapter.probeUsage
// di-stub via monkeypatch pada singleton `adapters` (tak perlu jaringan/kredensial nyata);
// Adapter.resumeCmd (claude) dipakai APA ADANYA — murni, tak ada I/O, aman dipanggil langsung.

import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adapters } from '../src/adapters/index.js';
import { createSupervisor } from '../src/daemon/supervisor.js';
import type { TimerHandle } from '../src/daemon/scheduler.js';
import { closeDb, openDb, type DatabaseInstance } from '../src/store/db.js';
import { createScheduledJobsRepo } from '../src/store/repositories/scheduled-jobs.js';
import { createSessionsRepo } from '../src/store/repositories/sessions.js';
import type { UsageSnapshot } from '../src/shared/types.js';

function uniqueSocketPath(): string {
  const rand = randomBytes(4).toString('hex');
  return process.platform === 'win32' ? `\\\\.\\pipe\\acca-dispatch-test-${rand}` : join(tmpdir(), `acca-dispatch-test-${rand}.sock`);
}

function createManualTimer() {
  let seq = 0;
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
    fire: async (): Promise<void> => {
      const entries = [...timers.entries()];
      const last = entries[entries.length - 1];
      if (!last) throw new Error('no timer armed to fire');
      const [id, t] = last;
      timers.delete(id);
      await t.fn();
    },
  };
}

// `probeUsage`/`resumeCmd` tak menyentuh `this` (fungsi murni) — aman disimpan lepas dari objek
// pemiliknya untuk restore di afterEach; unbound-method di sini adalah false positive.
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalClaudeProbeUsage = adapters.claude.probeUsage;
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalClaudeResumeCmd = adapters.claude.resumeCmd;

describe('supervisor real dispatch (M3d.5/6/7)', () => {
  let tempDir: string | undefined;
  let db: DatabaseInstance | undefined;
  let socketPath: string | undefined;

  afterEach(() => {
    adapters.claude.probeUsage = originalClaudeProbeUsage;
    adapters.claude.resumeCmd = originalClaudeResumeCmd;
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

  /** Bangun daemon, seed satu sesi + satu job due, fire timer sekali, lalu kembalikan handle
   * inspeksi (query mentah ke `db`) sebelum stop(). */
  async function setupAndFire(opts: {
    sessionId: string;
    procState: 'alive' | 'exited';
    cwd: string;
    jobKind: 'probe' | 'resume';
  }): Promise<{ db: DatabaseInstance }> {
    tempDir = join(tmpdir(), `acca-dispatch-test-${randomBytes(4).toString('hex')}`);
    process.env.ACCA_DATA_DIR = tempDir;
    db = openDb();
    socketPath = uniqueSocketPath();

    const sessions = createSessionsRepo(db);
    sessions.createSession({
      id: opts.sessionId,
      tool: 'claude',
      cwd: opts.cwd,
      status: 'LIMIT_HIT',
      proc_state: opts.procState,
      // pid = pid proses test ITU SENDIRI (selalu "alive") — supaya reconcileOrphans() yang
      // dijalankan supervisor.start() tidak diam-diam menulis-ulang proc_state 'alive'→'exited'
      // sebelum dispatch sempat berjalan (itu akan mengubah cabang yang diuji secara tak sengaja).
      pid: process.pid,
    });
    const jobs = createScheduledJobsRepo(db);
    jobs.enqueue({ session_id: opts.sessionId, run_at: 1_000, kind: opts.jobKind });

    const manual = createManualTimer();
    const nowRef = { value: 0 };

    const supervisor = createSupervisor({
      db,
      socketPath,
      now: () => nowRef.value,
      setTimer: manual.setTimer,
      clearTimer: manual.clearTimer,
      // deps.dispatch SENGAJA tidak diisi — memakai dispatch nyata di dalam createSupervisor.
    });

    await supervisor.start();
    nowRef.value = 1_000;
    await manual.fire();
    await supervisor.stop();

    return { db };
  }

  function eventsFor(database: DatabaseInstance, sessionId: string): Array<{ type: string; payload: unknown }> {
    const rows = database
      .prepare<[string], { type: string; payload: string }>('SELECT type, payload FROM events WHERE session_id = ? ORDER BY id ASC')
      .all(sessionId);
    return rows.map((r) => ({ type: r.type, payload: JSON.parse(r.payload) as unknown }));
  }

  function pendingJobs(database: DatabaseInstance, sessionId: string): Array<{ kind: string; attempts: number }> {
    return database
      .prepare<[string], { kind: string; attempts: number }>('SELECT kind, attempts FROM scheduled_jobs WHERE session_id = ?')
      .all(sessionId);
  }

  it('probe: all limits < 1 → enqueues a resume job and returns done (probe job removed)', async () => {
    adapters.claude.probeUsage = vi.fn(
      (): Promise<UsageSnapshot> =>
        Promise.resolve({
          tool: 'claude',
          limits: [{ kind: 'session', usedFraction: 0.4, resetAt: null }],
          capturedAt: 0,
        }),
    );

    const { db: database } = await setupAndFire({ sessionId: 's-probe-ok', procState: 'alive', cwd: process.cwd(), jobKind: 'probe' });

    const remaining = pendingJobs(database, 's-probe-ok');
    // Job 'probe' asli dihapus (done); job 'resume' baru muncul sebagai gantinya.
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.kind).toBe('resume');

    const events = eventsFor(database, 's-probe-ok');
    const done = events.find((e) => e.type === 'job_dispatch_done');
    expect(done).toBeDefined();
    expect((done?.payload as { action: string }).action).toBe('usage_available_enqueue_resume');
  });

  it('probe: at least one limit >= 1 → retry, no resume job enqueued', async () => {
    adapters.claude.probeUsage = vi.fn(
      (): Promise<UsageSnapshot> =>
        Promise.resolve({
          tool: 'claude',
          limits: [
            { kind: 'session', usedFraction: 0.2, resetAt: null },
            { kind: 'weekly_all', usedFraction: 1, resetAt: null },
          ],
          capturedAt: 0,
        }),
    );

    const { db: database } = await setupAndFire({ sessionId: 's-probe-limited', procState: 'alive', cwd: process.cwd(), jobKind: 'probe' });

    const remaining = pendingJobs(database, 's-probe-limited');
    // Job 'probe' tetap ada (retry = reschedule, bukan hapus); tak ada job 'resume' baru.
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.kind).toBe('probe');
    expect(remaining[0]?.attempts).toBe(1);

    const events = eventsFor(database, 's-probe-limited');
    const pending = events.find((e) => e.type === 'job_dispatch_pending');
    expect((pending?.payload as { action: string }).action).toBe('still_limited');
  });

  it('probe: empty limits → retry (cannot determine usage yet)', async () => {
    adapters.claude.probeUsage = vi.fn((): Promise<UsageSnapshot> => Promise.resolve({ tool: 'claude', limits: [], capturedAt: 0 }));

    const { db: database } = await setupAndFire({ sessionId: 's-probe-empty', procState: 'alive', cwd: process.cwd(), jobKind: 'probe' });

    const remaining = pendingJobs(database, 's-probe-empty');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.kind).toBe('probe');
  });

  it('probe: adapter.probeUsage throws → error event + retry', async () => {
    adapters.claude.probeUsage = vi.fn((): Promise<UsageSnapshot> => Promise.reject(new Error('network boom')));

    const { db: database } = await setupAndFire({ sessionId: 's-probe-throw', procState: 'alive', cwd: process.cwd(), jobKind: 'probe' });

    const remaining = pendingJobs(database, 's-probe-throw');
    expect(remaining).toHaveLength(1); // retry, not removed

    const events = eventsFor(database, 's-probe-throw');
    const errorEvent = events.find((e) => e.type === 'job_dispatch_error');
    expect(errorEvent).toBeDefined();
    expect((errorEvent?.payload as { error: string }).error).toContain('network boom');
  });

  it('resume: proc_state alive → inject_deferred event + done (not retry)', async () => {
    const { db: database } = await setupAndFire({ sessionId: 's-resume-alive', procState: 'alive', cwd: process.cwd(), jobKind: 'resume' });

    const remaining = pendingJobs(database, 's-resume-alive');
    expect(remaining).toHaveLength(0); // done → job removed, no infinite retry spin

    const events = eventsFor(database, 's-resume-alive');
    const pending = events.find((e) => e.type === 'job_dispatch_pending');
    expect(pending).toBeDefined();
    const payload = pending?.payload as { action: string; reason: string };
    expect(payload.action).toBe('inject_deferred');
    expect(payload.reason).toBe('invalid_pty_fd');
  });

  it('resume: proc_state exited + cwd exists → resume_ready event with spec.cwd + done', async () => {
    const realCwd = process.cwd();
    const { db: database } = await setupAndFire({ sessionId: 's-resume-exited-ok', procState: 'exited', cwd: realCwd, jobKind: 'resume' });

    const remaining = pendingJobs(database, 's-resume-exited-ok');
    expect(remaining).toHaveLength(0);

    const events = eventsFor(database, 's-resume-exited-ok');
    const done = events.find((e) => e.type === 'job_dispatch_done');
    expect(done).toBeDefined();
    const payload = done?.payload as { action: string; spec: { file: string; args: string[]; cwd?: string } };
    expect(payload.action).toBe('resume_ready');
    expect(payload.spec.cwd).toBe(realCwd);
    expect(payload.spec.file).toBe('claude');
  });

  it('resume: proc_state exited + cwd missing → BLOCKED event + done (terminal, no retry)', async () => {
    const missingCwd = join(tmpdir(), `acca-missing-cwd-${randomBytes(6).toString('hex')}`);
    const { db: database } = await setupAndFire({ sessionId: 's-resume-exited-blocked', procState: 'exited', cwd: missingCwd, jobKind: 'resume' });

    const remaining = pendingJobs(database, 's-resume-exited-blocked');
    expect(remaining).toHaveLength(0);

    const events = eventsFor(database, 's-resume-exited-blocked');
    const errorEvent = events.find((e) => e.type === 'job_dispatch_error');
    expect(errorEvent).toBeDefined();
    const payload = errorEvent?.payload as { action: string; reason: string; status: string };
    expect(payload.action).toBe('blocked');
    expect(payload.reason).toBe('cwd_missing');
    expect(payload.status).toBe('BLOCKED');
  });
});
