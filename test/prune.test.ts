import { describe, expect, it } from 'vitest';
import { isMonitored, selectPrunable } from '../src/cli/commands/prune.js';
import type { Session, SessionStatus } from '../src/shared/types.js';

let seq = 0;
function sess(status: SessionStatus, over: Partial<Session> = {}): Session {
  seq += 1;
  return {
    id: over.id ?? `s${seq}`,
    tool: 'claude',
    cli_session_id: null,
    cwd: '/x',
    pid: null,
    status,
    proc_state: 'exited',
    detected_at: null,
    detect_source: null,
    reset_at: null,
    reset_source: null,
    created_at: 1,
    updated_at: 2,
    archived_at: null,
    resumed_from: null,
    ...over,
  };
}

const never = () => false;
const always = () => true;

describe('isMonitored', () => {
  it('RUNNING/LIMIT_HIT/WAITING = dipantau; sisanya terminal', () => {
    expect(isMonitored('RUNNING')).toBe(true);
    expect(isMonitored('LIMIT_HIT')).toBe(true);
    expect(isMonitored('WAITING')).toBe(true);
    for (const s of ['EXITED', 'RESUMED', 'FAILED', 'BLOCKED'] as SessionStatus[]) {
      expect(isMonitored(s)).toBe(false);
    }
  });
});

describe('selectPrunable — default (terminal & tak-hidup)', () => {
  it('arsip hanya terminal; sisakan RUNNING/LIMIT_HIT/WAITING', () => {
    const active = [
      sess('RUNNING', { id: 'run' }),
      sess('LIMIT_HIT', { id: 'lim' }),
      sess('WAITING', { id: 'wait' }),
      sess('EXITED', { id: 'ex' }),
      sess('RESUMED', { id: 'res' }),
      sess('FAILED', { id: 'fail' }),
      sess('BLOCKED', { id: 'blk' }),
    ];
    const sel = selectPrunable(active, { ids: [], all: false, force: false, isAlive: never });
    expect(sel.toArchive.map((s) => s.id).sort()).toEqual(['blk', 'ex', 'fail', 'res']);
  });

  it('sesi terminal yang PID-nya masih hidup TIDAK diarsip (safety, race daemon)', () => {
    const active = [sess('EXITED', { id: 'zombie', pid: 4242 })];
    const sel = selectPrunable(active, { ids: [], all: false, force: false, isAlive: always });
    expect(sel.toArchive).toHaveLength(0);
  });
});

describe('selectPrunable — ids spesifik', () => {
  const active = [
    sess('EXITED', { id: 'ex' }),
    sess('RUNNING', { id: 'run' }),
  ];

  it('id terminal → diarsip', () => {
    const sel = selectPrunable(active, { ids: ['ex'], all: false, force: false, isAlive: never });
    expect(sel.toArchive.map((s) => s.id)).toEqual(['ex']);
  });

  it('id dipantau tanpa --force → dilewati dgn alasan', () => {
    const sel = selectPrunable(active, { ids: ['run'], all: false, force: false, isAlive: never });
    expect(sel.toArchive).toHaveLength(0);
    expect(sel.skipped[0]!.id).toBe('run');
    expect(sel.skipped[0]!.reason).toContain('dipantau');
  });

  it('id dipantau dengan --force → diarsip', () => {
    const sel = selectPrunable(active, { ids: ['run'], all: false, force: true, isAlive: never });
    expect(sel.toArchive.map((s) => s.id)).toEqual(['run']);
  });

  it('id tak dikenal → dilewati', () => {
    const sel = selectPrunable(active, { ids: ['ghost'], all: false, force: false, isAlive: never });
    expect(sel.toArchive).toHaveLength(0);
    expect(sel.skipped[0]!.reason).toContain('tak ada');
  });
});

describe('selectPrunable — --all', () => {
  it('mengarsip SEMUA sesi aktif (termasuk dipantau/hidup)', () => {
    const active = [sess('RUNNING', { id: 'run', pid: 1, }), sess('EXITED', { id: 'ex' })];
    const sel = selectPrunable(active, { ids: [], all: true, force: false, isAlive: always });
    expect(sel.toArchive.map((s) => s.id).sort()).toEqual(['ex', 'run']);
    expect(sel.skipped).toHaveLength(0);
  });
});
