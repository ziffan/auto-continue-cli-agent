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

## Availability

- Target **99% uptime daemon** di host always-on (≈ realistis untuk solo ops; jangan 99,9%).
- Auto-resume hanya terjamin saat host hidup. Di laptop tidur → resume tertunda sampai bangun (batasan terdokumentasi).

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
- Egress terbatas & eksplisit (whitelist): MVP hanya boleh memanggil (a) endpoint usage provider yang
  jadi sumber probe — `api.anthropic.com/api/oauth/usage`; `cloudcode-pa.googleapis.com …retrieveUserQuota`
  (probe agy pre-resume, **ADR-010 hybrid**) — (b) localhost (LS `GetUserStatus` agy, **ADR-010**) — dan
  (c) `api.telegram.org` (kanal remote-control Telegram, long-polling outbound-only, **ADR-011**). **Tidak ada**
  telemetry/analytics keluar. Channel notifikasi eksternal lain (ntfy/email, Nice) = opt-in dengan izin eksplisit.
  *(Revisi 3 Jul 2026: "MVP tanpa jaringan keluar" lama kontradiktif dengan probe usage; egress di-scope
  eksplisit oleh ADR-001 + ADR-010. Revisi 3 Jul sore: tambah `api.telegram.org` — ADR-011.)*
- **Remote-control (tier B/C) — kontrol keamanan wajib** (detail: THREAT-MODEL.md + ADR-012/013):
  ingress hanya dari `chat_id` allowlist (default-deny, sender tak sah di-drop+audit); relay-instruksi
  **wajib konfirmasi eksplisit** (human-in-the-loop, tak ada inject tanpa konfirmasi); egress output =
  redaksi rahasia + size-cap + opt-in per sesi; injection firewall (isi output = data, tak jadi aksi);
  rate-limit per sender. **THREAT-MODEL.md = gate wajib sebelum implementasi tier C.**

## Compliance

- MVP lokal, single-user, tidak mengumpulkan data pribadi pihak lain → beban PDP minimal.
- Bila kelak ada telemetry/cloud sync: tinjau UU PDP + lokasi data sebelum implementasi (ADR baru).

## Portability

- Wajib jalan di **Ubuntu 24.04 (daily)** dan **Windows 11 (weekend)**; idealnya macOS.
- Path handling cross-platform (jangan hardcode `~` / separator POSIX).

## Observability

- Log terstruktur per transisi status; `acca log` bisa menelusuri riwayat sesi.
- Health-check: `acca status` menampilkan liveness daemon + waktu cek usage terakhir.
