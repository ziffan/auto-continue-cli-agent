// M3d.5/M3d.6/M3d.7 — dispatch NYATA (bukan stub) dari createSupervisor. Adapter.probeUsage
// di-stub via monkeypatch pada singleton `adapters` (tak perlu jaringan/kredensial nyata);
// Adapter.resumeCmd (claude) dipakai APA ADANYA — murni, tak ada I/O, aman dipanggil langsung.

import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adapters } from '../src/adapters/index.js';
import type { InjectRequestResult } from '../src/daemon/inject-continue.js';
import { sendCommand } from '../src/daemon/ipc-client.js';
import { createSupervisor, type SupervisorDeps } from '../src/daemon/supervisor.js';
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
    cliSessionId?: string;
    requestInject?: SupervisorDeps['requestInject'];
    spawnResume?: SupervisorDeps['spawnResume'];
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
      cli_session_id: opts.cliSessionId ?? null,
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
      requestInject: opts.requestInject,
      // spawnResume SELALU di-inject untuk cabang exited — default runSession akan men-spawn
      // proses `claude` NYATA di mesin ini (fatal untuk unit test).
      spawnResume: opts.spawnResume,
      // M4: no-op notify → transisi (RESUMED/BLOCKED) tak menulis ke stderr saat test.
      notify: () => {},
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

  it('resume: proc_state alive + wrapper injects → RESUMED + inject_continue event + done', async () => {
    const injected: InjectRequestResult = { reachable: true, injected: true, reason: null };
    const requestInject = vi.fn((): Promise<InjectRequestResult> => Promise.resolve(injected));

    const { db: database } = await setupAndFire({ sessionId: 's-resume-alive-ok', procState: 'alive', cwd: process.cwd(), jobKind: 'resume', requestInject });

    expect(requestInject).toHaveBeenCalledTimes(1);

    const remaining = pendingJobs(database, 's-resume-alive-ok');
    expect(remaining).toHaveLength(0); // done → job removed, no spin

    const session = createSessionsRepo(database).getById('s-resume-alive-ok');
    expect(session?.status).toBe('RESUMED');
    expect(session?.proc_state).toBe('alive'); // inject-continue melanjutkan proses yang SAMA

    const events = eventsFor(database, 's-resume-alive-ok');
    const done = events.find((e) => e.type === 'job_dispatch_done');
    expect((done?.payload as { action: string }).action).toBe('inject_continue');
    const statusChange = events.find(
      (e) => e.type === 'status_change' && (e.payload as { to?: string }).to === 'RESUMED',
    );
    expect(statusChange).toBeDefined();
  });

  it('resume: proc_state alive + wrapper unreachable → inject_skipped event + done (no spin, no status change)', async () => {
    const unreachable: InjectRequestResult = { reachable: false, injected: false, reason: 'wrapper_unreachable' };
    const requestInject = vi.fn((): Promise<InjectRequestResult> => Promise.resolve(unreachable));

    const { db: database } = await setupAndFire({ sessionId: 's-resume-alive-gone', procState: 'alive', cwd: process.cwd(), jobKind: 'resume', requestInject });

    const remaining = pendingJobs(database, 's-resume-alive-gone');
    expect(remaining).toHaveLength(0); // done → job removed, tak ada retry-spin

    const session = createSessionsRepo(database).getById('s-resume-alive-gone');
    expect(session?.status).toBe('LIMIT_HIT'); // TAK di-RESUMED — surface manual (ADR-014)

    const events = eventsFor(database, 's-resume-alive-gone');
    const pending = events.find((e) => e.type === 'job_dispatch_pending' && (e.payload as { action?: string }).action === 'inject_skipped');
    expect(pending).toBeDefined();
    const payload = pending?.payload as { action: string; reason: string; reachable: boolean };
    expect(payload.reason).toBe('wrapper_unreachable');
    expect(payload.reachable).toBe(false);
  });

  it('resume: proc_state exited + cwd exists → spawns fresh wrapper at spec.cwd (AC-8), marks RESUMED', async () => {
    const realCwd = process.cwd();
    const spawnCalls: Array<{ file: string; args: string[]; cwd?: string; tool: string }> = [];
    const spawnResume = vi.fn((spec: { file: string; args: string[]; cwd?: string }, session: { tool: string }) => {
      spawnCalls.push({ file: spec.file, args: spec.args, cwd: spec.cwd, tool: session.tool });
      return { sessionId: 'new-session-1' };
    });

    const { db: database } = await setupAndFire({ sessionId: 's-resume-exited-ok', procState: 'exited', cwd: realCwd, jobKind: 'resume', cliSessionId: 'cc-uuid-abc123', spawnResume });

    // Spawn dipanggil TEPAT SEKALI, dengan cwd sesi ASLI (AC-8) + perintah resume-by-id yang benar.
    expect(spawnResume).toHaveBeenCalledTimes(1);
    expect(spawnCalls[0]?.cwd).toBe(realCwd);
    expect(spawnCalls[0]?.file).toBe('claude');
    // A-1: resume WAJIB pakai cli_session_id (id milik CLI), BUKAN id supervisor 's-resume-exited-ok'.
    expect(spawnCalls[0]?.args).toEqual(['--resume', 'cc-uuid-abc123']);

    const remaining = pendingJobs(database, 's-resume-exited-ok');
    expect(remaining).toHaveLength(0);

    const session = createSessionsRepo(database).getById('s-resume-exited-ok');
    expect(session?.status).toBe('RESUMED');

    const events = eventsFor(database, 's-resume-exited-ok');
    const done = events.find((e) => e.type === 'job_dispatch_done');
    const payload = done?.payload as { action: string; newSessionId?: string; spec: { cwd?: string } };
    expect(payload.action).toBe('resume_spawned');
    expect(payload.newSessionId).toBe('new-session-1');
    expect(payload.spec.cwd).toBe(realCwd);
  });

  it('resume: proc_state exited + cwd exists but cli_session_id NULL → BLOCKED, NO spawn, old session NOT resumed (A-1)', async () => {
    // Regresi A-1 (audit 11 Jul): tanpa cli_session_id, resume-by-id dulu men-spawn dgn id supervisor
    // 4-char yang PASTI ditolak CLI nyata (+ keliru markResumed). Sekarang: BLOCKED + surface, tak spawn.
    const spawnResume = vi.fn(() => ({ sessionId: 'should-not-happen' }));
    // cwd ADA (process.cwd) → guard cwd_missing lolos; yang memblokir = cli_session_id absen.
    const { db: database } = await setupAndFire({ sessionId: 's-resume-no-cliid', procState: 'exited', cwd: process.cwd(), jobKind: 'resume', spawnResume });

    expect(spawnResume).not.toHaveBeenCalled(); // JANGAN spawn id yang dijamin salah.

    const session = createSessionsRepo(database).getById('s-resume-no-cliid');
    expect(session?.status).toBe('LIMIT_HIT'); // TAK di-RESUMED.

    const remaining = pendingJobs(database, 's-resume-no-cliid');
    expect(remaining).toHaveLength(0); // 'done' terminal (surface manual), bukan retry-spin.

    const events = eventsFor(database, 's-resume-no-cliid');
    const blocked = events.find((e) => e.type === 'job_dispatch_error');
    const payload = blocked?.payload as { action: string; reason: string; status: string };
    expect(payload.action).toBe('blocked');
    expect(payload.reason).toBe('cli_session_id_missing');
    expect(payload.status).toBe('BLOCKED');
  });

  it('resume: proc_state exited + DEFAULT spawnResume + missing binary → daemon survives, old session NOT resumed, error surfaced (A-2)', async () => {
    // Regresi A-2 (audit 11 Jul): jalankan DEFAULT spawnResumeFn (BUKAN stub) → runSession in-process.
    // Arahkan resumeCmd ke binary yang tak ada di PATH supaya which() = null → runSession gagal SINKRON
    // (markFailed + waitForExit REJECT) TANPA men-spawn proses nyata. Dulu: rejected promise di-drop →
    // unhandledRejection mematikan daemon + sesi lama keliru RESUMED. Sekarang: ditangani + tak keliru.
    adapters.claude.resumeCmd = vi.fn(() => ({ file: 'acca-nonexistent-binary-zzz', args: ['--resume', 'x'] }));

    // spawnResume TIDAK di-inject → default runSession dipakai (jalur yang dulu tak pernah diuji).
    // cli_session_id diisi supaya lolos guard A-1 dan MENCAPAI jalur spawn (yang di sini gagal binary).
    const { db: database } = await setupAndFire({ sessionId: 's-resume-spawn-fail', procState: 'exited', cwd: process.cwd(), jobKind: 'resume', cliSessionId: 'cc-uuid-fail' });

    // Daemon selamat: fire()/stop() di setupAndFire resolve tanpa throw/unhandledRejection.
    // Sesi lama TAK di-RESUMED (defect kedua A-2) — tetap LIMIT_HIT sampai resume benar-benar sukses.
    const session = createSessionsRepo(database).getById('s-resume-spawn-fail');
    expect(session?.status).toBe('LIMIT_HIT');

    // Kegagalan di-surface (event) + job 'resume' dipertahankan untuk retry backoff (bukan dibuang).
    const events = eventsFor(database, 's-resume-spawn-fail');
    const err = events.find(
      (e) => e.type === 'job_dispatch_error' && (e.payload as { action?: string }).action === 'resume_spawn_failed',
    );
    expect(err).toBeDefined();
    const remaining = pendingJobs(database, 's-resume-spawn-fail');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.kind).toBe('resume');

    // Sesi baru (hasil runSession gagal-sinkron) tercatat FAILED + resumed_from = sesi asal → bukti
    // DEFAULT path benar-benar dijalankan (bukan stub), dan rantai resume (I-14) terjaga.
    const newSessionId = (err?.payload as { newSessionId?: string }).newSessionId;
    expect(typeof newSessionId).toBe('string');
    const newSession = newSessionId ? createSessionsRepo(database).getById(newSessionId) : undefined;
    expect(newSession?.status).toBe('FAILED');
    expect(newSession?.resumed_from).toBe('s-resume-spawn-fail');
  });

  it('rearm over IPC arms a job written by another process AFTER start (I-10 cross-process)', async () => {
    tempDir = join(tmpdir(), `acca-dispatch-test-${randomBytes(4).toString('hex')}`);
    process.env.ACCA_DATA_DIR = tempDir;
    db = openDb();
    socketPath = uniqueSocketPath();

    const sessions = createSessionsRepo(db);
    sessions.createSession({
      id: 's-rearm',
      tool: 'claude',
      cwd: process.cwd(),
      status: 'LIMIT_HIT',
      proc_state: 'alive',
      pid: process.pid, // "alive" → reconcileOrphans tak menyentuhnya.
    });

    // Probe stub → usage tersedia (dispatch probe akan enqueue resume + done, bukti job ter-dispatch).
    adapters.claude.probeUsage = vi.fn(
      (): Promise<UsageSnapshot> =>
        Promise.resolve({ tool: 'claude', limits: [{ kind: 'session', usedFraction: 0.4, resetAt: null }], capturedAt: 0 }),
    );

    const manual = createManualTimer();
    const nowRef = { value: 0 };
    const supervisor = createSupervisor({
      db,
      socketPath,
      now: () => nowRef.value,
      setTimer: manual.setTimer,
      clearTimer: manual.clearTimer,
      notify: () => {},
    });

    await supervisor.start(); // tak ada job pending → scheduler disarmed (tak ada timer).
    await expect(manual.fire()).rejects.toThrow(/no timer armed/); // buktikan benar-benar disarmed.

    // Proses LAIN menulis job `probe` langsung ke store (bukan lewat scheduler.enqueue in-process).
    const jobs = createScheduledJobsRepo(db);
    jobs.enqueue({ session_id: 's-rearm', run_at: 1_000, kind: 'probe' });

    // Notify lintas-proses: daemon HIDUP harus memuat ulang & arm — tanpa restart.
    const ack = await sendCommand(socketPath, 'rearm', undefined, { timeoutMs: 2000 });
    expect(ack).toEqual({ rearmed: true });

    // Timer kini armed atas job eksternal → fire → dispatch berjalan.
    nowRef.value = 1_000;
    await manual.fire();
    await supervisor.stop();

    // Bukti job eksternal ter-dispatch: probe done (dihapus) + resume baru ter-enqueue.
    const remaining = pendingJobs(db, 's-rearm');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.kind).toBe('resume');
    const events = eventsFor(db, 's-rearm');
    expect(events.find((e) => e.type === 'job_dispatch_done')).toBeDefined();
  });

  it('resume: proc_state exited + cwd missing → BLOCKED event + done (terminal, no retry, NO spawn)', async () => {
    const missingCwd = join(tmpdir(), `acca-missing-cwd-${randomBytes(6).toString('hex')}`);
    const spawnResume = vi.fn(() => ({ sessionId: 'should-not-happen' }));
    const { db: database } = await setupAndFire({ sessionId: 's-resume-exited-blocked', procState: 'exited', cwd: missingCwd, jobKind: 'resume', spawnResume });

    // AC-8: cwd hilang → JANGAN spawn di tempat yang salah.
    expect(spawnResume).not.toHaveBeenCalled();

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
