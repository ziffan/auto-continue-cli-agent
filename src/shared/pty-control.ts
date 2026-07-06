// Gating + inject untuk melanjutkan sesi yang MASIH HIDUP di PTY (M3d.7, jalur preferred ADR-014:
// limit != exit → inject "continue" ke stdin proses yang sudah ada, bukan kill+respawn). Logika
// gating PURE atas input eksplisit (testable tanpa wrapper/IPC nyata) — actuation fd sungguhan
// adalah seam integrasi terpisah (lihat catatan di daemon/supervisor.ts).

import { writeSync } from 'node:fs';

/** Dilempar saat penulisan ke fd PTY gagal (mis. fd sudah ditutup / proses sudah mati). */
export class PtyControlError extends Error {
  constructor(reason: string) {
    super(`PtyControl: gagal inject ke PTY — ${reason}`);
    this.name = 'PtyControlError';
  }
}

/** Tulis `text` ke fd PTY, menangani partial write (loop sampai seluruh buffer terkirim). */
export function injectToPty(fd: number, text: string, writeImpl: typeof writeSync = writeSync): void {
  const buf = Buffer.from(text, 'utf-8');
  let written = 0;
  try {
    while (written < buf.length) {
      written += writeImpl(fd, buf, written);
    }
  } catch (err) {
    throw new PtyControlError(err instanceof Error ? err.message : String(err));
  }
}

export interface InjectGatingInput {
  procAlive: boolean;
  /** Handle tulis ke PTY sebagai fd numerik (jalur legacy daemon-side; selalu undefined di sana). */
  ptyFd?: number;
  /** `true` = pemanggil memegang handle PTY yang bisa ditulis (jalur wrapper-side: node-pty `.write`,
   *  tak ada fd numerik portabel). Menggantikan cek `ptyFd` bila diset — wrapper adalah pemilik PTY. */
  hasPtyHandle?: boolean;
  foregroundIsAgent?: boolean; // dihitung wrapper nanti; undefined = unknown
  idle?: boolean; // dihitung wrapper nanti; undefined = unknown
}

/** Reason kegagalan gating, atau `null` bila boleh inject. `undefined` pada `foregroundIsAgent`/
 * `idle` berarti BELUM DIKETAHUI — tidak memblokir (hanya `false` eksplisit yang memblokir). */
export function checkInjectGating(i: InjectGatingInput): string | null {
  if (!i.procAlive) return 'proc_not_alive';
  // Handle-tulis valid bila wrapper menyatakan memegang PTY (`hasPtyHandle`) ATAU fd numerik > 0
  // (jalur legacy). Tanpa keduanya → tak ada tempat aman menulis "continue".
  const handleOk = i.hasPtyHandle === true || (i.ptyFd !== undefined && i.ptyFd > 0);
  if (!handleOk) return 'invalid_pty_fd';
  if (i.foregroundIsAgent === false) return 'foreground_not_agent';
  if (i.idle === false) return 'proc_not_idle';
  return null;
}
