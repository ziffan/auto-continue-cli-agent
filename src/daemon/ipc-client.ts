// Klien IPC CLI→daemon (ADR-015): satu koneksi per perintah, satu request/response NDJSON,
// timeout, dan pemetaan error koneksi → `DaemonNotRunningError` yang jelas untuk pemanggil CLI.

import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { createLineDecoder, encodeLine } from './ipc-protocol.js';
import type { IpcResponse } from './ipc-protocol.js';

const DEFAULT_TIMEOUT_MS = 5000;

/** Dilempar saat tak ada daemon yang mendengarkan di socket/pipe (ECONNREFUSED/ENOENT saat connect). */
export class DaemonNotRunningError extends Error {
  constructor() {
    super('Daemon tidak berjalan (tak ada yang mendengarkan di socket IPC). Jalankan: acca daemon');
    this.name = 'DaemonNotRunningError';
  }
}

/** Id request pendek unik per panggilan — cukup untuk mencocokkan balasan di satu koneksi
 * short-lived (bukan untuk keamanan), pola sama seperti `shared/ids.ts` tapi ruang lebih besar
 * (hex 12 char) karena ini korelasi request, bukan id sesi tampilan. */
function genRequestId(): string {
  return randomBytes(6).toString('hex');
}

/** Kirim satu perintah `cmd`/`args` ke daemon di `socketPath`, tunggu balasan yang cocok `id`-nya. */
export function sendCommand(
  socketPath: string,
  cmd: string,
  args?: unknown,
  opts?: { timeoutMs?: number },
): Promise<unknown> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const id = genRequestId();

  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    const decoder = createLineDecoder();
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
    };

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const timer = setTimeout(() => {
      settle(() => reject(new Error(`Timeout menunggu balasan daemon (${timeoutMs}ms)`)));
    }, timeoutMs);

    socket.on('connect', () => {
      socket.write(encodeLine({ id, cmd, args }));
    });

    socket.on('data', (chunk: Buffer) => {
      const lines = decoder.push(chunk);
      for (const line of lines) {
        let res: IpcResponse;
        try {
          res = JSON.parse(line) as IpcResponse;
        } catch {
          continue; // baris tak terparse dari sisi server — abaikan, tunggu baris/timeout berikutnya
        }
        if (res.id !== id) continue; // balasan untuk request lain di koneksi ini (tak diharapkan, tapi aman diabaikan)
        settle(() => {
          if (res.ok) resolve(res.data);
          else reject(new Error(res.error));
        });
      }
    });

    // Koneksi putus sebelum balasan diterima (server menutup tanpa jawab) → jangan gantung
    // sampai timeout; anggap setara daemon-tak-jalan (koneksi tak menghasilkan apa-apa).
    socket.on('close', () => {
      settle(() => reject(new DaemonNotRunningError()));
    });

    socket.on('error', (err: Error) => {
      // Cast tipis ke `{code?}` (pola `shared/proc.ts`) — hindari referensi namespace ambient
      // `NodeJS` (eslint no-undef tak mengenalinya di file TS ini).
      const code = (err as { code?: string }).code;
      if (code === 'ECONNREFUSED' || code === 'ENOENT') {
        settle(() => reject(new DaemonNotRunningError()));
      } else {
        settle(() => reject(err));
      }
    });
  });
}
