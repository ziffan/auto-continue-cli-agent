# Security Policy

> **English:** If you found a security vulnerability in `acca`, please report it privately via
> GitHub's [private vulnerability reporting](https://github.com/ziffan/auto-continue-cli-agent/security/advisories/new) (tab **Security → Report
> a vulnerability**) on this repository. Do **not** open a public issue for security reports. This is
> a solo-maintained, non-commercial project — reports are handled best-effort, with no SLA and no
> bug bounty.

## Versi yang didukung

`acca` masih **pra-rilis** (`0.x`, lihat `package.json`). Hanya branch `main` terkini yang
didukung — tak ada jaminan backport ke rilis/tag lama. Kalau menemukan kerentanan pada versi lama,
verifikasi dulu apakah masih reproduksi di `main` sebelum melapor.

## Melaporkan kerentanan

Gunakan **GitHub private vulnerability reporting**: tab **Security → "Report a vulnerability"** di
repo ini. **Jangan buka issue publik** untuk laporan kerentanan — issue publik terekspos ke semua
orang sebelum ada perbaikan.

Kontak alternatif (kalau private reporting tak bisa diakses): lewat
[kampusmerah.com](https://kampusmerah.com).

Proyek ini di-maintain solo. Laporan ditangani **best-effort, tanpa SLA, tanpa bug bounty**. Saya
akan berusaha membalas dan menindaklanjuti secepat mungkin, tapi tak ada jaminan waktu respons.

## Model kepercayaan (baca sebelum menjalankan acca)

`acca` adalah supervisor lokal yang berjalan dengan privilege user biasa (bukan root/admin) di
mesin Anda. Ringkasan apa yang ia lakukan:

- **Membaca kredensial Claude Code (`~/.claude/.credentials.json`) secara read-only** — hanya untuk
  probe usage; isinya tak pernah disalin, tak pernah di-log, tak pernah dikirim ke jaringan.
- **Men-spawn proses CLI agent (Claude Code / Antigravity CLI) lewat PTY** untuk memonitor dan
  melanjutkan sesi yang terhenti karena limit usage.
- **Menulis state ke SQLite lokal** (`acca.db`) — riwayat sesi, job, dan audit log (`events`,
  append-only, tak pernah di-hard-delete).
- **Membuka listener HTTP loopback (`127.0.0.1`) hanya bila `acca web` dijalankan secara eksplisit**
  — read-only, tanpa endpoint mutasi, opt-in (bukan default).
- **Egress terbatas allowlist host yang ditegakkan di kode** (`src/shared/http.ts`): hanya
  `api.anthropic.com` + loopback (`localhost`, `127.0.0.1`, `[::1]`). Host Google OAuth
  (`oauth2.googleapis.com`/`cloudcode-pa.googleapis.com`) **sengaja TIDAK ada di allowlist** — probe
  kuota standalone dibatalkan (ADR-018 di-supersede ADR-019), jadi acca tak menambah egress OAuth
  baru. Nol telemetry. Catatan: proses CLI agent yang di-spawn acca tentu menghubungi endpoint
  vendornya sendiri — itu di luar kendali acca dan bukan bagian dari allowlist ini.

Dua kontrol struktural yang mengikat seluruh desain:

- **Injection firewall**: output/transcript CLI agent diperlakukan sebagai **data, bukan
  perintah** — tak ada aksi yang diturunkan dari isi output (ADR-013).
- **Batas otonomi human-in-the-loop, never autonomous**: aksi otomatis dibatasi ke
  resume/continue/probe/verify pada sesi yang **sudah ada**; instruksi baru dari user (termasuk via
  kanal remote) wajib konfirmasi eksplisit sebelum di-inject ke sesi (ADR-008).

Detail lengkap: `docs/THREAT-MODEL.md` dan `docs/DECISIONS.md`.

## Batasan yang diketahui & diterima (bukan kerentanan baru)

Poin di bawah ini adalah residual risk yang **sudah didokumentasikan dan diterima secara sadar**
(bukan bug). Kalau laporan Anda hanya menyatakan ulang salah satu poin ini tanpa skenario baru, kami
kemungkinan akan menutupnya sebagai "known/accepted" — silakan tetap laporkan bila Anda menemukan
cara mengeksploitasinya melampaui apa yang didokumentasikan.

- **Asumsi single-user desktop** (ADR-006). `acca` tidak dirancang untuk mesin multi-user/bersama.
  Proses lain milik **user OS yang sama** secara prinsip bisa menjangkau kanal IPC lokal (socket/named
  pipe) dan port loopback `acca web` bila aktif.
- **Windows named pipe DACL terbuka by design** (ADR-023). Node.js tak menyediakan API untuk
  menyetel DACL named pipe. "Cek PID client" sengaja **tidak** dipakai sebagai kontrol keamanan
  karena PID pada named pipe Windows spoofable (bukan mitigasi yang valid).
- **`acca web` = read-only, bind `127.0.0.1` saja, tanpa autentikasi by design** (ADR-028). Tak ada
  endpoint mutasi; payload yang diekspos sudah melalui proyeksi ter-firewall yang sama dengan jalur
  IPC lokal.
- **Bukan untuk mesin multi-user/bersama.** Semua asumsi di atas gugur di lingkungan itu — jangan
  jalankan `acca` di mesin yang dipakai bersama user lain yang tak Anda percaya.

Laporan yang mengandaikan **penyerang sudah memegang akun OS pengguna** (kompromi lokal penuh) di
luar scope — pada titik itu penyerang sudah punya akses setara dengan pengguna itu sendiri, terlepas
dari `acca`.

Detail ancaman/mitigasi lengkap per poin: `docs/THREAT-MODEL.md` (§8–§9) dan `docs/DECISIONS.md`
(ADR-006/023/028).
