# Changelog

Semua perubahan penting proyek ini. Format: [Keep a Changelog](https://keepachangelog.com/id/1.1.0/),
versi mengikuti [SemVer](https://semver.org/). Belum ada rilis publik (`0.1.0`, unpackaged).

> Riwayat lengkap per-sesi ada di `docs/CONTEXT.md` + git log; CHANGELOG ini mulai dari M5.

## [Unreleased]

### Added

- **Web UI monitor read-only (`acca web`, M-web.1, ADR-028)** — dashboard browser lokal (`http://127.0.0.1:<port>`, default 4599, env `ACCA_WEB_PORT`) yang mirror `acca status`: usage bar 2 CLI, liveness daemon, tabel sesi, tail event-log, auto-refresh ~5s. Zero-dep (`http` bawaan), opt-in. **Keamanan (THREAT-MODEL §9, T-W1..W6):** bind `127.0.0.1` SAJA, GET-only (405 lain), Host-guard anti-DNS-rebinding (403), proyeksi ter-firewall yang sama dgn IPC status (nol `cli_session_id`/`cwd`/rahasia — nol jalur data baru), halaman self-contained (nol aset eksternal), render `textContent` (anti-XSS). Verifikasi runtime: `/api/status` firewalled + `Host: evil.com`→403 + netstat `LISTENING 127.0.0.1` saja. **Security-review gate M-web (T-W1..T-W6) LULUS PENUH 19 Jul → milestone M-web ditutup formal.**
- **`acca prune` — soft-archive sesi (ADR-004)** — arsipkan sesi lama agar `acca status` tetap relevan; default sesi terminal saja (sisakan RUNNING/LIMIT_HIT), `<ids>` selektif (`--force` utk yang dipantau), `--all`, `--dry-run`. **Soft** (set `archived_at`, TAK hard-delete — row tetap di DB utk audit/retensi); reversible; audit `session_archived`.
- **Brand/splash + inline badge (ADR-027)** — wordmark "The Loop" (`a ( c∞c ) a`) di `acca`/`--help`/`--version`/`acca daemon` start + inline gauge di header `acca status`. Gating ketat: TTY-only, hormati `NO_COLOR`, `--no-banner`, ASCII fallback (default konservatif; Windows legacy → ASCII), zero-dep (helper ANSI, bukan chalk/kleur).
- **Deploy sebagai service Linux (M5.4)** — `deploy/linux/acca-daemon.service` (systemd `--user`) + `scripts/install-linux.sh` / `scripts/uninstall-linux.sh` (render placeholder → path absolut, `enable --now` + `loginctl enable-linger`; uninstall round-trip LIVE-verified).
  LIVE-verified di Ubuntu (systemd 255): install→active, auto-restart on-crash <30s, survive logout + reboot auto-start, same-DB dengan CLI (kontras I-33), recovery job pending pasca-reboot (AC-M5-3).
- **Backup/DR minimal (M5.1/M5.2)** — engine `backupDatabase` (SQLite online backup API `db.backup` + integrity_check + prune tiered GFS-lite 24 hourly/30 daily, ADR-024); `scripts/backup.js`; template systemd backup + Windows Task Scheduler; dokumentasi restore. Restore **LIVE-verified** (M5.6): backup→marker→restore→revert terbukti + `integrity_check: ok` + daemon start bersih (T-L6 tutup).
- **Monitor proaktif "mendekati limit" (I-8/I-17)** — loop probe usage periodik saat sesi RUNNING (`usage-monitor.ts`, wired di `acca daemon`, interval ~2mnt) → cache snapshot utk `acca status` + notifikasi proximity (default 90% 5-jam / 75% mingguan, meniru Claude Code). Dedup rising-edge (`createProximityGate`) → notif hanya saat window BARU melewati ambang, bukan tiap tick.
- **Deploy sebagai service Windows (M5.5, ADR-026)** — autostart per-user via Task Scheduler trigger "At log on" (`deploy/windows/acca-daemon.task.xml` + `scripts/install-windows.ps1` / `uninstall-windows.ps1`); jalan sebagai user login → `acca.db` & kredensial CC/agy sama (menyelesaikan I-33 by construction, bukan Windows Service/LocalSystem). Crash-recovery = watchdog repetisi (`Repetition PT1M` + `IgnoreNew`, ~65s); nol jendela konsol via `conhost.exe --headless`; `ExecutionTimeLimit=PT0S`. **LIVE-verified di Win 11** (2× logout/login owner): @logon auto-start, daemon=user (bukan SYSTEM), same-DB, watchdog restart, nol tampilan terminal (G-49/G-50/G-52).
- **Gate artefak shippable lintas-OS (I-34)** — `test/systemd-unit.test.ts`, `test/shell-script.test.ts`, `test/ps1-encoding.test.ts`, `test/task-scheduler-xml.test.ts`: tiap `.service`/`.timer`/`.sh`/`.ps1`/Task-Scheduler-XML divalidasi (struktur/render/encoding/`--`-in-comment), bukan sekadar dibaca reviewer. Kelas I-34 kini tertutup untuk SEMUA artefak deploy.
- **Security pass 5-permukaan (M5.3)** — data-minimize IPC `status` (T-L1), + suite `test/security-*.test.ts` (injection firewall wire-level, credential-read, egress whitelist, audit append-only). THREAT-MODEL §8.

### Fixed

- **`acca help` regresi "too many arguments" (G-58)** — slice banner memasang `program.action()` di root commander → `acca help`/subcommand di-parse sbg argumen berlebih. Fix: `buildProgram()` diekstrak ke `src/cli/program.ts`, bare-`acca` (splash+help) ditangani sebelum parse via `process.argv`. Guard regresi `test/cli-dispatch.test.ts` (exitOverride).
- **Auto-resume sesi "limit lalu exit bersih" (D-1/RD-1 Opsi A, audit keempat 18 Jul)** — `markExited` tak lagi meng-clobber `LIMIT_HIT`→`EXITED` (status hanya transisi dari `RUNNING`; semantik = `markOrphanExited`). Sesi yang kena limit lalu ditutup bersih (Ctrl-C/quit) kini tetap di-resume-by-id otomatis di `reset_at` — regresi senyap dari interaksi guard I-35 (17 Jul) yang membuat jalur agy-exited (ADR-019) praktis tak terjangkau. +5 test (3 unit + 2 komposisi lifecycle), negative control terbukti.
- **Audit-trail probe agy sesi-hidup jujur soal kebasian (C-5/RC-5, audit ketiga)** — event keputusan probe untuk sesi agy `alive` (`usage_available_enqueue_resume`/`still_limited`) kini menyertakan `reason:'ls_snapshot_stale'` (probe LS agy sesi-hidup = snapshot beku launch-time, G-35 — bukan real-time). Perilaku tak berubah (self-correcting via inject→detect); hanya audit-trail yang berhenti menyesatkan. Opsi optimistic-resume penuh (spt agy-exited) ditolak: meng-inject sesi agy live-mungkin-masih-limit = jalur belum di-live-verify.
- **Notifikasi limit asli hasil konfirmasi `verify` (D-2/RD-2)** — latch via job `verify` kini menulis `status_change {to:LIMIT_HIT, source:verify}` → user dinotifikasi (AC-5) + audit-trail transisi konsisten di semua jalur latch. Sebelumnya satu-satunya jalur latch yang bisu.

### Security

- **Egress allowlist dipersempit — `api.telegram.org` DIHAPUS (D-4/RD-4, audit keempat 18 Jul)** — host tanpa konsumen produksi (M-remote ditunda tak-tentu) dibuang dari `ALLOWED_HOSTS` (`shared/http.ts`); least-privilege, preseden persis ADR-019. Dikembalikan saat slice M-remote (ADR-011) benar-benar dibangun. Test egress + NFR §Security disesuaikan.

### Changed

- **Build: script `prepare` (→ `npm run build`) + `typescript` dipindah ke `dependencies`** — `npm install` polos (setelah `git clone` manual) kini auto-build `dist/`, tak perlu langkah `npm run build` terpisah lagi untuk pemasangan baru. Dipicu oleh kebutuhan instalasi lintas-mesin: shortcut `npm install -g git+https://…` diuji langsung dan **tidak andal** (bug npm — lifecycle `prepare` re-run tanpa `node_modules/.bin` di salah satu jalur reify → `tsc: not found`); metode resmi tetap `git clone` manual + `npm install` + `npm link` (teruji end-to-end dari clone segar). Didokumentasikan di README §"Mesin baru, belum ada clone".
- **Engine backup → SQLite online backup API (I-32)** — `backupDatabase` kini async (`db.backup`), concurrency-safe by design: menghapus race `wal_checkpoint`+`copyFileSync` yang bisa hasilkan salinan half-written saat daemon menulis konkuren. Caller (`scripts/backup.js`) pakai top-level await.
- **Deteksi limit CC dari OUTPUT dikorroborasi snapshot usage (I-35)** — sinyal `source:'output'` CC di-suppress bila kuota jelas longgar (≥0.85 free, snapshot ≤5mnt) → firewall ADR-013 menguat; hook `StopFailure` bypass. **Jaring FN aktif (job `kind:'verify'`, migrasi 0003):** suppress kini menjadwalkan probe verifikasi susulan (~2,5mnt) → kuota ternyata habis (snapshot basi menutupi limit asli) = latch (mesin reset/probe normal ambil alih, tak langsung resume); kuota tersedia = FP terkonfirmasi (no-op). Dedup satu verify per-episode (`hasPendingKind`) — prosa multi-literal tak memicu storm probe.
- Gate higiene: frasa kanonik pesan limit dilarang di repo di luar `test/fixtures/**` (`test/no-canonical-limit-literals.test.ts`, I-36).

### Deferred

- **Windows Service via WinSW (ADR-025)** — di-demote jadi opsi host non-laptop selalu-login (tetap ter-blok I-33 utk kasus itu). MVP Windows pakai autostart per-user (ADR-026, lihat Added). Pin WinSW dorman-tapi-sah bila dibuka lagi.
- **Always-on lintas-logout / at-boot-pra-login di Windows** — TIDAK didukung (autostart logon-scoped, ADR-026/ADR-007, direlakan utk profil laptop). Always-on sejati = Linux systemd `--user` + linger.

### Security

- Runtime least-privilege (T-L7, Linux): daemon jalan sebagai user, bukan root; install pun user-scope (nol sudo).
- Backup/restore integritas (T-L6): restore LIVE-verified; gate security-review lokal Linux bersih (T-L1..T-L8 tutup/N/A).
