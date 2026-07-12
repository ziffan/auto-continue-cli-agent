// I-23 — pembangun settings.json hook CC (murni) + capability adapter `supervisorHooks`.

import { describe, expect, it } from 'vitest';
import {
  SESSIONSTART_MATCHER,
  STOPFAILURE_MATCHER,
  buildClaudeHookSettings,
} from '../src/adapters/claude-hooks.js';
import { claudeAdapter } from '../src/adapters/claude.js';
import { antigravityAdapter } from '../src/adapters/antigravity.js';
import type { HookForwarderSpec } from '../src/adapters/types.js';

const forwarder: HookForwarderSpec = {
  command: '/usr/bin/node',
  args: ['/opt/acca/dist/cli/index.js', '__hook', 'ab12'],
};

describe('buildClaudeHookSettings', () => {
  it('nests StopFailure + SessionStart under hooks with exec-form command entries', () => {
    const settings = buildClaudeHookSettings(forwarder) as {
      hooks: {
        StopFailure: { matcher: string; hooks: { type: string; command: string; args: string[] }[] }[];
        SessionStart: { matcher: string; hooks: { type: string; command: string; args: string[] }[] }[];
      };
    };

    expect(settings.hooks.StopFailure[0]?.matcher).toBe(STOPFAILURE_MATCHER);
    expect(settings.hooks.SessionStart[0]?.matcher).toBe(SESSIONSTART_MATCHER);

    // Exec-form (command + args terpisah) → tak ada shell-quoting; forwarder yang sama dipakai keduanya.
    const entry = settings.hooks.StopFailure[0]?.hooks[0];
    expect(entry).toEqual({ type: 'command', command: forwarder.command, args: forwarder.args });
    expect(settings.hooks.SessionStart[0]?.hooks[0]).toEqual(entry);
  });

  it('targets rate_limit (primer) in the StopFailure matcher, only startup|resume for SessionStart', () => {
    // Matcher = set exact-match join "|" (CC menolak koma/hyphen — RESEARCH §2c).
    expect(STOPFAILURE_MATCHER.split('|')).toContain('rate_limit');
    expect(SESSIONSTART_MATCHER.split('|').sort()).toEqual(['resume', 'startup']);
    expect(/^[A-Za-z0-9_|]+$/.test(STOPFAILURE_MATCHER)).toBe(true);
    expect(/^[A-Za-z0-9_|]+$/.test(SESSIONSTART_MATCHER)).toBe(true);
  });
});

describe('claudeAdapter.supervisorHooks', () => {
  it('returns valid settings JSON + prepends --settings <path>', () => {
    const plan = claudeAdapter.supervisorHooks?.({
      sessionId: 'ab12',
      forwarder,
      settingsPath: '/data/acca/session-ab12-hooks.json',
    });

    expect(plan).toBeDefined();
    expect(plan?.extraArgs).toEqual(['--settings', '/data/acca/session-ab12-hooks.json']);
    // settingsContent = JSON valid yang bisa CC baca.
    const parsed = JSON.parse(plan?.settingsContent ?? '') as { hooks: Record<string, unknown> };
    expect(parsed.hooks).toHaveProperty('StopFailure');
    expect(parsed.hooks).toHaveProperty('SessionStart');
  });
});

describe('antigravityAdapter', () => {
  it('does NOT support supervisor hooks (no StopFailure/SessionStart mechanism)', () => {
    expect(Object.hasOwn(antigravityAdapter, 'supervisorHooks')).toBe(false);
  });
});
