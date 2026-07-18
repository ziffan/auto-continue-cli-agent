import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, openDb, type DatabaseInstance } from '../src/store/db.js';
import { createSessionsRepo } from '../src/store/repositories/sessions.js';

const tempDir = join(tmpdir(), `acca-limithit-test-${randomBytes(4).toString('hex')}`);
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

describe('sessions.markLimitHit', () => {
  it('transitions RUNNING/alive → LIMIT_HIT, keeps proc_state alive, sets detected_at/detect_source', () => {
    const sessions = createSessionsRepo(db);
    const id = `sess-${randomBytes(4).toString('hex')}`;
    sessions.createSession({ id, tool: 'claude', cwd: process.cwd(), status: 'RUNNING', proc_state: 'alive' });

    const fixedDetectedAt = 1_720_000_000_000;
    sessions.markLimitHit(id, { source: 'output', detectedAt: fixedDetectedAt });

    const row = sessions.getById(id);
    expect(row?.status).toBe('LIMIT_HIT');
    expect(row?.proc_state).toBe('alive');
    expect(row?.detected_at).toBe(fixedDetectedAt);
    expect(row?.detect_source).toBe('output');
  });

  it('is a no-op when the session status is already EXITED (does not clobber)', () => {
    const sessions = createSessionsRepo(db);
    const id = `sess-${randomBytes(4).toString('hex')}`;
    sessions.createSession({ id, tool: 'claude', cwd: process.cwd(), status: 'RUNNING', proc_state: 'alive' });
    sessions.markExited(id);

    sessions.markLimitHit(id, { source: 'output', detectedAt: 1_720_000_000_000 });

    const row = sessions.getById(id);
    expect(row?.status).toBe('EXITED');
    expect(row?.detected_at).toBeNull();
    expect(row?.detect_source).toBeNull();
  });
});

describe('sessions.markRunningAfterInject (R3/I-21)', () => {
  it('LIMIT_HIT → RUNNING, proc_state tetap alive, membersihkan detected_at/detect_source/reset_at/reset_source', () => {
    const sessions = createSessionsRepo(db);
    const id = `sess-${randomBytes(4).toString('hex')}`;
    sessions.createSession({ id, tool: 'claude', cwd: process.cwd(), status: 'RUNNING', proc_state: 'alive' });
    sessions.markLimitHit(id, { source: 'output', detectedAt: 1_720_000_000_000 });
    sessions.setReset(id, { resetAt: 1_720_000_900_000, resetSource: 'exact' });

    expect(sessions.markRunningAfterInject(id)).toBe(true);

    const row = sessions.getById(id);
    expect(row?.status).toBe('RUNNING');
    expect(row?.proc_state).toBe('alive'); // inject-continue melanjutkan proses yang SAMA
    expect(row?.detected_at).toBeNull();
    expect(row?.detect_source).toBeNull();
    expect(row?.reset_at).toBeNull();
    expect(row?.reset_source).toBeNull();
  });

  it('no-op (false) saat sesi EXITED — tak meng-clobber terminal state (race exit)', () => {
    const sessions = createSessionsRepo(db);
    const id = `sess-${randomBytes(4).toString('hex')}`;
    sessions.createSession({ id, tool: 'claude', cwd: process.cwd(), status: 'RUNNING', proc_state: 'alive' });
    sessions.markExited(id);

    expect(sessions.markRunningAfterInject(id)).toBe(false);
    expect(sessions.getById(id)?.status).toBe('EXITED');
  });

  it('siklus 2×: LIMIT_HIT → RUNNING → LIMIT_HIT lagi (auto-continue bukan one-shot per sesi hidup)', () => {
    const sessions = createSessionsRepo(db);
    const id = `sess-${randomBytes(4).toString('hex')}`;
    sessions.createSession({ id, tool: 'claude', cwd: process.cwd(), status: 'RUNNING', proc_state: 'alive' });

    // siklus 1: limit → inject-continue → kembali RUNNING
    expect(sessions.markLimitHit(id, { source: 'output', detectedAt: 1 })).toBe(true);
    expect(sessions.markRunningAfterInject(id)).toBe(true);
    expect(sessions.getById(id)?.status).toBe('RUNNING');

    // siklus 2: markLimitHit (guard RUNNING) berhasil LAGI justru karena sesi kembali RUNNING —
    // inilah inti R3: tanpa transisi balik ke RUNNING, guard menolak & sesi tak pernah ter-rescue lagi.
    expect(sessions.markLimitHit(id, { source: 'output', detectedAt: 2 })).toBe(true);
    expect(sessions.getById(id)?.status).toBe('LIMIT_HIT');
    expect(sessions.getById(id)?.detected_at).toBe(2);
  });
});

describe('sessions.markExited mempertahankan status non-RUNNING (D-1/RD-1 Opsi A, audit keempat)', () => {
  it('LIMIT_HIT + exit bersih → status TETAP LIMIT_HIT, proc_state → exited (jalur resume-by-id tetap hidup)', () => {
    const sessions = createSessionsRepo(db);
    const id = `sess-${randomBytes(4).toString('hex')}`;
    sessions.createSession({ id, tool: 'antigravity', cwd: process.cwd(), status: 'RUNNING', proc_state: 'alive' });
    sessions.markLimitHit(id, { source: 'output', detectedAt: 1_720_000_000_000 });

    sessions.markExited(id);

    const row = sessions.getById(id);
    // Sebelum RD-1: status di-clobber EXITED → guard probe I-35 men-skip job → auto-resume mati senyap.
    expect(row?.status).toBe('LIMIT_HIT');
    expect(row?.proc_state).toBe('exited');
    expect(row?.detected_at).toBe(1_720_000_000_000); // episode limit tetap tercatat
  });

  it('RUNNING + exit bersih → EXITED/exited (semantik lama utk sesi sehat tak berubah)', () => {
    const sessions = createSessionsRepo(db);
    const id = `sess-${randomBytes(4).toString('hex')}`;
    sessions.createSession({ id, tool: 'claude', cwd: process.cwd(), status: 'RUNNING', proc_state: 'alive' });

    sessions.markExited(id);

    const row = sessions.getById(id);
    expect(row?.status).toBe('EXITED');
    expect(row?.proc_state).toBe('exited');
  });

  it('BLOCKED + exit → status TETAP BLOCKED (butuh-manual tak hilang), proc_state → exited', () => {
    const sessions = createSessionsRepo(db);
    const id = `sess-${randomBytes(4).toString('hex')}`;
    sessions.createSession({ id, tool: 'claude', cwd: process.cwd(), status: 'RUNNING', proc_state: 'alive' });
    sessions.markLimitHit(id, { source: 'output', detectedAt: 1 });
    sessions.markBlocked(id);

    sessions.markExited(id);

    const row = sessions.getById(id);
    expect(row?.status).toBe('BLOCKED');
    expect(row?.proc_state).toBe('exited');
  });
});

describe('sessions.markResumed guard (I-28/A-13)', () => {
  it('LIMIT_HIT → RESUMED (jalur normal)', () => {
    const sessions = createSessionsRepo(db);
    const id = `sess-${randomBytes(4).toString('hex')}`;
    sessions.createSession({ id, tool: 'claude', cwd: process.cwd(), status: 'RUNNING', proc_state: 'alive' });
    sessions.markLimitHit(id, { source: 'output', detectedAt: 1 });

    expect(sessions.markResumed(id)).toBe(true);
    expect(sessions.getById(id)?.status).toBe('RESUMED');
  });

  it('no-op (false) saat sesi sudah EXITED/FAILED — tak clobber terminal (race)', () => {
    const sessions = createSessionsRepo(db);
    const exitedId = `sess-${randomBytes(4).toString('hex')}`;
    sessions.createSession({ id: exitedId, tool: 'claude', cwd: process.cwd(), status: 'RUNNING', proc_state: 'alive' });
    sessions.markExited(exitedId);
    expect(sessions.markResumed(exitedId)).toBe(false);
    expect(sessions.getById(exitedId)?.status).toBe('EXITED');

    const failedId = `sess-${randomBytes(4).toString('hex')}`;
    sessions.createSession({ id: failedId, tool: 'claude', cwd: process.cwd(), status: 'RUNNING', proc_state: 'alive' });
    sessions.markFailed(failedId);
    expect(sessions.markResumed(failedId)).toBe(false);
    expect(sessions.getById(failedId)?.status).toBe('FAILED');
  });
});

describe('sessions.markBlocked (I-28/A-14)', () => {
  it('LIMIT_HIT → BLOCKED (auto-continue mustahil, butuh manual)', () => {
    const sessions = createSessionsRepo(db);
    const id = `sess-${randomBytes(4).toString('hex')}`;
    sessions.createSession({ id, tool: 'claude', cwd: process.cwd(), status: 'LIMIT_HIT', proc_state: 'exited' });
    expect(sessions.markBlocked(id)).toBe(true);
    expect(sessions.getById(id)?.status).toBe('BLOCKED');
  });

  it('no-op (false) saat sesi sudah EXITED — tak clobber terminal', () => {
    const sessions = createSessionsRepo(db);
    const id = `sess-${randomBytes(4).toString('hex')}`;
    sessions.createSession({ id, tool: 'claude', cwd: process.cwd(), status: 'RUNNING', proc_state: 'alive' });
    sessions.markExited(id);
    expect(sessions.markBlocked(id)).toBe(false);
    expect(sessions.getById(id)?.status).toBe('EXITED');
  });
});
