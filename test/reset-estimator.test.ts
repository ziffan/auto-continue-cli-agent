import { describe, expect, it } from 'vitest';
import { estimateReset } from '../src/daemon/reset-estimator.js';
import type { ResetHint } from '../src/adapters/types.js';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

describe('estimateReset — precedence: epochSeconds > isoTimestamp > relativeHours > clockTime > heuristic > backoff', () => {
  it('epochSeconds → exact, resetAt = epochSeconds * 1000', () => {
    const hint: ResetHint = { epochSeconds: 1_700_000_000 };
    const result = estimateReset(hint, { now: 0, detectedAt: 0 });
    expect(result).toEqual({ resetAt: 1_700_000_000_000, source: 'exact' });
  });

  it('isoTimestamp → exact, Date.parse value', () => {
    const hint: ResetHint = { isoTimestamp: '2026-01-01T00:00:00.000Z' };
    const result = estimateReset(hint, { now: 0, detectedAt: 0 });
    expect(result).toEqual({ resetAt: Date.parse('2026-01-01T00:00:00.000Z'), source: 'exact' });
  });

  it('invalid isoTimestamp falls through to relativeHours', () => {
    const now = 1_700_000_000_000;
    const hint: ResetHint = { isoTimestamp: 'not-a-real-date', relativeHours: 5 };
    const result = estimateReset(hint, { now, detectedAt: now });
    expect(result).toEqual({ resetAt: now + 5 * MS_PER_HOUR, source: 'exact' });
  });

  it('relativeHours → exact, now + N*3_600_000', () => {
    const now = 1_700_000_000_000;
    const hint: ResetHint = { relativeHours: 3 };
    const result = estimateReset(hint, { now, detectedAt: now });
    expect(result).toEqual({ resetAt: now + 3 * MS_PER_HOUR, source: 'exact' });
  });

  describe('clockTime — UTC', () => {
    it('target later today (no wrap)', () => {
      // now = 2026-04-10T10:00:00Z, target 3pm UTC same day = 15:00Z
      const now = Date.UTC(2026, 3, 10, 10, 0, 0);
      const hint: ResetHint = { clockTime: '3pm', timezone: 'UTC' };
      const result = estimateReset(hint, { now, detectedAt: now });
      expect(result).toEqual({ resetAt: Date.UTC(2026, 3, 10, 15, 0, 0), source: 'exact' });
    });

    it('target already passed today → wraps to tomorrow', () => {
      // now = 2026-04-10T20:00:00Z, target 3pm UTC (15:00Z) already passed → next occurrence tomorrow
      const now = Date.UTC(2026, 3, 10, 20, 0, 0);
      const hint: ResetHint = { clockTime: '3pm', timezone: 'UTC' };
      const result = estimateReset(hint, { now, detectedAt: now });
      expect(result).toEqual({ resetAt: Date.UTC(2026, 3, 11, 15, 0, 0), source: 'exact' });
    });

    it('absent timezone defaults to UTC', () => {
      const now = Date.UTC(2026, 3, 10, 10, 0, 0);
      const hint: ResetHint = { clockTime: '3pm' };
      const result = estimateReset(hint, { now, detectedAt: now });
      expect(result).toEqual({ resetAt: Date.UTC(2026, 3, 10, 15, 0, 0), source: 'exact' });
    });

    it('parses "2:30pm" and "11am" wall-clock forms', () => {
      const now = Date.UTC(2026, 3, 10, 0, 0, 0);
      expect(estimateReset({ clockTime: '2:30pm', timezone: 'UTC' }, { now, detectedAt: now })).toEqual({
        resetAt: Date.UTC(2026, 3, 10, 14, 30, 0),
        source: 'exact',
      });
      expect(estimateReset({ clockTime: '11am', timezone: 'UTC' }, { now, detectedAt: now })).toEqual({
        resetAt: Date.UTC(2026, 3, 10, 11, 0, 0),
        source: 'exact',
      });
    });
  });

  describe('clockTime — IANA timezone, DST-correct', () => {
    it('3pm America/New_York in summer (EDT, UTC-4)', () => {
      // Hand-verified via Intl formatToParts (independent of estimator code): 2026-07-15T19:00:00Z
      // reads as "07/15/2026, 15:00 GMT-4" in America/New_York.
      const now = Date.UTC(2026, 6, 15, 12, 0, 0);
      const hint: ResetHint = { clockTime: '3pm', timezone: 'America/New_York' };
      const result = estimateReset(hint, { now, detectedAt: now });
      expect(result).toEqual({ resetAt: Date.UTC(2026, 6, 15, 19, 0, 0), source: 'exact' });
    });

    it('3pm America/New_York in winter (EST, UTC-5)', () => {
      // Hand-verified: 2026-01-15T20:00:00Z reads as "01/15/2026, 15:00 GMT-5" in America/New_York.
      const now = Date.UTC(2026, 0, 15, 12, 0, 0);
      const hint: ResetHint = { clockTime: '3pm', timezone: 'America/New_York' };
      const result = estimateReset(hint, { now, detectedAt: now });
      expect(result).toEqual({ resetAt: Date.UTC(2026, 0, 15, 20, 0, 0), source: 'exact' });
    });

    it('3pm Europe/Dublin in summer (IST, UTC+1)', () => {
      // Hand-verified: 2026-07-15T14:00:00Z reads as "07/15/2026, 15:00 GMT+1" in Europe/Dublin.
      const now = Date.UTC(2026, 6, 15, 10, 0, 0);
      const hint: ResetHint = { clockTime: '3pm', timezone: 'Europe/Dublin' };
      const result = estimateReset(hint, { now, detectedAt: now });
      expect(result).toEqual({ resetAt: Date.UTC(2026, 6, 15, 14, 0, 0), source: 'exact' });
    });

    it('3pm Europe/Dublin in winter (GMT, UTC+0)', () => {
      // Hand-verified: 2026-01-15T15:00:00Z reads as "01/15/2026, 15:00 GMT+0" in Europe/Dublin
      // (Dublin's IANA record flags winter as its "DST" period — net wall-clock effect is UTC+0).
      const now = Date.UTC(2026, 0, 15, 10, 0, 0);
      const hint: ResetHint = { clockTime: '3pm', timezone: 'Europe/Dublin' };
      const result = estimateReset(hint, { now, detectedAt: now });
      expect(result).toEqual({ resetAt: Date.UTC(2026, 0, 15, 15, 0, 0), source: 'exact' });
    });

    it('wrap ke besok melintasi SPRING-FORWARD tetap 3pm wall-clock (I-4/G-13, DST-correct)', () => {
      // DST New York mulai Min 8 Mar 2026 (02:00 EST→03:00 EDT; hari lokal = 23 jam). now = 3pm ET
      // 7 Mar (EST) → target hari ini sudah lewat → next occurrence = 3pm ET 8 Mar (EDT, UTC-4 → 19:00Z).
      // Hand-verified via Intl. Menambah MS_PER_DAY mentah (bug lama) → 20:00Z = 16:00 EDT (salah 1 jam).
      const now = Date.UTC(2026, 2, 7, 20, 0, 0);
      const hint: ResetHint = { clockTime: '3pm', timezone: 'America/New_York' };
      const result = estimateReset(hint, { now, detectedAt: now });
      expect(result).toEqual({ resetAt: Date.UTC(2026, 2, 8, 19, 0, 0), source: 'exact' });
    });

    it('wrap ke besok melintasi FALL-BACK tetap 3pm wall-clock (I-4/G-13, DST-correct)', () => {
      // DST New York selesai Min 1 Nov 2026 (02:00 EDT→01:00 EST; hari lokal = 25 jam). now = 3pm ET
      // 31 Okt (EDT) → next occurrence = 3pm ET 1 Nov (EST, UTC-5 → 20:00Z). Hand-verified via Intl.
      // Menambah MS_PER_DAY mentah (bug lama) → 19:00Z = 14:00 EST (salah 1 jam).
      const now = Date.UTC(2026, 9, 31, 19, 0, 0);
      const hint: ResetHint = { clockTime: '3pm', timezone: 'America/New_York' };
      const result = estimateReset(hint, { now, detectedAt: now });
      expect(result).toEqual({ resetAt: Date.UTC(2026, 10, 1, 20, 0, 0), source: 'exact' });
    });

    it('unparseable IANA timezone falls through to heuristic', () => {
      const now = 1_700_000_000_000;
      const detectedAt = now - 1_000;
      const hint: ResetHint = { clockTime: '3pm', timezone: 'Not/ARealZone' };
      const result = estimateReset(hint, { now, detectedAt, windowHint: '5h' });
      expect(result).toEqual({ resetAt: detectedAt + 5 * MS_PER_HOUR, source: 'heuristic' });
    });

    it('unparseable clockTime text falls through to backoff', () => {
      const now = 1_700_000_000_000;
      const hint: ResetHint = { clockTime: 'not a real time' };
      const result = estimateReset(hint, { now, detectedAt: now });
      expect(result).toEqual({ resetAt: now + 5 * MS_PER_MINUTE, source: 'backoff' });
    });
  });

  describe('no usable hint → heuristic window', () => {
    it("windowHint '5h' → detectedAt + 5h", () => {
      const detectedAt = 1_700_000_000_000;
      const result = estimateReset(undefined, { now: detectedAt + 1_000, detectedAt, windowHint: '5h' });
      expect(result).toEqual({ resetAt: detectedAt + 5 * MS_PER_HOUR, source: 'heuristic' });
    });

    it("windowHint '7d' → detectedAt + 7d", () => {
      const detectedAt = 1_700_000_000_000;
      const result = estimateReset(undefined, { now: detectedAt + 1_000, detectedAt, windowHint: '7d' });
      expect(result).toEqual({ resetAt: detectedAt + 7 * MS_PER_DAY, source: 'heuristic' });
    });
  });

  describe('no usable hint, no windowHint → backoff escalation', () => {
    const now = 1_700_000_000_000;

    it('attempt 0 → +5min', () => {
      const result = estimateReset(undefined, { now, detectedAt: now, attempt: 0 });
      expect(result).toEqual({ resetAt: now + 5 * MS_PER_MINUTE, source: 'backoff' });
    });

    it('attempt 1 → +15min', () => {
      const result = estimateReset(undefined, { now, detectedAt: now, attempt: 1 });
      expect(result).toEqual({ resetAt: now + 15 * MS_PER_MINUTE, source: 'backoff' });
    });

    it('attempt 2 → +60min', () => {
      const result = estimateReset(undefined, { now, detectedAt: now, attempt: 2 });
      expect(result).toEqual({ resetAt: now + 60 * MS_PER_MINUTE, source: 'backoff' });
    });

    it('attempt 3 → capped at +60min', () => {
      const result = estimateReset(undefined, { now, detectedAt: now, attempt: 3 });
      expect(result).toEqual({ resetAt: now + 60 * MS_PER_MINUTE, source: 'backoff' });
    });

    it('attempt 10 → still capped at +60min', () => {
      const result = estimateReset(undefined, { now, detectedAt: now, attempt: 10 });
      expect(result).toEqual({ resetAt: now + 60 * MS_PER_MINUTE, source: 'backoff' });
    });

    it('attempt omitted → defaults to 0 (+5min)', () => {
      const result = estimateReset(undefined, { now, detectedAt: now });
      expect(result).toEqual({ resetAt: now + 5 * MS_PER_MINUTE, source: 'backoff' });
    });
  });
});
