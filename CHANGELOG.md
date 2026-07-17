# Changelog

Semua perubahan penting proyek ini. Format: [Keep a Changelog](https://keepachangelog.com/id/1.1.0/),
versi mengikuti [SemVer](https://semver.org/). Belum ada rilis publik (`0.1.0`, unpackaged).

> Riwayat lengkap per-sesi ada di `docs/CONTEXT.md` + git log; CHANGELOG ini mulai dari M5.

## [Unreleased]

### Added

- **Deploy sebagai service Linux (M5.4)** — `deploy/linux/acca-daemon.service` (systemd `--user`) + `scripts/install-linux.sh` / `scripts/uninstall-linux.sh` (render placeholder → path absolut, `enable --now` + `loginctl enable-linger`; uninstall round-trip LIVE-verified).
  LIVE-verified di Ubuntu (systemd 255): install→active, auto-restart on-crash <30s, survive logout + reboot auto-start, same-DB dengan CLI (kontras I-33), recovery job pending pasca-reboot (AC-M5-3).
- **Backup/DR minimal (M5.1/M5.2)** — engine `backupDatabase` (WAL checkpoint + copy + integrity_check + prune tiered GFS-lite 24 hourly/30 daily, ADR-024); `scripts/backup.js`; template systemd backup + Windows Task Scheduler; dokumentasi restore. Restore **LIVE-verified** (M5.6): backup→marker→restore→revert terbukti + `integrity_check: ok` + daemon start bersih (T-L6 tutup).
- **Gate artefak shippable lintas-OS (I-34)** — `test/systemd-unit.test.ts`, `test/shell-script.test.ts`, `test/ps1-encoding.test.ts`: tiap `.service`/`.timer`/`.sh`/`.ps1` divalidasi (struktur/render/encoding), bukan sekadar dibaca reviewer.
- **Security pass 5-permukaan (M5.3)** — data-minimize IPC `status` (T-L1), + suite `test/security-*.test.ts` (injection firewall wire-level, credential-read, egress whitelist, audit append-only). THREAT-MODEL §8.

### Changed

- **Deteksi limit CC dari OUTPUT dikorroborasi snapshot usage (I-35)** — sinyal `source:'output'` CC di-suppress bila kuota jelas longgar (≥0.85 free, snapshot ≤5mnt) → firewall ADR-013 menguat; hook `StopFailure` bypass.
- Gate higiene: frasa kanonik pesan limit dilarang di repo di luar `test/fixtures/**` (`test/no-canonical-limit-literals.test.ts`, I-36).

### Deferred

- **Service Windows (M5.5)** — DITUNDA (**I-33**): Windows Service default = LocalSystem → `acca.db` & kredensial berbeda → produk mati senyap. Windows sementara = `acca daemon` manual. Pin WinSW (ADR-025) siap saat dibuka.

### Security

- Runtime least-privilege (T-L7, Linux): daemon jalan sebagai user, bukan root; install pun user-scope (nol sudo).
- Backup/restore integritas (T-L6): restore LIVE-verified; gate security-review lokal Linux bersih (T-L1..T-L8 tutup/N/A).
