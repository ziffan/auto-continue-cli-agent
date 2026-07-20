// Gate artefak CI workflow (repo publik, I-34) - `npm run check` tak menyentuh file YAML;
// reviewer manusia membaca `.github/workflows/ci.yml`, tak mengeksekusinya. Kelas ini sudah
// menggigit dua kali (G-44 .ps1 em-dash; template Task Scheduler XML) -> tiap artefak yang
// jalan DI LUAR TypeScript butuh gate lintas-OS pure-TS sendiri, bukan sekadar "kelihatan benar".
//
// Repo ini zero-dep (CLAUDE.md): sengaja TIDAK import parser YAML (mis. `js-yaml`) hanya untuk
// satu test file. Validasi di bawah pure fs+string/regex - cukup untuk menangkap regresi
// struktural yang penting (supply-chain pin, matrix cross-OS, gate command, least-privilege).
//
// Yang divalidasi:
//   1. Workflow ada & tak kosong.
//   2. SEMUA `uses:` dipin ke SHA 40-hex, bukan tag `@v7` telanjang (kontrol supply-chain -
//      tag bisa dipindah pemilik action; SHA tak bisa).
//   3. Matrix memuat ubuntu-latest DAN windows-latest (klaim lintas-OS proyek harus benar-benar
//      diuji CI, bukan cuma diklaim di CLAUDE.md).
//   4. Workflow menjalankan `npm run check` (gate agregat typecheck+lint+test).
//   5. `permissions:` top-level memuat `contents: read` (least-privilege - default GITHUB_TOKEN
//      GitHub itu read+write kalau tak dibatasi eksplisit).
//   6. SECURITY.md ada, menautkan docs/THREAT-MODEL.md, dan NOL alamat email (mencegah PII
//      pribadi bocor ke file publik repo - kontak resmi = GitHub private reporting/kampusmerah.com).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..');
const workflowPath = join(repoRoot, '.github', 'workflows', 'ci.yml');
const securityPath = join(repoRoot, 'SECURITY.md');

const workflow = readFileSync(workflowPath, 'utf8');

describe('gate artefak CI workflow (repo publik, I-34)', () => {
  it('.github/workflows/ci.yml ada & tak kosong', () => {
    expect(workflow.trim().length).toBeGreaterThan(0);
  });

  it('semua `uses:` dipin ke SHA 40-hex (kontrol supply-chain - tag @v bisa dipindah pemilik action)', () => {
    const usesLines = workflow.match(/^\s*(?:-\s*)?uses:\s*.+$/gm) ?? [];
    expect(usesLines.length, 'workflow harus punya >=1 step `uses:` (gate tak boleh kosong senyap)').toBeGreaterThan(0);

    const bareTagLines = usesLines.filter((line) => /@v\d/.test(line) && !/@[0-9a-f]{40}\b/.test(line));
    expect(
      bareTagLines,
      `step \`uses:\` berikut memakai tag telanjang, bukan SHA 40-hex: ${bareTagLines.join(' | ')}`,
    ).toEqual([]);

    // Sebaliknya: pastikan tiap `uses:` benar-benar mengandung SHA 40-hex (bukan cuma lolos
    // filter di atas karena tak ada `@v` sama sekali - mis. typo format lain).
    const missingSha = usesLines.filter((line) => !/@[0-9a-f]{40}\b/.test(line));
    expect(missingSha, `step \`uses:\` berikut tak mengandung SHA 40-hex: ${missingSha.join(' | ')}`).toEqual([]);
  });

  it('matrix memuat ubuntu-latest DAN windows-latest (klaim lintas-OS harus benar-benar diuji CI)', () => {
    expect(workflow).toMatch(/ubuntu-latest/);
    expect(workflow).toMatch(/windows-latest/);
  });

  it('workflow menjalankan `npm run check` (gate agregat typecheck+lint+test)', () => {
    expect(workflow).toMatch(/npm run check/);
  });

  it('`permissions:` top-level memuat `contents: read` (least-privilege GITHUB_TOKEN)', () => {
    expect(workflow).toMatch(/permissions:\s*\n\s*contents:\s*read/);
  });

  it('SECURITY.md ada, menautkan docs/THREAT-MODEL.md, dan nol alamat email (PII tak boleh bocor ke repo publik)', () => {
    const security = readFileSync(securityPath, 'utf8');
    expect(security.trim().length).toBeGreaterThan(0);
    expect(security).toContain('docs/THREAT-MODEL.md');

    const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const matches = security.match(emailRe) ?? [];
    expect(matches, `SECURITY.md memuat pola alamat email: ${matches.join(', ')}`).toEqual([]);
  });
});
