# NFR.md — Non-Functional Requirements

> Bagian 2.2. **Tidak terukur = tidak ada.** Target realistis untuk solo ops (jangan janji 99,9%).

---

## Performance

| Metrik | Target |
|---|---|
| Deteksi LIMIT_HIT setelah sinyal muncul | < 5 detik |
| Selisih reset_at → sesi lanjut kembali | ≤ 5 menit (lihat PROJECT.md metrik sukses) |
| Overhead CPU/RAM daemon saat idle | < 1% CPU, < 80 MB RAM (muat di VPS 3,6 GB / node headless) |
| Latensi `acca status` render | < 300 ms |
| Latensi `GET /api/status` (Web UI, M-web) | < 300 ms (baca store read-only, sama kelas `acca status`) |
| Muat awal halaman Web UI (`GET /`, lokal) | < 1 detik (HTML self-contained, nol aset eksternal) |

## Availability

- Target **99% uptime daemon** di host always-on (≈ realistis untuk solo ops; jangan 99,9%).
- Auto-resume hanya terjamin saat host hidup. Di laptop tidur → resume tertunda sampai bangun (batasan terdokumentasi).
- **Service lifecycle (M5, ADR-007/021).** Daemon HARUS jalan sebagai service OS (systemd `--user`+linger Linux /
  Windows Service Windows) yang: (a) **survive reboot host** (start otomatis saat boot), (b) **survive logout** (Linux:
  `enable-linger`; Windows Service: independen sesi login), (c) **auto-restart on-crash** (`Restart=on-failure` / WinSW
  restart policy). Target waktu daemon kembali hidup pasca-crash < 30 detik.
- **Recovery state pasca-restart** (AC-7): job `scheduled_jobs` pending yang jatuh tempo saat daemon mati HARUS tetap
  dijalankan setelah service restart/boot (recovery-saat-`start()`).

## Backup / DR (M5, ADR-022)

- **RPO** = interval snapshot backup (bukan continuous). Default interval terkonfigurasi; kehilangan maksimum = 1 interval.
- Backup HARUS konsisten: `PRAGMA wal_checkpoint(TRUNCATE)` sebelum salin file (`acca.db`+`-wal`/`-shm`).
- **Retensi** N snapshot terakhir (konfigurasi, bukan hardcode). No-hard-delete (arsip, tak purge — ADR-004).
- Restore terdokumentasi (stop service → ganti file → start). DR penuh (replikasi/PITR) = **di luar scope MVP**.

## Reliability / Correctness

- False positive LIMIT_HIT < 1 per 100 sesi.
- Resume di working directory salah = **0** (hard requirement; status BLOCKED bila cwd hilang).
- State timer **tahan restart** daemon: recover `scheduled_jobs` dan lanjutkan.
- Tidak spam-resume saat probe kosong: backoff berjenjang (mis. 5m → 15m → 1j → cap).

## Scalability (skala MVP)

- Dukung ≥ 20 sesi termonitor bersamaan di satu mesin tanpa degradasi.
- Store SQLite sehat s/d puluhan ribu baris event (arsip + indeks).

## Security

- Tidak ada kredensial/secret di repo atau store (ADR-005).
- Output CLI/transcript diperlakukan sebagai data, bukan perintah (proteksi prompt-injection).
- Aksi otomatis whitelist-only, least-privilege (ADR-008).
- Events append-only sebagai audit trail (siapa/apa/kapan tiap resume).
- Egress terbatas & eksplisit (whitelist): allowlist AKTIF hanya (a) endpoint usage provider yang
  jadi sumber probe — `api.anthropic.com/api/oauth/usage` (probe CC, **ADR-001/010**) — dan (b) localhost (LS
  `GetUserStatus`/`RetrieveUserQuotaSummary` agy sesi hidup, **ADR-010 opsi #2**). `api.telegram.org` (kanal
  remote-control Telegram, **ADR-011**) **BELUM di allowlist** — ditambah saat slice M-remote benar-benar
  dibangun (kode konsumen + long-polling outbound-only). **Tidak ada** host Google OAuth
  publik (`oauth2.googleapis.com`/`cloudcode-pa.googleapis.com`): probe agy standalone via `retrieveUserQuota`
  (opsi #3) **dibatalkan** — terbukti membaca pool kuota SALAH (gemini-cli harian ≠ grup agy weekly+5h), lihat
  **ADR-019**; agy-exited kini pakai **optimistic resume + detect** (nol egress baru).
  **Tidak ada** telemetry/analytics keluar. Channel notifikasi eksternal lain (ntfy/email, Nice) = opt-in dengan izin eksplisit.
  *(Revisi 3 Jul 2026: "MVP tanpa jaringan keluar" lama kontradiktif dengan probe usage; egress di-scope
  eksplisit oleh ADR-001 + ADR-010. Revisi 3 Jul sore: tambah `api.telegram.org` — ADR-011. Revisi 11 Jul:
  tambah `oauth2.googleapis.com` — ADR-018. **Revisi 12 Jul: ADR-018 di-supersede ADR-019 → `oauth2.googleapis.com`
  + `cloudcode-pa.googleapis.com` DIHAPUS dari whitelist** (opsi #3 tak viable; live-verify baca pool salah).
  **Revisi 18 Jul (RD-4): `api.telegram.org` DIHAPUS dari allowlist** — M-remote ditunda tak-tentu (keputusan
  owner) → host tanpa konsumen produksi melanggar least-privilege (preseden persis ADR-019); dikembalikan saat
  slice M-remote dibuka.)*
- **Remote-control (tier B/C) — kontrol keamanan wajib** (detail: THREAT-MODEL.md + ADR-012/013):
  ingress hanya dari `chat_id` allowlist (default-deny, sender tak sah di-drop+audit); relay-instruksi
  **wajib konfirmasi eksplisit** (human-in-the-loop, tak ada inject tanpa konfirmasi); egress output =
  redaksi rahasia + size-cap + opt-in per sesi; injection firewall (isi output = data, tak jadi aksi);
  rate-limit per sender. **THREAT-MODEL.md = gate wajib sebelum implementasi tier C.**
- **Web UI monitor (M-web, ADR-028) — ingress lokal, bukan egress.** Membuka listener HTTP **`127.0.0.1` saja**
  (loopback terjangkau proses lokal lain, kelas T-L1 → data-minimize = proyeksi ter-firewall, nol jalur data baru);
  read-only GET; Host-guard anti-DNS-rebinding; halaman self-contained → **nol egress baru** (allowlist egress
  tak berubah). Gate security-review M-web (THREAT-MODEL §9, T-W1..W6).

## Web UI monitor (M-web, ADR-028)

- **Opt-in, default mati.** `acca web [--port]` (default `4599`, env `ACCA_WEB_PORT`). Bukan bagian daemon default.
- **Bind `127.0.0.1` SAJA** (hardcoded). LAN/`0.0.0.0` = ADR terpisah + auth (di luar v1).
- **Read-only:** hanya `GET /` (HTML self-contained) + `GET /api/status` (JSON); method lain → **405**; nol mutasi.
- **Nol jalur data baru:** `/api/status` = proyeksi ter-firewall yang SUDAH ADA (`toSessionStatusView` tanpa
  `cli_session_id`/`cwd`, `formatEventLine` allowlist, `formatUsageLines` G-9). Endpoint tak singkap > IPC status.
- **Nol egress baru:** halaman self-contained (CSS+JS inline, nol CDN/font/analytics). **Host-guard** `127.0.0.1`/
  `localhost` → else 403 (DNS-rebinding). Render nilai sbg teks (anti-XSS).
- **Isolasi availability:** server web opt-in, best-effort — **BUKAN** bagian SLA uptime daemon; crash web tak
  mengganggu auto-resume (proses/jalur terpisah). Resource: dapat-diabaikan (poll ~5s, JSON kecil).

## Compliance

- MVP lokal, single-user, tidak mengumpulkan data pribadi pihak lain → beban PDP minimal.
- **Web UI (M-web):** lokal + single-user + loopback + nol egress eksternal + data ter-minimize → **nol delta**
  kewajiban PDP/PSE (tak ada data pribadi baru dikumpulkan/dikirim keluar mesin).
- Bila kelak ada telemetry/cloud sync: tinjau UU PDP + lokasi data sebelum implementasi (ADR baru).

## Portability

- Wajib jalan di **Ubuntu 24.04 (daily)** dan **Windows 11 (weekend)**; idealnya macOS.
- Path handling cross-platform (jangan hardcode `~` / separator POSIX).

## Observability

- Log terstruktur per transisi status; `acca log` bisa menelusuri riwayat sesi.
- Health-check: `acca status` menampilkan liveness daemon + waktu cek usage terakhir.
