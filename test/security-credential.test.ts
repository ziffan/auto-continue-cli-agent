// T-L4 (M5.3): kredensial Claude Code hanya-DIBACA, tak pernah bocor (ADR-005/010). Modul
// `shared/credentials.ts` adalah fungsi murni baca-lalu-kembalikan: tak ada `writeFileSync`/`fetch`/
// panggilan jaringan apa pun di dalamnya (grep import di file sumber = 0 hit selain `readFileSync`).
// Fokus test ini: SETIAP cabang error (JSON invalid, field hilang, token hilang, field bukan string,
// bentuk root bukan objek) TIDAK menyertakan nilai token/kredensial rahasia di pesan error —
// least-exposure (CONVENTIONS.md). Ini pelengkap `test/credentials.test.ts` yang sudah ada (menguji
// happy-path + sebagian error) — di sini setiap cabang diuji eksplisit untuk kebocoran token.

import { describe, expect, it, vi } from 'vitest';
import { ClaudeCredentialsError, extractClaudeToken, loadClaudeCredentials } from '../src/shared/credentials.js';

const SECRET = 'sk-ant-oat-REAL-SECRET-TOKEN-should-never-leak-9f8e7d6c';

function assertNoLeak(err: unknown): void {
  expect(err).toBeInstanceOf(ClaudeCredentialsError);
  const msg = (err as Error).message;
  expect(msg).not.toContain(SECRET);
  expect(msg).not.toContain('sk-ant-oat');
}

describe('security-credential: loadClaudeCredentials — kredensial hanya-dibaca, error tak bocor', () => {
  it('file tak terbaca (ENOENT) — pesan error tak menyertakan path/isi rahasia apa pun', () => {
    const readFileImpl = (() => {
      throw new Error(`ENOENT: no such file, open '.../.credentials.json' token=${SECRET}`);
    }) as unknown as typeof import('node:fs').readFileSync;
    try {
      loadClaudeCredentials(readFileImpl);
      expect.unreachable('harus melempar');
    } catch (err) {
      assertNoLeak(err);
    }
  });

  it('isi bukan JSON valid — pesan error generik, tak mengutip isi file mentah', () => {
    const readFileImpl = (() => `garbage not json ${SECRET}`) as unknown as typeof import('node:fs').readFileSync;
    try {
      loadClaudeCredentials(readFileImpl);
      expect.unreachable('harus melempar');
    } catch (err) {
      assertNoLeak(err);
    }
  });

  it('sukses baca: mengembalikan objek APA ADANYA (fungsi murni baca — tak ada efek samping tulis)', () => {
    const spy = vi.fn((_path: unknown, _options?: unknown) =>
      JSON.stringify({ claudeAiOauth: { accessToken: SECRET } }),
    );
    const readFileImpl = spy as unknown as typeof import('node:fs').readFileSync;

    const cred = loadClaudeCredentials(readFileImpl);

    expect(cred).toEqual({ claudeAiOauth: { accessToken: SECRET } });
    // Hanya dipanggil sekali, satu argumen path+encoding — tak ada panggilan tulis/jaringan
    // tersembunyi dilakukan modul ini (murni baca).
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1]).toBe('utf-8');
  });
});

describe('security-credential: extractClaudeToken — setiap cabang error tak bocor', () => {
  it('root bukan objek (null) — tak bocor', () => {
    try {
      extractClaudeToken(null);
      expect.unreachable();
    } catch (err) {
      assertNoLeak(err);
    }
  });

  it('root bukan objek (string berisi token) — tak bocor DAN tak dipantulkan balik di pesan', () => {
    try {
      extractClaudeToken(SECRET);
      expect.unreachable();
    } catch (err) {
      assertNoLeak(err);
    }
  });

  it('field claudeAiOauth absen — tak bocor', () => {
    try {
      extractClaudeToken({ other: SECRET });
      expect.unreachable();
    } catch (err) {
      assertNoLeak(err);
    }
  });

  it('accessToken bukan string (mis. number) — tak bocor', () => {
    try {
      extractClaudeToken({ claudeAiOauth: { accessToken: 123456789 } });
      expect.unreachable();
    } catch (err) {
      assertNoLeak(err);
    }
  });

  it('accessToken string kosong — tak bocor', () => {
    try {
      extractClaudeToken({ claudeAiOauth: { accessToken: '' } });
      expect.unreachable();
    } catch (err) {
      assertNoLeak(err);
    }
  });

  it('accessToken absen sama sekali — tak bocor', () => {
    try {
      extractClaudeToken({ claudeAiOauth: {} });
      expect.unreachable();
    } catch (err) {
      assertNoLeak(err);
    }
  });

  it('sukses: token asli dikembalikan apa adanya oleh pemanggil eksplisit (bukan otomatis tersurface)', () => {
    const cred = { claudeAiOauth: { accessToken: SECRET } };
    expect(extractClaudeToken(cred)).toBe(SECRET);
  });
});
