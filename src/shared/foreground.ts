// Gating inject-continue poin (ii) ADR-014 — "foreground di PTY = agent, bukan shell" (I-13).
//
// Kita TAK menebak dari daftar nama proses. Sinyal yang tepat & robust: proses grup mana yang
// memegang FOREGROUND terminal (pts). node-pty (forkpty/ConPTY) menjadikan child session+group
// leader dengan pts sebagai controlling terminal. `/proc/<child>/stat` mengekspos:
//   • field 5 = pgrp  (process group child)
//   • field 8 = tpgid (foreground process group dari controlling tty child)
// Bila agent (atau anak di grup yang sama) yang foreground → tpgid == pgrp. Bila agent "drop ke
// shell" interaktif, subshell mengambil job-control-nya sendiri (grup baru + tcsetpgrp) → tpgid != pgrp.
// Maka:  tpgid == pgrp → agent foreground (true) ; tpgid != pgrp (>0) → grup lain memegang terminal
// (false, jangan inject "continue" ke sana) ; tpgid <= 0 / tak terbaca → unknown (undefined, tak
// memblokir — konsisten semantik `checkInjectGating`, tetap dijaga injection-firewall token literal).
//
// Windows/ConPTY tak punya konsep tpgid sederhana → foreground = unknown (undefined) untuk saat ini
// (I-13/I-15: pendekatan Windows menyusul). Semua I/O di-inject supaya testable tanpa /proc nyata.

import { readFileSync } from 'node:fs';
import { platform as osPlatform } from 'node:os';

export interface ForegroundDeps {
  // Cast tipis ke `string` (bukan `NodeJS.Platform`) — pola sama seperti `port-discovery.ts`.
  platform?: () => string;
  readFile?: (path: string) => string;
}

/** Ekstrak `{ pgrp, tpgid }` dari isi `/proc/<pid>/stat`, atau `null` bila malformed.
 *  `comm` (field 2) bisa memuat spasi/`)` → parse mulai dari `)` TERAKHIR. */
export function parseStatPgrpTpgid(statContent: string): { pgrp: number; tpgid: number } | null {
  const rparen = statContent.lastIndexOf(')');
  if (rparen === -1) return null;
  // Token setelah comm: [state, ppid, pgrp, session, tty_nr, tpgid, ...] (field 3..8).
  const rest = statContent.slice(rparen + 1).trim().split(/\s+/);
  const pgrpStr = rest[2];
  const tpgidStr = rest[5];
  if (pgrpStr === undefined || tpgidStr === undefined) return null;
  const pgrp = Number.parseInt(pgrpStr, 10);
  const tpgid = Number.parseInt(tpgidStr, 10);
  if (!Number.isInteger(pgrp) || !Number.isInteger(tpgid)) return null;
  return { pgrp, tpgid };
}

/** Keputusan murni dari `{ pgrp, tpgid }`. Lihat header untuk alasan. */
export function classifyForeground(v: { pgrp: number; tpgid: number }): boolean | undefined {
  if (v.tpgid <= 0) return undefined; // tak ada foreground / bukan tty → tak diketahui
  return v.tpgid === v.pgrp;
}

/**
 * `true` = foreground terminal dipegang grup proses child (agent) → aman inject.
 * `false` = grup lain (mis. subshell job-control) memegang foreground → JANGAN inject.
 * `undefined` = tak diketahui (Windows, /proc tak terbaca, stat malformed) → tak memblokir.
 * TAK PERNAH melempar — kegagalan apa pun → `undefined`.
 */
export function foregroundIsAgent(childPid: number, deps: ForegroundDeps = {}): boolean | undefined {
  const platform = (deps.platform ?? osPlatform)();
  if (platform !== 'linux') return undefined; // Windows/darwin: tpgid tak tersedia sederhana
  const readFile = deps.readFile ?? ((p) => readFileSync(p, 'utf-8'));
  let stat: string;
  try {
    stat = readFile(`/proc/${childPid}/stat`);
  } catch {
    return undefined; // proses mungkin sudah mati / race — unknown, bukan fatal
  }
  const parsed = parseStatPgrpTpgid(stat);
  if (parsed === null) return undefined;
  return classifyForeground(parsed);
}
