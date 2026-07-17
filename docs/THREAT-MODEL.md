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

## 8. Permukaan lokal fondasi — M5 security pass (bukan remote)

> Ditambahkan 2026-07-17 (spec M5). §1–§7 menutup permukaan **remote Telegram**. Bagian ini menutup permukaan
> **lokal fondasi** yang diaudit di M5 security pass (persona security-review) **sebelum** M-remote memperluasnya.
> Pengikat: **ADR-023** (IPC DACL), ADR-005/010 (credential), ADR-004 (retensi), ADR-021 (service).

### 8.1 Ancaman lokal → mitigasi → jejak

| ID | Ancaman | Mitigasi | Kontrol | AC |
|---|---|---|---|---|
| T-L1 | **DACL named pipe Windows terbuka** (I-26) — user lokal lain connect+read pipe → `status` bocorkan daftar cwd | **DITERIMA sbg residual risk (R-5)** + hardening lapisan-app: minimalkan data sensitif lewat pipe (`status` tak dump cwd tak perlu); Node tak punya API set-DACL (verified web); native addon ditolak | ADR-023 | AC-M5-4 |
| T-L2 | User lokal lain **memicu** perintah via pipe (`inject`/`resume-now`/`cancel`) | **Injection firewall struktural:** `inject` = token literal hardcoded wrapper **tanpa payload** → tak bisa suntik teks arbitrer; `resume-now`/`cancel` = whitelist terbatas; **hanya daemon mutasi state** (ADR-017); audit `events` | ADR-014/020/017/023 | AC-M5-4 |
| T-L3 | **Cek PID client sbg mitigasi** (kandidat lama I-26) ternyata palsu — PID spoofable | **Kandidat DITOLAK** (ADR-023): PID named pipe spoofable (Project Zero/CVE-2018-0749); Microsoft anti-PID-enforcement → tak dipakai (hindari rasa-aman-palsu) | ADR-023 | AC-M5-4 |
| T-L4 | **Kredensial upstream bocor** — `oauth_creds.json`/`.credentials.json` tersalin/ter-log | Kredensial **hanya dibaca**, tak disalin/di-log (ADR-005/010); tak masuk `events.payload`/log; redaksi bila muncul di jalur egress | ADR-005/010 | AC-M5-5 |
| T-L5 | **Egress nyasar** ke host non-allowlist (exfil / dep jahat) | **Whitelist egress** `guardEgress`/`ALLOWED_HOSTS` — hanya host NFR; non-allowlist → `EgressBlockedError` (test) | ADR-001/010/019/NFR | AC-M5-5 |
| T-L6 | **State korup/hilang** (`acca.db`) — crash saat write / disk error | **Backup/DR minimal** (ADR-022): WAL checkpoint + file copy + retensi; restore terdokumentasi; no-hard-delete (arsip) | ADR-022/004 | AC-M5-6/7 |
| T-L7 | **Service dijalankan dengan privilege berlebih** | Daemon **runtime least-privilege** (tak butuh root/admin); admin hanya saat **install** service (sekali) | ADR-021 | AC-M5-4 |
| T-L8 | **Tampering audit log** (`events`) menghapus jejak | `events` **append-only** (tak ada UPDATE/DELETE); verifikasi di security pass | ADR-004/NFR | AC-M5-4 |

### 8.2 Residual risk lokal (tambahan §6)

- **R-5 (diterima, terdokumentasi — single-user desktop).** DACL named pipe Windows terbuka by Node design (Everybody+
  Anonymous read; Node tak punya API set-DACL — issues nodejs/node #47086/#30823/#17743). User lokal lain bisa connect+read
  pipe + memicu perintah whitelist (dibatasi injection firewall — tak bisa suntik teks arbitrer).
  **Hardening M5.3 (T-L1):** payload IPC `status` kini di-**data-minimize** (`toSessionStatusView` — TANPA `cli_session_id`/
  `cwd`/field audit) → connect+read pipe **tak lagi** membocorkan id resume-capability maupun path proyek; sisa residual =
  pipe tetap bisa di-connect (metadata `ping` + perintah whitelist), bukan lagi data sensitif. **Diterima** untuk single-user
  desktop. **Node headless multi-akun (ADR-007):** relevan → mitigasi deploy = akun OS khusus daemon (isolasi user-level),
  bukan native addon. Revisit ADR-023 hanya bila kebutuhan multi-akun host konkret.
- **R-6 (diterima).** Backup RPO = interval snapshot (bukan continuous, ADR-022) → job/event antara snapshot terakhir &
  korupsi bisa hilang. Diterima single-user (kehilangan ≤1 interval; sesi LIMIT_HIT recover manual dari CLI agent asli).

### 8.3 Gate M5 security pass

Security-review gate M5 (skill `milestone-wrapup`, persona security-review) HARUS memverifikasi T-L1..T-L8 tertutup atau
tercatat residual (R-5/R-6) **sebelum** M5 dinyatakan selesai — dan **sebelum** M-remote menambah permukaan §1–§7 di atas fondasi ini.

### 8.4 Close-out M5.3 (security pass 5-permukaan)

> Diverifikasi 2026-07-17 (slice M5.3, persona security-review Opus + suite `test/security-*.test.ts`). Verdict per-item.
> Permukaan yang butuh slice `[LIVE]` (service/restore) belum bisa ditutup di sini — ditandai eksplisit.

| ID | Verdict | Bukti / alasan |
|---|---|---|
| T-L1 | **TUTUP (hardened) + residual R-5** | GAP nyata dikonfirmasi (handler `status` lama dump `cli_session_id`+`cwd` ke pipe DACL-terbuka, nol konsumen produksi) → `toSessionStatusView` proyeksi minimal 8-field. `test/security-ipc-status.test.ts` (properti + serialisasi JSON kabel). Pipe tetap terbuka = residual R-5 diterima. |
| T-L2 | **TUTUP (verified)** | Injection firewall struktural dua-lapis: handler `inject` abaikan args; `requestInject` tak punya parameter args. `test/security-inject-firewall.test.ts` termasuk uji **wire-level** (`sendCommand` payload jahat → hanya `CONTINUE_TOKEN` sampai PTY). |
| T-L3 | **N/A (kandidat ditolak)** | Cek-PID sbg enforcement DITOLAK (ADR-023, PID spoofable) — tak ada kode, tak ada permukaan baru. |
| T-L4 | **TUTUP (verified)** | Kredensial hanya-baca; tiap cabang error `ClaudeCredentialsError`/`extractClaudeToken` (8 bentuk) tak membocorkan nilai token; modul tak punya jalur tulis/network. `test/security-credential.test.ts`. |
| T-L5 | **TUTUP (verified)** | Egress whitelist exact-hostname (`Set.has`, bukan substring); domain-confusion/typosquat + URL malformed → `EgressBlockedError`; insecure-TLS hanya loopback. `test/security-egress.test.ts` + `test/http-egress.test.ts`. |
| T-L6 | **PARSIAL — engine ✅, restore/jadwal menunggu M5.2 [LIVE]** | Engine backup (`wal_checkpoint(TRUNCATE)`+copy+prune) ✅ M5.1 (`test/backup.test.ts`); restore terdokumentasi + jadwal + 1× live = M5.2 (belum). Residual R-6 (RPO interval) diterima. |
| T-L7 | **TUTUP untuk Linux (M5.4 LIVE 17 Jul); Windows = M5.5 ditunda/I-33** | systemd `--user` jalan sebagai **user** (bukan root/LocalSystem) — `whoami`/`$HOME`/`acca.db`/kredensial identik dengan sesi user; **install pun user-scope, nol sudo** (`systemctl --user` + `loginctl enable-linger` sendiri). Justru asimetri ini yang membuat Windows Service (LocalSystem, eskalasi privilege) DITOLAK → M5.5 ditunda (I-33). Bukti LIVE: `CGroup: …/user@1000.service/…`, daemon berjalan sbg uid 1000. |
| T-L8 | **TUTUP (verified)** | `events` repo hanya `append`/`listRecent`/`listBySession` — nol method update/delete (struktural). `test/security-audit-append-only.test.ts`. |

**Kesimpulan M5.3:** 5 permukaan SANDBOX-verifiable (T-L1/T-L2/T-L4/T-L5/T-L8) **tertutup**; T-L3 N/A; T-L6/T-L7 menunggu slice `[LIVE]` (M5.2/M5.4/M5.5). Gate security-review §8.3 belum lengkap sampai slice LIVE itu selesai — jangan nyatakan M5 selesai atau mulai M-remote sebelum T-L6/T-L7 ditutup dengan bukti mesin asli.

**Update penutupan M5 (M5.6 wrap-up, 17 Jul):** **T-L7 ✅ TUTUP untuk Linux** (M5.4 LIVE — service = user-scope, nol root). **T-L6 = residual terbuka** (engine backup ✅, tapi **restore LIVE 1× belum dijalankan** = M5.2 LIVE, butuh owner). **Windows (T-L7 paruh Windows) = M5.5 ditunda/I-33.** → **M5 ditutup PARSIAL (Linux track lengkap & LIVE-verified).** Gate ke M-remote: sisa **T-L6 restore LIVE** (1× smoke restore) — kecil, owner-hand.

---

## Change Log

| Tanggal | Perubahan | Oleh |
|---|---|---|
| 2026-07-03 | Draft awal — aset, trust boundary, STRIDE 4 vektor (spoof/authz, egress, injection→aksi, DoS/repudiation), matriks kontrol→AC, residual risk, gate. Gate ADR-013 §5 untuk implementasi tier B/C. | Ziffan × Claude |
| 2026-07-17 | **§8 baru — permukaan lokal fondasi (M5 security pass).** T-L1..T-L8 (DACL named pipe I-26/ADR-023, credential-read, egress whitelist, state korup, service privilege, audit tampering) + residual R-5 (DACL terbuka diterima single-user) / R-6 (backup RPO). Gate security-review M5 sebelum M-remote. Basis: verifikasi web DACL (Node tak bisa set-DACL; PID spoofable) → ADR-023. | Ziffan × Claude |
| 2026-07-17 | **§8.4 close-out M5.3.** Verdict per-item: T-L1 hardened (IPC `status` data-minimize `toSessionStatusView` — buang `cli_session_id`/`cwd`, GAP nyata ditutup) + T-L2/T-L4/T-L5/T-L8 verified via `test/security-*.test.ts` (30 test). T-L3 N/A. T-L6 parsial (engine M5.1 ✅, restore=M5.2 LIVE) / T-L7 menunggu M5.4-5 LIVE. R-5 diperbarui (payload `status` tak lagi bocor sensitif). | Ziffan × Claude |
