// I-17 wiring — integrasi usage-monitor ke createSupervisor. Membuktikan supervisor menyambung
// engine ke: adapters.probeUsage (per-tool, pid sesi representatif), meta (cache snapshot JSON),
// dan notify sink (proximity I-8). Engine murni-nya diuji terpisah di usage-monitor.test.ts.
// adapter.probeUsage di-stub via monkeypatch singleton `adapters` (tanpa jaringan/kredensial nyata).

import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adapters } from '../src/adapters/index.js';
import { createSupervisor } from '../src/daemon/supervisor.js';
import type { TimerHandle } from '../src/daemon/scheduler.js';
import type { Notification } from '../src/notify/notifier.js';
import { closeDb, openDb, type DatabaseInstance } from '../src/store/db.js';
import { createMetaRepo } from '../src/store/repositories/meta.js';
import { createSessionsRepo } from '../src/store/repositories/sessions.js';
import type { UsageSnapshot } from '../src/shared/types.js';

function uniqueSocketPath(): string {
  const rand = randomBytes(4).toString('hex');
  return process.platform === 'win32' ? `\\\\.\\pipe\\acca-umw-test-${rand}` : join(tmpdir(), `acca-umw-test-${rand}.sock`);
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
    armedCount: (): number => timers.size,
  };
}

// eslint-disable-next-line @typescript-eslint/unbound-method
const originalClaudeProbeUsage = adapters.claude.probeUsage;

describe('supervisor ↔ usage-monitor wiring (I-17)', () => {
  let tempDir: string | undefined;
  let db: DatabaseInstance | undefined;
  let socketPath: string | undefined;

  afterEach(() => {
    adapters.claude.probeUsage = originalClaudeProbeUsage;
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

  it('probe tersambung: RUNNING claude → probeUsage → snapshot cache ke meta + proximity ke notify', async () => {
    tempDir = join(tmpdir(), `acca-umw-test-${randomBytes(4).toString('hex')}`);
    process.env.ACCA_DATA_DIR = tempDir;
    db = openDb();
    socketPath = uniqueSocketPath();

    const sessions = createSessionsRepo(db);
    // Sesi RUNNING+alive (pid = pid test = alive) → lolos filter listRunning; reconcile tak menyentuhnya.
    sessions.createSession({ id: 'run1', tool: 'claude', cwd: tempDir, status: 'RUNNING', proc_state: 'alive', pid: process.pid });

    const snap: UsageSnapshot = { tool: 'claude', limits: [{ kind: '5h', usedFraction: 0.95, resetAt: null }], capturedAt: 0 };
    const probeUsage = vi.fn((): Promise<UsageSnapshot> => Promise.resolve(snap));
    adapters.claude.probeUsage = probeUsage;

    const delivered: Notification[] = [];
    const manual = createManualTimer();

    const supervisor = createSupervisor({
      db,
      socketPath,
      now: () => 0,
      setTimer: manual.setTimer,
      clearTimer: manual.clearTimer,
      notify: (n) => delivered.push(n),
      startUsageMonitor: true,
      usageProbeIntervalMs: 1000,
    });

    // Tak ada job pending → scheduler tak arm timer; satu-satunya timer ke-arm = monitor.
    await supervisor.start();
    expect(manual.armedCount()).toBe(1);
    await manual.fire(); // fire tick monitor → runOnce
    await supervisor.stop();

    // probeUsage dipanggil sekali untuk claude (dengan sessionPid dari sesi representatif).
    expect(probeUsage).toHaveBeenCalledTimes(1);
    expect(probeUsage).toHaveBeenCalledWith({ sessionPid: process.pid });

    // Snapshot ter-cache ke meta sebagai JSON per-tool (sumber `acca status`).
    const cached = createMetaRepo(db).get('usage_snapshot_claude');
    expect(cached).toBeDefined();
    expect(JSON.parse(cached as string)).toEqual(snap);

    // Proximity (0.95 ≥ 0.90 five_hour) → notifikasi PROXIMITY ke notify sink.
    const proximity = delivered.filter((n) => n.event === 'PROXIMITY');
    expect(proximity).toHaveLength(1);
    expect(proximity[0]?.body).toContain('claude');
  });

  it('monitor OFF secara default: tanpa startUsageMonitor, tak ada probe & tak ada timer monitor', async () => {
    tempDir = join(tmpdir(), `acca-umw-test-${randomBytes(4).toString('hex')}`);
    process.env.ACCA_DATA_DIR = tempDir;
    db = openDb();
    socketPath = uniqueSocketPath();

    const sessions = createSessionsRepo(db);
    sessions.createSession({ id: 'run2', tool: 'claude', cwd: tempDir, status: 'RUNNING', proc_state: 'alive', pid: process.pid });

    const probeUsage = vi.fn((): Promise<UsageSnapshot> => Promise.resolve({ tool: 'claude', limits: [], capturedAt: 0 }));
    adapters.claude.probeUsage = probeUsage;

    const manual = createManualTimer();
    const supervisor = createSupervisor({
      db,
      socketPath,
      now: () => 0,
      setTimer: manual.setTimer,
      clearTimer: manual.clearTimer,
      notify: () => {},
      // startUsageMonitor SENGAJA tak diisi (default false).
    });

    await supervisor.start();
    // Tak ada job pending & monitor off → nol timer ke-arm; probe tak pernah dipanggil.
    expect(manual.armedCount()).toBe(0);
    await supervisor.stop();
    expect(probeUsage).not.toHaveBeenCalled();
  });
});
