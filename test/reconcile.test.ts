import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reconcileOrphans } from '../src/daemon/reconcile.js';
import { closeDb, openDb, type DatabaseInstance } from '../src/store/db.js';
import { createEventsRepo } from '../src/store/repositories/events.js';
import { createSessionsRepo } from '../src/store/repositories/sessions.js';

const tempDir = join(tmpdir(), `acca-reconcile-test-${randomBytes(4).toString('hex')}`);
process.env.ACCA_DATA_DIR = tempDir;

let db: DatabaseInstance;

beforeAll(() => {
  db = openDb();
});

afterAll(() => {
  closeDb(db);
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.ACCA_DATA_DIR;
});

// PID di luar rentang PID valid OS (Windows/Linux) — hampir pasti tak pernah dipakai proses hidup.
const DEAD_PID = 2_147_483_646;

describe('reconcileOrphans', () => {
  it('rewrites only alive-but-dead-pid sessions; alive-and-live and already-exited are untouched', () => {
    const sessions = createSessionsRepo(db);
    const events = createEventsRepo(db);

    // (a) RUNNING/alive, pid mati → harus jadi EXITED/exited.
    sessions.createSession({
      id: 'orpa',
      tool: 'claude',
      cwd: '/tmp/orphan-a',
      status: 'RUNNING',
      proc_state: 'alive',
      pid: DEAD_PID,
    });

    // (b) RUNNING/alive, pid = proses test sendiri (hidup) → tak boleh disentuh.
    sessions.createSession({
      id: 'orpb',
      tool: 'claude',
      cwd: '/tmp/orphan-b',
      status: 'RUNNING',
      proc_state: 'alive',
      pid: process.pid,
    });

    // (c) sudah EXITED sebelumnya (proc_state sudah 'exited') → tak boleh dihitung/disentuh.
    sessions.createSession({
      id: 'orpc',
      tool: 'claude',
      cwd: '/tmp/orphan-c',
      status: 'EXITED',
      proc_state: 'exited',
      pid: DEAD_PID,
    });

    // (d) LIMIT_HIT/alive, pid mati → proc_state jadi 'exited' TAPI status LIMIT_HIT dipertahankan
    // (createSession menerima `status` apa pun yang valid — jalur produksi asli, bukan setter
    // test-only — sehingga kasus ini bisa diuji tanpa menambah API repo baru untuk test).
    sessions.createSession({
      id: 'orpd',
      tool: 'claude',
      cwd: '/tmp/orphan-d',
      status: 'LIMIT_HIT',
      proc_state: 'alive',
      pid: DEAD_PID,
    });

    const isAlive = (pid: number): boolean => pid === process.pid;

    const count = reconcileOrphans({ sessions, events, isAlive });
    expect(count).toBe(2);

    const a = sessions.getById('orpa');
    expect(a?.status).toBe('EXITED');
    expect(a?.proc_state).toBe('exited');

    const b = sessions.getById('orpb');
    expect(b?.status).toBe('RUNNING');
    expect(b?.proc_state).toBe('alive');

    const c = sessions.getById('orpc');
    expect(c?.status).toBe('EXITED');
    expect(c?.proc_state).toBe('exited');

    const d = sessions.getById('orpd');
    expect(d?.status).toBe('LIMIT_HIT');
    expect(d?.proc_state).toBe('exited');

    const rows = db
      .prepare<[], { session_id: string; type: string; payload: string }>(
        "SELECT session_id, type, payload FROM events WHERE type = 'status_change' AND session_id IN ('orpa','orpd') ORDER BY session_id",
      )
      .all();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const payload = JSON.parse(row.payload) as { to: string; reason: string; pid: number };
      expect(payload.to).toBe('exited');
      expect(payload.reason).toBe('orphan_reconciled');
      expect(payload.pid).toBe(DEAD_PID);
    }

    // (b)/(c) tak boleh menghasilkan event rekonsiliasi.
    const untouchedEvents = db
      .prepare<[], { session_id: string }>(
        "SELECT session_id FROM events WHERE type = 'status_change' AND session_id IN ('orpb','orpc')",
      )
      .all();
    expect(untouchedEvents).toHaveLength(0);
  });
});
