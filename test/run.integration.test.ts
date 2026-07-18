import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, openDb, type DatabaseInstance } from '../src/store/db.js';
import { createEventsRepo } from '../src/store/repositories/events.js';
import { createScheduledJobsRepo } from '../src/store/repositories/scheduled-jobs.js';
import { createSessionsRepo } from '../src/store/repositories/sessions.js';
import { createMetaRepo } from '../src/store/repositories/meta.js';
import { runSession } from '../src/daemon/process-wrapper.js';
import { adapters } from '../src/adapters/index.js';
import { requestInject } from '../src/daemon/inject-continue.js';
import { sessionControlSocketPath, sessionHookSettingsPath } from '../src/shared/paths.js';

const tempDir = join(tmpdir(), `acca-run-test-${randomBytes(4).toString('hex')}`);
process.env.ACCA_DATA_DIR = tempDir;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timeout');
    await delay(25);
  }
}

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
      // tool 'antigravity' = tanpa supervisorHooks → args spawn tak disisipi `--settings` (yang
      // membuat node stand-in menolak); test lifecycle ini tool-agnostik. Jalur hook CC diuji
      // terpisah di 'writes an isolated hook settings file for claude…' di bawah.
      const { sessionId, waitForExit } = runSession(
        {
          file: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd: process.cwd(),
          tool: 'antigravity',
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

  it('I-23: writes an isolated hook settings file for claude and removes it on exit', async () => {
    const sessions = createSessionsRepo(db);
    const events = createEventsRepo(db);
    const jobs = createScheduledJobsRepo(db);

    // tool 'claude' → wrapper menulis settings hook + menyisipkan `--settings <path>`. node stand-in
    // menolak flag itu (exit≠0) — TAK relevan; yang diuji = lifecycle FILE settings (ditulis→dihapus).
    const { sessionId, waitForExit } = runSession(
      { file: process.execPath, args: ['-e', 'process.exit(0)'], cwd: process.cwd(), tool: 'claude' },
      { sessions, events, jobs },
    );

    // Ditulis SINKRON sebelum spawn: hook StopFailure + SessionStart menunjuk `acca __hook <id>`.
    const settingsPath = sessionHookSettingsPath(sessionId);
    expect(existsSync(settingsPath)).toBe(true);
    const content = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks: { StopFailure: { hooks: { args: string[] }[] }[]; SessionStart: unknown[] };
    };
    expect(content.hooks.SessionStart).toBeDefined();
    expect(content.hooks.StopFailure[0]?.hooks[0]?.args).toEqual([process.argv[1] ?? '', '__hook', sessionId]);

    await waitForExit;
    expect(existsSync(settingsPath)).toBe(false); // dibersihkan saat exit (best-effort unlink)
  }, 10_000);

  it(
    'I-31: repaint banner limit lama CC pasca-inject via PTY nyata → limit_suppressed, BUKAN LIMIT_HIT kedua',
    async () => {
      // Live-verify TANPA limit nyata: replay byte banner limit CC (kelas yang classify() kenali, korpus +
      // live 16 Jul) lewat PTY nyata + wrapper PRODUKSI + control socket nyata. Child "CC palsu": cetak
      // banner (→ LIMIT_HIT#1), lalu saat menerima keystroke continue (inject NYATA → onInjected → unlatch)
      // me-REPAINT banner → harus DISUPPRESS grace-window OUTPUT-CC (I-31), bukan LIMIT_HIT#2. Menutup gap
      // wiring yang di-stub unit test: nowMs → watcher · onData → feedOutput · control-socket inject → unlatch.
      const sessions = createSessionsRepo(db);
      const events = createEventsRepo(db);
      const jobs = createScheduledJobsRepo(db);

      // tool 'claude' WAJIB (grace CC-only). Tapi supervisorHooks CC menyisipkan `--settings` yang ditolak
      // node stand-in → nonaktifkan utk test ini (jalur hook = OUTPUT-independent, diuji terpisah via
      // feedSignal). Yang diuji = jalur OUTPUT-scrape repaint. Restore di finally.
      // supervisorHooks murni (tak menyentuh `this`) — aman disimpan lepas untuk restore; unbound-method
      // di sini false positive (sama pola stub adapter di supervisor-dispatch.test.ts).
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const originalHooks = adapters.claude.supervisorHooks;
      adapters.claude.supervisorHooks = undefined;

      // Banner limit CC (ANSI-wrapped, \r\n). `\\x1b`/`\\r\\n` di sini = teks literal yang, saat disisipkan
      // ke `node -e`, dievaluasi jadi byte ESC + CRLF nyata di PTY.
      const banner = "\\x1b[31mYou've hit your session limit\\x1b[0m\\r\\n";
      const script =
        `const b = "${banner}";` +
        `process.stdout.write(b);` + // banner#1 → LIMIT_HIT#1
        `let done=false;process.stdin.resume();` +
        // repaint HANYA sbg reaksi keystroke continue (inject) → jamin urutan inject→unlatch→banner#2.
        `process.stdin.on('data',()=>{if(done)return;done=true;process.stdout.write(b);setTimeout(()=>process.exit(0),500);});` +
        `setTimeout(()=>process.exit(0),8000);`; // safety: exit walau tak ada inject

      try {
        const { sessionId, waitForExit } = runSession(
          { file: process.execPath, args: ['-e', script], cwd: process.cwd(), tool: 'claude' },
          { sessions, events, jobs },
        );

        // Banner#1 diproses → LIMIT_HIT#1 (latch).
        await waitFor(() => sessions.getById(sessionId)?.status === 'LIMIT_HIT', 6000);

        // Inject continue via CONTROL SOCKET nyata (idle=true: tak ada 'esc to interrupt'; foreground ok).
        // onInjected → markRunningAfterInject (LIMIT_HIT→RUNNING) + watcher.unlatch() → arm grace-window.
        const controlPath = sessionControlSocketPath(sessionId);
        let injected = false;
        for (let i = 0; i < 15 && !injected; i++) {
          const r = await requestInject(controlPath);
          injected = r.injected;
          if (!injected) await delay(100);
        }
        expect(injected).toBe(true);

        // Child terima keystroke → repaint banner#2 (dalam grace) → disuppress. Tunggu event muncul.
        await waitFor(
          () => events.listBySession(sessionId, 100).some((e) => e.type === 'limit_suppressed'),
          6000,
        );
        await waitForExit;

        const evs = events
          .listBySession(sessionId, 200)
          .map((e) => ({ type: e.type, payload: JSON.parse(e.payload) as Record<string, unknown> }));
        const limitHits = evs.filter((e) => e.type === 'status_change' && e.payload.to === 'LIMIT_HIT');
        const suppressed = evs.filter((e) => e.type === 'limit_suppressed');

        // Inti I-31: banner#1 = SATU LIMIT_HIT; repaint#2 DISUPPRESS (bukan LIMIT_HIT kedua). Tanpa grace:
        // limitHits==2 & suppressed==0 (regresi tertangkap di sini).
        expect(limitHits).toHaveLength(1);
        expect(suppressed).toHaveLength(1);
        expect(suppressed[0]?.payload.reason).toBe('post_unlatch_output_grace');
      } finally {
        adapters.claude.supervisorHooks = originalHooks;
      }
    },
    15_000,
  );

  it(
    'I-35: sinyal limit OUTPUT-CC dibantah snapshot segar → limit_suppressed + job `verify` ter-enqueue (WIRING nyata)',
    async () => {
      // Menutup gap wiring yang unit test dispatch tak sentuh: onUsageContradiction (limit-watcher) →
      // enqueue verify (process-wrapper) via PTY nyata + store nyata. Snapshot usage SEGAR (< 5 mnt) yang
      // membantah (maxBinding 0.55 < ambang 0.85) → banner limit OUTPUT DISUPPRESS (bukan latch) DAN job
      // `verify` benar-benar ditulis ke scheduled_jobs (jaring FN aktif I-35), bukan cuma event.
      const sessions = createSessionsRepo(db);
      const events = createEventsRepo(db);
      const jobs = createScheduledJobsRepo(db);
      const meta = createMetaRepo(db);

      meta.set(
        'usage_snapshot_claude',
        JSON.stringify({
          tool: 'claude',
          capturedAt: Date.now(),
          limits: [{ kind: 'session', usedFraction: 0.55, resetAt: null, isActive: true }],
        }),
      );

      // supervisorHooks CC menyisipkan `--settings` yg ditolak node stand-in → nonaktifkan (jalur OUTPUT).
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const originalHooks = adapters.claude.supervisorHooks;
      adapters.claude.supervisorHooks = undefined;

      // DUA baris banner (simulasi prosa multi-literal: mis. membaca file dengan >1 literal kanonik) →
      // dua sinyal suppress, tapi dedup → tetap SATU job verify per episode.
      const banner = "\\x1b[31mYou've hit your session limit\\x1b[0m\\r\\n";
      const script = `process.stdout.write("${banner}");process.stdout.write("${banner}");setTimeout(()=>process.exit(0),1500);`;

      try {
        const { sessionId, waitForExit } = runSession(
          { file: process.execPath, args: ['-e', script], cwd: process.cwd(), tool: 'claude' },
          { sessions, events, jobs, usageSnapshotJson: (tool) => meta.get(`usage_snapshot_${tool}`) },
        );

        await waitFor(() => events.listBySession(sessionId, 100).some((e) => e.type === 'verify_scheduled'), 6000);
        await waitForExit;

        const evs = events
          .listBySession(sessionId, 200)
          .map((e) => ({ type: e.type, payload: JSON.parse(e.payload) as Record<string, unknown> }));

        // Tak pernah latch (suppress benar) — nol status_change ke LIMIT_HIT.
        expect(evs.filter((e) => e.type === 'status_change' && e.payload.to === 'LIMIT_HIT')).toHaveLength(0);
        // Kedua baris banner ter-suppress (suppress per-baris).
        const suppressed = evs.filter((e) => e.type === 'limit_suppressed');
        expect(suppressed).toHaveLength(2);
        expect(suppressed[0]?.payload.reason).toBe('usage_contradicts');
        // WIRING inti: job verify BENAR-BENAR ditulis (bukan hanya event). Tanpa enqueue di
        // onUsageContradiction → filter ini kosong (negative control saat pengembangan).
        // DEDUP: dua suppress → tetap SATU verify job + satu event verify_scheduled.
        const verifyJobs = jobs.listPending().filter((j) => j.session_id === sessionId && j.kind === 'verify');
        expect(verifyJobs).toHaveLength(1);
        expect(evs.filter((e) => e.type === 'verify_scheduled')).toHaveLength(1);
      } finally {
        adapters.claude.supervisorHooks = originalHooks;
      }
    },
    15_000,
  );
});
