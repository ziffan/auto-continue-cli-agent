// Engine loop probe usage PERIODIK (I-17) — jalan selagi ada sesi RUNNING, memanggil probe usage
// per-tool secara berkala, menyimpan snapshot terbaru & meneruskan notifikasi proximity (I-8).
// Engine MURNI-INJECTABLE: timer (`setTimer`/`clearTimer`), sumber sesi aktif (`listRunning`), probe
// (`probeFor`), penyimpanan snapshot (`saveSnapshot`), sink notifikasi (`deliver`) — semua DISUNTIK
// dari luar (supervisor.ts men-wire; produksi `acca daemon` menyalakan via `startUsageMonitor`).
// Pola timer/re-entry-guard meniru `scheduler.ts` (M3b) 1:1 supaya konsisten & fake-timer-testable.
// Dedup proximity (rising-edge) lewat `createProximityGate` yang hidup LINTAS-tick (anti-spam I-8).
//
// FIREWALL (G-9, ADR-008/013): monitor TAK PERNAH menyurface field lain dari respons probe selain
// lewat gate proximity (body sudah PII-safe: tool/kind/persen) dan `saveSnapshot` (`UsageSnapshot`
// terstruktur). Tak ada log/echo field mentah probe di modul ini.

import { createProximityGate, DEFAULT_PROXIMITY_THRESHOLDS, type NotificationDeliver, type ProximityThresholds } from '../notify/notifier.js';
import type { Session, Tool, UsageSnapshot } from '../shared/types.js';
import type { TimerHandle } from './scheduler.js';

export interface UsageMonitorDeps {
  intervalMs: number;
  setTimer: (fn: () => void, ms: number) => TimerHandle;
  clearTimer: (h: TimerHandle) => void;
  /** Sesi RUNNING+alive saat ini (supervisor menyuntik: sessions.listActive filtered). */
  listRunning: () => Session[];
  /** Probe usage utk satu tool memakai pid sesi representatif (agy butuh pid utk port-discovery;
   *  CC abaikan). Return null bila tool tak punya kemampuan probe. Boleh reject. */
  probeFor: (tool: Tool, sessionPid: number | undefined) => Promise<UsageSnapshot | null>;
  /** Simpan snapshot terbaru (supervisor: meta.set JSON per tool) — utk `acca status`. */
  saveSnapshot: (snapshot: UsageSnapshot) => void;
  /** Sink notifikasi proximity (supervisor: notify sink). */
  deliver: NotificationDeliver;
  /** Best-effort error hook per-tool (supervisor: append daemon_error). Swallow-safe. */
  onError?: (err: unknown, ctx: { tool: Tool }) => void;
  /** Default DEFAULT_PROXIMITY_THRESHOLDS. */
  thresholds?: ProximityThresholds;
}

export interface UsageMonitor {
  start(): void;
  stop(): void;
  runOnce(): Promise<void>;
}

/** Dedup per tool: satu sesi representatif per tool, prefer yang `pid !== null` (agy butuh pid utk
 *  port-discovery). Urutan Map = urutan first-seen di `sessions` (deterministik untuk test). */
function pickRepresentatives(sessions: Session[]): Map<Tool, Session> {
  const reps = new Map<Tool, Session>();
  for (const session of sessions) {
    const existing = reps.get(session.tool);
    if (!existing) {
      reps.set(session.tool, session);
    } else if (existing.pid === null && session.pid !== null) {
      reps.set(session.tool, session);
    }
  }
  return reps;
}

export function createUsageMonitor(deps: UsageMonitorDeps): UsageMonitor {
  const { intervalMs, setTimer, clearTimer, listRunning, probeFor, saveSnapshot, deliver, onError, thresholds } = deps;

  // Satu gate proximity hidup LINTAS-tick (I-8): dedup rising-edge — tanpa ini proximity ter-deliver
  // tiap tick (~2 mnt) selama sesi bertahan di atas ambang → spam notif.
  const proximityGate = createProximityGate(thresholds ?? DEFAULT_PROXIMITY_THRESHOLDS);

  let current: TimerHandle | undefined;
  let started = false; // arm state: true selama monitor "hidup" (di antara start()/stop()).
  let running = false; // re-entry guard: satu runOnce/tick in-flight pada satu waktu.

  async function runOnce(): Promise<void> {
    const reps = pickRepresentatives(listRunning());
    for (const [tool, session] of reps) {
      try {
        const snap = await probeFor(tool, session.pid ?? undefined);
        if (snap === null) continue; // tool tak punya kemampuan probe → skip diam.
        saveSnapshot(snap);
        for (const n of proximityGate.evaluate(snap)) {
          deliver(n);
        }
      } catch (err) {
        // Isolasi per-tool: kegagalan satu tool TAK BOLEH menghentikan probe tool lain, dan runOnce
        // sendiri selalu resolve (tak pernah melempar keluar).
        onError?.(err, { tool });
      }
    }
  }

  async function tick(): Promise<void> {
    // Guard re-entry: tick berikut yang nyala selagi runOnce sebelumnya masih berjalan → skip diam
    // (jangan overlap probe).
    if (running) return;
    running = true;
    try {
      await runOnce();
    } finally {
      running = false;
    }
    if (started) {
      // Real setTimeout mengabaikan return value fn-nya (fire-and-forget); membungkus dengan `void`
      // tidak menambah keamanan di sini dan justru memutus Promise yang dibutuhkan test harness untuk
      // menunggu penyelesaian tick() secara deterministik lewat `await` (pola sama seperti scheduler.ts).
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      current = setTimer(tick, intervalMs);
    }
  }

  return {
    start(): void {
      if (started) return; // idempotent — sudah jalan, no-op.
      started = true;
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      current = setTimer(tick, intervalMs);
    },

    stop(): void {
      started = false; // tick in-flight (bila ada) tak akan re-arm setelah ini.
      if (current !== undefined) {
        clearTimer(current);
        current = undefined;
      }
    },

    runOnce,
  };
}
