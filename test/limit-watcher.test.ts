import { describe, expect, it } from 'vitest';
import { createLimitWatcher } from '../src/daemon/limit-watcher.js';
import type { DetectionResult } from '../src/adapters/types.js';
import type { Tool } from '../src/shared/types.js';

function makeCounter(tool: Tool) {
  let calls = 0;
  let lastResult: DetectionResult | undefined;
  const watcher = createLimitWatcher({
    tool,
    onLimit: (result) => {
      calls += 1;
      lastResult = result;
    },
  });
  return {
    watcher,
    getCalls: () => calls,
    getLastResult: () => lastResult,
  };
}

describe('createLimitWatcher — feedOutput', () => {
  it('CC limit line with trailing newline fires onLimit once', () => {
    const { watcher, getCalls, getLastResult } = makeCounter('claude');
    watcher.feedOutput("You've hit your session limit · resets 7:30am (Asia/Jakarta)\n");
    expect(getCalls()).toBe(1);
    expect(getLastResult()?.kind).toBe('limit');
    expect(getLastResult()?.evidence).toBeDefined();
  });

  it('agy real quota-reached message fires onLimit once', () => {
    const { watcher, getCalls, getLastResult } = makeCounter('antigravity');
    watcher.feedOutput(
      '⚠ Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 59m14s.\n',
    );
    expect(getCalls()).toBe(1);
    expect(getLastResult()?.kind).toBe('limit');
  });

  it('chunk split across a line only fires after the newline completes it', () => {
    const { watcher, getCalls } = makeCounter('claude');
    watcher.feedOutput("You've hit your ");
    expect(getCalls()).toBe(0);
    watcher.feedOutput('session limit\n');
    expect(getCalls()).toBe(1);
  });

  it('no newline yet → not fired; newline arrives later → fired', () => {
    const { watcher, getCalls } = makeCounter('claude');
    watcher.feedOutput("You've hit your session limit");
    expect(getCalls()).toBe(0);
    watcher.feedOutput('\n');
    expect(getCalls()).toBe(1);
  });

  it('ANSI-wrapped limit line still fires (proves ANSI stripping)', () => {
    const { watcher, getCalls } = makeCounter('claude');
    watcher.feedOutput("\x1b[31mYou've hit your session limit\x1b[0m\n");
    expect(getCalls()).toBe(1);
  });

  it('overload line does NOT fire onLimit', () => {
    const { watcher, getCalls } = makeCounter('claude');
    watcher.feedOutput('API Error: 529\n');
    expect(getCalls()).toBe(0);
  });

  it('benign noise line does NOT fire onLimit', () => {
    const { watcher, getCalls } = makeCounter('claude');
    watcher.feedOutput('Compiling project... done\n');
    expect(getCalls()).toBe(0);
  });

  it('two limit lines in one chunk → onLimit fires exactly once (latch)', () => {
    const { watcher, getCalls } = makeCounter('claude');
    watcher.feedOutput('usage limit reached\nusage limit reached\n');
    expect(getCalls()).toBe(1);
  });
});

describe('createLimitWatcher — feedSignal', () => {
  it('stopfailure rate_limit fires once; a second rate_limit signal does not fire again', () => {
    const { watcher, getCalls } = makeCounter('claude');
    watcher.feedSignal({ type: 'stopfailure', error: 'rate_limit' });
    expect(getCalls()).toBe(1);
    watcher.feedSignal({ type: 'stopfailure', error: 'rate_limit' });
    expect(getCalls()).toBe(1);
  });

  it('stopfailure overloaded on a fresh watcher does not fire', () => {
    const { watcher, getCalls } = makeCounter('claude');
    watcher.feedSignal({ type: 'stopfailure', error: 'overloaded' });
    expect(getCalls()).toBe(0);
  });
});
