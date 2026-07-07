// I-10: `notifyDaemonRearm` = glue wrapper `acca run` → daemon hidup. Best-effort & non-fatal:
// tak ada daemon → resolve senyap; ada daemon → kirim perintah `rearm` (tanpa payload).

import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIpcServer, type IpcServerHandle } from '../src/daemon/ipc-server.js';
import { notifyDaemonRearm } from '../src/daemon/process-wrapper.js';

function uniqueSocketPath(): string {
  const rand = randomBytes(4).toString('hex');
  return process.platform === 'win32' ? `\\\\.\\pipe\\acca-rearm-${rand}` : join(tmpdir(), `acca-rearm-${rand}.sock`);
}

describe('notifyDaemonRearm (I-10)', () => {
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

  it('sends the `rearm` command (no payload) to a live daemon', async () => {
    socketPath = uniqueSocketPath();
    const rearm = vi.fn((args: unknown) => {
      // Injection firewall selaras dengan inject-continue: perintah re-arm TAK membawa payload aksi.
      expect(args).toBeUndefined();
      return { rearmed: true };
    });
    server = createIpcServer({ rearm });
    await server.listen(socketPath);

    await notifyDaemonRearm(socketPath);
    expect(rearm).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('resolves silently when no daemon is listening (best-effort, non-fatal)', async () => {
    // Path tanpa server → connect gagal (ECONNREFUSED/ENOENT) → helper TAK melempar.
    const dead = uniqueSocketPath();
    await expect(notifyDaemonRearm(dead)).resolves.toBeUndefined();
  }, 10_000);
});
