// Gate encoding skrip PowerShell (G-44). Kelas cacat yang HANYA muncul saat dieksekusi, tak saat
// dibaca reviewer: PowerShell 5.1 (Windows PowerShell, default Win 11) membaca file `.ps1`
// UTF-8-tanpa-BOM sebagai CP1252. Em-dash `—` (U+2014 = E2 80 94) jadi 3 karakter yang terakhirnya
// U+201D — dan PowerShell MENERIMA U+201D sebagai delimiter string. Akibatnya string yang memuat
// em-dash tertutup lebih awal → parse error berantai yang menunjuk baris yang sama sekali tak salah.
//
// Terbukti nyata: `deploy/backup/windows/register-backup-task.ps1` (ter-commit di M5.2 `85be83c`,
// lolos tier-review) TIDAK bisa di-parse PowerShell 5.1 — backup terjadwal Windows tak akan pernah
// jalan. Ditemukan 17 Jul saat slice M5.5, diperbaiki bersama test ini.
//
// Kenapa test ini begini bentuknya: menguji ROOT CAUSE (byte), bukan gejala (parse). Memanggil
// parser PowerShell butuh Windows → test akan skip di Ubuntu (mesin harian) = gate bocor persis di
// tempat kita paling sering kerja. Cek byte = deterministik, instan, lintas-OS, nol dependency.
//
// Aturan: file `.ps1` WAJIB pure ASCII, ATAU dibuka UTF-8 BOM (EF BB BF) supaya PS 5.1 tak salah tebak.
// Pure ASCII lebih disukai (nol ketergantungan encoding). Dokumen boleh pakai em-dash — `.ps1` tidak.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);
const UTF8_BOM = [0xef, 0xbb, 0xbf];

function findPs1(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findPs1(full, acc);
    else if (entry.toLowerCase().endsWith('.ps1')) acc.push(full);
  }
  return acc;
}

const ps1Files = findPs1(repoRoot);

function hasUtf8Bom(buf: Buffer): boolean {
  return buf.length >= 3 && UTF8_BOM.every((b, i) => buf[i] === b);
}

/** Offset byte non-ASCII pertama, atau -1. */
function firstNonAscii(buf: Buffer, from = 0): number {
  for (let i = from; i < buf.length; i += 1) {
    const byte = buf[i];
    if (byte !== undefined && byte > 0x7f) return i;
  }
  return -1;
}

describe('gate encoding .ps1 (G-44)', () => {
  it('menemukan skrip .ps1 untuk diperiksa (gate tak boleh kosong senyap)', () => {
    // Kalau glob-nya rusak, test lain di bawah lolos-palsu karena nol iterasi.
    expect(ps1Files.length).toBeGreaterThan(0);
  });

  it.each(ps1Files.map((f) => [relative(repoRoot, f).replace(/\\/g, '/'), f] as const))(
    '%s = pure ASCII atau ber-BOM (PS 5.1 tak boleh salah-tebak CP1252)',
    (rel, full) => {
      const buf = readFileSync(full);
      if (hasUtf8Bom(buf)) return; // BOM = PS 5.1 baca UTF-8 dgn benar

      const at = firstNonAscii(buf);
      if (at !== -1) {
        const ctx = buf.subarray(Math.max(0, at - 24), at + 24).toString('utf8');
        const line = buf.subarray(0, at).toString('utf8').split('\n').length;
        const byteHex = (buf[at] ?? 0).toString(16).toUpperCase();
        throw new Error(
          `${rel}: byte non-ASCII 0x${byteHex} di baris ${line} (offset ${at}) ` +
            `tanpa UTF-8 BOM. PowerShell 5.1 akan membacanya sbg CP1252; bila ini em-dash di DALAM ` +
            `string, U+201D hasil salah-tebak menutup string lebih awal -> parse error menyesatkan (G-44). ` +
            `Perbaiki: ganti ke ASCII (mis. "-"). Konteks: ...${ctx}...`,
        );
      }
    },
  );

  it('regresi: register-backup-task.ps1 tak memuat em-dash di dalam string (bug M5.2 85be83c)', () => {
    const f = ps1Files.find((p) => p.endsWith('register-backup-task.ps1'));
    expect(f, 'skrip register-backup-task.ps1 harus ada').toBeDefined();
    const text = readFileSync(f as string, 'utf8');
    expect(text).not.toContain('—'); // em-dash
    expect(text).not.toContain('“'); // smart quote kiri
    expect(text).not.toContain('”'); // smart quote kanan = delimiter string PS
  });
});
