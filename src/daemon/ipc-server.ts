// Server IPC daemon (ADR-015): Node `net` socket (Unix domain socket Linux/macOS ↔ named pipe
// Windows lewat satu API), framing NDJSON. Tak ada TCP/port.

import { chmodSync, unlinkSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { createLineDecoder, encodeLine } from './ipc-protocol.js';
import type { IpcRequest, IpcResponse } from './ipc-protocol.js';

// Return type = `unknown` (sync ATAU `Promise<unknown>` — keduanya sudah tercakup `unknown`,
// `await` bekerja pada dua-duanya) — dipanggil lewat `await handler(args)` di bawah.
export type IpcHandler = (args: unknown) => unknown;

export interface IpcServerHandle {
  listen(socketPath: string): Promise<void>;
  close(): Promise<void>;
}

/** `unlinkSync` yang mengabaikan ENOENT (file/socket memang belum ada — bukan error). */
function unlinkIgnoreMissing(path: string): void {
  try {
    unlinkSync(path);
  } catch (err) {
    // Pola sama seperti `shared/proc.ts`: cast tipis ke bentuk `{code?}`, hindari referensi
    // namespace ambient `NodeJS` (eslint no-undef tak mengenalinya di file TS ini).
    if ((err as { code?: string }).code !== 'ENOENT') throw err;
  }
}

/** Tangani satu baris request lengkap: parse → dispatch handler → tulis balasan. Tak pernah
 * melempar ke pemanggil — kegagalan apa pun (parse/handler) jadi `IpcResponse` `ok:false`
 * best-effort, supaya satu request buruk tak pernah membunuh koneksi/proses. */
async function handleRequestLine(line: string, handlers: Record<string, IpcHandler>, socket: Socket): Promise<void> {
  let req: IpcRequest;
  try {
    req = JSON.parse(line) as IpcRequest;
  } catch {
    const res: IpcResponse = { id: '', ok: false, error: 'malformed request' };
    socket.write(encodeLine(res));
    return;
  }

  const handler = handlers[req.cmd];
  if (!handler) {
    const res: IpcResponse = { id: req.id, ok: false, error: `unknown command: ${req.cmd}` };
    socket.write(encodeLine(res));
    return;
  }

  try {
    const data = await handler(req.args);
    const res: IpcResponse = { id: req.id, ok: true, data };
    socket.write(encodeLine(res));
  } catch (err) {
    const res: IpcResponse = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
    socket.write(encodeLine(res));
  }
}

/** Buat server IPC dari peta `cmd → handler`. `listen`/`close` mengelola satu `net.Server`. */
export function createIpcServer(handlers: Record<string, IpcHandler>): IpcServerHandle {
  let server: Server | undefined;
  const sockets = new Set<Socket>();

  return {
    listen(socketPath: string): Promise<void> {
      return new Promise((resolve, reject) => {
        const srv = createServer((socket) => {
          sockets.add(socket);
          const decoder = createLineDecoder();

          socket.on('data', (chunk: Buffer) => {
            const lines = decoder.push(chunk);
            for (const line of lines) {
              // Per-request terisolasi: satu request buruk (parse gagal/handler throw) tak
              // boleh menjatuhkan koneksi atau proses daemon (spec IPC-server §3).
              handleRequestLine(line, handlers, socket).catch(() => {
                // handleRequestLine sudah menangkap error handler sendiri di dalam try/catch;
                // ini jaring pengaman terakhir (mis. socket.write gagal karena koneksi putus).
              });
            }
          });

          socket.on('error', () => {
            // Koneksi individual bermasalah (mis. ECONNRESET klien) tak boleh menjatuhkan server.
          });

          socket.on('close', () => {
            sockets.delete(socket);
          });
        });

        // Single-instance + stale-socket handling (ADR-002 satu daemon; ADR-015 daemon = penulis
        // tunggal). JANGAN unlink socket POSIX secara buta sebelum listen — itu men-"steal" socket
        // daemon yang MASIH HIDUP (unlink lalu bind path sama = dua daemon diam-diam). Sebagai
        // gantinya: coba listen; bila EADDRINUSE di POSIX, probe via connect untuk membedakan
        // socket STALE (daemon lama crash → tak ada yang jawab) vs daemon HIDUP (ada yang jawab).
        const bind = (isRetry: boolean): void => {
          const onError = (err: Error): void => {
            const code = (err as { code?: string }).code;
            // Windows named pipe: EADDRINUSE selalu = pipe masih dipegang proses hidup (pipe hilang
            // otomatis saat owner mati) → propagate. POSIX: bedakan stale vs hidup via probe.
            if (code === 'EADDRINUSE' && process.platform !== 'win32' && !isRetry) {
              const probe = connect(socketPath);
              probe.once('connect', () => {
                probe.destroy();
                reject(err); // ada yang mendengarkan → daemon hidup → single-instance menang
              });
              probe.once('error', () => {
                probe.destroy();
                unlinkIgnoreMissing(socketPath); // tak ada yang jawab → socket stale → bersihkan
                bind(true); // coba listen sekali lagi (isRetry → tak ada probe kedua, hindari loop)
              });
              return;
            }
            reject(err);
          };

          srv.once('error', onError);
          srv.listen(socketPath, () => {
            srv.removeListener('error', onError);
            // mode 0600 owner-only di POSIX (least-privilege, ADR-015); named pipe Windows pakai
            // ACL default owner (tak ada chmod setara).
            if (process.platform !== 'win32') {
              chmodSync(socketPath, 0o600);
            }
            server = srv;
            resolve();
          });
        };

        bind(false);
      });
    },

    close(): Promise<void> {
      return new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        sockets.clear();

        const srv = server;
        if (!srv) {
          resolve();
          return;
        }
        server = undefined;

        const address = srv.address();
        const socketPath = typeof address === 'string' ? address : undefined;

        srv.close(() => {
          // `server.close()` biasanya sudah menghapus file socket POSIX; unlink lagi
          // defensif (mis. bila OS tak sempat membersihkannya) — abaikan bila sudah hilang.
          if (process.platform !== 'win32' && socketPath !== undefined) {
            unlinkIgnoreMissing(socketPath);
          }
          resolve();
        });
      });
    },
  };
}
