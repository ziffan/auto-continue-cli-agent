// T-L1/R-5 (M5.3): data-minimize proyeksi IPC `status`. Pipe kontrol daemon ber-DACL terbuka (I-26) —
// tak boleh dump `cli_session_id` (id berkapabilitas-resume) atau `cwd` (path proyek) ke pemanggil
// lokal mana pun yang bisa connect. Tak ada konsumen produksi yang butuh field itu lewat IPC (`acca
// status` baca DB langsung — dikonfirmasi Opus), jadi minimisasi ini nol breakage.

import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, openDb, type DatabaseInstance } from '../src/store/db.js';
import { createSessionsRepo, toSessionStatusView } from '../src/store/repositories/sessions.js';

const tempDir = join(tmpdir(), `acca-test-${randomBytes(4).toString('hex')}`);
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

describe('toSessionStatusView (T-L1 data-minimize)', () => {
  it('strips resume-capability id, cwd, and internal audit fields', () => {
    const sessions = createSessionsRepo(db);
    const created = sessions.createSession({
      id: 'sec-1',
      tool: 'claude',
      cwd: '/home/ziffan/secret-project',
      status: 'RUNNING',
      proc_state: 'alive',
      cli_session_id: 'cc-transcript-uuid-abc123',
      pid: 4242,
    });

    const view = toSessionStatusView(created);

    // Sensitif — TIDAK boleh ada di proyeksi yang keluar lewat pipe ber-DACL terbuka.
    expect(view).not.toHaveProperty('cli_session_id');
    expect(view).not.toHaveProperty('cwd');
    expect(view).not.toHaveProperty('detected_at');
    expect(view).not.toHaveProperty('detect_source');
    expect(view).not.toHaveProperty('created_at');
    expect(view).not.toHaveProperty('archived_at');
    expect(view).not.toHaveProperty('resumed_from');

    // Serialisasi JSON (bentuk aktual yang lewat kabel IPC) juga tak boleh membocorkan nilai rahasia.
    const wire = JSON.stringify(view);
    expect(wire).not.toContain('cc-transcript-uuid-abc123');
    expect(wire).not.toContain('secret-project');

    // Field yang DIPERTAHANKAN — cukup untuk gambaran status ringkas.
    expect(view).toEqual({
      id: 'sec-1',
      tool: 'claude',
      status: 'RUNNING',
      proc_state: 'alive',
      pid: 4242,
      reset_at: null,
      reset_source: null,
      updated_at: created.updated_at,
    });
  });

  it('listActive().map(toSessionStatusView) — bentuk persis yang dipakai handler IPC status', () => {
    const sessions = createSessionsRepo(db);
    sessions.createSession({
      id: 'sec-2a',
      tool: 'antigravity',
      cwd: '/tmp/proj-a',
      status: 'LIMIT_HIT',
      proc_state: 'alive',
      cli_session_id: 'agy-conv-id-xyz',
    });
    sessions.createSession({
      id: 'sec-2b',
      tool: 'claude',
      cwd: '/tmp/proj-b',
      status: 'RUNNING',
      proc_state: 'alive',
    });

    const views = sessions.listActive().map(toSessionStatusView);
    const ids = views.map((v) => v.id);
    expect(ids).toEqual(expect.arrayContaining(['sec-1', 'sec-2a', 'sec-2b']));

    for (const v of views) {
      expect(Object.keys(v).sort()).toEqual(
        ['id', 'pid', 'proc_state', 'reset_at', 'reset_source', 'status', 'tool', 'updated_at'].sort(),
      );
    }
    expect(JSON.stringify(views)).not.toContain('agy-conv-id-xyz');
    expect(JSON.stringify(views)).not.toContain('/tmp/proj-a');
  });
});
