// Gate artefak shell (.sh) — I-34: artefak shippable WAJIB divalidasi gate, bukan cuma dibaca.
// Kelas kembar G-44 (.ps1): file skrip yang rusak HANYA saat dieksekusi, lolos review mata.
//
// Dua lapis:
//   FLOOR (pure fs, LINTAS-OS — tak pernah skip di Ubuntu daily driver, pelajaran G-44/I-34):
//     - LF-only: CRLF pada `.sh` = `#!/bin/sh\r` → `bad interpreter: /bin/sh^M` (mati senyap di Linux
//       walau file "terlihat benar"). `.gitattributes eol=lf` melindungi via git, tapi gate = jaring
//       kedua yang tak bergantung konfigurasi git lokal.
//     - Shebang `#!` di baris pertama.
//     - Tanpa UTF-8 BOM (EF BB BF) — merusak shebang.
//   DEPTH (bila `sh` ada — Ubuntu selalu punya, jadi jalan di daily driver; Windows tanpa sh = skip
//     depth SAJA, floor tetap jalan → tak ada bocor di mesin harian): `sh -n` (syntax check POSIX).

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);

function findSh(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findSh(full, acc);
    else if (entry.toLowerCase().endsWith('.sh')) acc.push(full);
  }
  return acc;
}

const shFiles = findSh(repoRoot);
const rel = (f: string) => relative(repoRoot, f).replace(/\\/g, '/');

function shAvailable(): boolean {
  try {
    execFileSync('sh', ['-c', 'exit 0'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const SH = shAvailable();

describe('gate artefak shell .sh (I-34)', () => {
  it('menemukan skrip .sh untuk diperiksa (gate tak boleh kosong senyap)', () => {
    expect(shFiles.length).toBeGreaterThan(0);
  });

  it.each(shFiles.map((f) => [rel(f), f] as const))('%s = LF-only (CRLF = bad interpreter)', (name, full) => {
    expect(readFileSync(full).includes(0x0d), `${name}: memuat CR (0x0D) → shebang rusak`).toBe(false);
  });

  it.each(shFiles.map((f) => [rel(f), f] as const))('%s = shebang #! di baris pertama', (name, full) => {
    const buf = readFileSync(full);
    const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    expect(hasBom, `${name}: UTF-8 BOM merusak shebang`).toBe(false);
    expect(buf.subarray(0, 2).toString('ascii'), `${name}: baris pertama harus #!`).toBe('#!');
  });

  // TAK ada gate "no em-dash" di sini: POSIX sh (dash/bash) baca UTF-8 native, non-ASCII di komentar/
  // string tak diperlakukan khusus (beda dari .ps1/CP1252, G-44). `sh -n` di bawah menangkap sintaks.

  (SH ? it : it.skip).each(shFiles.map((f) => [rel(f), f] as const))(
    '%s = lolos `sh -n` (syntax check POSIX)',
    (name, full) => {
      expect(() => execFileSync('sh', ['-n', full], { stdio: 'pipe' }), `${name}: sintaks sh invalid`).not.toThrow();
    },
  );
});
