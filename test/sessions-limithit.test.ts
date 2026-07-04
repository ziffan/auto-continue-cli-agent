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
