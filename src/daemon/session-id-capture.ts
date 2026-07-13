// I-20/R2b — seam yang menangkap `cli_session_id` milik CLI dari stream output PTY sesi hidup.
// Analog struktural `limit-watcher.ts`: engine MURNI (tak akses store/IPC, ADR-008/013) yang mem-buffer/
// strip-ANSI/scan output lalu memanggil `onCapture` saat id berubah; pemanggil (wrapper) yang menulis
// `sessions.setCliSessionId`. Ekstraksi id spesifik-tool di-inject lewat `capture` (adapter: agy =
// resume-cmd yang agy cetak saat exit, G-36; CC memakai jalur lain → tak dipasang capturer).
//
// C-3 (audit ketiga 12 Jul) — LAST-MATCH-WINS, bukan latch-first. Sumber id yang SAH dicetak agy saat
// EXIT (G-36) = kandidat TERAKHIR di stream; capturer di-feed SELURUH output, dan `--conversation=<uuid>`
// bisa muncul lebih awal di ISI transcript (agent membaca web/dokumen/repo yang memuat contoh perintah agy
// — threat model ADR-013 eksplisit: output tak tepercaya). Latch-first akan mengunci id yang salah secara
// permanen. Karena itu: jangan latch — biarkan match berikutnya menimpa; id yang dicetak saat exit menang
// karena paling akhir. Emit HANYA saat nilai berubah (setCliSessionId idempoten; hindari spam event).
//
// FIREWALL (ADR-013): `capture` HANYA mengklasifikasi (mengembalikan id atau null) — tak ada aksi lain
// yang diturunkan dari isi output. Id = uuid percakapan (bukan PII; memang dipakai `--conversation` saat resume).

import { stripAnsi } from '../shared/ansi.js';

export interface SessionIdCapturerDeps {
  /** Ekstrak cli_session_id dari SATU baris output (adapter-specific). Return null bila bukan sumber id. */
  capture: (line: string) => string | null;
  /** Dipanggil saat id BERUBAH (match baru != nilai terakhir). Last-match-wins → dipanggil ulang bila
   *  stream memuat id berbeda kemudian; setCliSessionId idempoten menerima id terakhir sebagai final. */
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
  let lastEmitted: string | null = null;

  /** Strip ANSI → coba ekstrak; bila dapat id BARU (beda dari terakhir), fire `onCapture`. */
  function record(text: string): void {
    const id = deps.capture(stripAnsi(text));
    if (id === null || id === lastEmitted) return; // no match / id tak berubah → jangan spam.
    lastEmitted = id;
    deps.onCapture(id);
  }

  return {
    feedOutput(chunk: string): void {
      buffer += chunk;

      // Baris lengkap (ter-newline) — jalur normal. Setiap baris di-scan; last-match-wins (C-3) →
      // tak berhenti di match pertama, biarkan baris berikutnya menimpa bila memuat id lain.
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        let line = buffer.slice(0, newlineIndex);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        buffer = buffer.slice(newlineIndex + 1);
        record(line);
        newlineIndex = buffer.indexOf('\n');
      }

      // Baris PARSIAL terakhir: resume-cmd agy dicetak tepat saat exit & bisa TANPA newline penutup
      // sebelum proses berhenti (limit-watcher tak perlu ini karena pesan limit selalu ber-newline).
      // Scan residual juga menutup kasus uuid terbelah antar-chunk (buffer terakumulasi). Bila kelak
      // baris ini jadi lengkap & memuat id yang sama, `record` diam (id tak berubah) → tak double-fire.
      record(buffer);

      if (buffer.length > MAX_BUFFER_LEN) buffer = buffer.slice(-BUFFER_TAIL_LEN);
    },
  };
}
