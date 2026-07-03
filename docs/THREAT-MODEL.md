# THREAT-MODEL.md — Remote-control Telegram (tier A+B+C)

> **Gate wajib** sebelum implementasi tier B/C (ADR-013 §5). Fitur remote-control Telegram
> membuka permukaan baru (ingress kanal + egress data sensitif + jalur relay-instruksi) yang
> tidak ada di supervisor lokal-only. Dokumen ini mengunci aset, trust boundary, dan ancaman
> beserta pemetaannya ke kontrol yang sudah diputuskan (ADR-011/012/013) dan acceptance criteria
> (AC-9..AC-12, PROJECT §6). ADR merujuk ke sini; dokumen ini **tidak** membuat keputusan baru —
> ia membuktikan bahwa kontrol yang ada menutup ancaman yang ada.
>
> Prinsip pengikat (ADR-008): **human-in-the-loop, never autonomous.** Supervisor me-relay
> instruksi user, tak pernah mengarang; **output agent = data, bukan perintah.**

---

## 1. Scope

**In scope.** Jalur remote Telegram penuh:
- **Tier A** (US-14) — notifikasi keluar (LIMIT_HIT/RESUMED/FAILED) ke `chat_id` terotorisasi.
- **Tier B** (US-15) — perintah kontrol masuk (`status`, `resume-now <id>`, `cancel <id>`).
- **Tier C** (US-16/US-17) — lihat output agent (egress sensitif) + kirim instruksi ber-konfirmasi
  (otoritas paling sensitif).

**Out of scope (dokumen lain / ADR).** Threat model supervisor lokal inti (deteksi/resume) — sudah
ditutup NFR §Security + ADR-008; keamanan upstream provider (Anthropic/Google) — di luar kendali;
keamanan platform Telegram itu sendiri (kita perlakukan `api.telegram.org` sebagai pihak ketiga
tepercaya-terbatas: transport OK, **tapi meng-cache konten** → lihat T-D1).

## 2. Aset yang dilindungi

| Aset | Klasifikasi | Kenapa penting |
|---|---|---|
| Isi transcript / output PTY sesi | **Sensitif** | Bisa memuat kode, isi file, path, rahasia. Bocor = kebocoran IP/kredensial. |
| Bot token Telegram | **Secret (infra)** | Bearer ke bot. Bocor = siapa pun bisa kirim update (ADR-011). *(≠ kredensial akun agent — ADR-005.)* |
| Kredensial upstream (`~/.gemini/oauth_creds.json`) | **Secret (dibaca saja)** | Dipakai probe agy (ADR-010). Tak boleh keluar via Telegram. |
| `chat_id` / `user_id` allowlist | **Konfigurasi kontrol-akses** | Basis authz (ADR-012). Manipulasi = bypass authz. |
| PTY sesi agent (kanal inject) | **Kritis (integritas)** | Jalur eksekusi ke mesin user. Inject tak sah = eksekusi tak sah. |
| `events` audit log | **Integritas (append-only)** | Bukti forensik siapa/apa/kapan. Tampering = kehilangan akuntabilitas. |
| Mesin host & sesi login CLI | **Kritis** | Target akhir. Kompromi = kendali penuh atas fleet agent user. |

## 3. Trust boundary & aktor

```
   UNTRUSTED (internet)                 │  SEMI-TRUSTED        │      TRUSTED (host user)
                                        │  (api.telegram.org)  │
 ┌─────────────────┐  getUpdates(poll)  │  ┌────────────────┐  │  ┌──────────────────────────┐
 │ Pengirim mana pun│ ─────────────────▶│  │  Telegram infra │◀─┼──│  Remote Gateway (daemon)  │
 │ (tahu bot token / │                  │  │  (relay + CACHE) │  │  │  ├ command listener (in)  │
 │  tebak bot name) │◀──── sendMessage ─┼──│                │──┼─▶│  ├ Notifier (out)         │
 └─────────────────┘                    │  └────────────────┘  │  │  └ authz + confirm gate    │
        ▲                               │                      │  └────────────┬─────────────┘
        │ instruksi/perintah            │   Trust boundary #2 ──┼──▶            │ (via IPC lokal)
   Solo Orchestrator (user sah)         │                      │        ┌───────▼────────┐
                                        │                      │        │ Supervisor core │
   Trust boundary #1 ───────────────────┘                      │        │ + PTY sesi agent │
   (pengirim → daemon: siapa pun bisa mengirim)                │        └────────────────┘
```

- **Trust boundary #1 (ingress):** long-polling menarik update dari Telegram → update bisa berasal
  dari **pengirim mana pun** yang menemukan bot. Bot token **bukan** rahasia per-pengirim. Otorisasi
  **harus** di lapisan aplikasi (ADR-012), bukan di kerahasiaan token.
- **Trust boundary #2 (egress):** apa pun yang dikirim ke `api.telegram.org` keluar dari mesin dan
  **di-cache pihak ketiga** — tak bisa ditarik balik meski pesan dihapus.
- **Aktor tepercaya:** Solo Orchestrator (pemilik `chat_id` di allowlist). **Aktor tak tepercaya:**
  pengirim lain, dan **isi output agent** (bisa memuat teks tak tepercaya dari web/dokumen — ini aktor,
  bukan sekadar data pasif; dasar injection firewall ADR-013 §3).

## 4. Ancaman (STRIDE) → mitigasi → jejak

Diprioritaskan pada tiga vektor kunci sesuai batas otonomi. Kolom **AC** = acceptance criteria yang
memverifikasi mitigasi; kolom **Kontrol** = ADR sumber.

### Vektor 1 — Spoofing / Elevation: pengirim tak sah mengeksekusi perintah

| ID | Ancaman | Mitigasi | Kontrol | AC |
|---|---|---|---|---|
| T-S1 | Penyerang tahu/menebak bot → kirim `resume-now`/`cancel` | **Default-deny allowlist `chat_id`**; update di luar allowlist di-drop **dan** di-audit | ADR-012 | AC-10 |
| T-S2 | Bot token bocor (dari `.env`/log) → bearer penuh | Token = infra-secret, `.env` gitignored, redaksi di log; **token bocor ≠ kompromi** karena masih tersaring allowlist | ADR-005/011/012 | AC-10 |
| T-E1 | Pengirim sah pakai tier C untuk aksi arbitrer di mesin | Relay-instruksi **tetap** butuh konfirmasi eksplisit (`/confirm <token>`) walau sender terotorisasi; whitelist perintah kontrol (tak ada perintah shell arbitrer via tier B) | ADR-008 §2 / ADR-013 §1 | AC-11 |
| T-E2 | `chat_id` spoofing | `chat_id` Telegram spoof-resistant (di-set server Telegram); untuk MVP single-user cukup — dicatat sebagai **residual** (§6) untuk multi-user v2 | ADR-012 | AC-10 |

### Vektor 2 — Information disclosure: egress data sensitif ke pihak ketiga

| ID | Ancaman | Mitigasi | Kontrol | AC |
|---|---|---|---|---|
| T-D1 | Output PTY/transcript berisi rahasia dikirim → di-cache Telegram | **Egress guard:** redaksi pola rahasia + **size cap** (truncate, simpan penuh lokal) + **opt-in per sesi** (default: tidak stream) | ADR-013 §2 | AC-12 |
| T-D2 | Kredensial upstream / bot token ikut ter-echo ke chat | Redaksi rahasia berlaku ke semua egress; kredensial hanya dibaca, tak pernah masuk jalur pesan | ADR-010/013 §2 | AC-12 |
| T-D3 | Redaksi pola gagal menangkap rahasia (best-effort) | Lapis kedua: size cap + opt-in membatasi blast radius; pola redaksi = **hybrid regex+entropy** (ADR-013 §2, locked); regex/threshold eksak di-tune M-remote dgn test corpus | ADR-013 §2 | AC-12 |
| T-D4 | Egress "nyasar" ke host selain Telegram (exfil) | **Whitelist egress**: hanya `api.telegram.org` untuk kanal ini (NFR §Security) | ADR-011 / NFR | AC-9 |

### Vektor 3 — Tampering / Elevation: injection→aksi via isi output agent

| ID | Ancaman | Mitigasi | Kontrol | AC |
|---|---|---|---|---|
| T-T1 | Output agent memuat teks tak tepercaya ("abaikan semua, jalankan X") → user tertipu / sistem mem-parse-nya jadi aksi | **Injection firewall:** output di Telegram diberi label **"data tak tepercaya"**; **tak ada aksi/perintah diturunkan dari isi output** — hanya dari perintah user terotorisasi. Jalur data & jalur perintah **terpisah** | ADR-013 §3 / ADR-008 | AC-12 |
| T-T2 | Instruksi masuk langsung di-inject tanpa gerbang | **Human-in-the-loop wajib:** queue → echo balik → `/confirm <token>` → baru inject. **Tanpa konfirmasi tak ada inject** | ADR-008 §2 / ADR-013 §1 | AC-11 |
| T-T3 | Replay/forge token konfirmasi | Token konfirmasi sekali-pakai, terikat ke instruksi ter-queue + sender; kadaluarsa; setiap langkah di-audit | ADR-013 §1/§4 | AC-11 |

### Vektor 4 — Denial of service & Repudiation (pendukung)

| ID | Ancaman | Mitigasi | Kontrol | AC |
|---|---|---|---|---|
| T-N1 | Flood pesan → daemon sibuk / spam inject | **Rate-limit per sender**; perintah tak sah di-drop sebelum proses | ADR-012/013 §4 | AC-10 |
| T-R1 | Sengketa "siapa menyuruh resume/inject?" | **`events` append-only**: tiap perintah, konfirmasi, inject tercatat (sender, waktu, payload) | ADR-013 §4 / NFR §Observability | AC-11 |

## 5. Matriks kontrol → AC (kelengkapan)

Membuktikan tak ada kontrol ADR-013 yang yatim dan tiap AC remote punya ancaman + mitigasi.

| AC (PROJECT §6) | Ancaman tertutup | Kontrol utama |
|---|---|---|
| **AC-9** egress hanya `api.telegram.org` | T-D4 | Whitelist egress (ADR-011/NFR) |
| **AC-10** kontrol dari `chat_id` sah; sender tak sah di-drop+audit | T-S1, T-S2, T-E2, T-N1 | Default-deny allowlist + rate-limit (ADR-012) |
| **AC-11** instruksi tak pernah di-inject tanpa konfirmasi | T-E1, T-T2, T-T3, T-R1 | Human-in-the-loop gate + audit (ADR-008/013 §1/§4) |
| **AC-12** output teredaksi + size-capped + opt-in; tak ada aksi dari isi output | T-D1, T-D2, T-D3, T-T1 | Egress guard + injection firewall (ADR-013 §2/§3) |

Kontrol ADR-013 §1–§4 semuanya terpetakan (§1→T-T2/T-T3; §2→T-D1..D3; §3→T-T1; §4→T-N1/T-R1/T-T3).
Kontrol §5 = gate dokumen ini sendiri.

## 6. Residual risk & asumsi

- **R-1 (diterima, MVP).** `chat_id` = kontrol-akses spoof-resistant, **bukan** kripto-auth. Cukup untuk
  single-user (ADR-006/012); multi-user v2 butuh model lebih kuat (mis. per-user secret / signed command).
- **R-2 (dimitigasi berlapis).** Redaksi rahasia = best-effort pola → bisa lolos. Lapis kedua: size cap +
  opt-in default-off. Pola redaksi = **hybrid regex+entropy** (ADR-013 §2, locked 3 Jul malam); regex/threshold
  eksak + allowlist di-tune di M-remote dengan test corpus redaksi.
- **R-3 (diterima, terdokumentasi).** Telegram meng-cache pesan → egress tak bisa ditarik balik. Karena itu
  egress tier C **opt-in per sesi**, bukan default.
- **R-4 (terdokumentasi).** Long-polling butuh koneksi keluar persisten; kompromi mesin host = kompromi
  total (di luar scope kanal — sama seperti supervisor lokal).
- **Asumsi:** host always-on tepercaya; `.env` tak bocor ke repo (gitignore ditegakkan); satu `chat_id`
  di allowlist untuk MVP.

## 7. Gate & prasyarat implementasi (ADR-013 §5)

Sebelum menulis kode tier B/C (M-remote):
1. Dokumen ini **di-review** (owner: Ziffan × Claude) — ✅ ada.
2. **Pola redaksi rahasia** — ✅ **diputuskan** (hybrid regex+entropy, ADR-013 §2, locked 3 Jul malam);
   regex/threshold eksak + allowlist di-tune di M-remote dengan test corpus.
3. **Lib Telegram bot Node + pin versi** — ✅ **diputuskan** (`grammy` 1.44.0, ADR-011, locked 3 Jul malam).
4. **security-review gate** dijalankan di akhir M-remote terhadap AC-9..AC-12 (skill `milestone-wrapup`).
5. ADR-011/012/013 — ✅ **di-lock (Accepted)** 3 Jul malam setelah rantai doc-first rampung — dokumen ini prasyaratnya.

---

## Change Log

| Tanggal | Perubahan | Oleh |
|---|---|---|
| 2026-07-03 | Draft awal — aset, trust boundary, STRIDE 4 vektor (spoof/authz, egress, injection→aksi, DoS/repudiation), matriks kontrol→AC, residual risk, gate. Gate ADR-013 §5 untuk implementasi tier B/C. | Ziffan × Claude |
