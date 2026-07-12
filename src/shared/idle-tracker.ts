// Gating inject-continue poin (iii) ADR-014 — "sesi idle, bukan mid-turn" (I-13).
//
// Saat agent sedang men-generate, footer TUI dengan penanda "busy" (Claude Code: "esc to interrupt")
// DI-REPAINT terus-menerus (spinner tick sub-detik). Begitu turn selesai, penanda berhenti muncul.
// Maka idle = TIDAK ADA penanda busy di output selama jendela sunyi `quietMs`. Ini di-drive dari
// stream output yang sama seperti limit-watcher (bukan menebak dari isi — hanya penanda footer tetap;
// tak ada aksi diturunkan dari konten, ADR-008/013). Waktu di-inject supaya deterministik di test.
//
// agy (1.1.1): penanda busy = footer "esc to cancel" (analog "esc to interrupt" Claude) — ditangkap live
// 12 Jul (G-33, I-15 Sub-task B). Marker ini yang paling STABIL: teks tetap di footer, di-repaint terus
// selama generate. `Generating...`/`Working...` juga muncul TAPI di-selingi spinner braille di tengah kata
// (`W⣻  Wor`, ConPTY partial-repaint) → tak andal sbg regex → sengaja TIDAK dipakai. Idle = "esc to cancel"
// absen selama jendela sunyi (footer balik ke "? for shortcuts"). Gating inject agy live-verify = sisa I-15.

import { stripAnsi } from './ansi.js';
import { nowMs } from './time.js';
import type { Tool } from './types.js';

/** Penanda "sedang men-generate" per tool. Absen = penanda busy belum diketahui → idle unknown. */
const BUSY_MARKERS: Partial<Record<Tool, RegExp>> = {
  // "esc to interrupt" muncul di footer generate Claude Code (juga di baris retry overload) — keduanya
  // = mid-turn/busy, jadi tepat diperlakukan sebagai penanda busy. Terverifikasi di fixtures korpus.
  claude: /esc to interrupt/i,
  // "esc to cancel" muncul di footer generate agy 1.1.1 (G-33) — marker footer tetap & paling stabil.
  antigravity: /esc to cancel/i,
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
