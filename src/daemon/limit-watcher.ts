// M3d.1 — seam yang menyambungkan Detector murni (M2, `classify()`) ke stream output PTY
// sesi hidup. Engine ini TETAP MURNI: tak ada akses store/IPC di sini (ADR-008/013) — hanya
// mem-buffer/strip/classify lalu memanggil `onLimit` callback; pemanggil (`cli/run-core.ts`)
// yang melakukan transisi state (`sessions.markLimitHit` + `events.append`). Tak ada aksi yang
// diturunkan dari *isi* output selain klasifikasi kind tetap `limit`/`overload`/`none`.
//
// Latched single-fire: sinyal limit pertama memicu `onLimit` tepat sekali per instance — sinyal
// berikutnya tetap "dikonsumsi" (supaya buffer tak bocor) tapi tak diklasifikasi ulang.
//
// Transport hook StopFailure (install settings.json + callback IPC) = slice terpisah (masa depan);
// engine ini sudah menerima `feedSignal` sehingga hook nanti tinggal memanggilnya apa adanya.

import { classify } from './detector.js';
import type { DetectionResult, DetectSignal } from '../adapters/types.js';
import type { Tool } from '../shared/types.js';

export interface LimitWatcherDeps {
  tool: Tool;
  /** Dipanggil TEPAT SEKALI pada sinyal `limit` pertama (latched). Engine TAK akses store/IPC —
   *  pemanggil yang melakukan transisi state (ADR-008/013: engine murni, tak menurunkan aksi dari isi output). */
  onLimit: (result: DetectionResult) => void;
}

export interface LimitWatcher {
  /** Umpan chunk output PTY mentah (boundary sembarang). Buffer → strip ANSI → split baris → classify. */
  feedOutput(chunk: string): void;
  /** Umpan sinyal non-output langsung (mis. hook StopFailure, exitcode) — di-classify apa adanya. */
  feedSignal(signal: DetectSignal): void;
}

// Cakupan CSI (Control Sequence Introducer) dasar: ESC "[" params... final-byte. Cukup untuk
// warna/cursor TUI (mis. "\x1b[31m", "\x1b[0m") tanpa merusak frasa limit di sekitarnya.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;?]*[a-zA-Z]/g;

/** Buffer tanpa newline melebihi ini (mis. progress-bar `\r`-only) → dipangkas, sisakan ekor. */
const MAX_BUFFER_LEN = 65536;
const BUFFER_TAIL_LEN = 4096;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

export function createLimitWatcher(deps: LimitWatcherDeps): LimitWatcher {
  let buffer = '';
  let latched = false;

  function classifyLine(line: string): void {
    if (latched) return;
    const stripped = stripAnsi(line);
    const result = classify(deps.tool, { type: 'output', text: stripped });
    if (result.kind === 'limit') {
      latched = true;
      deps.onLimit(result);
    }
    // 'overload' dan 'none' → diabaikan (bukan tanggung jawab engine ini menindaklanjuti).
  }

  return {
    feedOutput(chunk: string): void {
      buffer += chunk;

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        let line = buffer.slice(0, newlineIndex);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        buffer = buffer.slice(newlineIndex + 1);
        classifyLine(line);
        newlineIndex = buffer.indexOf('\n');
      }

      // Buffer cap: cegah kebocoran memori bila stream tak pernah emit '\n' (mis. progress-bar `\r`
      // terus-menerus). Pesan limit pendek — aman menyimpan hanya ekor terbaru.
      if (buffer.length > MAX_BUFFER_LEN) {
        buffer = buffer.slice(-BUFFER_TAIL_LEN);
      }
    },

    feedSignal(signal: DetectSignal): void {
      if (latched) return;
      const result = classify(deps.tool, signal);
      if (result.kind === 'limit') {
        latched = true;
        deps.onLimit(result);
      }
    },
  };
}
