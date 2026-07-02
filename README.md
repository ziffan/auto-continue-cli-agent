# auto-continue-cli-agent

Supervisor lokal yang **memonitor usage** dan **melanjutkan otomatis sesi yang terputus karena limit**
untuk dua CLI coding-agent: **Claude Code** dan **Antigravity CLI**.

> **Status:** Perencanaan (Doc-First — Bagian 2). Belum ada kode fitur. Lihat [`docs/CONTEXT.md`](docs/CONTEXT.md).

---

## Masalah

Sesi agent panjang sering terhenti di tengah jalan karena kehabisan usage:

- **Claude Code** — limit rolling 5-jam + limit mingguan per akun.
- **Antigravity CLI** — refresh 5-jam + kuota mingguan (dua-duanya harus > 0).

Ketika limit habis, sesi berhenti. Progres tidak hilang (transcript tersimpan), tapi user harus:
menyadari sesi berhenti → tahu kapan limit reset → kembali ke folder yang benar → resume manual.
Untuk solo dev yang menjalankan agent berjam-jam, ini biaya waktu + konteks yang nyata.

Detail (untuk siapa, biaya masalah terukur, batasan) → [`docs/PROJECT.md`](docs/PROJECT.md).

## Solusi (ringkas)

1. **Monitor** — pantau status usage kedua CLI.
2. **Detect** — kenali saat sesi berhenti karena limit + baca kapan window reset.
3. **Auto-continue** — jadwalkan resume (`claude --resume <id>` / padanan Antigravity) begitu limit pulih,
   di working directory yang benar.

## Kenapa ini bukan hal sepele

- Header rate-limit Claude Code **belum** diekspos ke hooks/status line → deteksi harus lewat
  wrapper proses / parsing transcript, bukan hook resmi. Lihat [`docs/RESEARCH.md`](docs/RESEARCH.md).
- Resume Claude Code **scoped ke working directory** sesi — harus `cd` ke folder asli.
- Kuota Antigravity variabel (berkorelasi beban kerja per-prompt), tidak sesederhana hitung prompt.

## Prior art & posisi

[CodexBar](https://github.com/steipete/CodexBar) memonitor usage 56+ provider AI coding (menu bar macOS,
Swift) — tapi **monitor-only, tanpa auto-resume**, dan belum mendukung Antigravity (isu #1178 terbuka).
Diferensiasi kita: **monitor + auto-resume sesi terputus**, **cross-OS** (Linux+Windows), fokus dalam pada
2 CLI. Detail perbandingan + temuan cara membaca usage agy → [`docs/RESEARCH.md`](docs/RESEARCH.md) §4d–§5b.

## Dokumentasi

| Dokumen | Isi |
|---|---|
| [`docs/PROJECT.md`](docs/PROJECT.md) | Problem statement, persona, user story, flow, wireframe, acceptance criteria |
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | Fakta usage-limit & mekanisme resume kedua CLI + sumber |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | C4, container map, tech stack |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | ADR (locked / pending) |
| [`docs/NFR.md`](docs/NFR.md) | Target non-fungsional terukur |
| [`docs/MILESTONES.md`](docs/MILESTONES.md) | Rencana milestone |
| [`docs/CONTEXT.md`](docs/CONTEXT.md) | Status proyek (update tiap sesi) |

## Konteks agent

`CLAUDE.md` adalah satu sumber konteks untuk semua coding agent. `AGENTS.md` adalah **symlink** ke
`CLAUDE.md` supaya Codex/Cursor/Windsurf/OpenCode dan Claude Code berbagi instruksi yang sama.

## Lisensi

TBD (lihat ADR-terkait di `docs/DECISIONS.md` saat lock).
