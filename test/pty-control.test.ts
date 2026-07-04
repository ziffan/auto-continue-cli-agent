import { describe, expect, it, vi } from 'vitest';
import { checkInjectGating, injectToPty, PtyControlError } from '../src/shared/pty-control.js';

describe('checkInjectGating', () => {
  it('blocks with proc_not_alive when the process is not alive', () => {
    expect(checkInjectGating({ procAlive: false })).toBe('proc_not_alive');
  });

  it('blocks with invalid_pty_fd when ptyFd is undefined', () => {
    expect(checkInjectGating({ procAlive: true, ptyFd: undefined })).toBe('invalid_pty_fd');
  });

  it('blocks with invalid_pty_fd when ptyFd is <= 0', () => {
    expect(checkInjectGating({ procAlive: true, ptyFd: 0 })).toBe('invalid_pty_fd');
    expect(checkInjectGating({ procAlive: true, ptyFd: -1 })).toBe('invalid_pty_fd');
  });

  it('blocks with foreground_not_agent only when explicitly false', () => {
    expect(checkInjectGating({ procAlive: true, ptyFd: 5, foregroundIsAgent: false })).toBe('foreground_not_agent');
  });

  it('blocks with proc_not_idle only when explicitly false', () => {
    expect(checkInjectGating({ procAlive: true, ptyFd: 5, foregroundIsAgent: true, idle: false })).toBe('proc_not_idle');
  });

  it('returns null (OK) when all checks pass', () => {
    expect(checkInjectGating({ procAlive: true, ptyFd: 5, foregroundIsAgent: true, idle: true })).toBeNull();
  });

  it('does NOT block when foregroundIsAgent/idle are undefined (unknown != false)', () => {
    expect(checkInjectGating({ procAlive: true, ptyFd: 5 })).toBeNull();
    expect(checkInjectGating({ procAlive: true, ptyFd: 5, foregroundIsAgent: undefined, idle: undefined })).toBeNull();
  });
});

describe('injectToPty', () => {
  it('loops until the full buffer is written when writeImpl returns partial writes', () => {
    const calls: Array<{ offset: number; length: number }> = [];
    const writeImpl = vi.fn((_fd: number, buf: Buffer | Uint8Array, offset?: number) => {
      const off = offset ?? 0;
      const remaining = buf.length - off;
      calls.push({ offset: off, length: remaining });
      // First call writes 3 bytes, then the rest.
      return calls.length === 1 ? Math.min(3, remaining) : remaining;
    }) as unknown as typeof import('node:fs').writeSync;

    injectToPty(7, 'continue\n', writeImpl);

    expect(writeImpl).toHaveBeenCalledTimes(2);
    expect(calls[0]).toEqual({ offset: 0, length: Buffer.from('continue\n', 'utf-8').length });
    expect(calls[1]?.offset).toBe(3);
  });

  it('writes the full buffer in one call when writeImpl returns full length immediately', () => {
    const writeImpl = vi.fn((_fd: number, buf: Buffer | Uint8Array) => buf.length) as unknown as typeof import('node:fs').writeSync;
    injectToPty(7, 'continue\n', writeImpl);
    expect(writeImpl).toHaveBeenCalledTimes(1);
  });

  it('wraps a throwing writeImpl in PtyControlError', () => {
    const writeImpl = vi.fn(() => {
      throw new Error('EBADF: bad file descriptor');
    }) as unknown as typeof import('node:fs').writeSync;
    expect(() => injectToPty(7, 'continue\n', writeImpl)).toThrow(PtyControlError);
  });
});
