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
import type { Session, UsageSnapshot } from '../src/shared/types.js';

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
  };
}

// `probeUsage`/`resumeCmd` tak menyentuh `this` (fungsi murni) — aman disimpan lepas dari objek
// pemiliknya untuk restore di afterEach; unbound-method di sini adalah false positive.
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalClaudeProbeUsage = adapters.claude.probeUsage;
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalClaudeResumeCmd = adapters.claude.resumeCmd;
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalAgyProbeUsage = adapters.antigravity.probeUsage;

describe('supervisor real dispatch (M3d.5/6/7)', () => {
  let tempDir: string | undefined;
  let db: DatabaseInstance | undefined;
  let socketPath: string | undefined;

  afterEach(() => {
    adapters.claude.probeUsage = originalClaudeProbeUsage;
    adapters.claude.resumeCmd = originalClaudeResumeCmd;
    adapters.antigravity.probeUsage = originalAgyProbeUsage;
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
    jobKind: 'probe' | 'resume' | 'verify';
    /** Status awal sesi. Default 'LIMIT_HIT' (cabang probe/resume). Cabang `verify` butuh 'RUNNING'
     *  (sesi yang limit-nya DI-suppress, belum di-latch). */
    status?: Session['status'];
    cliSessionId?: string;
    tool?: 'claude' | 'antigravity';
    requestInject?: SupervisorDeps['requestInject'];
    spawnResume?: SupervisorDeps['spawnResume'];
    /** B-1: seed `scheduled_jobs.attempts` awal (simulasi job yang sudah di-retry N kali) supaya
     *  cabang attempts-cap bisa diuji dengan SATU fire alih-alih men-drive banyak siklus backoff. */
    jobAttempts?: number;
    /** C-4/RC-4: override pid sesi (default = pid test = alive). Pid mati → uji reconcile liveness. */
    pid?: number;
    /** C-4: dijalankan SETELAH start() (reconcileOrphans sudah lewat) & SEBELUM fire() — simulasi wrapper
     *  mati keras SETELAH daemon start (mis. set pid ke pid mati) supaya reconcile DISPATCH yang diuji. */
    beforeFire?: (database: DatabaseInstance) => void;
  }): Promise<{ db: DatabaseInstance }> {
    tempDir = join(tmpdir(), `acca-dispatch-test-${randomBytes(4).toString('hex')}`);
    process.env.ACCA_DATA_DIR = tempDir;
    db = openDb();
    socketPath = uniqueSocketPath();

    const sessions = createSessionsRepo(db);
    sessions.createSession({
      id: opts.sessionId,
      tool: opts.tool ?? 'claude',
      cwd: opts.cwd,
      status: opts.status ?? 'LIMIT_HIT',
      proc_state: opts.procState,
      cli_session_id: opts.cliSessionId ?? null,
      // pid = pid proses test ITU SENDIRI (selalu "alive") — supaya reconcileOrphans() yang
      // dijalankan supervisor.start() tidak diam-diam menulis-ulang proc_state 'alive'→'exited'
      // sebelum dispatch sempat berjalan (itu akan mengubah cabang yang diuji secara tak sengaja).
      // C-4/RC-4: opts.pid (mis. pid mati) meng-override utk menguji reconcile liveness saat dispatch.
      pid: opts.pid ?? process.pid,
    });
    const jobs = createScheduledJobsRepo(db);
    const job = jobs.enqueue({ session_id: opts.sessionId, run_at: 1_000, kind: opts.jobKind });
    if (opts.jobAttempts !== undefined) {
      db.prepare('UPDATE scheduled_jobs SET attempts = @a WHERE id = @id').run({ a: opts.jobAttempts, id: job.id });
    }

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
    opts.beforeFire?.(db);
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
    // C-5: probe CC = real-time (HTTP) → TAK ditandai basi (marker khusus agy-alive).
    expect((done?.payload as { reason?: string }).reason).toBeUndefined();
  });

  it('probe C-5: agy sesi ALIVE → resume di-enqueue TAPI ditandai reason ls_snapshot_stale (G-35)', async () => {
    // Probe usage agy sesi-hidup = snapshot LS beku launch-time → keputusan "tersedia" berbasis data basi.
    // Perilaku sama (enqueue resume, self-correcting R3) tapi audit-trail wajib jujur soal kebasian.
    adapters.antigravity.probeUsage = vi.fn(
      (): Promise<UsageSnapshot> =>
        Promise.resolve({
          tool: 'antigravity',
          limits: [{ kind: 'session', usedFraction: 0.3, resetAt: null }],
          capturedAt: 0,
        }),
    );

    const { db: database } = await setupAndFire({
      sessionId: 's-probe-agy-alive',
      procState: 'alive',
      cwd: process.cwd(),
      jobKind: 'probe',
      tool: 'antigravity',
    });

    const remaining = pendingJobs(database, 's-probe-agy-alive');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.kind).toBe('resume');

    const events = eventsFor(database, 's-probe-agy-alive');
    const done = events.find((e) => e.type === 'job_dispatch_done');
    expect((done?.payload as { action: string }).action).toBe('usage_available_enqueue_resume');
    expect((done?.payload as { reason?: string }).reason).toBe('ls_snapshot_stale');
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

  it('probe (I-25): CC globals free but an UNUSED scoped model exhausted → still enqueues resume', async () => {
    // Bug lama: `every(usedFraction<1)` memblokir resume selamanya krn weekly Opus (scoped, tak dipakai)
    // habis, walau session+weekly_all + model aktif masih punya kuota. Kini adapter.isUsageAvailable
    // (CC) hanya gate window mengikat → resume di-enqueue.
    adapters.claude.probeUsage = vi.fn(
      (): Promise<UsageSnapshot> =>
        Promise.resolve({
          tool: 'claude',
          limits: [
            { kind: 'session', usedFraction: 0.3, resetAt: null },
            { kind: 'weekly_all', usedFraction: 0.3, resetAt: null },
            { kind: 'weekly_scoped', usedFraction: 1, resetAt: null, scope: 'Claude Opus 4.6', isActive: false },
          ],
          capturedAt: 0,
        }),
    );

    const { db: database } = await setupAndFire({ sessionId: 's-probe-scoped', procState: 'alive', cwd: process.cwd(), jobKind: 'probe' });

    const remaining = pendingJobs(database, 's-probe-scoped');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.kind).toBe('resume');

    const events = eventsFor(database, 's-probe-scoped');
    const done = events.find((e) => e.type === 'job_dispatch_done');
    expect((done?.payload as { action: string }).action).toBe('usage_available_enqueue_resume');
  });

  // I-35 residual: cabang `verify` (probe verifikasi eksplisit). Sesi BELUM di-latch (limit output
  // di-suppress korroborasi → tetap RUNNING); verify mem-probe → kuota HABIS = latch, tersedia = FP.
  function sessionRow(database: DatabaseInstance, sessionId: string): { status: string; detect_source: string | null } {
    return database
      .prepare<[string], { status: string; detect_source: string | null }>('SELECT status, detect_source FROM sessions WHERE id = ?')
      .get(sessionId) as { status: string; detect_source: string | null };
  }

  it('verify: kuota tersedia → FP terkonfirmasi (TAK latch, TAK resume), job verify dihapus', async () => {
    adapters.claude.probeUsage = vi.fn(
      (): Promise<UsageSnapshot> =>
        Promise.resolve({ tool: 'claude', limits: [{ kind: 'session', usedFraction: 0.4, resetAt: null }], capturedAt: 0 }),
    );

    const { db: database } = await setupAndFire({ sessionId: 's-verify-fp', procState: 'alive', cwd: process.cwd(), jobKind: 'verify', status: 'RUNNING' });

    // Sesi tetap RUNNING — suppress benar, verify tak mengubah apa pun.
    expect(sessionRow(database, 's-verify-fp').status).toBe('RUNNING');
    // Job verify selesai+dihapus; TAK ada job probe/resume baru (verify tak pernah resume).
    expect(pendingJobs(database, 's-verify-fp')).toHaveLength(0);

    const done = eventsFor(database, 's-verify-fp').find((e) => e.type === 'job_dispatch_done');
    expect((done?.payload as { action: string }).action).toBe('verify_fp_confirmed');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(adapters.claude.probeUsage).toHaveBeenCalledTimes(1);
  });

  it('verify: kuota HABIS → latch LIMIT_HIT (source verify) + probe dijadwalkan (mesin normal ambil alih)', async () => {
    adapters.claude.probeUsage = vi.fn(
      (): Promise<UsageSnapshot> =>
        Promise.resolve({ tool: 'claude', limits: [{ kind: 'session', usedFraction: 1, resetAt: null }], capturedAt: 0 }),
    );

    const { db: database } = await setupAndFire({ sessionId: 's-verify-latch', procState: 'alive', cwd: process.cwd(), jobKind: 'verify', status: 'RUNNING' });

    const row = sessionRow(database, 's-verify-latch');
    expect(row.status).toBe('LIMIT_HIT');
    expect(row.detect_source).toBe('verify');
    // verify job dihapus (done); job `probe` baru dijadwalkan oleh scheduleProbeForLimit (mesin normal).
    const remaining = pendingJobs(database, 's-verify-latch');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.kind).toBe('probe');

    const events = eventsFor(database, 's-verify-latch');
    const done = events.find(
      (e) => e.type === 'job_dispatch_done' && (e.payload as { action: string }).action === 'verify_latched_real_limit',
    );
    expect(done).toBeDefined();

    // D-2 (RD-2, audit keempat): latch via verify WAJIB menulis `status_change {to:LIMIT_HIT}` —
    // konsistensi audit-trail + otomatis di-surface Notifier (mapping status_change→LIMIT_HIT sudah
    // diuji di notifier.test.ts). Sebelumnya = satu-satunya jalur latch yang bisu.
    const statusChange = events.find(
      (e) => e.type === 'status_change' && (e.payload as { to?: string; source?: string }).to === 'LIMIT_HIT',
    );
    expect(statusChange).toBeDefined();
    expect((statusChange?.payload as { source?: string }).source).toBe('verify');
  });

  it('verify: sesi sudah LIMIT_HIT (hook primer melatch di antara suppress & fire) → skip, probe TAK dipanggil', async () => {
    adapters.claude.probeUsage = vi.fn(
      (): Promise<UsageSnapshot> => Promise.resolve({ tool: 'claude', limits: [{ kind: 'session', usedFraction: 0.4, resetAt: null }], capturedAt: 0 }),
    );

    const { db: database } = await setupAndFire({ sessionId: 's-verify-stale', procState: 'alive', cwd: process.cwd(), jobKind: 'verify', status: 'LIMIT_HIT' });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(adapters.claude.probeUsage).not.toHaveBeenCalled();
    const done = eventsFor(database, 's-verify-stale').find((e) => e.type === 'job_dispatch_done');
    expect((done?.payload as { action: string }).action).toBe('skipped:verify_stale');
    expect(pendingJobs(database, 's-verify-stale')).toHaveLength(0);
  });

  it('verify: probe tak terbaca di cap attempts → menyerah TANPA markBlocked (sesi tetap RUNNING)', async () => {
    adapters.claude.probeUsage = vi.fn(
      (): Promise<UsageSnapshot> => Promise.resolve({ tool: 'claude', limits: [], capturedAt: 0 }),
    );

    // jobAttempts=2 → attempts+1=3 = MAX_DISPATCH_ATTEMPTS → cabang cap dalam SATU fire.
    const { db: database } = await setupAndFire({ sessionId: 's-verify-unreadable', procState: 'alive', cwd: process.cwd(), jobKind: 'verify', status: 'RUNNING', jobAttempts: 2 });

    // KRITIS (beda dari cabang probe): sesi RUNNING & sehat TAK boleh di-BLOCKED atas probe tak terbaca.
    expect(sessionRow(database, 's-verify-unreadable').status).toBe('RUNNING');
    const done = eventsFor(database, 's-verify-unreadable').find((e) => e.type === 'job_dispatch_done');
    expect((done?.payload as { action: string }).action).toBe('skipped:verify_unreadable');
    expect(pendingJobs(database, 's-verify-unreadable')).toHaveLength(0);
  });

  it('probe: empty limits → retry (cannot determine usage yet)', async () => {
    adapters.claude.probeUsage = vi.fn((): Promise<UsageSnapshot> => Promise.resolve({ tool: 'claude', limits: [], capturedAt: 0 }));

    const { db: database } = await setupAndFire({ sessionId: 's-probe-empty', procState: 'alive', cwd: process.cwd(), jobKind: 'probe' });

    const remaining = pendingJobs(database, 's-probe-empty');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.kind).toBe('probe');
  });

  it('probe: sesi TAK LAGI LIMIT_HIT saat job fire (mis. resume manual/race) → skip stale, TAK panggil probeUsage (I-35 residual)', async () => {
    const probeUsage = vi.fn((): Promise<UsageSnapshot> => Promise.reject(new Error('probeUsage TAK BOLEH dipanggil untuk job stale')));
    adapters.claude.probeUsage = probeUsage;

    const { db: database } = await setupAndFire({
      sessionId: 's-probe-stale',
      procState: 'alive',
      cwd: process.cwd(),
      jobKind: 'probe',
      // Simulasi status berubah SETELAH job dijadwalkan (resume-now manual / race) — SEBELUM job fire.
      beforeFire: (db2) => db2.prepare("UPDATE sessions SET status = 'RUNNING' WHERE id = @id").run({ id: 's-probe-stale' }),
    });

    expect(probeUsage).not.toHaveBeenCalled();

    // Job stale dibuang (done), TANPA enqueue job resume baru.
    const remaining = pendingJobs(database, 's-probe-stale');
    expect(remaining).toHaveLength(0);

    // Status TAK disentuh dispatch (sudah RUNNING dari luar; guard hanya no-op, bukan menulis status).
    const session = createSessionsRepo(database).getById('s-probe-stale');
    expect(session?.status).toBe('RUNNING');

    const events = eventsFor(database, 's-probe-stale');
    const done = events.find((e) => e.type === 'job_dispatch_done');
    expect(done).toBeDefined();
    expect((done?.payload as { action: string; status: string }).action).toBe('skipped:probe_stale_status');
    expect((done?.payload as { action: string; status: string }).status).toBe('RUNNING');
    expect(events.find((e) => e.type === 'job_dispatch_error')).toBeUndefined();
  });

  // D-1 (audit keempat 18 Jul / RD-1 Opsi A) — test KOMPOSISI lifecycle: status dicapai lewat
  // transisi repo NYATA (markLimitHit → markExited, urutan persis wrapper), BUKAN di-seed langsung.
  // Kelas gap yang melahirkan D-1: semua test dispatch men-seed status akhir → interaksi
  // markExited×guard-I-35 tak pernah teruji. Dua test ini mengunci semantik yang diputuskan owner.
  it('D-1 komposisi (agy): LIMIT_HIT → exit BERSIH → probe fire → optimistic resume (BUKAN skip stale)', async () => {
    const { db: database } = await setupAndFire({
      sessionId: 's-d1-agy',
      tool: 'antigravity',
      procState: 'alive',
      cwd: process.cwd(),
      jobKind: 'probe',
      status: 'RUNNING',
      // Urutan kejadian nyata di wrapper: limit ter-latch, lalu user menutup CLI bersih (Ctrl-C).
      beforeFire: (db2) => {
        const sessions = createSessionsRepo(db2);
        sessions.markLimitHit('s-d1-agy', { source: 'output', detectedAt: 500 });
        sessions.markExited('s-d1-agy');
      },
    });

    const session = createSessionsRepo(database).getById('s-d1-agy');
    expect(session?.status).toBe('LIMIT_HIT'); // markExited TAK meng-clobber (RD-1 Opsi A)
    expect(session?.proc_state).toBe('exited');

    // Jalur ADR-019 hidup kembali: probe → optimistic resume (job `resume` di-enqueue), bukan skip.
    const remaining = pendingJobs(database, 's-d1-agy');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.kind).toBe('resume');

    const events = eventsFor(database, 's-d1-agy');
    const done = events.find((e) => e.type === 'job_dispatch_done');
    expect((done?.payload as { action: string }).action).toBe('optimistic_resume_agy_exited');
    expect(events.find((e) => (e.payload as { action?: string }).action === 'skipped:probe_stale_status')).toBeUndefined();
  });

  it('D-1 komposisi (CC): LIMIT_HIT → exit BERSIH → probe fire → probeUsage jalan → enqueue resume', async () => {
    const probeUsage = vi.fn(
      (): Promise<UsageSnapshot> =>
        Promise.resolve({ tool: 'claude', limits: [{ kind: 'session', usedFraction: 0.3, resetAt: null }], capturedAt: 0 }),
    );
    adapters.claude.probeUsage = probeUsage;

    const { db: database } = await setupAndFire({
      sessionId: 's-d1-cc',
      procState: 'alive',
      cwd: process.cwd(),
      jobKind: 'probe',
      status: 'RUNNING',
      cliSessionId: '77777777-7777-7777-7777-777777777777',
      beforeFire: (db2) => {
        const sessions = createSessionsRepo(db2);
        sessions.markLimitHit('s-d1-cc', { source: 'stopfailure', detectedAt: 500 });
        sessions.markExited('s-d1-cc');
      },
    });

    expect(probeUsage).toHaveBeenCalledTimes(1); // probe BERJALAN — bukan skipped:probe_stale_status

    const session = createSessionsRepo(database).getById('s-d1-cc');
    expect(session?.status).toBe('LIMIT_HIT');
    expect(session?.proc_state).toBe('exited');

    const remaining = pendingJobs(database, 's-d1-cc');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.kind).toBe('resume'); // dispatch berikutnya = resume-by-id (cabang exited)
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

  it('probe: agy session exited → optimistic resume (enqueue resume, done, NOT blocked) — ADR-019', async () => {
    // ADR-019 (men-supersede ADR-018): probe agy standalone MUSTAHIL untuk sesi exited (LS bind hanya
    // ber-PTY, port terikat PID mati); alternatif OAuth `retrieveUserQuota` LIVE-VERIFIED membaca pool
    // kuota SALAH (gemini-cli harian ≠ grup agy weekly+5h, G-38). Karena itu: JANGAN probe & JANGAN
    // BLOCKED — resume OPTIMISTIC. Job probe dijadwalkan pada reset_at (kuota mungkin sudah tersedia) →
    // enqueue resume; bila ternyata masih limit, sesi hasil-resume mendeteksi ulang via LS-nya.
    // probeUsage SENGAJA tak di-stub — guard fire SEBELUM adapter dipanggil (kalau terpanggil, probeAgyUsage
    // nyata akan discoverLocalPorts pada PID test → tak deterministik).
    const { db: database } = await setupAndFire({
      sessionId: 's-probe-agy-exited',
      tool: 'antigravity',
      procState: 'exited',
      cwd: process.cwd(),
      jobKind: 'probe',
    });

    // Job 'probe' dihapus (done); job 'resume' baru muncul sebagai gantinya (bukan retry backoff senyap).
    const remaining = pendingJobs(database, 's-probe-agy-exited');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.kind).toBe('resume');

    // TAK di-BLOCKED — sesi tetap LIMIT_HIT (optimistic, bukan minta manual).
    const session = createSessionsRepo(database).getById('s-probe-agy-exited');
    expect(session?.status).toBe('LIMIT_HIT');

    const events = eventsFor(database, 's-probe-agy-exited');
    const done = events.find((e) => e.type === 'job_dispatch_done');
    expect(done).toBeDefined();
    const payload = done?.payload as { action: string; reason: string };
    expect(payload.action).toBe('optimistic_resume_agy_exited');
    // Tak ada event error (bukan BLOCKED, bukan probe_impossible).
    expect(events.find((e) => e.type === 'job_dispatch_error')).toBeUndefined();
  });

  it('resume: proc_state alive + wrapper injects → inject_continue event + done (status transition owned by wrapper, R3)', async () => {
    const injected: InjectRequestResult = { reachable: true, injected: true, reason: null };
    const requestInject = vi.fn((): Promise<InjectRequestResult> => Promise.resolve(injected));

    const { db: database } = await setupAndFire({ sessionId: 's-resume-alive-ok', procState: 'alive', cwd: process.cwd(), jobKind: 'resume', requestInject });

    expect(requestInject).toHaveBeenCalledTimes(1);

    const remaining = pendingJobs(database, 's-resume-alive-ok');
    expect(remaining).toHaveLength(0); // done → job removed, no spin

    // R3 (I-21): daemon TAK lagi menulis status pada jalur inject — transisi RUNNING + un-latch watcher
    // dilakukan WRAPPER via `onInjected` (ADR-017). `requestInject` di-stub di sini (tanpa wrapper nyata)
    // → status tetap LIMIT_HIT. Transisi wrapper diuji terpisah (inject-continue.test.ts + sessions/
    // limit-watcher). Daemon di sini hanya mencatat audit + memicu notifikasi RESUMED via event dispatch.
    const session = createSessionsRepo(database).getById('s-resume-alive-ok');
    expect(session?.status).toBe('LIMIT_HIT');
    expect(session?.proc_state).toBe('alive'); // inject-continue melanjutkan proses yang SAMA

    const events = eventsFor(database, 's-resume-alive-ok');
    const done = events.find((e) => e.type === 'job_dispatch_done');
    expect((done?.payload as { action: string }).action).toBe('inject_continue');
    // Daemon TIDAK lagi meng-emit `status_change RESUMED` (wrapper yang meng-emit `RUNNING`).
    const resumedStatusChange = events.find(
      (e) => e.type === 'status_change' && (e.payload as { to?: string }).to === 'RESUMED',
    );
    expect(resumedStatusChange).toBeUndefined();
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

    const { db: database } = await setupAndFire({ sessionId: 's-resume-exited-ok', procState: 'exited', cwd: realCwd, jobKind: 'resume', cliSessionId: '11111111-1111-1111-1111-111111111111', spawnResume });

    // Spawn dipanggil TEPAT SEKALI, dengan cwd sesi ASLI (AC-8) + perintah resume-by-id yang benar.
    expect(spawnResume).toHaveBeenCalledTimes(1);
    expect(spawnCalls[0]?.cwd).toBe(realCwd);
    expect(spawnCalls[0]?.file).toBe('claude');
    // A-1: resume WAJIB pakai cli_session_id (id milik CLI), BUKAN id supervisor 's-resume-exited-ok'.
    expect(spawnCalls[0]?.args).toEqual(['--resume', '11111111-1111-1111-1111-111111111111']);

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

  it('resume: full cycle exited→spawn→continue drives inject on the NEW alive session (C-1/RC-1)', async () => {
    // Test kontrak ujung-ke-ujung (audit §6: "siapa yang bergerak berikutnya?"): sesi mati di-resume →
    // sesi baru alive → job continue-nya fire → requestInject dipanggil terhadap sesi BARU.
    tempDir = join(tmpdir(), `acca-dispatch-test-${randomBytes(4).toString('hex')}`);
    process.env.ACCA_DATA_DIR = tempDir;
    db = openDb();
    socketPath = uniqueSocketPath();

    const sessions = createSessionsRepo(db);
    sessions.createSession({
      id: 's-old',
      tool: 'claude',
      cwd: process.cwd(),
      status: 'LIMIT_HIT',
      proc_state: 'exited',
      cli_session_id: '22222222-2222-2222-2222-222222222222',
      pid: process.pid,
    });
    const jobs = createScheduledJobsRepo(db);
    jobs.enqueue({ session_id: 's-old', run_at: 1_000, kind: 'resume' });

    // spawnResume meniru runSession: buat baris sesi BARU (RUNNING+alive) supaya continue job punya
    // target hidup yang bisa di-inject lewat jalur alive yang ada.
    const spawnResume: SupervisorDeps['spawnResume'] = (_spec, session) => {
      sessions.createSession({
        id: 's-new',
        tool: session.tool,
        cwd: session.cwd,
        status: 'RUNNING',
        proc_state: 'alive',
        pid: process.pid,
        resumed_from: session.id,
      });
      return { sessionId: 's-new' };
    };

    const injected: InjectRequestResult = { reachable: true, injected: true, reason: null };
    const requestInject = vi.fn<(session: Session) => Promise<InjectRequestResult>>(() => Promise.resolve(injected));

    const manual = createManualTimer();
    const nowRef = { value: 0 };
    const supervisor = createSupervisor({
      db,
      socketPath,
      now: () => nowRef.value,
      setTimer: manual.setTimer,
      clearTimer: manual.clearTimer,
      spawnResume,
      requestInject,
      notify: () => {},
    });

    await supervisor.start();
    nowRef.value = 1_000;
    await manual.fire(); // dispatch resume-by-id s-old → spawn s-new + enqueue continue job utk s-new.

    // Sesi lama RESUMED; sesi BARU punya SATU job `resume` terjadwal (bukti RC-1 meng-enqueue continue).
    expect(createSessionsRepo(db).getById('s-old')?.status).toBe('RESUMED');
    const newJobs = pendingJobs(db, 's-new');
    expect(newJobs).toHaveLength(1);
    expect(newJobs[0]?.kind).toBe('resume');

    // Continue job (run_at = now + delay) belum jatuh tempo saat fire pertama; majukan jam jauh ke depan
    // lalu fire → job continue kini `due` → dispatch jalur alive s-new → requestInject.
    expect(requestInject).not.toHaveBeenCalled();
    nowRef.value = 10_000_000;
    await manual.fire();
    await supervisor.stop();

    expect(requestInject).toHaveBeenCalledTimes(1);
    // Inject ditujukan ke sesi BARU (s-new), bukan sesi lama.
    expect(requestInject.mock.calls[0]?.[0]?.id).toBe('s-new');
    // Continue job dibuang (done) setelah inject — tak ada retry-spin.
    expect(pendingJobs(db, 's-new')).toHaveLength(0);
  });

  it('resume: continue-target (resumed_from set) that EXITED before continue → BLOCKED, NO re-spawn (F-1 loop sever)', async () => {
    // F-1 (review independen RC-1, 16 Jul): continue-job (kind:'resume') dijadwalkan utk sesi HASIL-resume.
    // Bila sesi itu EXIT sebelum job fire (paling mudah CC: hook SessionStart mengisi cli_session_id di
    // startup lalu proses mati cepat), job mendarat di cabang exited. TANPA guard: resume-by-id spawn sesi
    // BARU → RC-1 enqueue continue lagi → loop ~tiap 15s tak terbatas. Guard Opsi B: resumed_from != null
    // && detected_at == null → BLOCKED, TAK re-spawn.
    tempDir = join(tmpdir(), `acca-dispatch-test-${randomBytes(4).toString('hex')}`);
    process.env.ACCA_DATA_DIR = tempDir;
    db = openDb();
    socketPath = uniqueSocketPath();

    const sessions = createSessionsRepo(db);
    // Sesi ASAL (parent rantai resume) — wajib ada dulu: `sessions.resumed_from` = FK self-reference.
    sessions.createSession({
      id: 's-old',
      tool: 'claude',
      cwd: process.cwd(),
      status: 'RESUMED',
      proc_state: 'exited',
      pid: process.pid,
    });
    // Continue-target: hasil resume (resumed_from='s-old'), EXITED, cli_session_id ADA + cwd ADA (kedua
    // guard lain LOLOS) tapi BELUM pernah kena limit (detected_at null = ciri crash-sebelum-kerja).
    sessions.createSession({
      id: 's-continue-crashed',
      tool: 'claude',
      cwd: process.cwd(),
      status: 'LIMIT_HIT',
      proc_state: 'exited',
      cli_session_id: 'cc-uuid-continue',
      pid: process.pid,
      resumed_from: 's-old',
    });
    const jobs = createScheduledJobsRepo(db);
    jobs.enqueue({ session_id: 's-continue-crashed', run_at: 1_000, kind: 'resume' });

    // Bila guard gagal, resume-by-id akan memanggil spawnResume → itu bukti loop terbuka.
    const spawnResume = vi.fn(() => ({ sessionId: 'should-not-spawn' }));

    const manual = createManualTimer();
    const nowRef = { value: 0 };
    const supervisor = createSupervisor({
      db,
      socketPath,
      now: () => nowRef.value,
      setTimer: manual.setTimer,
      clearTimer: manual.clearTimer,
      spawnResume,
      notify: () => {},
    });
    await supervisor.start();
    nowRef.value = 1_000;
    await manual.fire();
    await supervisor.stop();

    // Guard memutus loop: TAK spawn sesi baru.
    expect(spawnResume).not.toHaveBeenCalled();
    // Ditandai BLOCKED (surface manual), bukan RESUMED.
    expect(createSessionsRepo(db).getById('s-continue-crashed')?.status).toBe('BLOCKED');
    // Job asli dibuang (done); tak ada job baru → loop tak berlanjut.
    expect(pendingJobs(db, 's-continue-crashed')).toHaveLength(0);
    const events = eventsFor(db, 's-continue-crashed');
    const err = events.find((e) => e.type === 'job_dispatch_error');
    expect((err?.payload as { action: string }).action).toBe('continue_target_exited');
  });

  it('resume: RC-1 continue-enqueue FK failure is best-effort → dispatch stays done, old session RESUMED, no retry (F-2/G-39)', async () => {
    // F-2 (review independen): properti anti-loop inti RC-1 — "enqueue continue GAGAL jangan flip dispatch
    // ke retry" (G-39, alasan seluruh try/catch ada) — sebelumnya tak punya test. Stub spawnResume balikan
    // sessionId TANPA membuat baris → FK (scheduled_jobs.session_id→sessions.id, foreign_keys=ON) throw →
    // assert dispatch tetap 'done' + markResumed tetap + event resume_continue_enqueue_failed, TAK re-spawn.
    tempDir = join(tmpdir(), `acca-dispatch-test-${randomBytes(4).toString('hex')}`);
    process.env.ACCA_DATA_DIR = tempDir;
    db = openDb();
    socketPath = uniqueSocketPath();

    const sessions = createSessionsRepo(db);
    // Sesi asal biasa (resumed_from=null → guard F-1 tak fire) yang exited + siap resume-by-id.
    sessions.createSession({
      id: 's-old-fk',
      tool: 'claude',
      cwd: process.cwd(),
      status: 'LIMIT_HIT',
      proc_state: 'exited',
      cli_session_id: '33333333-3333-3333-3333-333333333333',
      pid: process.pid,
    });
    const jobs = createScheduledJobsRepo(db);
    jobs.enqueue({ session_id: 's-old-fk', run_at: 1_000, kind: 'resume' });

    // Spawn "sukses" tapi TIDAK membuat baris sesi → enqueue continue-job kena FK.
    const spawnResume = vi.fn(() => ({ sessionId: 's-new-ghost' }));

    const manual = createManualTimer();
    const nowRef = { value: 0 };
    const supervisor = createSupervisor({
      db,
      socketPath,
      now: () => nowRef.value,
      setTimer: manual.setTimer,
      clearTimer: manual.clearTimer,
      spawnResume,
      notify: () => {},
    });
    await supervisor.start();
    nowRef.value = 1_000;
    await manual.fire();
    await supervisor.stop();

    // Spawn tetap terpanggil (resume-by-id sukses).
    expect(spawnResume).toHaveBeenCalledTimes(1);
    // Sesi lama RESUMED (markResumed jalan SEBELUM enqueue yang gagal).
    expect(createSessionsRepo(db).getById('s-old-fk')?.status).toBe('RESUMED');
    // Job asli dibuang (done) — TIDAK di-retry (kegagalan enqueue tak boleh flip ke 'retry' = loop re-spawn).
    expect(pendingJobs(db, 's-old-fk')).toHaveLength(0);
    // Kegagalan FK ter-audit eksplisit.
    const events = eventsFor(db, 's-old-fk');
    const failed = events.find(
      (e) => e.type === 'job_dispatch_error' && (e.payload as { action?: string }).action === 'resume_continue_enqueue_failed',
    );
    expect(failed).toBeDefined();
    expect((failed?.payload as { newSessionId: string }).newSessionId).toBe('s-new-ghost');
  });

  it('resume: proc_state exited + cwd exists but cli_session_id NULL → BLOCKED, NO spawn, old session NOT resumed (A-1)', async () => {
    // Regresi A-1 (audit 11 Jul): tanpa cli_session_id, resume-by-id dulu men-spawn dgn id supervisor
    // 4-char yang PASTI ditolak CLI nyata (+ keliru markResumed). Sekarang: BLOCKED + surface, tak spawn.
    const spawnResume = vi.fn(() => ({ sessionId: 'should-not-happen' }));
    // cwd ADA (process.cwd) → guard cwd_missing lolos; yang memblokir = cli_session_id absen.
    const { db: database } = await setupAndFire({ sessionId: 's-resume-no-cliid', procState: 'exited', cwd: process.cwd(), jobKind: 'resume', spawnResume });

    expect(spawnResume).not.toHaveBeenCalled(); // JANGAN spawn id yang dijamin salah.

    const session = createSessionsRepo(database).getById('s-resume-no-cliid');
    // I-28/A-14: kini ditulis BLOCKED (butuh manual: id CLI belum tertangkap) — bukan tetap LIMIT_HIT
    // maupun keliru RESUMED. `acca status` menampilkannya sebagai sesi butuh-aksi.
    expect(session?.status).toBe('BLOCKED');

    const remaining = pendingJobs(database, 's-resume-no-cliid');
    expect(remaining).toHaveLength(0); // 'done' terminal (surface manual), bukan retry-spin.

    const events = eventsFor(database, 's-resume-no-cliid');
    const blocked = events.find((e) => e.type === 'job_dispatch_error');
    const payload = blocked?.payload as { action: string; reason: string; status: string };
    expect(payload.action).toBe('blocked');
    expect(payload.reason).toBe('cli_session_id_missing');
    expect(payload.status).toBe('BLOCKED');
  });

  it('resume: proc_state exited + cli_session_id present but NON-UUID → BLOCKED, NO spawn (F-3 defense-in-depth)', async () => {
    // F-3 (review independen, defense-in-depth): validasi UUID di TITIK-PAKAI. Penulis produksi selalu
    // UUID-kanonik (agy matchAgyResumeId; CC hook di-gate RC-2), tapi bila suatu jalur tulis masa depan
    // lolos nilai non-UUID (mis. named pipe Win ber-ACL terbuka, I-26), nilai itu TAK boleh mengalir ke
    // argv `claude --resume <id>`. cwd ADA + cli_session_id ADA (bukan null) → dua guard sebelumnya lolos;
    // yang memblokir = bentuk non-UUID.
    const spawnResume = vi.fn(() => ({ sessionId: 'should-not-happen' }));
    const { db: database } = await setupAndFire({ sessionId: 's-resume-badid', procState: 'exited', cwd: process.cwd(), jobKind: 'resume', cliSessionId: 'not-a-uuid; rm -rf', spawnResume });

    expect(spawnResume).not.toHaveBeenCalled(); // JANGAN spawn CLI dengan argumen sembarang.

    const session = createSessionsRepo(database).getById('s-resume-badid');
    expect(session?.status).toBe('BLOCKED');

    const remaining = pendingJobs(database, 's-resume-badid');
    expect(remaining).toHaveLength(0); // 'done' terminal (surface manual), bukan retry-spin.

    const events = eventsFor(database, 's-resume-badid');
    const blocked = events.find((e) => e.type === 'job_dispatch_error');
    const payload = blocked?.payload as { action: string; reason: string; status: string };
    expect(payload.action).toBe('blocked');
    expect(payload.reason).toBe('cli_session_id_malformed');
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
    const { db: database } = await setupAndFire({ sessionId: 's-resume-spawn-fail', procState: 'exited', cwd: process.cwd(), jobKind: 'resume', cliSessionId: '44444444-4444-4444-4444-444444444444' });

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

    // I-28/A-14: status sesi kini benar-benar ditulis BLOCKED (bukan hanya event) → `acca status` tampil.
    const session = createSessionsRepo(database).getById('s-resume-exited-blocked');
    expect(session?.status).toBe('BLOCKED');
  });

  // ── B-1 (audit followup 12 Jul): cabang retry terminal-cap ──────────────────────────────────────

  it('probe: adapter tanpa probeUsage (statis) → BLOCKED + probe_unsupported + done, no retry (B-1)', async () => {
    // Kondisi STATIS (kemampuan adapter tak berubah runtime) → retry tak akan pernah sembuh → terminal
    // langsung, bukan retry selamanya. `probeUsage` di-null-kan (afterEach me-restore).
    adapters.claude.probeUsage = undefined;

    const { db: database } = await setupAndFire({ sessionId: 's-probe-nocap', procState: 'alive', cwd: process.cwd(), jobKind: 'probe' });

    expect(pendingJobs(database, 's-probe-nocap')).toHaveLength(0); // done → job dibuang, tak retry.
    expect(createSessionsRepo(database).getById('s-probe-nocap')?.status).toBe('BLOCKED');

    const err = eventsFor(database, 's-probe-nocap').find((e) => e.type === 'job_dispatch_error');
    const payload = err?.payload as { action: string; reason: string; status: string };
    expect(payload.action).toBe('probe_unsupported');
    expect(payload.reason).toBe('adapter_no_probe');
    expect(payload.status).toBe('BLOCKED');
  });

  it('probe: limits kosong PERSISTEN (attempts di batas) → BLOCKED + probe_unreadable + done (B-1)', async () => {
    // Empty limits transien = retry (diuji terpisah, attempts 0). Di batas attempts → berhenti: probe
    // dianggap tak terbaca permanen (mis. schema usage berubah upstream), surface daripada retry 60m selamanya.
    adapters.claude.probeUsage = vi.fn((): Promise<UsageSnapshot> => Promise.resolve({ tool: 'claude', limits: [], capturedAt: 0 }));

    const { db: database } = await setupAndFire({ sessionId: 's-probe-unreadable', procState: 'alive', cwd: process.cwd(), jobKind: 'probe', jobAttempts: 2 });

    expect(pendingJobs(database, 's-probe-unreadable')).toHaveLength(0); // done terminal, bukan retry.
    expect(createSessionsRepo(database).getById('s-probe-unreadable')?.status).toBe('BLOCKED');

    const err = eventsFor(database, 's-probe-unreadable').find((e) => e.type === 'job_dispatch_error');
    const payload = err?.payload as { action: string; reason: string; attempts: number; status: string };
    expect(payload.action).toBe('probe_unreadable');
    expect(payload.reason).toBe('limits_empty_persistent');
    expect(payload.attempts).toBe(3);
    expect(payload.status).toBe('BLOCKED');
  });

  it('resume: adapter tanpa resumeCmd (statis) → BLOCKED + resume_unsupported + done, no retry (B-1)', async () => {
    adapters.claude.resumeCmd = undefined;

    const { db: database } = await setupAndFire({ sessionId: 's-resume-nocmd', procState: 'exited', cwd: process.cwd(), jobKind: 'resume', cliSessionId: '55555555-5555-5555-5555-555555555555' });

    expect(pendingJobs(database, 's-resume-nocmd')).toHaveLength(0);
    expect(createSessionsRepo(database).getById('s-resume-nocmd')?.status).toBe('BLOCKED');

    const err = eventsFor(database, 's-resume-nocmd').find((e) => e.type === 'job_dispatch_error');
    const payload = err?.payload as { action: string; reason: string; status: string };
    expect(payload.action).toBe('resume_unsupported');
    expect(payload.reason).toBe('adapter_no_resumecmd');
    expect(payload.status).toBe('BLOCKED');
  });

  it('resume: spawn gagal BERULANG di batas attempts → BLOCKED + resume_gave_up, baris lempar diarsipkan (B-1)', async () => {
    // Jalankan DEFAULT spawnResume (runSession in-process) dgn binary hilang → spawn gagal sinkron.
    // Di batas attempts: JANGAN retry selamanya (PROJECT §4) → sesi lama BLOCKED + surface manual;
    // dan baris FAILED lempar yang dibuat runSession diARSIPKAN (tak menumpuk di `acca status`).
    adapters.claude.resumeCmd = vi.fn(() => ({ file: 'acca-nonexistent-binary-zzz', args: ['--resume', 'x'] }));

    const { db: database } = await setupAndFire({ sessionId: 's-resume-giveup', procState: 'exited', cwd: process.cwd(), jobKind: 'resume', cliSessionId: '44444444-4444-4444-4444-444444444444', jobAttempts: 2 });

    // Terminal: job dibuang (done), sesi lama BLOCKED.
    expect(pendingJobs(database, 's-resume-giveup')).toHaveLength(0);
    const sessionsRepo = createSessionsRepo(database);
    expect(sessionsRepo.getById('s-resume-giveup')?.status).toBe('BLOCKED');

    const err = eventsFor(database, 's-resume-giveup').find(
      (e) => e.type === 'job_dispatch_error' && (e.payload as { action?: string }).action === 'resume_gave_up',
    );
    expect(err).toBeDefined();
    const payload = err?.payload as { attempts: number; status: string };
    expect(payload.attempts).toBe(3);
    expect(payload.status).toBe('BLOCKED');

    // Baris sesi LEMPAR (hasil runSession gagal, resumed_from = sesi lama) tak boleh muncul di listActive
    // (archived_at ter-set) → `acca status` tak dibanjiri percobaan gagal.
    const active = sessionsRepo.listActive();
    expect(active.some((s) => s.resumed_from === 's-resume-giveup')).toBe(false);
    // Sesi lama BLOCKED sendiri tetap aktif (butuh perhatian user).
    expect(active.some((s) => s.id === 's-resume-giveup')).toBe(true);
  });

  const DEAD_PID = 2_147_483_646; // pid yg (hampir) pasti tak ada → isProcessAlive → false (ESRCH)

  it('C-4: probe agy proc_state alive tapi PID MATI (mati SETELAH start) → reconcile ke exited → optimistic resume (bukan retry-senyap)', async () => {
    // reconcileOrphans hanya jalan di start(); wrapper agy yang mati keras SETELAH itu tinggalkan
    // proc_state='alive' basi → dulu probeAgyUsage(pid mati) throw → catch generik retry 60m senyap.
    // Kini reconcile DISPATCH tandai exited → cabang optimistic_resume_agy_exited (ADR-019). beforeFire
    // set pid mati SETELAH start (start pakai process.pid → reconcileOrphans start tak menyentuhnya).
    const { db: database } = await setupAndFire({
      sessionId: 's-orphan-agy',
      procState: 'alive',
      cwd: process.cwd(),
      jobKind: 'probe',
      tool: 'antigravity',
      beforeFire: (db2) => db2.prepare('UPDATE sessions SET pid = @p WHERE id = @id').run({ p: DEAD_PID, id: 's-orphan-agy' }),
    });

    // Reconcile menulis proc_state exited (status LIMIT_HIT dipertahankan).
    const sess = createSessionsRepo(database).getById('s-orphan-agy');
    expect(sess?.proc_state).toBe('exited');
    const events = eventsFor(database, 's-orphan-agy');
    expect(events.some((e) => e.type === 'job_dispatch_reconcile' && (e.payload as { action?: string }).action === 'orphan_reconciled_at_dispatch')).toBe(true);
    // Cabang exited agy → enqueue resume (optimistic), BUKAN retry-spin.
    const done = events.find((e) => e.type === 'job_dispatch_done');
    expect((done?.payload as { action?: string }).action).toBe('optimistic_resume_agy_exited');
    const remaining = pendingJobs(database, 's-orphan-agy');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.kind).toBe('resume');
  });

  it('C-4: resume CC proc_state alive tapi PID MATI → reconcile ke exited → resume-by-id (bukan inject ke wrapper mati)', async () => {
    // CC: dulu proc alive basi → jalur inject → requestInject wrapper unreachable → buntu manual, padahal
    // auto-recovery mungkin (pid mati + cli_session_id ada → resume-by-id). Kini reconcile → resume-by-id.
    const spawnResume = vi.fn(() => ({ sessionId: 's-orphan-cc-new' }));
    // requestInject TAK boleh dipanggil (bukti jalur BUKAN inject-alive) — beri stub yg gagal test bila dipakai.
    const requestInject = vi.fn(() => Promise.resolve({ reachable: false, injected: false, reason: 'should_not_inject' }));

    const { db: database } = await setupAndFire({
      sessionId: 's-orphan-cc',
      procState: 'alive',
      cwd: process.cwd(),
      jobKind: 'resume',
      tool: 'claude',
      cliSessionId: '66666666-6666-6666-6666-666666666666',
      requestInject,
      spawnResume,
      beforeFire: (db2) => db2.prepare('UPDATE sessions SET pid = @p WHERE id = @id').run({ p: DEAD_PID, id: 's-orphan-cc' }),
    });

    expect(requestInject).not.toHaveBeenCalled(); // BUKAN jalur inject-alive
    expect(spawnResume).toHaveBeenCalledTimes(1); // resume-by-id
    expect(createSessionsRepo(database).getById('s-orphan-cc')?.status).toBe('RESUMED');
    const events = eventsFor(database, 's-orphan-cc');
    expect(events.some((e) => e.type === 'job_dispatch_reconcile')).toBe(true);
    expect(events.some((e) => e.type === 'job_dispatch_done' && (e.payload as { action?: string }).action === 'resume_spawned')).toBe(true);
  });

  it('RC-4: error dispatch tak-terduga di BATAS attempts → BLOCKED + dispatch_gave_up + done (bukan retry selamanya)', async () => {
    // probeUsage throw (mis. discoverLocalPorts pd pid basi yg lolos reconcile, atau glitch). pid ALIVE
    // (process.pid) → reconcile skip → probe → throw → catch generik. jobAttempts=2 → +1=3=MAX → BLOCKED.
    adapters.claude.probeUsage = vi.fn((): Promise<UsageSnapshot> => Promise.reject(new Error('discoverLocalPorts: boom')));

    const { db: database } = await setupAndFire({ sessionId: 's-catch-cap', procState: 'alive', cwd: process.cwd(), jobKind: 'probe', jobAttempts: 2 });

    expect(pendingJobs(database, 's-catch-cap')).toHaveLength(0); // done, bukan retry
    expect(createSessionsRepo(database).getById('s-catch-cap')?.status).toBe('BLOCKED');
    const err = eventsFor(database, 's-catch-cap').find(
      (e) => e.type === 'job_dispatch_error' && (e.payload as { action?: string }).action === 'dispatch_gave_up',
    );
    expect(err).toBeDefined();
    expect((err?.payload as { status: string }).status).toBe('BLOCKED');
    expect((err?.payload as { attempts: number }).attempts).toBe(3);
  });

  it('RC-4: error dispatch tak-terduga DI BAWAH batas attempts → retry (transien, tak langsung menyerah)', async () => {
    adapters.claude.probeUsage = vi.fn((): Promise<UsageSnapshot> => Promise.reject(new Error('transient glitch')));

    const { db: database } = await setupAndFire({ sessionId: 's-catch-retry', procState: 'alive', cwd: process.cwd(), jobKind: 'probe', jobAttempts: 0 });

    const remaining = pendingJobs(database, 's-catch-retry');
    expect(remaining).toHaveLength(1); // retry (job dipertahankan)
    expect(remaining[0]?.attempts).toBe(1);
    expect(createSessionsRepo(database).getById('s-catch-retry')?.status).not.toBe('BLOCKED');
  });
});
