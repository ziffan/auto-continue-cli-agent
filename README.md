# auto-continue-cli-agent

Supervisor lokal yang **memonitor usage** dan **melanjutkan otomatis sesi yang terputus karena limit**
untuk dua CLI coding-agent: **Claude Code** dan **Antigravity CLI**.

> **Status:** Implementasi berjalan — **loop auto-continue (M1–M3d) + monitoring & UX (M4 inti) bertes & gate M3e
> ✅ hijau** (deteksi limit → jadwal reset → probe usage → inject-continue sesi hidup / resume-by-id sesi mati;
> `acca status` usage-view, `acca log`, notifikasi transisi). Deteksi limit CC primer + inject-continue otomatis
> sudah **live-verified pada limit Claude Code ASLI** (16 Jul).
> Sekarang di **M5 — hardening + deploy sebagai service**: backup/restore state + security pass ✅; **service Linux
> (systemd `--user`) menyusul**; **service Windows DITUNDA** atas blocker terbukti — lihat [Menjalankan daemon](#menjalankan-daemon).
> **570 test hijau** (2 skip POSIX-only di Windows), cross-OS (Linux + Windows). Belum dirilis/dipaketkan;
> M-remote (kontrol Telegram) menyusul setelah M5. Status terkini per sesi → [`docs/CONTEXT.md`](docs/CONTEXT.md).

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

## Instalasi (dari source)

Belum ada paket/installer rilis — jalankan dari source. Cross-OS (Linux + Windows).

**Linux / macOS / Git Bash:**

```bash
npm install && npm run build
npm link                        # sekali — bikin perintah `acca` tersedia di PATH
```

**Windows PowerShell** — `&&` **tidak ada** di Windows PowerShell 5.1 (bawaan Windows 11; baru ada di PowerShell 7),
jadi pisahkan perintahnya:

```powershell
npm install
npm run build
npm link                        # sekali — bikin perintah `acca` tersedia di PATH
```

`npm link` memasang shim global (`bin.acca` → `dist/cli/index.js`). Cabut kapan saja: `npm unlink -g auto-continue-cli-agent`.

**Tanpa `npm link`** (kalau tak mau shim global) — semua perintah di bawah tetap jalan dengan memanggil entrypoint langsung.
Ganti `acca` dengan `node dist/cli/index.js`, mis. `node dist/cli/index.js daemon`.

> Perintah `acca` **hanya** ada setelah `npm link` (atau `npm i -g .`). Kalau muncul `'acca' is not recognized` /
> `command not found`, itu sebabnya — bukan build yang gagal.

## Perintah (yang sudah ada)

| Perintah                            | Fungsi                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `acca run <claude\|agy> [args…]`    | Jalankan CLI target di bawah supervisor (PTY wrapper); catat sesi + deteksi limit.     |
| `acca daemon`                       | Supervisor daemon: rekonsiliasi orphan, scheduler resume, monitor usage periodik, IPC. |
| `acca status`                       | Sesi termonitor + usage best-effort (bar per window, indikator "perkiraan").           |
| `acca log [sessionId]`              | Riwayat event / audit trail (terbaru dulu).                                            |

Belum ada: kontrol Telegram (M-remote) & `resume-now`/`cancel` via remote, deploy sebagai service (M5 — lihat bawah).

## Menjalankan daemon

Auto-resume hanya jalan bila **daemon hidup** saat window limit reset. Daemon harus jalan **sebagai kamu** — ia
memakai `acca.db` di profil kamu dan mewarisi sesi login `claude`/`agy` kamu (ADR-005).

**Sekarang (semua OS) — manual:**

```bash
acca daemon                      # biarkan terminal ini terbuka
# tanpa npm link: node dist/cli/index.js daemon
```

**Linux — service (systemd `--user` + lingering):** ini jalur always-on yang didukung; jalan sebagai user kamu dan
bertahan pasca-logout. Template + skrip menyusul di slice M5.4.

**Windows — service: DITUNDA, pakai `acca daemon` manual dulu.** Bukan karena belum sempat, tapi karena ada blocker
nyata yang sudah kami buktikan empiris: Windows Service default jalan sebagai **LocalSystem**, bukan sebagai kamu →
ia me-resolve **`acca.db` yang berbeda** (di `C:\WINDOWS\system32\config\systemprofile\…`, dan membuat DB kosong baru)
serta **tak melihat kredensial** `claude`/`agy` kamu. Gejalanya menipu: `sc query` bilang RUNNING dan `acca status`
terlihat normal — tapi daemon menatap database kosong dan **tak melakukan apa pun saat limit reset**. Jadi jangan
daftarkan `acca daemon` sebagai Windows Service dulu. Detail + jalan keluar yang sedang digarap: **I-33**
(`docs/ISSUES.md`).

**Batasan (semua OS, ADR-007):** kalau mesin tidur/mati, resume tertunda sampai ia bangun.

## Backup & restore

**Apa yang di-backup:** `acca.db` (checkpoint WAL `TRUNCATE` + salin file utama saja — sidecar
`-wal`/`-shm` basi pasca-checkpoint TAK disalin, salinan konsisten diverifikasi `integrity_check`).
Retensi **tiered GFS-lite** (ADR-024): **24 snapshot terbaru** (hourly) **+ 1 representatif per
hari-kalender lokal** untuk **30 hari** terakhir yang punya snapshot — coverage 1 bulan, disk
ter-cap ~54× ukuran DB. Lokasi default `<dataDir>/backups` (override env `ACCA_BACKUP_DIR`).
Config via env (config-over-hardcode, ADR-022/024): `ACCA_BACKUP_RETENTION_HOURLY` (default 24),
`ACCA_BACKUP_RETENTION_DAILY` (default 30), `ACCA_DATA_DIR`, `ACCA_BACKUP_DIR`.

**Jalankan sekali manual:**

```sh
npm run build           # wajib — skrip mengimpor dist/
node scripts/backup.js
```

**Pasang jadwal otomatis (default interval hourly, ADR-024):**

| OS | Template |
| --- | --- |
| Linux (systemd --user) | [`deploy/backup/systemd/`](deploy/backup/systemd/) — `acca-backup.service` (oneshot) + `acca-backup.timer` (`OnCalendar=hourly`) |
| Windows (Task Scheduler) | [`deploy/backup/windows/register-backup-task.ps1`](deploy/backup/windows/register-backup-task.ps1) — trigger repetition 1 jam |

Backup = tugas **one-shot periodik**, bukan proses long-running — Task Scheduler cocok di sini.
(Kelemahan Task Scheduler yang mendasari ADR-021 — gagal-senyap tanpa auto-restart — khusus
relevan untuk **daemon** yang harus terus hidup; tidak berlaku untuk job one-shot yang memang
dirancang exit setiap kali selesai.) Detail placeholder path + variabel ada di komentar tiap
template.

**Restore (langkah manual):**

1. **Hentikan daemon.** Linux (setelah M5.4): `systemctl --user stop acca-daemon`. **Windows: Ctrl+C di terminal
   `acca daemon`** — service Windows ditunda (I-33), jadi tak ada service untuk di-`sc stop`.
2. **Ganti** `<dataDir>/acca.db` dengan snapshot pilihan:
   `cp <snapshot> <dataDir>/acca.db` — hapus sisa `<dataDir>/acca.db-wal` / `-shm` bila ada.
3. **Jalankan daemon lagi** (`acca daemon`, atau `systemctl --user start acca-daemon` di Linux pasca-M5.4).
4. **Verifikasi**: `acca status` menunjukkan daemon hidup + sesi termonitor sesuai snapshot.

> **[LIVE] butuh user** — alur restore end-to-end (backup asli → restore → daemon start bersih)
> belum diverifikasi live di mesin nyata; jangan anggap terverifikasi sampai dijalankan manual.

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
