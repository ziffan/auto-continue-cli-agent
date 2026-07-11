import { describe, expect, it } from 'vitest';
import { genSessionId, genUniqueSessionId } from '../src/shared/ids.js';

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
