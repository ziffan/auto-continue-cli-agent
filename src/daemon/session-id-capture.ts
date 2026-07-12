// I-20/R2b — seam yang menangkap `cli_session_id` milik CLI dari stream output PTY sesi hidup.
// Analog struktural `limit-watcher.ts`: engine MURNI (tak akses store/IPC, ADR-008/013) yang mem-buffer/
// strip-ANSI/scan output lalu memanggil `onCapture` TEPAT SEKALI (latched); pemanggil (wrapper) yang
// menulis `sessions.setCliSessionId`. Ekstraksi id spesifik-tool di-inject lewat `capture` (adapter:
// agy = resume-cmd yang agy cetak saat exit, G-36; CC memakai jalur lain → tak dipasang capturer).
//
// FIREWALL (ADR-013): `capture` HANYA mengklasifikasi (mengembalikan id atau null) — tak ada aksi lain
// yang diturunkan dari isi output. Id = uuid percakapan (bukan PII; memang dipakai `--conversation` saat resume).

import { stripAnsi } from '../shared/ansi.js';

export interface SessionIdCapturerDeps {
  /** Ekstrak cli_session_id dari SATU baris output (adapter-specific). Return null bila bukan sumber id. */
  capture: (line: string) => string | null;
  /** Dipanggil TEPAT SEKALI saat id pertama tertangkap (latched). */
  onCapture: (id: string) => void;
}

export interface SessionIdCapturer {
  /** Umpan chunk output PTY mentah (boundary sembarang). No-op setelah tertangkap. */
  feedOutput(chunk: string): void;
}

/** Buffer tanpa newline melebihi ini (mis. progress-bar `\r`-only) → dipangkas, sisakan ekor. */
const MAX_BUFFER_LEN = 65536;
const BUFFER_TAIL_LEN = 4096;

export function createSessionIdCapturer(deps: SessionIdCapturerDeps): SessionIdCapturer {
  let buffer = '';
  let captured = false;

  /** Strip ANSI → coba ekstrak; bila dapat, latch + fire. Return true bila tertangkap. */
  function tryCapture(text: string): boolean {
    const id = deps.capture(stripAnsi(text));
    if (id === null) return false;
    captured = true;
    buffer = '';
    deps.onCapture(id);
    return true;
  }

  return {
    feedOutput(chunk: string): void {
      if (captured) return;
      buffer += chunk;

      // Baris lengkap (ter-newline) — jalur normal.
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        let line = buffer.slice(0, newlineIndex);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        buffer = buffer.slice(newlineIndex + 1);
        if (tryCapture(line)) return;
        newlineIndex = buffer.indexOf('\n');
      }

      // Baris PARSIAL terakhir: resume-cmd agy dicetak tepat saat exit & bisa TANPA newline penutup
      // sebelum proses berhenti (limit-watcher tak perlu ini karena pesan limit selalu ber-newline).
      // Scan residual juga menutup kasus uuid terbelah antar-chunk (buffer terakumulasi). Latched →
      // tak akan double-fire saat baris ini kelak jadi lengkap.
      if (tryCapture(buffer)) return;

      if (buffer.length > MAX_BUFFER_LEN) buffer = buffer.slice(-BUFFER_TAIL_LEN);
    },
  };
}
