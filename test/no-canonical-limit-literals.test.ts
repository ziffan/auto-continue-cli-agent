// I-36 gate: repo ini sendiri = korpus yang memicu detektornya sendiri. `/session-start` wajib
// membaca GOTCHAS/RESEARCH/DECISIONS/CONTEXT/ISSUES tiap sesi — kalau sesi itu jalan di bawah
// `acca run claude`, membaca file yang mengutip pesan limit kanonik APA ADANYA mencetaknya ke
// terminal yang di-supervise → limit-watcher mengklasifikasinya sbg limit BARU (I-35 akar #1: FP
// nyata 17 Jul, detektor membaca komentar sumbernya sendiri). Gate ini menolak string yang cocok
// CC_LIMIT_PATTERNS/AGY_LIMIT_PATTERNS di luar test/** (korpus deteksi WAJIB memuat literal itu
// untuk berfungsi — dikecualikan, sama alasan seperti test/fixtures/**).
//
// Konvensi perbaikan (dua bentuk, ISSUES.md I-35/I-36 header): (a) escape `\b` — sisip literal
// "\b" (backslash+b, DUA karakter — BUKAN escape JS '\b' yang jadi backspace U+0008 tunggal;
// backspace TETAP non-word char sehingga \b-the-regex-metachar masih menemukan boundary dan
// fix jadi no-op senyap, dibuktikan G-46) tepat SEBELUM awal frasa yang match — mematahkan
// word-boundary tanpa mengubah teks yang terbaca manusia; (b) referensi by-index (mis.
// `CC_LIMIT_PATTERNS[3]`) untuk konteks "data record"/evidence field di mana menyisipkan `\b`
// akan salah merepresentasikan nilai yang sebenarnya tercatat (G-46).
//
// Pengecualian STRUKTURAL (bukan prosa yang mengutip, tapi LOGIKA DETEKSI itu sendiri — pattern
// source-nya niscaya memuat teks targetnya): baris yang diakhiri komentar `gate:allow-canonical-
// literal` (lihat src/adapters/patterns.ts — AGY_LIMIT_PATTERNS[0]'s literal source text berisi
// substring yang independen memenuhi AGY_LIMIT_PATTERNS[1] juga; mengubahnya = mengubah semantik
// regex produksi, bukan cuma dokumentasi).
//
// Kenapa test ini begini bentuknya (pola sama seperti ps1-encoding.test.ts, G-44): jalan lintas-OS
// (pure fs+regex, tak butuh Windows/Linux-only tool), scan SEMUA file text-ish di repo (bukan cuma
// yang "biasanya" berisiko) supaya file baru otomatis tergate tanpa update daftar manual.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchLimit, matchAgyLimit } from '../src/adapters/patterns.js';

const repoRoot = join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', 'test']);
const GATE_EXEMPT_MARKER = 'gate:allow-canonical-literal';
// Ekstensi text-ish yang relevan (repo ini: TS + Markdown + shell/deploy config saat M5.4/M5.5).
const TEXT_EXTENSIONS = new Set(['.ts', '.md', '.json', '.sh', '.ps1', '.xml', '.service', '.yml', '.yaml']);

function findTextFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findTextFiles(full, acc);
    else if (TEXT_EXTENSIONS.has(extname(entry))) acc.push(full);
  }
  return acc;
}

const targetFiles = findTextFiles(repoRoot);

interface Hit {
  line: number;
  evidence: string;
  kind: 'cc' | 'agy';
}

/** Baris yang cocok CC_LIMIT_PATTERNS dan/atau AGY_LIMIT_PATTERNS — DUA independen (bukan
 *  cc??agy): satu baris bisa memuat evidence CC dan agy sekaligus, keduanya wajib terdeteksi
 *  (lihat DECISIONS.md:850 di sejarah perbaikan — miss salah satu meninggalkan residual). */
function findHits(text: string): Hit[] {
  const hits: Hit[] = [];
  text.split('\n').forEach((line, idx) => {
    if (line.includes(GATE_EXEMPT_MARKER)) return;
    const cc = matchLimit(line);
    if (cc) hits.push({ line: idx + 1, evidence: cc.evidence, kind: 'cc' });
    const agy = matchAgyLimit(line);
    if (agy) hits.push({ line: idx + 1, evidence: agy.evidence, kind: 'agy' });
  });
  return hits;
}

describe('gate: literal pesan limit kanonik di luar test/** (I-35/I-36)', () => {
  it('menemukan file text-ish untuk diperiksa (gate tak boleh kosong senyap)', () => {
    expect(targetFiles.length).toBeGreaterThan(0);
  });

  it.each(targetFiles.map((f) => [relative(repoRoot, f).replace(/\\/g, '/'), f] as const))(
    '%s = bebas literal CC_LIMIT_PATTERNS/AGY_LIMIT_PATTERNS (atau ter-escape/by-index/ber-marker)',
    (rel, full) => {
      const hits = findHits(readFileSync(full, 'utf8'));
      if (hits.length === 0) return;
      const detail = hits.map((h) => `  L${h.line} [${h.kind}]: "${h.evidence}"`).join('\n');
      throw new Error(
        `${rel} memuat ${hits.length} baris yang cocok pola kanonik limit — mencetaknya ke ` +
          `terminal sesi yang di-supervise acca akan memicu detektor (I-35/I-36). Perbaiki dengan ` +
          `escape "\\b" di depan frasa (word-boundary patah, teks tetap terbaca) atau referensi ` +
          `by-index (mis. CC_LIMIT_PATTERNS[3]); bila ini logika deteksi itu sendiri (bukan kutipan ` +
          `prosa), tambah komentar akhir-baris "${GATE_EXEMPT_MARKER}" dengan alasan tertulis:\n${detail}`,
      );
    },
  );
});
