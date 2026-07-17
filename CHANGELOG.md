# Changelog

Semua perubahan penting proyek ini. Format: [Keep a Changelog](https://keepachangelog.com/id/1.1.0/),
versi mengikuti [SemVer](https://semver.org/). Belum ada rilis publik (`0.1.0`, unpackaged).

> Riwayat lengkap per-sesi ada di `docs/CONTEXT.md` + git log; CHANGELOG ini mulai dari M5.

## [Unreleased]

### Added

- **Deploy sebagai service Linux (M5.4)** — `deploy/linux/acca-daemon.service` (systemd `--user`) + `scripts/install-linux.sh` / `scripts/uninstall-linux.sh` (render placeholder → path absolut, `enable --now` + `loginctl enable-linger`; uninstall round-trip LIVE-verified).
  LIVE-verified di Ubuntu (systemd 255): install→active, auto-restart on-crash <30s, survive logout + reboot auto-start, same-DB dengan CLI (kontras I-33), recovery job pending pasca-reboot (AC-M5-3).
- **Backup/DR minimal (M5.1/M5.2)** — engine `backupDatabase` (WAL checkpoint + copy + integrity_check + prune tiered GFS-lite 24 hourly/30 daily, ADR-024); `scripts/backup.js`; template systemd backup + Windows Task Scheduler; dokumentasi restore. Restore **LIVE-verified** (M5.6): backup→marker→restore→revert terbukti + `integrity_check: ok` + daemon start bersih (T-L6 tutup).
- **Deploy sebagai service Windows (M5.5, ADR-026)** — autostart per-user via Task Scheduler trigger "At log on" (`deploy/windows/acca-daemon.task.xml` + `scripts/install-windows.ps1` / `uninstall-windows.ps1`); jalan sebagai user login → `acca.db` & kredensial CC/agy sama (menyelesaikan I-33 by construction, bukan Windows Service/LocalSystem). Crash-recovery = watchdog repetisi (`Repetition PT1M` + `IgnoreNew`, ~65s); nol jendela konsol via `conhost.exe --headless`; `ExecutionTimeLimit=PT0S`. **LIVE-verified di Win 11** (2× logout/login owner): @logon auto-start, daemon=user (bukan SYSTEM), same-DB, watchdog restart, nol tampilan terminal (G-49/G-50/G-52).
- **Gate artefak shippable lintas-OS (I-34)** — `test/systemd-unit.test.ts`, `test/shell-script.test.ts`, `test/ps1-encoding.test.ts`, `test/task-scheduler-xml.test.ts`: tiap `.service`/`.timer`/`.sh`/`.ps1`/Task-Scheduler-XML divalidasi (struktur/render/encoding/`--`-in-comment), bukan sekadar dibaca reviewer. Kelas I-34 kini tertutup untuk SEMUA artefak deploy.
- **Security pass 5-permukaan (M5.3)** — data-minimize IPC `status` (T-L1), + suite `test/security-*.test.ts` (injection firewall wire-level, credential-read, egress whitelist, audit append-only). THREAT-MODEL §8.

### Changed

- **Deteksi limit CC dari OUTPUT dikorroborasi snapshot usage (I-35)** — sinyal `source:'output'` CC di-suppress bila kuota jelas longgar (≥0.85 free, snapshot ≤5mnt) → firewall ADR-013 menguat; hook `StopFailure` bypass.
- Gate higiene: frasa kanonik pesan limit dilarang di repo di luar `test/fixtures/**` (`test/no-canonical-limit-literals.test.ts`, I-36).

### Deferred

- **Windows Service via WinSW (ADR-025)** — di-demote jadi opsi host non-laptop selalu-login (tetap ter-blok I-33 utk kasus itu). MVP Windows pakai autostart per-user (ADR-026, lihat Added). Pin WinSW dorman-tapi-sah bila dibuka lagi.
- **Always-on lintas-logout / at-boot-pra-login di Windows** — TIDAK didukung (autostart logon-scoped, ADR-026/ADR-007, direlakan utk profil laptop). Always-on sejati = Linux systemd `--user` + linger.

### Security

- Runtime least-privilege (T-L7, Linux): daemon jalan sebagai user, bukan root; install pun user-scope (nol sudo).
- Backup/restore integritas (T-L6): restore LIVE-verified; gate security-review lokal Linux bersih (T-L1..T-L8 tutup/N/A).
