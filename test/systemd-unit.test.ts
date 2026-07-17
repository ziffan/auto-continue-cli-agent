// Gate artefak systemd (.service/.timer) — I-34: artefak shippable WAJIB punya >=1 gate yang
// MEMVALIDASINYA, bukan sekadar dibaca reviewer. `npm run check` (typecheck+lint+test) tak menyentuh
// file non-TS; reviewer membaca template, tak mengeksekusinya. Kelas ini menggigit dua kali (G-44
// .ps1 em-dash; README `&&`) → sejak M5.4 tiap artefak deploy punya gate lintas-OS.
//
// Yang divalidasi (pure fs+string → jalan di Ubuntu DAN Windows, tak pernah skip di daily driver):
//   1. Struktur semua *.service/*.timer di deploy/: tiap baris = komentar/blank/[Section]/key=value.
//      Menangkap korupsi sintaks (mis. smart-quote/em-dash nyasar spt G-44, baris tanpa `=`).
//   2. Byte non-ASCII terlarang (em-dash/smart-quote — kelas G-44) di file unit.
//   3. Template daemon M5.4 (acca-daemon.service): render (substitusi placeholder <...> dgn nilai
//      contoh) → assert TAK ada `<...>` tersisa + key wajib (ExecStart ...daemon, Restart=on-failure,
//      RestartSec numerik, Type=simple, [Install] WantedBy). Ini "string-render (testable)" spec M5.4.
//   4. Setiap placeholder <TOKEN> di template daemon DISUBSTITUSI oleh scripts/install-linux.sh
//      → tak ada placeholder yang lolos ke unit terpasang (menutup celah I-34 yang sebenarnya:
//      template dikirim, hubungan template<->substitusi tak pernah di-gate).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..');
const deployDir = join(repoRoot, 'deploy');

function findUnits(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findUnits(full, acc);
    else if (/\.(service|timer)$/.test(entry)) acc.push(full);
  }
  return acc;
}

const unitFiles = findUnits(deployDir);
const rel = (f: string) => relative(repoRoot, f).replace(/\\/g, '/');

/** Baris yang bermakna secara struktur (bukan komentar/blank/section). */
function offendingLines(text: string): { line: number; content: string }[] {
  const bad: { line: number; content: string }[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const s = raw.trim();
    if (s === '' || s.startsWith('#') || s.startsWith(';')) return; // komentar/blank
    if (/^\[[A-Za-z]+\]$/.test(s)) return; // [Unit]/[Service]/[Timer]/[Install]
    if (s.includes('=')) return; // key=value (systemd)
    bad.push({ line: i + 1, content: raw });
  });
  return bad;
}

/** Ekstrak nilai key pertama dari sebuah section apa pun (cukup untuk assert kami). */
function keyValue(text: string, key: string): string | undefined {
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim();
    if (s.startsWith('#') || s.startsWith(';')) continue;
    const m = s.match(new RegExp(`^${key}=(.*)$`));
    if (m) return m[1];
  }
  return undefined;
}

describe('gate artefak systemd (I-34)', () => {
  it('menemukan unit systemd untuk diperiksa (gate tak boleh kosong senyap)', () => {
    expect(unitFiles.length).toBeGreaterThan(0);
  });

  it.each(unitFiles.map((f) => [rel(f), f] as const))(
    '%s = struktur systemd valid (tiap baris komentar/section/key=value)',
    (name, full) => {
      const bad = offendingLines(readFileSync(full, 'utf8'));
      expect(bad, `${name}: baris bukan key=value/section/komentar: ${JSON.stringify(bad)}`).toEqual(
        [],
      );
    },
  );

  // Sengaja TAK ada gate "no em-dash": systemd baca UTF-8 native, non-ASCII di komentar/Description
  // tak merusak parser (beda dari .ps1 yang G-44 = CP1252 salah-tebak em-dash jadi delimiter string).
  // Assertion ASCII-only di sini akan false-premise + memaksa churn template backup M5.2 (di luar scope).

  describe('template daemon M5.4 (acca-daemon.service)', () => {
    const daemonUnit = join(deployDir, 'linux', 'acca-daemon.service');
    const template = readFileSync(daemonUnit, 'utf8');
    const placeholders = [...new Set(template.match(/<[A-Z_]+>/g) ?? [])];

    // Render: substitusi placeholder dgn nilai contoh (persis peran install-linux.sh).
    const sample: Record<string, string> = {
      '<NODE>': '/home/u/.nvm/versions/node/v24.18.0/bin/node',
      '<ENTRYPOINT>': '/opt/acca/dist/cli/index.js',
    };
    const rendered = placeholders.reduce(
      (acc, ph) => acc.replaceAll(ph, sample[ph] ?? `__UNMAPPED_${ph}__`),
      template,
    );

    it('semua placeholder punya nilai contoh (tak ada <TOKEN> tak dikenal)', () => {
      expect(placeholders.filter((ph) => !(ph in sample))).toEqual([]);
    });

    it('render TIDAK menyisakan placeholder <...> (spec M5.4: tak ada <…> tertinggal)', () => {
      expect(rendered.match(/<[A-Z_]+>/g)).toBeNull();
    });

    it('render = struktur systemd valid', () => {
      expect(offendingLines(rendered)).toEqual([]);
    });

    it('Type=simple + ExecStart menjalankan `... daemon` dgn node+entrypoint tersubstitusi', () => {
      expect(keyValue(rendered, 'Type')).toBe('simple');
      const exec = keyValue(rendered, 'ExecStart');
      expect(exec).toBeDefined();
      expect(exec).toContain(sample['<NODE>']);
      expect(exec).toContain(sample['<ENTRYPOINT>']);
      expect(exec!.trimEnd().endsWith(' daemon')).toBe(true);
    });

    it('auto-restart: Restart=on-failure + RestartSec numerik (AC-M5-1)', () => {
      expect(keyValue(rendered, 'Restart')).toBe('on-failure');
      const sec = keyValue(rendered, 'RestartSec');
      expect(sec, 'RestartSec wajib ada').toBeDefined();
      expect(Number.isInteger(Number(sec)), `RestartSec numerik, dapat: ${sec}`).toBe(true);
    });

    it('[Install] WantedBy=default.target (wajib agar `systemctl --user enable` bekerja)', () => {
      // default.target = target user manager; multi-user.target hanya utk unit sistem.
      expect(keyValue(rendered, 'WantedBy')).toBe('default.target');
    });

    it('setiap placeholder <TOKEN> disubstitusi oleh scripts/install-linux.sh (celah I-34)', () => {
      const installSh = readFileSync(join(repoRoot, 'scripts', 'install-linux.sh'), 'utf8');
      const missing = placeholders.filter((ph) => !installSh.includes(ph));
      expect(
        missing,
        `install-linux.sh tak menyubstitusi: ${missing.join(', ')} → placeholder lolos ke unit terpasang`,
      ).toEqual([]);
    });
  });
});
