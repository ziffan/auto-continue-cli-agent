# PROJECT.md — auto-continue-cli-agent

> Output **Bagian 2 — Perencanaan (Doc-First)**, sub-bagian 2.1 Discovery.
> Enam artefak sekuensial: Problem Statement → Persona → User Stories → User Flow → Wireframe → Acceptance Criteria.
> Aturan edit: file ini boleh berubah **dengan Change Log** (di bawah). Spec di-lock sebelum implementasi.

---

## 1. Problem Statement

**Untuk siapa (spesifik).**
Solo agentic engineer / power-user yang menjalankan **sesi CLI coding-agent berdurasi panjang**
(Claude Code sebagai primary, Antigravity CLI sebagai sekunder) di mesin sendiri (Linux daily /
Windows weekend), sering paralel/unattended, dan berlangganan plan berbayar yang tetap punya
limit usage (5-jam + mingguan).

**Masalah apa.**
Sesi agent berhenti mendadak ketika usage/quota habis. Transcript tidak hilang, tapi untuk
melanjutkan user harus melakukan rangkaian manual: (a) menyadari sesi sudah berhenti, (b) tahu
kapan limit reset, (c) kembali ke *working directory* yang persis sama, (d) menjalankan perintah
resume yang benar (`claude --resume <id>` / padanan Antigravity). Kalau limit reset jam 02:00,
praktis progres menganggur sampai user bangun dan mengurusnya manual.

**Biaya masalah (terukur — kasar, diisi sejak awal).**

| Komponen biaya | Estimasi | Dasar |
|---|---|---|
| Sesi terhenti per minggu (heavy user) | 3–8 kali | limit 5-jam + mingguan sering kena saat kerja intens |
| Idle time per interupsi (limit reset saat user tidak di depan layar) | 0,5–8 jam | tergantung jam reset vs jam kerja; kasus malam hari terburuk |
| Overhead re-entry manual (sadar + cd + resume + re-orient konteks) | 5–15 menit/interupsi | context switch mahal untuk solo dev |
| Total waktu produktif hilang/minggu | **~1–4 jam** | 3–8 interupsi × (idle + overhead) |

Biaya utamanya **waktu wall-clock yang menganggur** dan **beban kognitif jaga terminal**, bukan uang langsung.

**Ukuran sukses (metrik konkret).**

| Metrik | Target MVP |
|---|---|
| Interupsi limit yang ter-resume otomatis tanpa aksi manual | ≥ 90% |
| Selisih waktu antara limit reset dan sesi lanjut kembali | ≤ 5 menit |
| Deteksi salah (false positive "kena limit") | < 1 per 100 sesi |
| Sesi yang di-resume di working directory yang salah | 0 |
| Manual terminal-watching yang dihemat | ~1–4 jam/minggu (lihat tabel biaya) |

**Batasan (yang TIDAK dikerjakan di MVP).**

- **Tidak** menambah/mem-bypass limit usage. Ini penjadwal, bukan quota-cracker.
- **Tidak** memulai/melanjutkan sesi berisi instruksi arbitrer secara **otonom**. Supervisor tak pernah
  *mengarang* instruksi. Aksi auto dibatasi `resume/continue`/`probe`; instruksi apa pun dari user (termasuk
  via Telegram) = **human-in-the-loop, wajib konfirmasi** — supervisor hanya me-relay, bukan mengarang
  (batas otonomi & keamanan; ADR-008/013).
- **Tidak** GUI/dashboard web di MVP. UX MVP = CLI + notifikasi/kontrol lokal **dan** kanal remote **Telegram**
  (notif keluar + kontrol `status/resume/cancel` + relay-instruksi ber-konfirmasi; ADR-011/012/013). Dashboard
  web = Later (US-10).
- **Tidak** dukung agent selain Claude Code & Antigravity CLI di MVP (OpenCode = Later).
- **Tidak** menyimpan/mengirim kredensial akun; supervisor memakai sesi login yang sudah ada di mesin.
- **Tidak** menjamin resume saat mesin mati/tidur (butuh always-on host; lihat NFR & Failure Modes).

---

## 2. User Persona

**Persona utama — "Solo Orchestrator"**

| Atribut | Isi |
|---|---|
| Profil | Solo dev / power-user, menjalankan agent fleet dari CLI; sering multi-sesi paralel |
| Kemampuan teknis | Tinggi — nyaman dengan terminal, cron/systemd, JSON/YAML, tapi tidak mau membangun infra ad-hoc tiap kali |
| Kebiasaan sekarang | Jalankan Claude Code / Antigravity CLI langsung; cek limit manual via `/usage`; resume manual; kadang pasang timer HP untuk cek limit |
| Frustrasi | Sesi mati saat ditinggal; lupa `cd` ke folder benar; limit reset tengah malam menganggur; tidak ada notifikasi kapan bisa lanjut |
| Job-to-be-done | "Saat aku menjalankan agent lama, aku ingin ia otomatis lanjut sendiri begitu limit pulih, tanpa aku harus jaga terminal." |
| Lingkungan | Ubuntu (daily, laptop) + Windows 11 (weekend, PC); kadang node headless 24/7 di LAN |

**Persona sekunder (post-MVP)** — tim kecil yang berbagi node build always-on dan ingin dashboard status
usage bersama. Tidak dijadikan target MVP.

---

## 3. User Stories

Format Connextra + acceptance criteria (Given/When/Then). Klasifikasi: **Must (MVP)** / **Nice (v1)** / **Later (v2+)**.

### Must (MVP)

**US-1 — Deteksi sesi kena limit**
*As a* solo orchestrator, *I want* supervisor mendeteksi otomatis saat sesi CLI berhenti karena
usage/quota, *so that* aku tidak perlu memelototi terminal.
- Given sebuah sesi berjalan di bawah supervisor,
  When CLI mengeluarkan sinyal kehabisan limit (hook event `StopFailure` [Claude Code] / pesan
  rate-limit di output / exit code [print-mode] / entri error di transcript),
  Then supervisor menandai sesi `LIMIT_HIT`, mencatat waktu deteksi + sumber sinyal + **kondisi proses
  (masih hidup di prompt vs sudah exit)** — sesi interaktif umumnya TETAP HIDUP saat limit (RESEARCH §2c).

**US-2 — Estimasi waktu reset**
*As a* solo orchestrator, *I want* tahu perkiraan kapan limit reset, *so that* resume bisa dijadwalkan.
- Given sebuah sesi `LIMIT_HIT`,
  When supervisor punya sinyal reset (`retry-after` / header utilization / heuristik window 5-jam),
  Then supervisor menyimpan `reset_at` dan menampilkannya ke user; jika tak ada sinyal pasti,
  pakai fallback konservatif (retry berjadwal dengan backoff) dan tandai estimasinya "perkiraan".

**US-3 — Auto-resume di working directory benar**
*As a* solo orchestrator, *I want* sesi otomatis dilanjutkan setelah limit pulih, *so that* progres jalan lagi tanpa aku.
- Given sebuah sesi `LIMIT_HIT` dengan `reset_at`,
  When waktu reset tercapai dan probe usage menunjukkan kuota tersedia,
  Then supervisor menjalankan perintah resume yang benar **di cwd asli sesi** dan status jadi `RESUMED`.

**US-4 — Monitor usage terpusat**
*As a* solo orchestrator, *I want* satu tampilan status usage kedua CLI, *so that* aku tak perlu cek satu-satu.
- Given supervisor berjalan,
  When aku menjalankan `acca status`,
  Then aku melihat, per tool: status limit terkini yang diketahui, sesi aktif/menunggu, dan `reset_at` terjadwal.

**US-5 — Notifikasi peristiwa penting**
*As a* solo orchestrator, *I want* notifikasi saat sesi kena limit dan saat berhasil di-resume, *so that* aku tetap update tanpa jaga layar.
- Given supervisor berjalan,
  When sesi berpindah ke `LIMIT_HIT` atau `RESUMED` atau `FAILED`,
  Then supervisor mengirim notifikasi lokal (desktop/CLI) **dan** ke Telegram (US-14) — kanal remote = primer
  untuk kasus "user jauh dari mesin" (persona §2).

### Remote-control Telegram — Must (MVP)

> Fitur ini masuk MVP atas keputusan user (3 Jul 2026). Prinsip pengikat: **human-in-the-loop, never autonomous**
> (ADR-008). Semua perintah remote hanya dari `chat_id` terotorisasi (ADR-012). Detail guardrail: ADR-011/012/013.

**US-14 — Notifikasi ke Telegram** *(tier A; mempromosikan US-9 utk Telegram)*
*As a* solo orchestrator, *I want* notifikasi peristiwa (LIMIT_HIT/RESUMED/FAILED) sampai ke Telegram-ku, *so that* aku tahu status walau jauh dari mesin.
- Given supervisor berjalan dengan bot Telegram terkonfigurasi,
  When sesi berpindah status penting,
  Then supervisor mengirim pesan ke `chat_id` terotorisasi (egress hanya ke `api.telegram.org`).

**US-15 — Kontrol dari Telegram** *(tier B)*
*As a* solo orchestrator, *I want* menjalankan `status`, `resume-now <id>`, `cancel <id>` dari Telegram, *so that* aku bisa mengendalikan supervisor tanpa akses terminal.
- Given pesan perintah dari `chat_id` **terotorisasi** (ADR-012),
  When perintah termasuk whitelist kontrol (`status`/`resume-now`/`cancel`),
  Then supervisor mengeksekusinya (otoritas sama dengan CLI lokal, tak ada yang baru) & membalas hasilnya;
  pesan dari pengirim tak terotorisasi di-drop + di-audit.

**US-16 — Lihat output agent dari Telegram** *(tier C — egress sensitif)*
*As a* solo orchestrator, *I want* mengintip output sesi dari Telegram, *so that* aku bisa menilai kondisi agent dari jauh.
- Given sesi ter-supervise & user meng-**opt-in** stream output untuk sesi itu,
  When user meminta cuplikan output,
  Then supervisor mengirim potongan yang **sudah diredaksi rahasia** + **size-capped**, diberi label
  **"data tak tepercaya"** (ADR-013); default (tanpa opt-in) = tidak stream.

**US-17 — Kirim instruksi dari Telegram (ber-konfirmasi)** *(tier C — otoritas paling sensitif)*
*As a* solo orchestrator, *I want* mengirim instruksi ke sesi agent dari Telegram, *so that* aku bisa mengarahkan kerja dari jauh — **tetap dengan gerbang konfirmasi**.
- Given instruksi dari `chat_id` terotorisasi,
  When supervisor menerimanya,
  Then instruksi di-**queue** + di-echo balik → **wajib konfirmasi eksplisit** user (mode `ask`) → baru di-inject
  ke PTY; **tanpa konfirmasi tak ada inject**. Tak ada aksi yang diturunkan dari *isi* output agent (injection
  firewall, ADR-013). Setiap langkah di-audit (`events`).

### Web UI monitor — v1 (opt-in, dibangun 18 Jul; promosi US-10)

**US-10 — Dashboard web read-only status usage & sesi** *(v1 module; opt-in; ADR-028)*
*As a* solo orchestrator, *I want* melihat usage/sesi/log acca di browser lokal, *so that* aku bisa memantau
sekilas tanpa terminal — **tanpa menambah permukaan aksi**.
- Given daemon menulis state ke store (usage snapshot, sesi, events),
  When aku menjalankan `acca web` (opt-in, default mati) lalu buka `http://127.0.0.1:<port>`,
  Then browser menampilkan **mirror read-only** `acca status`: usage bar 2 CLI + reset countdown, liveness
  daemon, tabel sesi, tail event-log — auto-refresh (~5s). **Nol aksi** (tak ada resume/cancel dari web di v1).
- Given endpoint di-bind **`127.0.0.1` saja**,
  When proses/website mana pun mencoba membacanya,
  Then hanya `GET /` (HTML self-contained) + `GET /api/status` (JSON) yang dilayani; data = **proyeksi
  ter-firewall yang SAMA** dengan IPC status (`toSessionStatusView` tanpa `cli_session_id`/`cwd`,
  `formatEventLine` allowlist, `formatUsageLines` G-9) — **nol jalur data baru**; `Host` non-loopback → 403
  (guard DNS-rebinding). Halaman **100% self-contained** (nol aset eksternal/CDN → nol egress baru).

### Nice (v1)

- **US-6** Mode konfirmasi "ask" vs full-auto. *(Untuk **resume** = tetap Nice. Untuk **relay-instruksi remote**
  (US-17), mode `ask` **naik jadi Must** — konfirmasi wajib, bukan opsional; ADR-008/013.)*
- **US-7** Retry berjenjang dengan backoff saat probe pasca-reset masih kosong (mis. kuota mingguan habis).
- **US-8** Riwayat & log interupsi/resume yang bisa ditelusuri (`acca log`).
- **US-9** Channel notifikasi eksternal (ntfy/email) — dengan izin eksplisit user. *(Kanal **Telegram** dipromosikan
  ke Must sebagai US-14; ntfy/email tetap Nice.)*

### Later (v2+)

- ~~**US-10** Dashboard web status usage & sesi.~~ → **DIPROMOSIKAN ke v1 module (opt-in, read-only)** 18 Jul — lihat "Web UI monitor — v1" di atas + ADR-028.
- **US-11** Dukungan OpenCode dan agent CLI lain (arsitektur adapter).
- **US-12** Mode multi-user/tim dengan node always-on bersama.
- **US-13** Prediksi proaktif "limit akan habis dalam ~N menit" sebelum benar-benar berhenti.

---

## 4–5. User Flow + Wireframe → diarsipkan

> **Alur** (happy-path auto-continue, cabang inject-PTY vs resume-by-id, sub-flow remote Telegram) +
> **wireframe low-fi** (CLI `acca status`/`run`/`log` + web monitor) dipindah ke
> [`.archived/PROJECT-design.md`](.archived/PROJECT-design.md) saat pelangsingan 19 Jul — fitur sudah
> dibangun (CLI/web) atau ditunda (Telegram). Baca di sana bila task menyentuh flow/wireframe.

## 6. Acceptance Criteria (ringkas — melekat ke story)

Checklist test milestone (detail Given/When/Then ada di tiap story §3):

- [ ] AC-1 Deteksi `LIMIT_HIT` benar untuk kedua CLI (dari fixture output/transcript nyata). (US-1)
- [ ] AC-2 `reset_at` terisi dari sinyal pasti bila ada; fallback heuristik ditandai "perkiraan". (US-2)
- [ ] AC-3 Auto-resume berjalan **di cwd asli** dan sesi lanjut. (US-3)
- [ ] AC-4 `acca status` menampilkan usage + sesi + reset terjadwal, dengan empty/error state. (US-4)
- [ ] AC-5 Notifikasi terkirim pada transisi LIMIT_HIT / RESUMED / FAILED. (US-5)
- [ ] AC-6 Probe pasca-reset kosong → backoff & jadwal ulang, tidak spam-resume. (US-2, US-7)
- [ ] AC-7 State timer bertahan lintas restart supervisor (recover & lanjut). (US-3, flow §4)
- [ ] AC-8 Tidak pernah resume di working directory yang salah (status BLOCKED bila cwd hilang). (batasan §1)
- [ ] AC-9 Notifikasi peristiwa sampai ke Telegram `chat_id` terotorisasi; egress hanya `api.telegram.org`. (US-14)
- [ ] AC-10 Perintah kontrol (`status/resume/cancel`) dari `chat_id` terotorisasi jalan; **sender tak terotorisasi di-drop + di-audit** (default-deny). (US-15, ADR-012)
- [ ] AC-11 Instruksi remote **tak pernah** di-inject tanpa konfirmasi eksplisit; tanpa `chat_id` terotorisasi = ditolak. (US-17, ADR-008/013)
- [ ] AC-12 Output ke Telegram teredaksi rahasia + size-capped + opt-in; **tak ada aksi diturunkan dari isi output** (injection firewall). (US-16, ADR-013)

**Web UI monitor (US-10, ADR-028) — diuji di M-web:**
- [ ] AC-W1 `acca web` (opt-in) menyajikan `GET /` (HTML self-contained) + `GET /api/status` (JSON) di **`127.0.0.1` saja**; mirror read-only usage/liveness/sesi/event-log, auto-refresh. (US-10)
- [ ] AC-W2 **Read-only:** hanya method `GET`; tak ada endpoint mutasi (resume/cancel) di v1; method lain → 405. (US-10, ADR-008/028)
- [ ] AC-W3 `/api/status` = **proyeksi ter-firewall yang sama** dgn IPC status (nol `cli_session_id`/`cwd`/secret/payload mentah); `Host` non-loopback → **403** (guard DNS-rebinding). (US-10, ADR-028, T-W1/T-W3)
- [ ] AC-W4 Halaman **self-contained** (nol aset eksternal → nol egress baru); data dirender sbg **teks** (bukan `innerHTML`) → nol XSS dari nilai tersimpan. (US-10, ADR-028, T-W4/T-W5)

> Catatan: AC-9..AC-12 diuji di **M-remote** dengan **security-review gate**; prasyarat **THREAT-MODEL.md** (ADR-013 §5).
> Flow §4 (sub-flow remote-control) & wireframe §5 (interaksi Telegram) + container Remote Gateway (ARCHITECTURE)
> + THREAT-MODEL.md **sudah dibuat 3 Jul (sore, lanjutan)**. Sisa: putuskan pola redaksi + lib bot → lock ADR-011/012/013.

---

## Change Log

| Tanggal | Perubahan | Oleh |
|---|---|---|
| 2026-07-02 | Draft awal (6 artefak discovery Bagian 2.1). | Ziffan × Claude |
| 2026-07-03 | US-1 + flow §4 direvisi pasca temuan hook `StopFailure` & nuansa "limit-hit ≠ proses exit": sumber sinyal deteksi diperluas, langkah 9 bercabang inject-PTY (proses hidup) vs resume-by-id (proses mati). (RESEARCH §2c) | Claude (validasi sesi 3 Jul) |
| 2026-07-03 (sore) | **Fitur remote-control Telegram masuk MVP (tier A+B+C, keputusan user).** Batasan §1 diksi ulang (human-in-the-loop, never autonomous); US-5 rujuk Telegram; **US-14..US-17 baru (Must)** — notif/kontrol/lihat-output/instruksi-ber-konfirmasi; US-6 mode `ask` naik Must utk relay-instruksi; US-9 Telegram→US-14 (ntfy/email tetap Nice); AC-9..AC-12 baru. Dasar: ADR-008 (revisi) + ADR-011/012/013 (baru). Flow/wireframe/ARCHITECTURE/NFR/MILESTONES/THREAT-MODEL = sesi berikutnya. | Ziffan × Claude |
| 2026-07-03 (sore, lanjutan) | **Flow §4 sub-flow remote-control** (notif→kontrol→confirm gate→inject; cabang error remote) + **wireframe §5 interaksi Telegram (mobile)** ditambahkan, selaras ADR-011/012/013. (Rantai doc-first Telegram: THREAT-MODEL.md dibuat + ARCHITECTURE Remote Gateway + NFR egress `api.telegram.org` + MILESTONES M-remote — lihat DECISIONS change log.) | Ziffan × Claude |
| 2026-07-18 | **US-10 (dashboard web) DIPROMOSIKAN dari Later ke v1 module (opt-in, read-only) — keputusan owner.** Story expanded (Given/When/Then) + wireframe web §5 + **AC-W1..W4** (loopback-only, read-only GET, proyeksi ter-firewall = nol jalur data baru, Host-guard DNS-rebinding, self-contained nol-egress, render-as-text anti-XSS). Dasar: **ADR-028** (read-only localhost). Rantai doc-first Web UI: THREAT-MODEL §9 (T-W1..W6) + NFR (Web UI) + MAP (`src/web/`) + MILESTONES M-web — lihat DECISIONS change log. | Ziffan × Claude |
