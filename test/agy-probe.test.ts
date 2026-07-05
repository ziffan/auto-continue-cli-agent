import { describe, expect, it, vi } from 'vitest';
import { probeAgyUsage, type AgyProbeDeps } from '../src/adapters/antigravity.js';
import type { LoopbackResponse } from '../src/shared/http.js';

// probeAgyUsage: retry-loop G-23 (https loopback → 200 ber-userStatus). Semua I/O di-inject; clock
// palsu (sleep memajukan `now`) supaya cepat & deterministik tanpa jaringan/timer nyata.

/** userStatus minimal ber-kuota → parseAgyUserStatus menghasilkan limits non-kosong. */
const READY_BODY = JSON.stringify({
  userStatus: {
    cascadeModelConfigData: {
      clientModelConfigs: [
        { label: 'Claude Opus 4.6', quotaInfo: { remainingFraction: 0.5, resetTime: '2026-07-05T10:00:00Z' } },
      ],
    },
  },
});

/** userStatus 200 tapi TANPA model (LS belum siap) — plus PII yang TAK BOLEH bocor ke error. */
const NOT_READY_BODY_WITH_PII = JSON.stringify({
  userStatus: { name: 'SECRET_NAME_XYZ', email: 'secret@example.com', cascadeModelConfigData: { clientModelConfigs: [] } },
});

function makeClock(startMs = 1000) {
  let t = startMs;
  const now = () => t;
  const sleep = vi.fn((ms: number): Promise<void> => {
    t += ms;
    return Promise.resolve();
  });
  return { now, sleep };
}

function baseDeps(overrides: Partial<AgyProbeDeps> = {}): AgyProbeDeps {
  const clock = makeClock();
  return {
    discover: () => [16484, 16485],
    now: clock.now,
    sleep: clock.sleep,
    maxWaitMs: 15000,
    intervalMs: 2000,
    ...overrides,
  };
}

const ok = (body: string): LoopbackResponse => ({ status: 200, body });
const httpErr = (status: number): LoopbackResponse => ({ status, body: '' });

describe('probeAgyUsage', () => {
  it('throws when sessionPid is missing', async () => {
    await expect(probeAgyUsage(undefined, baseDeps())).rejects.toThrow(/sessionPid/);
    await expect(probeAgyUsage({}, baseDeps())).rejects.toThrow(/sessionPid/);
  });

  it('throws when no LS ports are discovered', async () => {
    const deps = baseDeps({ discover: () => [] });
    await expect(probeAgyUsage({ sessionPid: 42 }, deps)).rejects.toThrow(/ports not found/);
  });

  it('returns snapshot immediately when a port answers 200 with userStatus', async () => {
    const post = vi.fn(() => Promise.resolve(ok(READY_BODY)));
    const deps = baseDeps({ post });
    const snap = await probeAgyUsage({ sessionPid: 42 }, deps);
    expect(snap.tool).toBe('antigravity');
    expect(snap.limits).toHaveLength(1);
    expect(snap.limits[0]!.usedFraction).toBeCloseTo(0.5);
    // dipanggil untuk port pertama; berhenti begitu 200-berkuota (tak lanjut port kedua).
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('skips a wrong port that errors (ECONNRESET) and uses the good one', async () => {
    const post = vi.fn((url: string) =>
      url.includes(':16484')
        ? Promise.reject(new Error('read ECONNRESET'))
        : Promise.resolve(ok(READY_BODY)),
    );
    const deps = baseDeps({ post });
    const snap = await probeAgyUsage({ sessionPid: 42 }, deps);
    expect(snap.limits).toHaveLength(1);
    expect(post).toHaveBeenCalledTimes(2); // port pertama gagal → port kedua sukses, satu ronde.
  });

  it('retries across rounds until the LS becomes ready (~G-23 2-4s)', async () => {
    const clock = makeClock();
    // Kedua port: sebelum t>=5000 balas HTTP 500 (Connect-error), sesudahnya 200-berkuota.
    const post = vi.fn(() => Promise.resolve(clock.now() >= 5000 ? ok(READY_BODY) : httpErr(500)));
    const deps = baseDeps({ post, now: clock.now, sleep: clock.sleep });
    const snap = await probeAgyUsage({ sessionPid: 42 }, deps);
    expect(snap.limits).toHaveLength(1);
    expect(clock.sleep).toHaveBeenCalled(); // benar-benar menunggu, bukan sekali coba.
    expect(post.mock.calls.length).toBeGreaterThan(2);
  });

  it('gives up after the deadline and never leaks response body/PII into the error', async () => {
    const post = vi.fn(() => Promise.resolve(ok(NOT_READY_BODY_WITH_PII))); // 200 tapi userStatus kosong selamanya
    const deps = baseDeps({ post });
    const err = await probeAgyUsage({ sessionPid: 42 }, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toMatch(/tak ada HTTP 200 ber-kuota/);
    expect(msg).not.toContain('SECRET_NAME_XYZ');
    expect(msg).not.toContain('secret@example.com');
  });

  it('retries on persistent non-200 then throws with last status (no body)', async () => {
    const post = vi.fn(() => Promise.resolve(httpErr(503)));
    const deps = baseDeps({ post });
    const err = await probeAgyUsage({ sessionPid: 42 }, deps).catch((e: unknown) => e);
    expect((err as Error).message).toContain('HTTP 503');
    expect(post.mock.calls.length).toBeGreaterThan(2);
  });
});
