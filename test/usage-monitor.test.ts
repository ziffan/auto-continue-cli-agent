import { describe, expect, it, vi } from 'vitest';
import { createUsageMonitor, type UsageMonitorDeps } from '../src/daemon/usage-monitor.js';
import type { TimerHandle } from '../src/daemon/scheduler.js';
import type { Notification } from '../src/notify/notifier.js';
import type { Session, Tool, UsageSnapshot } from '../src/shared/types.js';

function makeSession(partial: Partial<Session> & { id: string; tool: Tool }): Session {
  return {
    cli_session_id: null,
    cwd: '/tmp/project',
    pid: null,
    status: 'RUNNING',
    proc_state: 'alive',
    detected_at: null,
    detect_source: null,
    reset_at: null,
    reset_source: null,
    created_at: 0,
    updated_at: 0,
    archived_at: null,
    resumed_from: null,
    ...partial,
  };
}

function snapshot(tool: Tool, usedFraction: number, kind = 'session'): UsageSnapshot {
  return { tool, limits: [{ kind, usedFraction, resetAt: null }], capturedAt: 0 };
}

function baseDeps(overrides: Partial<UsageMonitorDeps> = {}): UsageMonitorDeps {
  return {
    intervalMs: 1000,
    setTimer: (): TimerHandle => 0 as unknown as TimerHandle,
    clearTimer: (): void => {},
    listRunning: () => [],
    probeFor: () => Promise.resolve(null),
    saveSnapshot: () => {},
    deliver: () => {},
    ...overrides,
  };
}

/**
 * Spy timer: `setTimer`/`clearTimer` DISUNTIK — tak pernah menyentuh wall-clock nyata (pola sama
 * seperti `test/scheduler.test.ts`). `calls[i].fn` disimpan sebagai referensi fungsi ASLI (async di
 * runtime nyata `usage-monitor.ts` meski tipe statis `setTimer` adalah `() => void`) supaya test bisa
 * `await` hasil nyatanya secara deterministik.
 */
interface TimerCall {
  id: number;
  fn: () => void;
  delay: number;
}
function createSpyTimer() {
  let seq = 0;
  const calls: TimerCall[] = [];
  const cleared = new Set<number>();
  return {
    setTimer: (fn: () => void, delayMs: number): TimerHandle => {
      const id = ++seq;
      calls.push({ id, fn, delay: delayMs });
      return id as unknown as TimerHandle;
    },
    clearTimer: (h: TimerHandle): void => {
      cleared.add(h as unknown as number);
    },
    calls,
    cleared,
    callCount: (): number => calls.length,
  };
}

/** Panggil fn armed sbg async (fn nyata mengembalikan Promise walau tipe statisnya `() => void`). */
function fire(call: TimerCall): Promise<void> {
  return (call.fn as unknown as () => Promise<void>)();
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('usage-monitor', () => {
  it('runOnce dedups sessions per tool — probeFor called exactly once per tool, using the pid-bearing session for claude', async () => {
    const sessions: Session[] = [
      makeSession({ id: 'c1', tool: 'claude', pid: null }),
      makeSession({ id: 'c2', tool: 'claude', pid: 222 }),
      makeSession({ id: 'a1', tool: 'antigravity', pid: 333 }),
    ];
    const probeFor = vi.fn(
      (_tool: Tool, _pid: number | undefined): Promise<UsageSnapshot | null> => Promise.resolve(null),
    );
    const monitor = createUsageMonitor(baseDeps({ listRunning: () => sessions, probeFor }));

    await monitor.runOnce();

    expect(probeFor).toHaveBeenCalledTimes(2);
    const claudeCall = probeFor.mock.calls.find(([tool]) => tool === 'claude');
    const agyCall = probeFor.mock.calls.find(([tool]) => tool === 'antigravity');
    expect(claudeCall?.[1]).toBe(222); // pid-bearing session preferred
    expect(agyCall?.[1]).toBe(333);
  });

  it('proximity: usedFraction 0.95 (>= threshold) delivers a PROXIMITY notification and saves the snapshot', async () => {
    const snap = snapshot('claude', 0.95);
    const saveSnapshot = vi.fn();
    const deliver = vi.fn<(n: Notification) => void>();
    const monitor = createUsageMonitor(
      baseDeps({
        listRunning: () => [makeSession({ id: 's1', tool: 'claude', pid: 1 })],
        probeFor: () => Promise.resolve(snap),
        saveSnapshot,
        deliver,
      }),
    );

    await monitor.runOnce();

    expect(saveSnapshot).toHaveBeenCalledWith(snap);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0]?.[0]?.event).toBe('PROXIMITY');
  });

  it('proximity dedup (I-8): sesi bertahan di atas ambang lintas TICK → deliver hanya SEKALI (bukan tiap tick)', async () => {
    // Regresi anti-spam: sebelum gate, tiap runOnce (tiap ~2 mnt) men-deliver PROXIMITY selama sesi
    // masih di atas ambang → puluhan notif identik. Gate persists lintas-tick di monitor.
    const snap = snapshot('claude', 0.95);
    const deliver = vi.fn<(n: Notification) => void>();
    const monitor = createUsageMonitor(
      baseDeps({
        listRunning: () => [makeSession({ id: 's1', tool: 'claude', pid: 1 })],
        probeFor: () => Promise.resolve(snap),
        deliver,
      }),
    );

    await monitor.runOnce();
    await monitor.runOnce();
    await monitor.runOnce();

    // Tiga tick di atas ambang, hanya satu notif PROXIMITY (crossing pertama).
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0]?.[0]?.event).toBe('PROXIMITY');
  });

  it('proximity: usedFraction 0.5 (below threshold) does not deliver, but still saves the snapshot', async () => {
    const snap = snapshot('claude', 0.5);
    const saveSnapshot = vi.fn();
    const deliver = vi.fn<(n: Notification) => void>();
    const monitor = createUsageMonitor(
      baseDeps({
        listRunning: () => [makeSession({ id: 's1', tool: 'claude', pid: 1 })],
        probeFor: () => Promise.resolve(snap),
        saveSnapshot,
        deliver,
      }),
    );

    await monitor.runOnce();

    expect(saveSnapshot).toHaveBeenCalledWith(snap);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('proximity: usedFraction 1 (exhausted) does not deliver (proximity skips exhausted windows), but still saves the snapshot', async () => {
    const snap = snapshot('claude', 1);
    const saveSnapshot = vi.fn();
    const deliver = vi.fn<(n: Notification) => void>();
    const monitor = createUsageMonitor(
      baseDeps({
        listRunning: () => [makeSession({ id: 's1', tool: 'claude', pid: 1 })],
        probeFor: () => Promise.resolve(snap),
        saveSnapshot,
        deliver,
      }),
    );

    await monitor.runOnce();

    expect(saveSnapshot).toHaveBeenCalledWith(snap);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('isolation: one tool rejecting does not stop the other — onError fires for the failing tool, the other tool is still probed and saved, and runOnce resolves', async () => {
    const agySnap = snapshot('antigravity', 0.3);
    const err = new Error('claude probe failed');
    const probeFor = vi.fn((tool: Tool): Promise<UsageSnapshot | null> => {
      if (tool === 'claude') return Promise.reject(err);
      return Promise.resolve(agySnap);
    });
    const saveSnapshot = vi.fn();
    const onError = vi.fn();
    const monitor = createUsageMonitor(
      baseDeps({
        listRunning: () => [
          makeSession({ id: 'c1', tool: 'claude', pid: 1 }),
          makeSession({ id: 'a1', tool: 'antigravity', pid: 2 }),
        ],
        probeFor,
        saveSnapshot,
        onError,
      }),
    );

    await expect(monitor.runOnce()).resolves.toBeUndefined(); // never throws out of runOnce

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(err, { tool: 'claude' });
    expect(saveSnapshot).toHaveBeenCalledWith(agySnap);
  });

  it('null: probeFor returning null skips silently — no saveSnapshot, no deliver, no error', async () => {
    const saveSnapshot = vi.fn();
    const deliver = vi.fn<(n: Notification) => void>();
    const onError = vi.fn();
    const monitor = createUsageMonitor(
      baseDeps({
        listRunning: () => [makeSession({ id: 's1', tool: 'claude', pid: 1 })],
        probeFor: () => Promise.resolve(null),
        saveSnapshot,
        deliver,
        onError,
      }),
    );

    await monitor.runOnce();

    expect(saveSnapshot).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('no running sessions -> probeFor is never called', async () => {
    const probeFor = vi.fn((): Promise<UsageSnapshot | null> => Promise.resolve(null));
    const monitor = createUsageMonitor(baseDeps({ listRunning: () => [], probeFor }));

    await monitor.runOnce();

    expect(probeFor).not.toHaveBeenCalled();
  });

  it('timer: start() arms, manual tick runs runOnce and re-arms, stop() clears and prevents further re-arm, start() twice is idempotent', async () => {
    const probeFor = vi.fn((): Promise<UsageSnapshot | null> => Promise.resolve(null));
    const timer = createSpyTimer();
    const monitor = createUsageMonitor(
      baseDeps({
        intervalMs: 5000,
        setTimer: timer.setTimer,
        clearTimer: timer.clearTimer,
        listRunning: () => [makeSession({ id: 's1', tool: 'claude', pid: 1 })],
        probeFor,
      }),
    );

    monitor.start();
    expect(timer.callCount()).toBe(1);
    expect(timer.calls[0]?.delay).toBe(5000);

    monitor.start(); // idempotent — already armed, no-op.
    expect(timer.callCount()).toBe(1);

    const firstCall = timer.calls[0] as TimerCall;
    await fire(firstCall); // manual tick fires
    expect(probeFor).toHaveBeenCalledTimes(1);
    expect(timer.callCount()).toBe(2); // re-armed after tick completed

    monitor.stop();
    expect(timer.cleared.has((timer.calls[1] as TimerCall).id)).toBe(true);

    // A leftover fire after stop() must not re-arm.
    const secondCall = timer.calls[1] as TimerCall;
    await fire(secondCall);
    expect(probeFor).toHaveBeenCalledTimes(2); // runOnce still executes on this manual fire...
    expect(timer.callCount()).toBe(2); // ...but no new timer is armed (started === false).
  });

  it('re-entry guard: an overlapping tick fire while runOnce is in-flight is skipped (no overlap)', async () => {
    const deferred = createDeferred<UsageSnapshot | null>();
    const probeFor = vi.fn((): Promise<UsageSnapshot | null> => deferred.promise);
    const timer = createSpyTimer();
    const monitor = createUsageMonitor(
      baseDeps({
        intervalMs: 1000,
        setTimer: timer.setTimer,
        clearTimer: timer.clearTimer,
        listRunning: () => [makeSession({ id: 's1', tool: 'claude', pid: 1 })],
        probeFor,
      }),
    );

    monitor.start();
    const tickFn = timer.calls[0] as TimerCall;

    const p1 = fire(tickFn); // starts tick: probeFor called, suspends awaiting deferred.promise
    const p2 = fire(tickFn); // overlapping manual fire while first tick still in-flight — must be skipped

    expect(probeFor).toHaveBeenCalledTimes(1); // second fire did not call probeFor again

    deferred.resolve(null);
    await p1;
    await p2;

    expect(probeFor).toHaveBeenCalledTimes(1);
    expect(timer.callCount()).toBe(2); // re-armed exactly once, after the first tick finished
  });
});
