// I-20/R2b — capturer `cli_session_id` dari output PTY + pattern agy (G-36). Engine murni (tak sentuh
// store/IPC); di sini diuji langsung + di-pair dgn `antigravityAdapter.captureSessionId` (pattern nyata).

import { describe, expect, it, vi } from 'vitest';
import { antigravityAdapter } from '../src/adapters/antigravity.js';
import { matchAgyResumeId } from '../src/adapters/patterns.js';
import { createSessionIdCapturer } from '../src/daemon/session-id-capture.js';

// Baris persis yang agy CETAK saat exit (G-36), dengan uuid contoh kanonik.
const UUID = '4f9a8638-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
const RESUME_LINE = `Resume with -c (or command below): agy --conversation=${UUID}`;

describe('matchAgyResumeId (G-36)', () => {
  it('ekstrak uuid dari resume-cmd yang agy cetak (bentuk `=`)', () => {
    expect(matchAgyResumeId(RESUME_LINE)).toBe(UUID);
  });

  it('terima juga bentuk spasi (`--conversation <uuid>`, Go-flag)', () => {
    expect(matchAgyResumeId(`agy --conversation ${UUID}`)).toBe(UUID);
  });

  it('normalisasi ke lowercase', () => {
    expect(matchAgyResumeId(`agy --conversation=${UUID.toUpperCase()}`)).toBe(UUID);
  });

  it('KONSERVATIF: id non-UUID tak ditangkap (null) — cegah resume id salah', () => {
    expect(matchAgyResumeId('agy --conversation=not-a-uuid')).toBeNull();
    expect(matchAgyResumeId('agy --conversation=1234')).toBeNull();
  });

  it('output tanpa resume-cmd → null', () => {
    expect(matchAgyResumeId('Individual quota reached. Resets in 3m.')).toBeNull();
  });

  it('adapter agy memakai pattern ini (captureSessionId)', () => {
    expect(antigravityAdapter.captureSessionId?.(RESUME_LINE)).toBe(UUID);
  });
});

describe('createSessionIdCapturer', () => {
  const capture = (line: string): string | null => matchAgyResumeId(line);

  it('menangkap id dari baris ber-newline → onCapture sekali', () => {
    const onCapture = vi.fn();
    const cap = createSessionIdCapturer({ capture, onCapture });
    cap.feedOutput(`some prior output\n${RESUME_LINE}\n`);
    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith(UUID);
  });

  it('menangkap baris PARSIAL terakhir (tanpa newline penutup — dicetak tepat saat exit)', () => {
    const onCapture = vi.fn();
    const cap = createSessionIdCapturer({ capture, onCapture });
    cap.feedOutput(RESUME_LINE); // tak ada '\n' — proses langsung exit setelah ini.
    expect(onCapture).toHaveBeenCalledWith(UUID);
  });

  it('menangkap uuid yang TERBELAH antar-chunk (buffer terakumulasi)', () => {
    const onCapture = vi.fn();
    const cap = createSessionIdCapturer({ capture, onCapture });
    const mid = RESUME_LINE.length - 10;
    cap.feedOutput(RESUME_LINE.slice(0, mid));
    expect(onCapture).not.toHaveBeenCalled();
    cap.feedOutput(`${RESUME_LINE.slice(mid)}\n`);
    expect(onCapture).toHaveBeenCalledWith(UUID);
  });

  it('emit-on-change: baris id IDENTIK berulang → fire tepat sekali (nilai tak berubah)', () => {
    const onCapture = vi.fn();
    const cap = createSessionIdCapturer({ capture, onCapture });
    cap.feedOutput(`${RESUME_LINE}\n`);
    cap.feedOutput(`${RESUME_LINE}\n`);
    expect(onCapture).toHaveBeenCalledTimes(1);
  });

  it('LAST-MATCH-WINS (C-3): uuid di ISI transcript lebih awal, id yang dicetak saat EXIT menang', () => {
    const onCapture = vi.fn();
    const cap = createSessionIdCapturer({ capture, onCapture });
    // Threat model ADR-013: output agy bisa memuat teks tak tepercaya (web/dokumen/repo) yang KEBETULAN
    // menyebut perintah agy ber-uuid — latch-first akan mengunci uuid palsu ini permanen.
    const FAKE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    cap.feedOutput(`the README says: agy --conversation=${FAKE}\n`);
    // …lalu agy mencetak resume-cmd SAH saat exit (kandidat TERAKHIR di stream).
    cap.feedOutput(`${RESUME_LINE}\n`);
    // Kedua match ter-emit (palsu lalu sah); nilai TERAKHIR (yang menang di setCliSessionId) = yang sah.
    expect(onCapture).toHaveBeenNthCalledWith(1, FAKE);
    expect(onCapture).toHaveBeenNthCalledWith(2, UUID);
    expect(onCapture).toHaveBeenLastCalledWith(UUID);
  });

  it('strip ANSI: baris ber-warna tetap tertangkap', () => {
    const onCapture = vi.fn();
    const cap = createSessionIdCapturer({ capture, onCapture });
    cap.feedOutput(`\x1b[2mResume with -c: agy --conversation=${UUID}\x1b[0m\n`);
    expect(onCapture).toHaveBeenCalledWith(UUID);
  });

  it('output tanpa id → tak pernah fire', () => {
    const onCapture = vi.fn();
    const cap = createSessionIdCapturer({ capture, onCapture });
    cap.feedOutput('just normal output\nno resume command here\n');
    expect(onCapture).not.toHaveBeenCalled();
  });
});
