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

    const idA = 'fd55a7d2-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
    const idB = '00000000-1111-4222-8333-444444444444';
    handler({ event: 'SessionStart', ccSessionId: idA });
    // SessionStart fire lagi di resume/compact (id sama) → di-latch, tak menulis ulang.
    handler({ event: 'SessionStart', ccSessionId: idA });
    handler({ event: 'SessionStart', ccSessionId: idB });

    expect(captureCcSessionId).toHaveBeenCalledExactlyOnceWith(idA);
    expect(feedStopFailure).not.toHaveBeenCalled();
  });

  it('rejects a non-canonical-UUID ccSessionId (C-2: keeps arbitrary strings out of `--resume` argv)', () => {
    const { handler, captureCcSessionId } = makeHandler();

    // Payload hook nyata CC selalu UUID (G-34); nilai lain hanya bisa datang dari penulis socket kontrol
    // yang tak sah (named pipe Windows ber-ACL terbuka, I-26). Non-UUID → no-op senyap, bukan disimpan.
    for (const bad of ['uuid-abc', 'not-a-uuid', '--resume', '../../etc', '42', 'fd55a7d2']) {
      expect(handler({ event: 'SessionStart', ccSessionId: bad })).toEqual({ ok: true });
    }
    expect(captureCcSessionId).not.toHaveBeenCalled();

    // Setelah semua sampah ditolak, latch belum terpakai → UUID sah pertama TETAP tertangkap.
    const good = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    handler({ event: 'SessionStart', ccSessionId: good });
    expect(captureCcSessionId).toHaveBeenCalledExactlyOnceWith(good);
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
