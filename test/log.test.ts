import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, openDb, type DatabaseInstance } from '../src/store/db.js';
import { createEventsRepo } from '../src/store/repositories/events.js';
import { createSessionsRepo } from '../src/store/repositories/sessions.js';
import { formatEventLine } from '../src/cli/commands/log.js';

describe('formatEventLine — firewall & format (pure, tanpa DB)', () => {
  it('status_change LIMIT_HIT: menyertakan to/source, TAK PERNAH evidence', () => {
    const line = formatEventLine({
      id: 1,
      session_id: 'kcb3',
      type: 'status_change',
      payload: JSON.stringify({ to: 'LIMIT_HIT', source: 'output', evidence: 'sk-ant-SECRET-LEAK' }),
      created_at: 0,
    });
    expect(line).toContain('status_change');
    expect(line).toContain('to=LIMIT_HIT');
    expect(line).toContain('source=output');
    expect(line).not.toContain('SECRET');
    expect(line).not.toContain('sk-ant');
    expect(line).not.toContain('evidence');
  });

  it('status_change RESUMED: to=RESUMED reason=inject_continue', () => {
    const line = formatEventLine({
      id: 2,
      session_id: 'kcb3',
      type: 'status_change',
      payload: JSON.stringify({ to: 'RESUMED', reason: 'inject_continue' }),
      created_at: 0,
    });
    expect(line).toContain('to=RESUMED reason=inject_continue');
  });

  it('job_dispatch_done resume_spawned: action/newSessionId disurface, spec TIDAK', () => {
    const line = formatEventLine({
      id: 3,
      session_id: 'old1',
      type: 'job_dispatch_done',
      payload: JSON.stringify({
        jobId: 7,
        action: 'resume_spawned',
        newSessionId: 'new9',
        spec: { file: 'claude', args: ['--secret-flag'] },
      }),
      created_at: 0,
    });
    expect(line).toContain('action=resume_spawned');
    expect(line).toContain('jobId=7');
    expect(line).toContain('newSessionId=new9');
    expect(line).not.toContain('spec');
    expect(line).not.toContain('--secret-flag');
  });

  it('session_id null → kolom sesi "·"', () => {
    const line = formatEventLine({
      id: 4,
      session_id: null,
      type: 'daemon_error',
      payload: JSON.stringify({ where: 'scheduler_timer' }),
      created_at: 0,
    });
    const cols = line.split(/\s{2,}/);
    expect(cols[1]).toBe('·');
  });

  it('payload non-JSON tak crash, summary kosong', () => {
    const line = formatEventLine({
      id: 5,
      session_id: 's',
      type: 'weird',
      payload: 'not json',
      created_at: 0,
    });
    expect(() => line).not.toThrow();
    expect(line.endsWith('weird')).toBe(true);
  });

  it('payload "null" (JSON literal null) tak crash, summary kosong', () => {
    const line = formatEventLine({
      id: 6,
      session_id: 's',
      type: 'weird2',
      payload: 'null',
      created_at: 0,
    });
    expect(line.endsWith('weird2')).toBe(true);
  });

  it('created_at → ISO benar di kolom pertama', () => {
    const ts = 1_700_000_000_000;
    const line = formatEventLine({
      id: 7,
      session_id: 's',
      type: 't',
      payload: '{}',
      created_at: ts,
    });
    expect(line.startsWith(new Date(ts).toISOString())).toBe(true);
  });
});

describe('events repo — listRecent & listBySession', () => {
  const tempDir = join(tmpdir(), `acca-log-test-${randomBytes(4).toString('hex')}`);
  let db: DatabaseInstance;

  beforeAll(() => {
    process.env.ACCA_DATA_DIR = tempDir;
    db = openDb();
    const sessions = createSessionsRepo(db);
    sessions.createSession({ id: 'sA', tool: 'claude', cwd: '/tmp/a', status: 'RUNNING', proc_state: 'alive' });
    sessions.createSession({ id: 'sB', tool: 'claude', cwd: '/tmp/b', status: 'RUNNING', proc_state: 'alive' });
  });

  afterAll(() => {
    closeDb(db);
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.ACCA_DATA_DIR;
  });

  it('listRecent urut terbaru-dulu dan menghormati LIMIT', () => {
    const events = createEventsRepo(db);
    events.append({ session_id: 'sA', type: 'e1', payload: { n: 1 } });
    events.append({ session_id: 'sB', type: 'e2', payload: { n: 2 } });
    events.append({ session_id: 'sA', type: 'e3', payload: { n: 3 } });

    const all = events.listRecent(100);
    const relevant = all.filter((e) => e.type === 'e1' || e.type === 'e2' || e.type === 'e3');
    expect(relevant.map((e) => e.type)).toEqual(['e3', 'e2', 'e1']);

    const limited = events.listRecent(1);
    expect(limited).toHaveLength(1);
    expect(limited[0]?.type).toBe('e3');
  });

  it('listBySession filter benar per sesi', () => {
    const events = createEventsRepo(db);
    events.append({ session_id: 'sA', type: 'fa1', payload: {} });
    events.append({ session_id: 'sB', type: 'fb1', payload: {} });
    events.append({ session_id: 'sA', type: 'fa2', payload: {} });

    const forA = events.listBySession('sA', 100).filter((e) => e.type.startsWith('fa'));
    expect(forA.map((e) => e.type)).toEqual(['fa2', 'fa1']);

    const forB = events.listBySession('sB', 100).filter((e) => e.type.startsWith('fb'));
    expect(forB.map((e) => e.type)).toEqual(['fb1']);
  });
});
