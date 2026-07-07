// Engine penjadwal `scheduled_jobs` — timer persisten + recovery saat restart daemon + backoff berjenjang.
// M3b HANYA menjadwalkan (arm/fire/reschedule); eksekusi nyata (probe usage / resume sesi) via `dispatch`
// yang DISUNTIK dari luar — implementasi probe/resume menyusul di slice M3c/M3d ("engine first, wire later",
// pola sama seperti M2). Belum di-wire ke `supervisor.ts` di slice ini.

import type { JobKind, ScheduledJob } from '../shared/types.js';
import type { ScheduledJobsRepo } from '../store/repositories/scheduled-jobs.js';

export type TimerHandle = ReturnType<typeof setTimeout>;
export type JobResult = 'done' | 'retry';

/** Handler yang benar-benar mengeksekusi job (probe/resume) — DISUNTIK. M3b hanya menjadwalkan;
 * eksekusi nyata (probe usage / resume) menyusul di slice M3c/M3d. */
export type JobDispatch = (job: ScheduledJob) => JobResult | Promise<JobResult>;

export interface SchedulerDeps {
  jobs: ScheduledJobsRepo;
  now: () => number;
  dispatch: JobDispatch;
  setTimer: (fn: () => void, delayMs: number) => TimerHandle;
  clearTimer: (h: TimerHandle) => void;
  onError?: (err: unknown, job: ScheduledJob) => void;
}

export interface EnqueueJobInput {
  session_id: string;
  run_at: number;
  kind: JobKind;
  next_backoff_ms?: number | null;
}

export interface Scheduler {
  /** Recovery: muat pending dari `scheduled_jobs` (tahan restart daemon), arm timer untuk job terdekat. */
  start(): void;
  enqueue(input: EnqueueJobInput): ScheduledJob;
  /** I-10: muat ulang pending dari store & arm ulang timer. `enqueue()` hanya melihat job yang
   *  ditulis IN-PROCESS; job yang ditulis proses LAIN (mis. wrapper `acca run` yang meng-enqueue
   *  `probe` saat LIMIT_HIT) tak terlihat daemon hidup sampai restart. `rearm()` (dipicu lewat
   *  IPC `rearm`) menutup celah itu — `arm()` selalu membaca `jobs.listPending()` segar dari store. */
  rearm(): void;
  /** Clear timer aktif (tidak menghapus job dari store — hanya berhenti memicu). */
  stop(): void;
}

/** Backoff berjenjang (NFR, mirror reset-estimator.ts): attempt 0→5m, 1→15m, ≥2→60m (cap). */
const MS_PER_MINUTE = 60_000;
const BACKOFF_MS: readonly number[] = [5 * MS_PER_MINUTE, 15 * MS_PER_MINUTE, 60 * MS_PER_MINUTE];

function backoffMs(attempt: number): number {
  const idx = Math.min(Math.max(attempt, 0), BACKOFF_MS.length - 1);
  // idx di-clamp ke rentang array yang valid → indexing selalu aman.
  return BACKOFF_MS[idx] as number;
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  const { jobs, now, dispatch, setTimer, clearTimer, onError } = deps;

  let current: TimerHandle | undefined;
  let running = false;

  function arm(): void {
    if (current !== undefined) {
      clearTimer(current);
      current = undefined;
    }
    const earliest = jobs.listPending()[0];
    if (!earliest) return; // tak ada job pending → disarmed sampai enqueue berikutnya.
    const delay = Math.max(0, earliest.run_at - now());
    // runDue() sudah menangkap error per-job secara internal (try/catch di sekitar dispatch()); real
    // setTimeout mengabaikan return value fn-nya (fire-and-forget), sehingga membungkusnya dengan
    // `void` tidak menambah keamanan di sini — dan justru memutus Promise yang dibutuhkan test harness
    // untuk menunggu penyelesaian runDue() secara deterministik lewat `await`.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    current = setTimer(runDue, delay);
  }

  async function runDue(): Promise<void> {
    // Guard re-entry: fire manual di test / timer overlap tak boleh memproses dua kali bersamaan.
    if (running) return;
    running = true;
    try {
      const dueJobs = jobs.due(now());
      for (const job of dueJobs) {
        let result: JobResult;
        try {
          result = await dispatch(job);
        } catch (err) {
          onError?.(err, job);
          result = 'retry';
        }

        if (result === 'done') {
          jobs.remove(job.id);
        } else {
          const attempts = job.attempts + 1;
          const backoff = backoffMs(job.attempts); // indeks LAMA menentukan delay; attempts baru disimpan.
          jobs.reschedule(job.id, now() + backoff, attempts, backoff);
        }
      }
    } finally {
      running = false;
      arm(); // re-arm untuk job pending berikutnya (termasuk yang baru saja di-reschedule).
    }
  }

  return {
    start(): void {
      arm();
    },

    enqueue(input: EnqueueJobInput): ScheduledJob {
      const row = jobs.enqueue(input);
      arm(); // job baru mungkin lebih cepat dari timer yang sedang armed.
      return row;
    },

    rearm(): void {
      arm(); // baca ulang pending (termasuk yang ditulis proses lain) & arm timer terdekat.
    },

    stop(): void {
      if (current !== undefined) {
        clearTimer(current);
        current = undefined;
      }
    },
  };
}
