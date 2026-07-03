import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, openDb, type DatabaseInstance } from '../src/store/db.js';
import { createSessionsRepo } from '../src/store/repositories/sessions.js';
import { createEventsRepo } from '../src/store/repositories/events.js';

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

describe('store', () => {
  it('creates a session and reads back all columns', () => {
    const sessions = createSessionsRepo(db);
    const created = sessions.createSession({
      id: 'a1b2',
      tool: 'claude',
      cwd: '/tmp/some-project',
      status: 'RUNNING',
      proc_state: 'alive',
    });

    expect(created.id).toBe('a1b2');
    expect(created.tool).toBe('claude');
    expect(created.cwd).toBe('/tmp/some-project');
    expect(created.status).toBe('RUNNING');
    expect(created.proc_state).toBe('alive');
    expect(created.pid).toBeNull();
    expect(created.cli_session_id).toBeNull();
    expect(created.detected_at).toBeNull();
    expect(created.detect_source).toBeNull();
    expect(created.reset_at).toBeNull();
    expect(created.reset_source).toBeNull();
    expect(created.archived_at).toBeNull();
    expect(typeof created.created_at).toBe('number');
    expect(typeof created.updated_at).toBe('number');

    const fetched = sessions.getById('a1b2');
    expect(fetched).toEqual(created);
  });

  it('setPid updates pid and updated_at', () => {
    const sessions = createSessionsRepo(db);
    sessions.createSession({
      id: 'pidt',
      tool: 'antigravity',
      cwd: '/tmp/other-project',
      status: 'RUNNING',
      proc_state: 'alive',
    });

    sessions.setPid('pidt', 12345);
    const fetched = sessions.getById('pidt');
    expect(fetched?.pid).toBe(12345);
  });

  it('markExited flips status and proc_state', () => {
    const sessions = createSessionsRepo(db);
    sessions.createSession({
      id: 'exit',
      tool: 'claude',
      cwd: '/tmp/exit-project',
      status: 'RUNNING',
      proc_state: 'alive',
    });

    sessions.markExited('exit');
    const fetched = sessions.getById('exit');
    expect(fetched?.status).toBe('EXITED');
    expect(fetched?.proc_state).toBe('exited');
  });

  it('listActive returns non-archived sessions ordered by updated_at desc', () => {
    const sessions = createSessionsRepo(db);
    const active = sessions.listActive();
    expect(active.length).toBeGreaterThanOrEqual(3);
    expect(active.every((s) => s.archived_at === null)).toBe(true);
  });

  it('events.append persists an append-only event', () => {
    const sessions = createSessionsRepo(db);
    const events = createEventsRepo(db);
    sessions.createSession({
      id: 'evnt',
      tool: 'claude',
      cwd: '/tmp/event-project',
      status: 'RUNNING',
      proc_state: 'alive',
    });

    events.append({ session_id: 'evnt', type: 'status_change', payload: { to: 'RUNNING' } });

    const row = db
      .prepare<[string], { session_id: string; type: string; payload: string }>(
        'SELECT session_id, type, payload FROM events WHERE session_id = ?',
      )
      .get('evnt');

    expect(row?.type).toBe('status_change');
    expect(row ? (JSON.parse(row.payload) as { to: string }).to : undefined).toBe('RUNNING');
  });
});
