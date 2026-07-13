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

/** UUID kanonik (8-4-4-4-12 hex). Validasi `cli_session_id` yang masuk dari kanal data (hook CC
 *  `SessionStart` — I-23; agy resume-cmd — G-36): nilai ini kelak menjadi argv `claude --resume <id>` /
 *  `agy --conversation <id>`, jadi bentuk selain UUID kanonik ditolak (C-2: lebih baik BLOCKED/no-op
 *  daripada meneruskan string arbitrer dari pihak yang bisa menulis ke socket kontrol ke argv CLI). */
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCanonicalUuid(value: string): boolean {
  return CANONICAL_UUID.test(value);
}

/** I-27 (audit A-9): hasilkan id sesi yang dijamin belum dipakai. `genSessionId` 4-char (≈1 jt
 *  kombinasi) + retensi never-purge → probabilitas birthday-collision naik seiring baris bertambah;
 *  tanpa cek, tabrakan PK membuat `createSession` throw `SQLITE_CONSTRAINT_PRIMARYKEY` → `acca run`
 *  gagal MISTERIUS. Coba ulang sampai `exists(id)` false; `maxTries` habis → throw pesan JELAS (bukan
 *  constraint SQLite mentah). `exists` di-inject (repo `getById`) → testable tanpa DB & race-tolerant
 *  (INSERT tetap dijaga PK constraint bila ada race lintas-proses tepat di antara cek & insert). */
export function genUniqueSessionId(exists: (id: string) => boolean, maxTries = 8): string {
  for (let i = 0; i < maxTries; i++) {
    const id = genSessionId();
    if (!exists(id)) return id;
  }
  throw new Error(
    `Gagal menghasilkan id sesi unik setelah ${maxTries} percobaan — store mungkin terlalu penuh (arsipkan sesi lama atau perpanjang ID_LENGTH).`,
  );
}
