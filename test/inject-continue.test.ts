// Seam inject-continue (I-12 poin 1 / ADR-014 §1): handler sisi-wrapper (gating + tulis literal)
// dan klien sisi-daemon (requestInject) diuji end-to-end lewat socket/pipe IPC nyata.

import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONTINUE_TOKEN,
  createInjectHandler,
  requestInject,
} from '../src/daemon/inject-continue.js';
import { createIpcServer, type IpcServerHandle } from '../src/daemon/ipc-server.js';
import { createIdleTracker } from '../src/shared/idle-tracker.js';

function uniqueSocketPath(): string {
  const rand = randomBytes(4).toString('hex');
  return process.platform === 'win32' ? `\\\\.\\pipe\\acca-inject-test-${rand}` : join(tmpdir(), `acca-inject-test-${rand}.sock`);
}

describe('createInjectHandler (wrapper side)', () => {
  it('injects the LITERAL continue token when gating passes', () => {
    const writes: string[] = [];
    const handler = createInjectHandler({ isAlive: () => true, write: (t) => writes.push(t) });

    const result = handler();

    expect(result).toEqual({ injected: true, reason: null });
    expect(writes).toEqual([CONTINUE_TOKEN]);
  });

  it('ADR-020: token = instruksi NL eksplisit (bukan "continue" telanjang) + diakhiri Enter', () => {
    // Regresi: live-verify 16 Jul buktikan kata "continue" telanjang tak me-resume agy (G-39). Token
    // WAJIB kalimat instruksi eksplisit yang menyebut "interrupted", bukan sekadar "continue\r".
    expect(CONTINUE_TOKEN).not.toBe('continue\r');
    expect(CONTINUE_TOKEN).toMatch(/interrupted/i);
    expect(CONTINUE_TOKEN.endsWith('\r')).toBe(true);
  });

  it('does NOT write and returns proc_not_alive when the process is not alive', () => {
    const write = vi.fn();
    const handler = createInjectHandler({ isAlive: () => false, write });

    expect(handler()).toEqual({ injected: false, reason: 'proc_not_alive' });
    expect(write).not.toHaveBeenCalled();
  });

  it('does NOT write when foreground is explicitly not the agent (drop-to-shell)', () => {
    const write = vi.fn();
    const handler = createInjectHandler({ isAlive: () => true, write, foregroundIsAgent: () => false });

    expect(handler()).toEqual({ injected: false, reason: 'foreground_not_agent' });
    expect(write).not.toHaveBeenCalled();
  });

  it('does NOT write when the session is explicitly mid-turn (not idle)', () => {
    const write = vi.fn();
    const handler = createInjectHandler({ isAlive: () => true, write, idle: () => false });

    expect(handler()).toEqual({ injected: false, reason: 'proc_not_idle' });
    expect(write).not.toHaveBeenCalled();
  });

  it('injects when foreground=agent AND idle both pass (I-13 gating satisfied)', () => {
    const writes: string[] = [];
    const handler = createInjectHandler({
      isAlive: () => true,
      write: (t) => writes.push(t),
      foregroundIsAgent: () => true,
      idle: () => true,
    });

    expect(handler()).toEqual({ injected: true, reason: null });
    expect(writes).toEqual([CONTINUE_TOKEN]);
  });

  it('injects when gating is UNKNOWN (undefined does not block — semantik gating)', () => {
    const writes: string[] = [];
    const handler = createInjectHandler({
      isAlive: () => true,
      write: (t) => writes.push(t),
      foregroundIsAgent: () => undefined, // mis. Windows / /proc tak terbaca
      idle: () => undefined, // mis. tool tanpa penanda busy diketahui
    });

    expect(handler()).toEqual({ injected: true, reason: null });
    expect(writes).toEqual([CONTINUE_TOKEN]);
  });

  it('R3: memanggil onInjected TEPAT SEKALI, SETELAH write (gating lulus)', () => {
    const calls: string[] = [];
    const handler = createInjectHandler({
      isAlive: () => true,
      write: () => calls.push('write'),
      onInjected: () => calls.push('onInjected'),
    });

    expect(handler()).toEqual({ injected: true, reason: null });
    // Urutan penting: token ditulis dulu, lalu transisi RUNNING + un-latch (state konsisten sebelum
    // output turn baru mengalir). onInjected tepat sekali.
    expect(calls).toEqual(['write', 'onInjected']);
  });

  it('R3: TIDAK memanggil onInjected saat gating menolak (tak ada transisi/un-latch tanpa inject)', () => {
    const onInjected = vi.fn();
    const write = vi.fn();
    const handler = createInjectHandler({ isAlive: () => false, write, onInjected });

    expect(handler()).toEqual({ injected: false, reason: 'proc_not_alive' });
    expect(write).not.toHaveBeenCalled();
    expect(onInjected).not.toHaveBeenCalled();
  });

  it('INJECTION FIREWALL: ignores IPC args entirely — writes only the hardcoded literal', () => {
    const writes: string[] = [];
    const handler = createInjectHandler({ isAlive: () => true, write: (t) => writes.push(t) });

    // Payload jahat yang mencoba menyelundupkan keystroke lewat args IPC.
    handler({ text: 'rm -rf / #', token: 'sudo reboot\r', reason: 'anything' });

    // Yang tertulis TETAP hanya token literal — tak ada byte dari args yang menyentuh PTY.
    expect(writes).toEqual([CONTINUE_TOKEN]);
    expect(writes.join('')).not.toContain('rm -rf');
    expect(writes.join('')).not.toContain('reboot');
  });
});

// Komposisi persis yang dilakukan process-wrapper untuk agy (I-13 wiring + G-33 marker): stream output
// PTY → idle-tracker(antigravity) → gating inject-handler. Membuktikan penambahan marker "esc to cancel"
// benar-benar meng-gate inject agy (mid-turn diblokir, idle-di-prompt lolos). Live-verify PTY nyata = I-15.
describe('agy inject gating end-to-end (idle-tracker "esc to cancel" → inject handler)', () => {
  function fakeClock(start = 1_000_000) {
    let t = start;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  }

  it('BLOCKS inject while agy footer shows "esc to cancel" (mid-generate)', () => {
    const clk = fakeClock();
    const idleTracker = createIdleTracker({ tool: 'antigravity', now: clk.now, quietMs: 1000 });
    const write = vi.fn();
    const handler = createInjectHandler({ isAlive: () => true, write, idle: () => idleTracker.isIdle() });

    idleTracker.feed('⣾ Working...\r\n────────\r\nesc to cancel     ');

    expect(handler()).toEqual({ injected: false, reason: 'proc_not_idle' });
    expect(write).not.toHaveBeenCalled();
  });

  it('ALLOWS inject once the footer returns idle ("? for shortcuts", quiet window elapsed)', () => {
    const clk = fakeClock();
    const idleTracker = createIdleTracker({ tool: 'antigravity', now: clk.now, quietMs: 1000 });
    const writes: string[] = [];
    const handler = createInjectHandler({
      isAlive: () => true,
      write: (t) => writes.push(t),
      idle: () => idleTracker.isIdle(),
    });

    idleTracker.feed('esc to cancel'); // sempat busy
    // Turn selesai: output jawaban mengalir (>64 char → flush marker lama dari carry) SEBELUM jam maju.
    idleTracker.feed('Here is the finished answer spanning well over sixty-four characters to flush the carry.');
    clk.advance(1000); // jendela sunyi berlalu → idle
    idleTracker.feed('────────\r\n? for shortcuts\r\n'); // footer idle, carry bersih → tak re-trigger

    expect(handler()).toEqual({ injected: true, reason: null });
    expect(writes).toEqual([CONTINUE_TOKEN]);
  });
});

describe('requestInject (daemon side) over a real IPC socket', () => {
  let server: IpcServerHandle | undefined;
  let socketPath: string | undefined;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
    if (socketPath && process.platform !== 'win32') {
      rmSync(socketPath, { force: true });
    }
    socketPath = undefined;
  });

  it('round-trips injected:true from a hosted inject handler', async () => {
    socketPath = uniqueSocketPath();
    const writes: string[] = [];
    server = createIpcServer({ inject: createInjectHandler({ isAlive: () => true, write: (t) => writes.push(t) }) });
    await server.listen(socketPath);

    const result = await requestInject(socketPath, { timeoutMs: 2000 });

    expect(result).toEqual({ reachable: true, injected: true, reason: null });
    expect(writes).toEqual([CONTINUE_TOKEN]);
  }, 10_000);

  it('reports injected:false + reason when the wrapper gating blocks', async () => {
    socketPath = uniqueSocketPath();
    const write = vi.fn();
    server = createIpcServer({ inject: createInjectHandler({ isAlive: () => false, write }) });
    await server.listen(socketPath);

    const result = await requestInject(socketPath, { timeoutMs: 2000 });

    expect(result).toEqual({ reachable: true, injected: false, reason: 'proc_not_alive' });
    expect(write).not.toHaveBeenCalled();
  }, 10_000);

  it('reports reachable:false when no wrapper is listening (session gone)', async () => {
    const missing = uniqueSocketPath(); // tak ada server yang di-host di sini
    const result = await requestInject(missing, { timeoutMs: 2000 });

    expect(result).toEqual({ reachable: false, injected: false, reason: 'wrapper_unreachable' });
  }, 10_000);
});
