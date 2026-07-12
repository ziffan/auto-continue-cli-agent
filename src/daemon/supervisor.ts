// Supervisor daemon (ADR-002 monolith): koordinasi lifecycle — rekonsiliasi orphan saat start,
// heartbeat berkala, dan server IPC (ADR-015). Timer/sinyal OS hidup di entrypoint tipis
// (`cli/commands/daemon.ts`); modul ini logika inti yang testable tanpa proses nyata.

import { existsSync } from 'node:fs';
import { adapters } from '../adapters/index.js';
import type { SpawnSpec } from '../adapters/types.js';
import { runSession } from './process-wrapper.js';
import { isProcessAlive } from '../shared/proc.js';
import { sessionControlSocketPath } from '../shared/paths.js';
import type { Session } from '../shared/types.js';
import type { DatabaseInstance } from '../store/db.js';
import { createEventsRepo } from '../store/repositories/events.js';
import { createMetaRepo } from '../store/repositories/meta.js';
import { createScheduledJobsRepo } from '../store/repositories/scheduled-jobs.js';
import { createSessionsRepo } from '../store/repositories/sessions.js';
import { requestInject, type InjectRequestResult } from './inject-continue.js';
import { stderrDeliver, withNotifications, type NotificationDeliver } from '../notify/notifier.js';
import { createIpcServer } from './ipc-server.js';
import { reconcileOrphans } from './reconcile.js';
import { createScheduler, type JobDispatch, type JobResult, type TimerHandle } from './scheduler.js';
import { createUsageMonitor } from './usage-monitor.js';

/** Interval default probe usage periodik saat ada sesi RUNNING (I-17) — ~2 menit (owner Ziffan,
 *  11 Jul). Endpoint usage = metadata (tak memakan kuota model); injectable → gampang di-tune. */
const DEFAULT_USAGE_PROBE_INTERVAL_MS = 120_000;

/** B-1 (audit followup 12 Jul): batas percobaan untuk cabang retry yang bisa "gagal berulang" tapi
 *  MUNGKIN transien (spawn resume gagal → PATH transien; probe balas kosong → glitch upstream).
 *  Setelah sekian percobaan gagal → terminal (BLOCKED + surface manual), BUKAN retry backoff cap 60m
 *  SELAMANYA (PROJECT §4: "Resume gagal N kali → FAILED, stop auto-retry, minta intervensi manual";
 *  pola sama dengan A-4 loop-senyap yang audit awal nilai P1). Cabang berkondisi STATIS (kemampuan
 *  adapter) langsung terminal tanpa attempts. `still_limited` TIDAK dibatasi — limit memang akan reset. */
const MAX_DISPATCH_ATTEMPTS = 3;

/** I-6: setTimer produksi yang MEMBUNGKUS rejection. `setTimeout` mengabaikan Promise yang
 *  dikembalikan fn (scheduler mem-pass `runDue` async), jadi tanpa .catch sebuah rejection (mis.
 *  arm()/listPending() gagal karena DB closed) menjadi unhandledRejection yang bisa mematikan
 *  daemon. Bungkus baik rejection async MAUPUN throw sinkron → onError. */
export function createDaemonTimer(onError: (err: unknown) => void): (fn: () => void, ms: number) => TimerHandle {
  return (fn, ms) =>
    setTimeout(() => {
      try {
        void Promise.resolve(fn()).catch(onError);
      } catch (err) {
        onError(err);
      }
    }, ms);
}

export interface SupervisorDeps {
  db: DatabaseInstance;
  socketPath: string;
  now: () => number;
  dispatch?: JobDispatch;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (h: TimerHandle) => void;
  /** Minta wrapper pemilik PTY sesi meng-inject continue (I-12 poin 1). Default = connect ke socket
   *  kontrol per-sesi (`sessionControlSocketPath`) via IPC. Di-inject di test → tanpa socket nyata. */
  requestInject?: (session: Session) => Promise<InjectRequestResult>;
  /** Spawn wrapper PTY baru untuk resume-by-id sesi yang `exited` (I-12 poin 2). Default = `runSession`
   *  in-process (spawn CLI target di `spec.cwd`, catat sesi baru, host socket kontrol → re-injectable).
   *  Di-inject di test → tak spawn proses nyata. */
  spawnResume?: (spec: SpawnSpec, session: Session) => ResumeSpawnResult;
  /** M4: sink notifikasi transisi daemon (RESUMED/BLOCKED/…). Default = stderr (journal service).
   *  Di-inject di test (no-op/capture) supaya assertion event tak tercemar noise stderr. */
  notify?: NotificationDeliver;
  /** I-17: aktifkan loop probe usage periodik (proximity I-8 + cache snapshot utk `acca status`).
   *  Default **false** — `acca daemon` (produksi) menyetel `true`; test lama tak menyalakannya supaya
   *  tak menambah timer ke-arm yang mengacaukan assertion timer scheduler mereka. */
  startUsageMonitor?: boolean;
  /** I-17: interval probe usage saat RUNNING. Default `DEFAULT_USAGE_PROBE_INTERVAL_MS` (~2 mnt). */
  usageProbeIntervalMs?: number;
}

/** Hasil spawn resume-by-id. `sessionId` = id sesi wrapper BARU yang melanjutkan percakapan lama.
 *  `spawnFailed` = spawn gagal (binary hilang dll) → dispatch TAK menandai sesi lama RESUMED (A-2). */
export interface ResumeSpawnResult {
  sessionId?: string;
  spawnFailed?: boolean;
}

/** Dilempar saat socket/pipe daemon sudah dipakai (instance daemon lain sudah berjalan). */
export class DaemonAlreadyRunningError extends Error {
  constructor(public readonly socketPath: string) {
    super(`Daemon lain sudah berjalan (socket "${socketPath}" sudah dipakai).`);
    this.name = 'DaemonAlreadyRunningError';
  }
}

export interface Supervisor {
  start(): Promise<void>;
  stop(): Promise<void>;
  heartbeat(): void;
}

/** Bangun supervisor dari `deps`. Repo dibuat sekali dari `deps.db` dan dipakai untuk handler IPC. */
export function createSupervisor(deps: SupervisorDeps): Supervisor {
  const sessions = createSessionsRepo(deps.db);
  // M4: transisi daemon (RESUMED via inject/resume-by-id, BLOCKED) ter-surface lewat dekorator ini.
  // Sesi hasil resume-by-id (spawnResumeFn di bawah) memakai `events` yang SAMA → transisinya ikut.
  const events = withNotifications(createEventsRepo(deps.db), deps.notify);
  const meta = createMetaRepo(deps.db);
  const jobs = createScheduledJobsRepo(deps.db);

  const daemonError = (err: unknown, where: string, extra?: Record<string, unknown>): void =>
    events.append({
      session_id: null,
      type: 'daemon_error',
      payload: { where, error: err instanceof Error ? err.message : String(err), ...extra },
    });

  // Sisi-daemon dari kanal inject-continue (I-12 poin 1). Default = connect ke socket kontrol
  // per-sesi yang di-host wrapper; test menyuntik pengganti tanpa socket nyata.
  const requestInjectFn = deps.requestInject ?? ((session: Session): Promise<InjectRequestResult> => requestInject(sessionControlSocketPath(session.id)));

  // Actuation resume-by-id (I-12 poin 2). Default = runSession in-process: spawn CLI target di cwd
  // asli (which/G-12), catat sesi wrapper BARU, host socket kontrol (re-injectable). Non-blocking —
  // `waitForExit` sengaja tak di-await. Test menyuntik pengganti supaya tak spawn proses nyata.
  const spawnResumeFn: (spec: SpawnSpec, session: Session) => ResumeSpawnResult =
    deps.spawnResume ??
    ((spec, session) => {
      const { sessionId: newId, waitForExit } = runSession(
        // resumedFrom = id sesi ASAL → baris sesi baru menautkan rantai resume (I-14).
        { file: spec.file, args: spec.args, cwd: spec.cwd ?? session.cwd, tool: session.tool, resumedFrom: session.id },
        { sessions, events, jobs },
      );
      // A-2 (audit 11 Jul): saat spawn GAGAL sinkron (mis. binary CLI hilang — skenario nyata daemon
      // service dgn PATH minimal), `runSession` mengembalikan `waitForExit` yang REJECT. Bila promise
      // ini di-drop, ia menjadi unhandledRejection → Node ≥15 mematikan DAEMON. Konsumsi di sini —
      // kegagalan sudah tercatat oleh runSession (markFailed + status_change FAILED pada sesi baru).
      void waitForExit.catch(() => undefined);
      // runSession memanggil `markFailed` SEBELUM return pada jalur gagal-sinkron → deteksi via status
      // sesi baru supaya dispatch TAK keliru menandai sesi lama RESUMED (A-2, defect kedua).
      const spawnFailed = sessions.getById(newId)?.status === 'FAILED';
      return { sessionId: newId, spawnFailed };
    });

  // Dispatch nyata (M3d.5 probe + M3d.6 resume-by-id + M3d.7 inject-continue gating). Setiap
  // cabang menulis event audit (pola sudah ada di reconcile.ts/limit-watcher.ts); error tak
  // terduga dibungkus try/catch → event + 'retry' (job dipertahankan, dijadwal ulang via backoff).
  const realDispatch: JobDispatch = async (job): Promise<JobResult> => {
    try {
      if (job.kind === 'probe') {
        const session = sessions.getById(job.session_id);
        if (!session) {
          events.append({
            session_id: job.session_id,
            type: 'job_dispatch_done',
            payload: { jobId: job.id, action: 'skipped:session_not_found' },
          });
          return 'done';
        }

        // ADR-019 (men-supersede ADR-018): probe usage agy butuh sesi HIDUP ber-PTY — Language Server
        // hanya bind saat ber-PTY (G-3) & port-nya terikat PID sesi itu; sesi agy `exited` = PID mati =
        // tak ada port → probe-via-LS mustahil. Alternatif standalone OAuth (ADR-018 opsi #3,
        // `retrieveUserQuota`) LIVE-VERIFIED membaca pool kuota SALAH — request harian per-model gemini-cli,
        // BUKAN limit grup weekly+5h yang agy tegakkan (Summary via OAuth = 403) → tak bisa menggerbang
        // resume agy (GOTCHAS G-38). Karena itu: JANGAN probe, JANGAN BLOCKED — resume OPTIMISTIC. Job
        // `probe` ini dijadwalkan pada `reset_at` (kuota sangat mungkin sudah tersedia) → enqueue `resume`
        // langsung. Bila ternyata masih limit, sesi hasil-resume mem-bind LS-nya sendiri → output TUI
        // `Individual quota reached` (limit-watcher, G-19) → LIMIT_HIT baru → jadwal ulang di `reset_at`
        // berikut (dibatasi cap attempts B-1). Actuation JADI probe. CC tak kena: probe CC = HTTP standalone
        // ke api.anthropic.com yang membaca limit CC nyata tanpa sesi hidup → CC-exited tetap di-probe normal.
        if (session.tool === 'antigravity' && session.proc_state === 'exited') {
          jobs.enqueue({ session_id: job.session_id, run_at: deps.now(), kind: 'resume', next_backoff_ms: null });
          events.append({
            session_id: job.session_id,
            type: 'job_dispatch_done',
            payload: { jobId: job.id, action: 'optimistic_resume_agy_exited', reason: 'no_standalone_agy_quota_probe' },
          });
          return 'done';
        }

        const adapter = adapters[session.tool];
        if (!adapter?.probeUsage) {
          // B-1: kemampuan adapter STATIS (tak berubah runtime) → retry tak akan pernah sembuh. Terminal:
          // BLOCKED + surface (butuh manual), bukan retry backoff selamanya. Defensif (kedua adapter
          // produksi punya probeUsage) — guard ini menutup jalur mustahil-sembuh, bukan kasus sehari-hari.
          sessions.markBlocked(job.session_id);
          events.append({
            session_id: job.session_id,
            type: 'job_dispatch_error',
            payload: { jobId: job.id, action: 'probe_unsupported', reason: 'adapter_no_probe', status: 'BLOCKED' },
          });
          return 'done';
        }

        const usage = await adapter.probeUsage({ sessionPid: session.pid ?? undefined });

        if (usage.limits.length === 0) {
          // Tak bisa menentukan status usage dari respons ini. Bisa transien (glitch) → retry beberapa
          // kali; tapi bila PERSISTEN kosong (mis. schema usage berubah upstream) probe tak akan pernah
          // terbaca → B-1: setelah MAX_DISPATCH_ATTEMPTS gagal, berhenti (BLOCKED + surface) daripada
          // retry 60m selamanya tanpa user pernah tahu probe rusak.
          if (job.attempts + 1 >= MAX_DISPATCH_ATTEMPTS) {
            sessions.markBlocked(job.session_id);
            events.append({
              session_id: job.session_id,
              type: 'job_dispatch_error',
              payload: { jobId: job.id, action: 'probe_unreadable', reason: 'limits_empty_persistent', attempts: job.attempts + 1, status: 'BLOCKED' },
            });
            return 'done';
          }
          events.append({
            session_id: job.session_id,
            type: 'job_dispatch_pending',
            payload: { jobId: job.id, action: 'still_unknown', reason: 'limits_empty' },
          });
          return 'retry';
        }

        // I-25: keputusan "kuota tersedia" pindah ke adapter (`isUsageAvailable`). CC = hanya window
        // mengikat (global + scoped-aktif) supaya limit model-scoped tak-terpakai tak memblokir selamanya;
        // adapter tanpa override (agy) = default `every(<1)` (dual-limit per grup, semua bucket mengikat).
        const hasAvailable = adapter.isUsageAvailable
          ? adapter.isUsageAvailable(usage)
          : usage.limits.every((l) => l.usedFraction < 1);
        if (hasAvailable) {
          jobs.enqueue({ session_id: job.session_id, run_at: deps.now(), kind: 'resume', next_backoff_ms: null });
          events.append({
            session_id: job.session_id,
            type: 'job_dispatch_done',
            payload: { jobId: job.id, action: 'usage_available_enqueue_resume' },
          });
          return 'done';
        }

        events.append({
          session_id: job.session_id,
          type: 'job_dispatch_pending',
          payload: { jobId: job.id, action: 'still_limited' },
        });
        return 'retry';
      }

      // job.kind === 'resume'
      const session = sessions.getById(job.session_id);
      if (!session) {
        events.append({
          session_id: job.session_id,
          type: 'job_dispatch_done',
          payload: { jobId: job.id, action: 'skipped:session_not_found' },
        });
        return 'done';
      }

      if (session.proc_state === 'alive') {
        // Jalur preferred ADR-014: sesi masih hidup di PTY → inject "continue", bukan kill+respawn.
        // Daemon bukan pemilik PTY → minta wrapper (via socket kontrol per-sesi) yang melakukan gating
        // lokal + menulis token literal (I-12 poin 1). Token TAK PERNAH dilewatkan lewat IPC ini.
        const outcome = await requestInjectFn(session);
        if (outcome.injected) {
          // R3 (I-21): transisi status (kembali RUNNING, BUKAN RESUMED-terminal) + un-latch limit-watcher
          // dilakukan WRAPPER (pemilik PTY & penulis lifecycle sesinya, ADR-017) di dalam handler inject
          // — supaya siklus limit BERIKUTNYA di sesi hidup yang sama terdeteksi & dipantau lagi
          // (auto-continue tak lagi one-shot per sesi). Daemon hanya mencatat audit; notifikasi "resumed"
          // ke user disurface dari event `job_dispatch_done action:inject_continue` (paralel dengan
          // `resume_spawned` untuk resume-by-id).
          events.append({
            session_id: job.session_id,
            type: 'job_dispatch_done',
            payload: { jobId: job.id, action: 'inject_continue' },
          });
          return 'done';
        }
        // Tak ter-inject (gating wrapper menolak ATAU wrapper tak terjangkau). 'done', bukan 'retry' —
        // hindari retry-spin tak berujung (bug yang menyebabkan percobaan sebelumnya di-revert).
        // Kondisi tetap terlihat via event audit; surface manual sesuai ADR-014 (jangan auto-kill).
        events.append({
          session_id: job.session_id,
          type: 'job_dispatch_pending',
          payload: { jobId: job.id, action: 'inject_skipped', reason: outcome.reason, reachable: outcome.reachable },
        });
        return 'done';
      }

      // session.proc_state === 'exited' → resume-by-id (M3d.6).
      if (!existsSync(session.cwd)) {
        // AC-8: cwd asli sesi hilang — tak ada tempat aman untuk melanjutkan. Terminal, jangan retry.
        // I-28 (A-14): tulis status BLOCKED supaya `acca status` menampilkan sesi butuh-manual ini.
        sessions.markBlocked(job.session_id);
        events.append({
          session_id: job.session_id,
          type: 'job_dispatch_error',
          payload: { jobId: job.id, action: 'blocked', reason: 'cwd_missing', status: 'BLOCKED' },
        });
        return 'done';
      }

      // A-1 (audit 11 Jul): resume-by-id WAJIB pakai id sesi milik CLI (`claude --resume <uuid>` /
      // `agy --conversation <id>`), BUKAN id supervisor 4-char. Tanpa `cli_session_id`, resume PASTI
      // ditolak CLI nyata → BLOCKED (surface manual), JANGAN spawn proses yang dijamin gagal +
      // JANGAN keliru menandai sesi lama RESUMED. Penangkapan `cli_session_id` (transcript CC /
      // printed cmd agy) = slice terpisah yang butuh live-verify (setCliSessionId sudah siap).
      if (!session.cli_session_id) {
        // I-28 (A-14): tulis status BLOCKED (butuh manual: id CLI belum tertangkap → resume pasti gagal).
        sessions.markBlocked(job.session_id);
        events.append({
          session_id: job.session_id,
          type: 'job_dispatch_error',
          payload: { jobId: job.id, action: 'blocked', reason: 'cli_session_id_missing', status: 'BLOCKED' },
        });
        return 'done';
      }

      const adapter = adapters[session.tool];
      if (!adapter?.resumeCmd) {
        // B-1: kemampuan adapter STATIS → resume tak akan pernah bisa. Terminal (BLOCKED + surface),
        // bukan retry selamanya. Defensif (kedua adapter produksi punya resumeCmd).
        sessions.markBlocked(job.session_id);
        events.append({
          session_id: job.session_id,
          type: 'job_dispatch_error',
          payload: { jobId: job.id, action: 'resume_unsupported', reason: 'adapter_no_resumecmd', status: 'BLOCKED' },
        });
        return 'done';
      }

      const spec = adapter.resumeCmd(session.cli_session_id, session.cwd);
      // Actuation spawn nyata (I-12 poin 2): jalankan wrapper PTY baru di `spec.cwd` (AC-8 — resume
      // WAJIB di direktori kerja sesi asli). Default `spawnResumeFn` (runSession in-process) TAK
      // melempar saat spawn gagal — ia melapor `spawnFailed` (A-2: dulu jalur gagal jadi
      // unhandledRejection yang mematikan daemon + keliru menandai sesi lama RESUMED).
      const spawned = spawnResumeFn(spec, session);
      if (spawned.spawnFailed) {
        // Sesi baru gagal spawn (mis. binary hilang) → JANGAN tandai sesi lama RESUMED.
        // B-1: `runSession` SELALU membuat baris sesi (create→markFailed) meski spawn gagal sinkron →
        // pada retry berulang baris FAILED lempar MENUMPUK (retensi never-purge). Arsipkan baris lempar
        // itu (soft) supaya `acca status` tak dibanjiri percobaan gagal.
        if (spawned.sessionId) sessions.archive(spawned.sessionId);
        if (job.attempts + 1 >= MAX_DISPATCH_ATTEMPTS) {
          // B-1 (PROJECT §4): gagal spawn berulang (mis. PATH permanen rusak / binary hilang) → berhenti
          // auto-retry, tandai sesi lama BLOCKED + surface (level error) minta intervensi manual —
          // daripada tiap jam menciptakan baris FAILED baru + notif selamanya (pola A-4).
          sessions.markBlocked(job.session_id);
          events.append({
            session_id: job.session_id,
            type: 'job_dispatch_error',
            payload: { jobId: job.id, action: 'resume_gave_up', reason: 'resume_spawn_failed_repeatedly', attempts: job.attempts + 1, status: 'BLOCKED' },
          });
          return 'done';
        }
        // Belum melewati batas → surface + 'retry' (backoff berjenjang; PATH mungkin transien; sesi
        // lama tetap LIMIT_HIT, tak hilang).
        events.append({
          session_id: job.session_id,
          type: 'job_dispatch_error',
          payload: { jobId: job.id, action: 'resume_spawn_failed', newSessionId: spawned.sessionId, attempts: job.attempts + 1 },
        });
        return 'retry';
      }
      sessions.markResumed(job.session_id);
      events.append({
        session_id: job.session_id,
        type: 'job_dispatch_done',
        payload: { jobId: job.id, action: 'resume_spawned', newSessionId: spawned.sessionId, spec },
      });
      return 'done';
    } catch (err) {
      events.append({
        session_id: job.session_id,
        type: 'job_dispatch_error',
        payload: { jobId: job.id, kind: job.kind, error: err instanceof Error ? err.message : String(err) },
      });
      return 'retry';
    }
  };

  const dispatch: JobDispatch = deps.dispatch ?? realDispatch;

  // Timer di-resolusi sekali → dipakai scheduler DAN usage-monitor (I-17). Di test, `deps.setTimer`
  // (manual timer) menyetir keduanya; itulah kenapa monitor default OFF (lihat `startUsageMonitor`)
  // supaya test scheduler lama tak melihat timer ke-arm ekstra.
  const setTimer = deps.setTimer ?? createDaemonTimer((err) => daemonError(err, 'scheduler_timer'));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h));

  const scheduler = createScheduler({
    jobs,
    now: deps.now,
    dispatch,
    setTimer,
    clearTimer,
    onError: (err, job) => daemonError(err, 'dispatch', { jobId: job.id }),
  });

  // I-17 — loop probe usage periodik (opt-in via `startUsageMonitor`; produksi `acca daemon` menyalakan).
  // Probe PER-TOOL (usage = account-level; pilih satu sesi RUNNING representatif per tool, pakai pid-nya
  // utk port-discovery agy). Snapshot terbaru → `meta` (JSON per tool, tanpa migrasi) utk `acca status`;
  // proximity (I-8) → notify sink. FIREWALL (G-9): engine tak menyurface field probe lain (lihat usage-monitor).
  const usageMonitor = deps.startUsageMonitor
    ? createUsageMonitor({
        intervalMs: deps.usageProbeIntervalMs ?? DEFAULT_USAGE_PROBE_INTERVAL_MS,
        setTimer,
        clearTimer,
        listRunning: () =>
          sessions.listActive().filter((s) => s.status === 'RUNNING' && s.proc_state === 'alive'),
        probeFor: async (tool, pid) => {
          const adapter = adapters[tool];
          if (adapter.probeUsage === undefined) return null;
          return adapter.probeUsage(pid !== undefined ? { sessionPid: pid } : undefined);
        },
        saveSnapshot: (snap) => meta.set(`usage_snapshot_${snap.tool}`, JSON.stringify(snap)),
        deliver: deps.notify ?? stderrDeliver,
        onError: (err, ctx) => daemonError(err, 'usage_monitor', { tool: ctx.tool }),
      })
    : undefined;

  // IPC server dibuat SETELAH scheduler supaya handler `rearm` bisa menutup atas `scheduler`
  // (handler cuma dipanggil setelah start()/listen, jadi tak ada TDZ). `rearm` = celah lintas-proses
  // I-10: proses lain (wrapper `acca run`) menulis job `probe` ke scheduled_jobs saat LIMIT_HIT lalu
  // mengirim `rearm` → daemon HIDUP memuat ulang pending & arm timer tanpa menunggu restart.
  const ipcServer = createIpcServer({
    ping: () => ({ pong: true, pid: process.pid, at: deps.now() }),
    status: () => sessions.listActive(),
    rearm: () => {
      scheduler.rearm();
      return { rearmed: true };
    },
  });

  function heartbeat(): void {
    meta.setHeartbeat(deps.now(), process.pid);
  }

  return {
    async start(): Promise<void> {
      // Urutan wajib: rekonsiliasi dulu (I-3) → heartbeat awal → baru buka IPC, supaya klien
      // yang connect segera setelah listen melihat store yang sudah konsisten.
      reconcileOrphans({ sessions, events, isAlive: isProcessAlive });
      heartbeat();

      try {
        await ipcServer.listen(deps.socketPath);
      } catch (err) {
        // EADDRINUSE = kode yang sama di POSIX (unix socket) MAUPUN Windows (named pipe sudah
        // dipakai) — diverifikasi empiris (net.Server pada named pipe yang sudah bound
        // melempar error.code 'EADDRINUSE', bukan kode Windows lain). Jadi satu pengecekan
        // kode cukup untuk kedua OS, tak perlu branch platform di sini.
        // Cast tipis ke `{code?}` (pola `shared/proc.ts`) — hindari referensi namespace ambient
        // `NodeJS` (eslint no-undef tak mengenalinya di file TS ini).
        if ((err as { code?: string }).code === 'EADDRINUSE') {
          throw new DaemonAlreadyRunningError(deps.socketPath);
        }
        throw err;
      }

      // Scheduler diarm SETELAH listen sukses — kalau bind gagal (DaemonAlreadyRunningError)
      // tak boleh ada timer nyasar tertinggal armed dari instance yang gagal start.
      scheduler.start();
      usageMonitor?.start();
    },

    async stop(): Promise<void> {
      usageMonitor?.stop();
      scheduler.stop();
      await ipcServer.close();
    },

    heartbeat,
  };
}
