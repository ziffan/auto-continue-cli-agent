import { describe, expect, it } from 'vitest';
import type { AppendEventInput, EventsRepo } from '../src/store/repositories/events.js';
import type { UsageSnapshot } from '../src/shared/types.js';
import {
  DEFAULT_PROXIMITY_THRESHOLDS,
  formatNotification,
  notificationForEvent,
  proximityNotifications,
  withNotifications,
  type Notification,
} from '../src/notify/notifier.js';

describe('notificationForEvent — transisi yang layak-surface', () => {
  it('LIMIT_HIT (status_change) → warn, menyertakan source-label tapi BUKAN evidence', () => {
    const n = notificationForEvent({
      session_id: 'kcb3',
      type: 'status_change',
      payload: { to: 'LIMIT_HIT', source: 'output', evidence: 'sk-ant-SECRET-should-not-leak' },
    });
    expect(n).not.toBeNull();
    expect(n?.event).toBe('LIMIT_HIT');
    expect(n?.level).toBe('warn');
    expect(n?.sessionId).toBe('kcb3');
    expect(n?.body).toContain('#kcb3');
    expect(n?.body).toContain('via output');
    // FIREWALL: potongan output PTY (evidence) tak boleh muncul di notifikasi (G-9).
    expect(n?.body).not.toContain('SECRET');
    expect(n?.body).not.toContain('sk-ant');
  });

  it('RESUMED via inject-continue (status_change) → info, menyertakan reason-label', () => {
    const n = notificationForEvent({
      session_id: 'kcb3',
      type: 'status_change',
      payload: { to: 'RESUMED', reason: 'inject_continue' },
    });
    expect(n?.event).toBe('RESUMED');
    expect(n?.level).toBe('info');
    expect(n?.body).toContain('inject_continue');
  });

  it('RESUMED via resume-by-id (job_dispatch_done resume_spawned) → info, menautkan sesi baru', () => {
    const n = notificationForEvent({
      session_id: 'old1',
      type: 'job_dispatch_done',
      payload: { jobId: 7, action: 'resume_spawned', newSessionId: 'new9', spec: { file: 'claude', args: [] } },
    });
    expect(n?.event).toBe('RESUMED');
    expect(n?.body).toContain('#old1');
    expect(n?.body).toContain('#new9');
  });

  it('FAILED (status_change) → error, menyurface pesan error spawn kita (dipangkas)', () => {
    const long = 'x'.repeat(300);
    const n = notificationForEvent({
      session_id: 'f1',
      type: 'status_change',
      payload: { to: 'FAILED', reason: long },
    });
    expect(n?.event).toBe('FAILED');
    expect(n?.level).toBe('error');
    expect(n?.body).toContain('…');
    expect(n?.body.length).toBeLessThan(long.length);
  });

  it('BLOCKED (job_dispatch_error status BLOCKED) → error, menyertakan reason-label', () => {
    const n = notificationForEvent({
      session_id: 'b1',
      type: 'job_dispatch_error',
      payload: { jobId: 3, action: 'blocked', reason: 'cwd_missing', status: 'BLOCKED' },
    });
    expect(n?.event).toBe('BLOCKED');
    expect(n?.level).toBe('error');
    expect(n?.body).toContain('cwd_missing');
    expect(n?.body).toContain('manual');
  });

  it('inject_skipped (job_dispatch_pending) → INJECT_SKIPPED warn, reason-label + "manual" (I-18)', () => {
    const n = notificationForEvent({
      session_id: 'kcb3',
      type: 'job_dispatch_pending',
      payload: { jobId: 9, action: 'inject_skipped', reason: 'gating_foreground', reachable: true },
    });
    expect(n?.event).toBe('INJECT_SKIPPED');
    expect(n?.level).toBe('warn');
    expect(n?.body).toContain('#kcb3');
    expect(n?.body).toContain('gating_foreground');
    expect(n?.body).toContain('manual');
  });
});

describe('notificationForEvent — event yang TIDAK di-surface', () => {
  const cases: AppendEventInput[] = [
    { session_id: 's', type: 'status_change', payload: { to: 'RUNNING' } },
    { session_id: 's', type: 'status_change', payload: { to: 'EXITED', exitCode: 0 } },
    // orphan reconcile pakai 'exited' huruf kecil → tetap bukan noise-worthy.
    { session_id: 's', type: 'status_change', payload: { to: 'exited', reason: 'orphan_reconciled' } },
    { session_id: null, type: 'daemon_error', payload: { where: 'scheduler_timer' } },
    { session_id: 's', type: 'job_dispatch_pending', payload: { action: 'still_limited' } },
    { session_id: 's', type: 'job_dispatch_done', payload: { action: 'inject_continue' } },
    { session_id: 's', type: 'control_socket_error', payload: { error: 'boom' } },
    { session_id: 's', type: 'probe_scheduled', payload: {} },
  ];
  for (const c of cases) {
    it(`${c.type}/${JSON.stringify(c.payload)} → null`, () => {
      expect(notificationForEvent(c)).toBeNull();
    });
  }

  it('payload non-objek tak meng-crash (defensif)', () => {
    expect(notificationForEvent({ session_id: 's', type: 'status_change', payload: null })).toBeNull();
    expect(notificationForEvent({ session_id: 's', type: 'status_change', payload: 'nope' })).toBeNull();
  });
});

describe('formatNotification', () => {
  it('menghasilkan satu baris berlabel level', () => {
    const n: Notification = { event: 'FAILED', level: 'error', title: 'Session failed', body: 'oops', sessionId: 'x' };
    expect(formatNotification(n)).toBe('[acca error] Session failed — oops');
  });
});

describe('proximityNotifications (I-8) — engine murni', () => {
  const snap = (limits: UsageSnapshot['limits'], tool: UsageSnapshot['tool'] = 'claude'): UsageSnapshot => ({
    tool,
    limits,
    capturedAt: 0,
  });

  it('5-jam menembus 0.90 → satu notif PROXIMITY warn', () => {
    const ns = proximityNotifications(snap([{ kind: 'five_hour', usedFraction: 0.92, resetAt: null }]));
    expect(ns).toHaveLength(1);
    expect(ns[0].event).toBe('PROXIMITY');
    expect(ns[0].level).toBe('warn');
    expect(ns[0].body).toContain('5h');
    expect(ns[0].body).toContain('92%');
  });

  it('mingguan pakai ambang 0.75, bukan 0.90 (0.80 weekly → nyala, 0.80 five_hour → tidak)', () => {
    expect(proximityNotifications(snap([{ kind: 'weekly_all', usedFraction: 0.8, resetAt: null }]))).toHaveLength(1);
    expect(proximityNotifications(snap([{ kind: 'five_hour', usedFraction: 0.8, resetAt: null }]))).toHaveLength(0);
  });

  it('seven_day & agy "weekly" & "5h" terklasifikasi window dengan benar', () => {
    expect(proximityNotifications(snap([{ kind: 'seven_day', usedFraction: 0.76, resetAt: null }]))[0].body).toContain(
      'weekly',
    );
    const agy = proximityNotifications(
      snap(
        [
          { kind: 'weekly', usedFraction: 0.8, resetAt: null },
          { kind: '5h', usedFraction: 0.95, resetAt: null },
        ],
        'antigravity',
      ),
    );
    expect(agy).toHaveLength(2);
    expect(agy[0].body).toContain('weekly');
    expect(agy[1].body).toContain('5h');
  });

  it('di bawah ambang → kosong; exhausted (usedFraction=1) → dilewati (wilayah LIMIT_HIT)', () => {
    expect(proximityNotifications(snap([{ kind: 'five_hour', usedFraction: 0.5, resetAt: null }]))).toHaveLength(0);
    expect(proximityNotifications(snap([{ kind: 'weekly', usedFraction: 1, resetAt: null }]))).toHaveLength(0);
  });

  it('ambang tepat di batas (>=) menyala; threshold custom dihormati', () => {
    expect(proximityNotifications(snap([{ kind: 'five_hour', usedFraction: 0.9, resetAt: null }]))).toHaveLength(1);
    const strict = proximityNotifications(snap([{ kind: 'five_hour', usedFraction: 0.6, resetAt: null }]), {
      fiveHour: 0.5,
      weekly: 0.5,
    });
    expect(strict).toHaveLength(1);
  });

  it('default threshold = 90/75 (meniru Claude Code, G-15)', () => {
    expect(DEFAULT_PROXIMITY_THRESHOLDS).toEqual({ fiveHour: 0.9, weekly: 0.75 });
  });
});

describe('withNotifications — dekorator EventsRepo', () => {
  function fakeEvents(): { repo: EventsRepo; appended: AppendEventInput[] } {
    const appended: AppendEventInput[] = [];
    // listRecent/listBySession = stub no-op: EventsRepo kini punya method baca (M4 `acca log`),
    // dekorator men-spread & meneruskannya; test ini hanya menyoal jalur `append`.
    return { repo: { append: (i) => appended.push(i), listRecent: () => [], listBySession: () => [] }, appended };
  }

  it('meneruskan append ke repo asli lalu deliver untuk event layak-surface', () => {
    const { repo, appended } = fakeEvents();
    const delivered: Notification[] = [];
    const wrapped = withNotifications(repo, (n) => delivered.push(n));

    wrapped.append({ session_id: 'k', type: 'status_change', payload: { to: 'LIMIT_HIT', source: 'output' } });

    expect(appended).toHaveLength(1); // passthrough
    expect(delivered).toHaveLength(1);
    expect(delivered[0].event).toBe('LIMIT_HIT');
  });

  it('event tak-layak-surface → tetap append, TANPA deliver', () => {
    const { repo, appended } = fakeEvents();
    const delivered: Notification[] = [];
    const wrapped = withNotifications(repo, (n) => delivered.push(n));

    wrapped.append({ session_id: 'k', type: 'status_change', payload: { to: 'RUNNING' } });

    expect(appended).toHaveLength(1);
    expect(delivered).toHaveLength(0);
  });

  it('deliver yang throw di-swallow — append (lifecycle) tetap sukses', () => {
    const { repo, appended } = fakeEvents();
    const wrapped = withNotifications(repo, () => {
      throw new Error('stderr closed');
    });

    expect(() =>
      wrapped.append({ session_id: 'k', type: 'status_change', payload: { to: 'FAILED', reason: 'nope' } }),
    ).not.toThrow();
    expect(appended).toHaveLength(1);
  });
});
