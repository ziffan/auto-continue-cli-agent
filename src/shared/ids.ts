import { randomBytes } from 'node:crypto';

// Alfabet base32 lowercase (RFC4648, tanpa padding) — dipakai untuk id sesi supervisor
// tampilan pendek (mis. `#a1b2`). Bukan untuk keamanan/secret — sekadar id ringkas unik.
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const ID_LENGTH = 4;

/** Hasilkan id sesi supervisor 4-char base32 lowercase (tampilan `#a1b2`). */
export function genSessionId(): string {
  const bytes = randomBytes(ID_LENGTH);
  let id = '';
  for (let i = 0; i < ID_LENGTH; i++) {
    const byte = bytes[i] ?? 0;
    id += BASE32_ALPHABET[byte % BASE32_ALPHABET.length];
  }
  return id;
}
