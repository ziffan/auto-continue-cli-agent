import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DaemonNotRunningError, sendCommand } from '../src/daemon/ipc-client.js';
import { createIpcServer, type IpcServerHandle } from '../src/daemon/ipc-server.js';

/** Path socket/pipe unik per test — hindari bentrok antar-run dan lintas-platform. */
function uniqueSocketPath(): string {
  const rand = randomBytes(4).toString('hex');
  return process.platform === 'win32' ? `\\\\.\\pipe\\acca-test-${rand}` : join(tmpdir(), `acca-test-${rand}.sock`);
}

describe('ipc integration (server + client over a real socket/pipe)', () => {
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

  it(
    'round-trips ping/status, rejects unknown commands, and rejects after close',
    async () => {
      socketPath = uniqueSocketPath();
      server = createIpcServer({
        ping: () => ({ pong: true }),
        status: () => [{ id: 'x' }],
      });
      await server.listen(socketPath);

      const pingResult = await sendCommand(socketPath, 'ping');
      expect(pingResult).toEqual({ pong: true });

      const statusResult = await sendCommand(socketPath, 'status');
      expect(statusResult).toEqual([{ id: 'x' }]);

      await expect(sendCommand(socketPath, 'nope', undefined, { timeoutMs: 2000 })).rejects.toThrow(
        /unknown command: nope/,
      );

      await server.close();
      server = undefined;

      await expect(sendCommand(socketPath, 'ping', undefined, { timeoutMs: 2000 })).rejects.toBeInstanceOf(
        DaemonNotRunningError,
      );
    },
    10_000,
  );

  it('a throwing handler yields an ok:false response, not a dropped connection', async () => {
    socketPath = uniqueSocketPath();
    server = createIpcServer({
      boom: () => {
        throw new Error('handler kaboom');
      },
    });
    await server.listen(socketPath);

    await expect(sendCommand(socketPath, 'boom', undefined, { timeoutMs: 2000 })).rejects.toThrow(/kaboom/);

    // Koneksi/server tetap hidup setelah handler yang gagal — perintah berikutnya masih terlayani.
    await expect(sendCommand(socketPath, 'boom', undefined, { timeoutMs: 2000 })).rejects.toThrow(/kaboom/);
  }, 10_000);

  it('rejects a second server binding the same socket (single-instance, ADR-002)', async () => {
    socketPath = uniqueSocketPath();
    server = createIpcServer({ ping: () => ({ pong: true }) });
    await server.listen(socketPath);

    // Instance kedua di path yang sama harus GAGAL bind (EADDRINUSE) — bukan diam-diam
    // men-steal socket. (Windows named pipe: EADDRINUSE = pipe masih dipegang instance pertama;
    // POSIX: probe connect → ada yang jawab → propagate. Jalur stale-unlink POSIX = logic-only,
    // tak teruji di mesin Windows ini — lihat catatan tier-review.) `second` tak pernah listen
    // → tak butuh cleanup.
    const second = createIpcServer({ ping: () => ({ pong: true }) });
    await expect(second.listen(socketPath)).rejects.toMatchObject({ code: 'EADDRINUSE' });

    // Instance pertama tetap melayani setelah percobaan bind kedua yang ditolak.
    await expect(sendCommand(socketPath, 'ping', undefined, { timeoutMs: 2000 })).resolves.toEqual({ pong: true });
  }, 10_000);
});
