import { describe, expect, it } from 'vitest';
import { genSessionId, genUniqueSessionId, isCanonicalUuid } from '../src/shared/ids.js';

describe('genSessionId', () => {
  it('menghasilkan id 4-char base32 lowercase', () => {
    for (let i = 0; i < 50; i++) {
      const id = genSessionId();
      expect(id).toMatch(/^[a-z2-7]{4}$/);
    }
  });
});

describe('genUniqueSessionId (I-27/A-9 retry-on-collision)', () => {
  it('mengembalikan id pertama saat belum ada tabrakan', () => {
    const id = genUniqueSessionId(() => false);
    expect(id).toMatch(/^[a-z2-7]{4}$/);
  });

  it('melewati id yang sudah dipakai lalu mengembalikan yang bebas', () => {
    let calls = 0;
    // Dua kandidat pertama "sudah ada", kandidat ke-3 bebas.
    const id = genUniqueSessionId(() => {
      calls += 1;
      return calls <= 2;
    });
    expect(calls).toBe(3);
    expect(id).toMatch(/^[a-z2-7]{4}$/);
  });

  it('throw pesan jelas (bukan constraint SQLite) saat maxTries habis', () => {
    expect(() => genUniqueSessionId(() => true, 3)).toThrowError(/id sesi unik setelah 3 percobaan/);
  });

  it('menghormati maxTries default (8) sebelum menyerah', () => {
    let calls = 0;
    expect(() =>
      genUniqueSessionId(() => {
        calls += 1;
        return true;
      }),
    ).toThrow();
    expect(calls).toBe(8);
  });
});

describe('isCanonicalUuid (C-2 validasi cli_session_id lintas-kanal)', () => {
  it('menerima UUID kanonik 8-4-4-4-12 (case-insensitive)', () => {
    expect(isCanonicalUuid('fd55a7d2-1c2d-4e5f-8a9b-0c1d2e3f4a5b')).toBe(true);
    expect(isCanonicalUuid('FD55A7D2-1C2D-4E5F-8A9B-0C1D2E3F4A5B')).toBe(true);
  });

  it('menolak bentuk non-UUID (cegah argv `--resume <sampah>`)', () => {
    for (const bad of [
      'uuid-abc', // placeholder lama
      'not-a-uuid',
      '1234',
      '',
      '--resume', // berawalan flag → berbahaya bila diteruskan ke argv
      'fd55a7d2-1c2d-4e5f-8a9b-0c1d2e3f4a5b extra', // ada ekor
      'zd55a7d2-1c2d-4e5f-8a9b-0c1d2e3f4a5b', // 'z' bukan hex
      'fd55a7d2-1c2d-4e5f-8a9b-0c1d2e3f4a5', // kurang 1 digit
    ]) {
      expect(isCanonicalUuid(bad)).toBe(false);
    }
  });
});
