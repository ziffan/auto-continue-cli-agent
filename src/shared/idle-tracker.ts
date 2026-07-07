// Gating inject-continue poin (iii) ADR-014 — "sesi idle, bukan mid-turn" (I-13).
//
// Saat agent sedang men-generate, footer TUI dengan penanda "busy" (Claude Code: "esc to interrupt")
// DI-REPAINT terus-menerus (spinner tick sub-detik). Begitu turn selesai, penanda berhenti muncul.
// Maka idle = TIDAK ADA penanda busy di output selama jendela sunyi `quietMs`. Ini di-drive dari
// stream output yang sama seperti limit-watcher (bukan menebak dari isi — hanya penanda footer tetap;
// tak ada aksi diturunkan dari konten, ADR-008/013). Waktu di-inject supaya deterministik di test.
//
// agy: penanda busy belum diverifikasi live (ADR-014 catat keystroke agy TBD) → `isIdle()` = undefined
// (unknown, tak memblokir) sampai live-verify (I-15). Jangan mengarang penanda yang belum teramati.

import { stripAnsi } from './ansi.js';
import { nowMs } from './time.js';
import type { Tool } from './types.js';

/** Penanda "sedang men-generate" per tool. Absen = penanda busy belum diketahui → idle unknown. */
const BUSY_MARKERS: Partial<Record<Tool, RegExp>> = {
  // "esc to interrupt" muncul di footer generate Claude Code (juga di baris retry overload) — keduanya
  // = mid-turn/busy, jadi tepat diperlakukan sebagai penanda busy. Terverifikasi di fixtures korpus.
  claude: /esc to interrupt/i,
  // antigravity: TBD (I-15) — biarkan idle unknown, jangan tebak.
};

/** Cukup panjang untuk menjembatani penanda busy yang terbelah antar-chunk (penanda ≤ ~20 char). */
const MARKER_CARRY = 64;

/** Jendela sunyi default: tak ada penanda busy selama ini → dianggap idle. Footer generate
 *  di-repaint jauh lebih sering (sub-detik), jadi 1 detik sunyi = idle dengan yakin. */
const DEFAULT_QUIET_MS = 1000;

export interface IdleTrackerDeps {
  tool: Tool;
  quietMs?: number;
  now?: () => number;
}

export interface IdleTracker {
  /** Umpan chunk output PTY mentah (boundary sembarang). */
  feed(chunk: string): void;
  /** `true` = idle di prompt · `false` = mid-turn (baru saja lihat penanda busy) ·
   *  `undefined` = tool tanpa penanda busy diketahui (unknown, tak memblokir gating). */
  isIdle(): boolean | undefined;
}

export function createIdleTracker(deps: IdleTrackerDeps): IdleTracker {
  const marker = BUSY_MARKERS[deps.tool];
  const quietMs = deps.quietMs ?? DEFAULT_QUIET_MS;
  const now = deps.now ?? nowMs;

  let lastBusyAtMs: number | null = null;
  let carry = '';

  return {
    feed(chunk: string): void {
      if (marker === undefined) return; // tool tanpa penanda: tak ada yang dilacak
      const hay = carry + stripAnsi(chunk);
      if (marker.test(hay)) lastBusyAtMs = now();
      carry = hay.slice(-MARKER_CARRY);
    },

    isIdle(): boolean | undefined {
      if (marker === undefined) return undefined; // unknown → tak memblokir (semantik gating)
      if (lastBusyAtMs === null) return true; // belum pernah busy → idle di prompt (mis. saat limit-hit)
      return now() - lastBusyAtMs >= quietMs;
    },
  };
}
