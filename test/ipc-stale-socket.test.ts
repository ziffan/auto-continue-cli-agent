// Recovery socket STALE POSIX (G-14 / I-5): daemon lama mati keras (SIGKILL) meninggalkan FILE
// socket unix di disk tanpa listener. `listen()` harus: EADDRINUSE → probe `connect` → ECONNREFUSED
// (tak ada yang jawab) → unlink → retry listen → sukses. Ini kebalikan dari jalur "daemon hidup →
// reject" (single-instance) yang sudah diuji di `ipc.integration.test.ts`.
//
// Genuinely POSIX-only: named pipe Windows hilang otomatis saat owner mati → socket stale tak mungkin
// ada di sana (G-14). Skip di win32.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sendCommand } from '../src/daemon/ipc-client.js';
import { createIpcServer } from '../src/daemon/ipc-server.js';

const describePosix = process.platform === 'win32' ? describe.skip : describe;

/** Anak node yang bind unix socket lalu tulis "READY" — sengaja tak pasang cleanup, jadi SIGKILL
 *  meninggalkan file socket sebagai STALE (persis kegagalan daemon crash G-14). */
const CHILD_SCRIPT =
  "import net from 'node:net'; const p=process.argv[1]; net.createServer(()=>{}).listen(p,()=>process.stdout.write('READY\\n'));";

describePosix('ipc stale-socket recovery (POSIX, G-14/I-5)', () => {
  it('unlinks a dead listener\'s stale socket and binds successfully', async () => {
    const socketPath = join(tmpdir(), `acca-stale-${randomBytes(4).toString('hex')}.sock`);

    // 1. Spawn child yang listen di socketPath; tunggu READY.
    const child = spawn(process.execPath, ['--input-type=module', '-e', CHILD_SCRIPT, socketPath], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('child listener never became READY')), 5000);
      child.stdout.on('data', (b: Buffer) => {
        if (b.toString().includes('READY')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    expect(existsSync(socketPath)).toBe(true);

    // 2. SIGKILL → tak ada cleanup → file socket tertinggal (stale).
    const childExited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGKILL');
    await childExited;
    expect(existsSync(socketPath)).toBe(true); // stale masih ada; connect ke sini = ECONNREFUSED

    // 3. Server kita harus PULIH: EADDRINUSE → probe ECONNREFUSED → unlink → retry → bind sukses.
    const server = createIpcServer({ ping: () => ({ pong: true }) });
    await server.listen(socketPath); // reject bila jalur stale tak ditangani

    try {
      await expect(sendCommand(socketPath, 'ping', undefined, { timeoutMs: 2000 })).resolves.toEqual({ pong: true });
    } finally {
      await server.close();
      rmSync(socketPath, { force: true });
    }
  }, 15_000);

  it('does NOT unlink or steal a socket held by a LIVE listener (single-instance holds)', async () => {
    // Kontras dengan kasus stale: bila listener MASIH HIDUP, probe connect sukses → reject (jangan
    // unlink). Ini memastikan pembeda stale-vs-hidup benar di POSIX nyata (bukan cuma Windows pipe).
    const socketPath = join(tmpdir(), `acca-live-${randomBytes(4).toString('hex')}.sock`);
    const child = spawn(process.execPath, ['--input-type=module', '-e', CHILD_SCRIPT, socketPath], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('child listener never became READY')), 5000);
      child.stdout.on('data', (b: Buffer) => {
        if (b.toString().includes('READY')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const second = createIpcServer({ ping: () => ({ pong: true }) });
    try {
      await expect(second.listen(socketPath)).rejects.toMatchObject({ code: 'EADDRINUSE' });
      // Listener hidup TIDAK diganggu → socket masih ada.
      expect(existsSync(socketPath)).toBe(true);
    } finally {
      const childExited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGKILL');
      await childExited;
      rmSync(socketPath, { force: true });
    }
  }, 15_000);
});
