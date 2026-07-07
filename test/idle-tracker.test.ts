// Gating inject-continue poin (iii) ADR-014 — idle bukan mid-turn (I-13).

import { describe, expect, it } from 'vitest';
import { createIdleTracker } from '../src/shared/idle-tracker.js';

/** Clock yang dikontrol test supaya jendela sunyi deterministik. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('createIdleTracker (claude)', () => {
  it('is idle before any output (session sits at prompt, e.g. at limit-hit)', () => {
    const tracker = createIdleTracker({ tool: 'claude' });
    expect(tracker.isIdle()).toBe(true);
  });

  it('is NOT idle right after seeing the busy footer', () => {
    const clk = fakeClock();
    const tracker = createIdleTracker({ tool: 'claude', now: clk.now, quietMs: 1000 });

    tracker.feed('… thinking (esc to interrupt)');
    expect(tracker.isIdle()).toBe(false);

    clk.advance(500); // masih dalam jendela sunyi
    expect(tracker.isIdle()).toBe(false);
  });

  it('becomes idle again once the quiet window elapses with no busy marker', () => {
    const clk = fakeClock();
    const tracker = createIdleTracker({ tool: 'claude', now: clk.now, quietMs: 1000 });

    tracker.feed('esc to interrupt');
    clk.advance(1000); // >= quietMs
    expect(tracker.isIdle()).toBe(true);
  });

  it('detects the busy marker even when wrapped in ANSI escapes (G-20)', () => {
    const clk = fakeClock();
    const tracker = createIdleTracker({ tool: 'claude', now: clk.now, quietMs: 1000 });

    tracker.feed('\x1b[2m\x1b[36mesc to interrupt\x1b[0m');
    expect(tracker.isIdle()).toBe(false);
  });

  it('detects a busy marker split across two feeds (carry-over)', () => {
    const clk = fakeClock();
    const tracker = createIdleTracker({ tool: 'claude', now: clk.now, quietMs: 1000 });

    tracker.feed('spinner… esc to ');
    tracker.feed('interrupt · Retrying');
    expect(tracker.isIdle()).toBe(false);
  });

  it('re-arms busy on a fresh marker after having gone idle', () => {
    const clk = fakeClock();
    const tracker = createIdleTracker({ tool: 'claude', now: clk.now, quietMs: 1000 });

    tracker.feed('esc to interrupt');
    clk.advance(2000);
    expect(tracker.isIdle()).toBe(true); // sudah idle

    tracker.feed('esc to interrupt'); // turn baru mulai
    expect(tracker.isIdle()).toBe(false);
  });
});

describe('createIdleTracker (antigravity — busy marker not yet verified, I-15)', () => {
  it('returns undefined (unknown, does not block) since no busy marker is configured', () => {
    const tracker = createIdleTracker({ tool: 'antigravity' });
    expect(tracker.isIdle()).toBeUndefined();

    tracker.feed('esc to interrupt'); // feed diabaikan untuk tool tanpa penanda
    expect(tracker.isIdle()).toBeUndefined();
  });
});
