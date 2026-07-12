// I-23 — dispatch kanal DATA hook CC (sisi-wrapper). StopFailure → feedStopFailure; SessionStart →
// captureCcSessionId (latched sekali). Injection firewall: bentuk tak dikenal / teks bebas → no-op.

import { describe, expect, it, vi } from 'vitest';
import { createHookHandler } from '../src/daemon/hook-relay.js';

function makeHandler() {
  const feedStopFailure = vi.fn<(error: string) => void>();
  const captureCcSessionId = vi.fn<(id: string) => void>();
  const handler = createHookHandler({ feedStopFailure, captureCcSessionId });
  return { handler, feedStopFailure, captureCcSessionId };
}

describe('createHookHandler', () => {
  it('feeds StopFailure error to the limit-watcher relay (classification happens downstream)', () => {
    const { handler, feedStopFailure, captureCcSessionId } = makeHandler();

    expect(handler({ event: 'StopFailure', error: 'rate_limit' })).toEqual({ ok: true });

    expect(feedStopFailure).toHaveBeenCalledExactlyOnceWith('rate_limit');
    expect(captureCcSessionId).not.toHaveBeenCalled();
  });

  it('relays every StopFailure error value verbatim (relay is dumb; classify decides)', () => {
    const { handler, feedStopFailure } = makeHandler();

    // overloaded / model_not_found juga diteruskan — `classify` yang memutuskan bukan-limit.
    handler({ event: 'StopFailure', error: 'overloaded' });
    handler({ event: 'StopFailure', error: 'model_not_found' });

    expect(feedStopFailure).toHaveBeenNthCalledWith(1, 'overloaded');
    expect(feedStopFailure).toHaveBeenNthCalledWith(2, 'model_not_found');
  });

  it('captures the CC cli_session_id from SessionStart exactly once (latched across repeats)', () => {
    const { handler, captureCcSessionId, feedStopFailure } = makeHandler();

    handler({ event: 'SessionStart', ccSessionId: 'uuid-abc' });
    // SessionStart fire lagi di resume/compact (id sama) → di-latch, tak menulis ulang.
    handler({ event: 'SessionStart', ccSessionId: 'uuid-abc' });
    handler({ event: 'SessionStart', ccSessionId: 'uuid-different' });

    expect(captureCcSessionId).toHaveBeenCalledExactlyOnceWith('uuid-abc');
    expect(feedStopFailure).not.toHaveBeenCalled();
  });

  it('ignores malformed / unknown payloads without throwing (firewall: no action from junk)', () => {
    const { handler, feedStopFailure, captureCcSessionId } = makeHandler();

    // Bentuk yang harus jadi no-op — tak boleh melempar, tak boleh memicu aksi apa pun.
    for (const bad of [
      undefined,
      null,
      {},
      { event: 'PreToolUse', tool_input: { command: 'rm -rf /' } }, // event lain (mis. injection attempt)
      { event: 'StopFailure' }, // tanpa error
      { event: 'StopFailure', error: 123 }, // error bukan string
      { event: 'SessionStart' }, // tanpa ccSessionId
      { event: 'SessionStart', ccSessionId: '' }, // ccSessionId kosong
      { event: 'SessionStart', ccSessionId: 42 }, // ccSessionId bukan string
    ]) {
      expect(handler(bad)).toEqual({ ok: true });
    }

    expect(feedStopFailure).not.toHaveBeenCalled();
    expect(captureCcSessionId).not.toHaveBeenCalled();
  });
});
