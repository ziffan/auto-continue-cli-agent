# auto-continue-cli-agent

Supervisor lokal yang **memonitor usage** dan **melanjutkan otomatis sesi yang terputus karena limit**
untuk dua CLI coding-agent: **Claude Code** dan **Antigravity CLI**.

> **Status:** Implementasi berjalan — **loop auto-continue (M1–M3d) + monitoring & UX (M4 inti) bertes**
> (deteksi limit → jadwal reset → probe usage → inject-continue sesi hidup / resume-by-id sesi mati; `acca status`
> usage-view, `acca log`, notifikasi transisi). Sedang di **M3e — koreksi loop** (audit 11 Jul menemukan 4 P1 di jalur
> resume/continue; R1–R4 + R6/I-23 [deteksi limit CC primer + capture id CC, live-verified 2.1.207] ✅ — **R4 ditutup
> via ADR-019 optimistic resume, pivot dari ADR-018 setelah live-verify buktikan probe OAuth baca pool kuota salah**;
> R7/I-25 [gate resume per-adapter] + idle-tracker-agy ✅. **Audit menyeluruh ketiga (13 Jul) menemukan P1 C-1
> [resume-by-id memuat percakapan tapi tak melanjutkan kerja] → DITUTUP (RC-1: inject continue ke sesi hasil-resume)
> + C-2/C-3 pengeras kanal data.** Live-verify token (16 Jul, ADR-020: kata `"continue"` telanjang tak me-resume agy →
> token = instruksi NL eksplisit, terbukti resume agy+CC di limit asli) ✅ — **sisa gate = HANYA live-verify literal
> English pasca-reset agy nyata, opportunistik**).
> 394 test hijau (2 skip POSIX-only
> di Windows), cross-OS (Linux + Windows). Belum dirilis/dipaketkan; M-remote (kontrol Telegram) & M5 (deploy sebagai
> service) menyusul setelah gate M3e hijau. Status terkini per sesi → [`docs/CONTEXT.md`](docs/CONTEXT.md).

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

## Perintah (yang sudah ada)

Jalankan dari source (`npm install && npm run build`; belum ada paket/installer rilis). Cross-OS (Linux + Windows).

| Perintah                            | Fungsi                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `acca run -- <claude\|agy> [args…]` | Jalankan CLI target di bawah supervisor (PTY wrapper); catat sesi + deteksi limit.     |
| `acca daemon`                       | Supervisor daemon: rekonsiliasi orphan, scheduler resume, monitor usage periodik, IPC. |
| `acca status`                       | Sesi termonitor + usage best-effort (bar per window, indikator "perkiraan").           |
| `acca log [sessionId]`              | Riwayat event / audit trail (terbaru dulu).                                            |

Belum ada: kontrol Telegram (M-remote) & `resume-now`/`cancel` via remote, deploy sebagai service (M5).

## Kenapa ini bukan hal sepele

- Usage Claude Code kini terekspos resmi (statusLine JSON v2.1.80+), dan deteksi limit bisa event-driven
  via **hook `StopFailure`** (v2.1.78+) — tapi dua-duanya hanya bekerja pada sesi yang di-manage; dan
  **limit-hit tidak men-exit sesi interaktif** (proses idle di prompt), sementara sesi yang benar-benar
  mati (reboot/tutup terminal) tak bersinyal apa pun — supervisor harus menangani **dua kondisi berbeda**:
  inject "continue" ke sesi hidup vs resume-by-id sesi mati. Lihat [`docs/RESEARCH.md`](docs/RESEARCH.md) §2c.
- Resume Claude Code **scoped ke working directory** sesi — harus `cd` ke folder asli.
- Kuota Antigravity variabel (berkorelasi beban kerja per-prompt), dan `/usage`-nya **snapshot saat
  launch, bukan live** — probe kuota harus dirancang khusus.

## Prior art & posisi

- [CodexBar](https://github.com/steipete/CodexBar) — monitor usage 56+ provider (menu bar **macOS-only**,
  Swift), **monitor-only tanpa auto-resume**. Kini sudah mendukung Antigravity (isu #1178 ditutup via PR #1341) — mekanismenya (probe language-server lokal + endpoint OAuth `retrieveUserQuota`) justru jadi referensi implementasi untuk probe kita.
- [claude-auto-retry](https://github.com/cheapestinference/claude-auto-retry) — auto-continue Claude Code
  via tmux (deteksi pesan limit → tunggu reset → kirim "continue"). **Claude Code-only, butuh tmux, tanpa native Windows**, tanpa monitor usage, dan hanya menangani sesi yang masih hidup di pane.

Diferensiasi kita: **monitor + auto-continue sesi hidup (PTY sendiri, tanpa tmux) + resume sesi yang
sudah mati** (claude-auto-retry hanya menangani pane hidup), **cross-OS native** (Linux + Windows tanpa
WSL/tmux), dual-CLI (Claude Code + Antigravity), state persisten + audit trail. Catatan risiko:
auto-continue native sedang diminta ke upstream Claude Code (tracking #13354, **masih open per 11 Jul 2026**,
demand naik — banyak isu duplikat, belum ada implementasi native di changelog) — lihat [`docs/RESEARCH.md`](docs/RESEARCH.md) §4c/§5b–§5c.

## Dokumentasi

| Dokumen                                        | Isi                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| [`docs/PROJECT.md`](docs/PROJECT.md)           | Problem statement, persona, user story, flow, wireframe, acceptance criteria |
| [`docs/RESEARCH.md`](docs/RESEARCH.md)         | Fakta usage-limit & mekanisme resume kedua CLI + sumber                      |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | C4, container map, tech stack                                                |
| [`docs/DECISIONS.md`](docs/DECISIONS.md)       | ADR (locked / pending)                                                       |
| [`docs/NFR.md`](docs/NFR.md)                   | Target non-fungsional terukur                                                |
| [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) | Threat model remote (Telegram) — gate keamanan M-remote                      |
| [`docs/MILESTONES.md`](docs/MILESTONES.md)     | Rencana milestone + progres                                                  |
| [`docs/GOTCHAS.md`](docs/GOTCHAS.md)           | Jebakan teknis yang sudah dibayar (agy/CC/PTY/store)                         |
| [`docs/CONTEXT.md`](docs/CONTEXT.md)           | Status proyek (update tiap sesi)                                             |
| [`docs/ISSUES.md`](docs/ISSUES.md)             | Issue terbuka/tertutup + prioritas                                           |

## Konteks agent

`CLAUDE.md` adalah satu sumber konteks untuk semua coding agent. `AGENTS.md` adalah **symlink** ke
`CLAUDE.md` supaya Codex/Cursor/Windsurf/OpenCode dan Claude Code berbagi instruksi yang sama.

## Lisensi

TBD (lihat ADR-terkait di `docs/DECISIONS.md` saat lock).
