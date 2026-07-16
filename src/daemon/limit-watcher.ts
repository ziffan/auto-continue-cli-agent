// M3d.1 — seam yang menyambungkan Detector murni (M2, `classify()`) ke stream output PTY
// sesi hidup. Engine ini TETAP MURNI: tak ada akses store/IPC di sini (ADR-008/013) — hanya
// mem-buffer/strip/classify lalu memanggil `onLimit` callback; pemanggil (`daemon/process-wrapper.ts`)
// yang melakukan transisi state (`sessions.markLimitHit` + `events.append`). Tak ada aksi yang
// diturunkan dari *isi* output selain klasifikasi kind tetap `limit`/`overload`/`none`.
//
// Latched single-fire: sinyal limit pertama memicu `onLimit` tepat sekali per instance — sinyal
// berikutnya tetap "dikonsumsi" (supaya buffer tak bocor) tapi tak diklasifikasi ulang.
//
// Transport hook StopFailure (install settings.json + callback IPC) = slice terpisah (masa depan);
// engine ini sudah menerima `feedSignal` sehingga hook nanti tinggal memanggilnya apa adanya.

import { classify } from './detector.js';
import { stripAnsi } from '../shared/ansi.js';
import type { DetectionResult, DetectSignal } from '../adapters/types.js';
import type { Tool } from '../shared/types.js';

export interface LimitWatcherDeps {
  tool: Tool;
  /** Dipanggil TEPAT SEKALI pada sinyal `limit` pertama (latched). Engine TAK akses store/IPC —
   *  pemanggil yang melakukan transisi state (ADR-008/013: engine murni, tak menurunkan aksi dari isi output). */
  onLimit: (result: DetectionResult) => void;
  /** I-31 (G-37 terkonfirmasi live 16 Jul): jam untuk grace-window pasca-unlatch (deterministik di test,
   *  CONVENTIONS.md — engine tak panggil Date.now sendiri). Default `Date.now` untuk kenyamanan produksi. */
  now?: () => number;
  /** I-31: audit opsional saat sinyal limit dari OUTPUT ditolak grace-window pasca-unlatch (repaint banner
   *  lama CC). Engine tetap murni — hanya callback; pemanggil (wrapper) yang menulis event. */
  onOutputSuppressed?: (result: DetectionResult) => void;
}

export interface LimitWatcher {
  /** Umpan chunk output PTY mentah (boundary sembarang). Buffer → strip ANSI → split baris → classify. */
  feedOutput(chunk: string): void;
  /** Umpan sinyal non-output langsung (mis. hook StopFailure, exitcode) — di-classify apa adanya. */
  feedSignal(signal: DetectSignal): void;
  /** R3 (I-21): buka latch setelah auto-continue berhasil di-inject ke sesi HIDUP ini, supaya siklus
   *  limit BERIKUTNYA (persona sesi panjang yang kena limit >1×) terdeteksi lagi — tanpa ini
   *  auto-continue cuma bekerja SEKALI per sesi hidup. Buffer di-reset supaya sisa parsial baris limit
   *  lama (bila ada) tak langsung re-fire; pesan limit baru datang dengan newline sendiri. Pemanggil
   *  (wrapper) menjamin sesi sudah kembali RUNNING sebelum/berbarengan un-latch → `markLimitHit`
   *  (guard RUNNING) siap menerima siklus berikutnya. */
  unlatch(): void;
}

/** Buffer tanpa newline melebihi ini (mis. progress-bar `\r`-only) → dipangkas, sisakan ekor. */
const MAX_BUFFER_LEN = 65536;
const BUFFER_TAIL_LEN = 4096;

/**
 * I-31 (G-37): jendela pasca-`unlatch()` di mana sinyal limit dari OUTPUT **CC** diabaikan. Setelah
 * inject-continue sukses (unlatch), TUI CC me-repaint banner limit LAMA (ber-`\n`) yang mengalir lewat
 * `feedOutput` → tanpa guard ini ia diklasifikasi ulang sbg limit BARU (LIMIT_HIT palsu, live 16 Jul).
 * HANYA jalur output CC yang disuppress: (a) re-limit CC SAH datang lewat `feedSignal` (hook StopFailure =
 * deteksi PRIMER CC, I-23) yang TAK disuppress → tetap fire seketika; (b) agy TAK disuppress → re-limit
 * langsung ADR-019 optimistic ("Individual quota reached") tetap terdeteksi. Genuine cycle-2 CC via output
 * (fallback tanpa hook) selalu >window kemudian → tetap terdeteksi. 5s = margin aman atas repaint (live: repaint
 * di detik yang sama dgn inject); reversibel. */
const POST_UNLATCH_OUTPUT_GRACE_MS = 5_000;

export function createLimitWatcher(deps: LimitWatcherDeps): LimitWatcher {
  const now = deps.now ?? ((): number => Date.now());
  let buffer = '';
  let latched = false;
  // I-31: timestamp unlatch terakhir; null = belum pernah unlatch (tak ada suppression sebelum siklus-1).
  let unlatchedAt: number | null = null;

  function classifyLine(line: string): void {
    if (latched) return;
    const stripped = stripAnsi(line);
    const result = classify(deps.tool, { type: 'output', text: stripped });
    if (result.kind === 'limit') {
      // I-31: suppress repaint banner lama CC dalam grace-window pasca-unlatch (OUTPUT-only, CC-only).
      // TAK melatch → sinyal limit SAH setelah window (atau via feedSignal/hook) tetap bisa fire.
      if (deps.tool === 'claude' && unlatchedAt !== null && now() - unlatchedAt < POST_UNLATCH_OUTPUT_GRACE_MS) {
        deps.onOutputSuppressed?.(result);
        return;
      }
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

    unlatch(): void {
      latched = false;
      buffer = '';
      // I-31: arm grace-window OUTPUT-CC. Sinyal hook (feedSignal) TAK terpengaruh (authoritative).
      unlatchedAt = now();
    },
  };
}
