# DECISIONS.md — ADR

> Format Nygard. ADR *Accepted* immutable — revisi = ADR baru yang men-supersede.
> Status per ADR: **Proposed** (masih bisa berubah) / Accepted / Deprecated / Superseded.
> Status per 2026-07-03: **ADR-003 & ADR-004 = Accepted (locked)**; ADR-001/002/005–009 = Proposed;
> ADR-010 = Proposed (draft); **ADR-011/012/013 = Proposed (baru — fitur remote-control Telegram)**.
> Accepted = immutable. ADR-005 & ADR-008 **direvisi 2026-07-03** (masih Proposed) untuk fitur Telegram.

Wajib ada (Bagian 2.2): monolith vs services · stack utama · auth · multi-tenancy · deployment ·
data retention · **model routing policy** · **batas otonomi agent**.

---

## ADR-001: Pisahkan "monitor usage" (jalur resmi) dari "deteksi sesi mati" (wrapper)
**Status:** Proposed
**Context:** Koreksi riset (RESEARCH.md §2, verifikasi Chrome 2 Jul 2026): usage Claude Code **kini**
diekspos ke statusLine JSON (v2.1.80, isu #18121) + ada endpoint OAuth usage (undocumented). Asumsi awal
"tak terekspos ke hook" batal. Namun statusLine hanya hidup selama sesi jalan → tak bisa mendeteksi sesi
yang **sudah berhenti** untuk di-resume.
**Decision:** Dua tanggung jawab, dua mekanisme:
1. **Monitor usage** → sumber resmi: statusLine JSON (dalam sesi) atau endpoint OAuth usage (daemon standalone).
   Untuk Antigravity *(direvisi 3 Jul 2026 — `/usage` terbukti stale di sesi hidup, RESEARCH §4b)*: probe kuota
   via salah satu dari — fresh-launch snapshot `/usage` / probe language-server lokal (ala CodexBar) /
   endpoint `v1internal:retrieveUserQuota` — **pilihan di-lock sebelum M3** (lihat Pending) + tangkap sinyal
   quota-exhausted dari output.
2. **Deteksi LIMIT_HIT + auto-continue** *(direvisi 3 Jul 2026 dini hari — temuan hook `StopFailure`,
   RESEARCH §2c)*: untuk Claude Code, sinyal primer = **hook `StopFailure`** matcher `rate_limit`
   (event-driven resmi, v2.1.78+; supervisor pasang hook ke sesi yang di-supervise), fallback = pola
   output PTY (korpus §2b), exit code hanya untuk print-mode (**tak ada exit code khusus rate-limit**;
   fallback terakhir parsing transcript JSONL). Antigravity: pola output PTY + exit (transcript `.pb`
   tak praktis di-parse). **Limit-hit ≠ proses exit**: sesi interaktif tetap hidup di prompt → dua jalur
   lanjut: (a) proses masih hidup → inject "continue" ke PTY yang dipegang supervisor (dengan gating
   foreground+idle ala claude-auto-retry); (b) proses mati → resume by-id di cwd asli — Claude Code:
   `claude --resume <id>`; Antigravity: `agy --conversation <id>` (atau perintah auto-printed saat exit;
   `-c` = sesi terakhir saja).
**Consequences:** (+) monitor tanpa scraping/hack; (+) deteksi limit CC deterministik via hook (typed
error, sekaligus membedakan overload vs usage-limit); (+) deteksi mati tetap andal via wrapper.
(−) dua jalur untuk dirawat; fallback parsing output rapuh terhadap perubahan format → tetap butuh
fixture & test regresi; (−) hook butuh instalasi per-config (supervisor kelola `CLAUDE_CONFIG_DIR`/settings)
dan payload-nya belum diuji empiris (RESEARCH §6 TODO #7); (−) sisa verifikasi: fixture pesan limit sebagai
fallback + varian Antigravity (termasuk perilaku TUI agy saat quota habis) — butuh observasi terminal nyata.
*(Skema statusLine `rate_limits` & resume kedua CLI sudah terkonfirmasi — lihat RESEARCH.md §2/§4b/§4c.)*
**Alternatives Rejected:** Hanya wrapper+scraping transcript untuk usage (tak perlu lagi — ada jalur resmi);
hanya statusLine/hook (tak bisa deteksi sesi mati); scraping claude.ai (rapuh, dilarang di RESEARCH).

## ADR-002: Monolith proses tunggal (satu daemon)
**Status:** Proposed
**Context:** Solo-user, satu mesin, beban ringan.
**Decision:** Satu daemon monolitik (CLI + supervisor in-process), bukan microservices.
**Consequences:** (+) sederhana, mudah deploy sebagai service OS. (−) skalabilitas multi-node = kerja v2+.
**Alternatives Rejected:** Services (over-engineering untuk skala ini).

## ADR-003: TypeScript + Node.js LTS + node-pty
**Status:** **Accepted** (locked 2026-07-03) — *immutable; revisi = ADR baru yang men-supersede.*
**Context:** Butuh kontrol proses/PTY, cross-platform (Ubuntu daily + Windows weekend), sejalan ekosistem user.
Diperkuat uji empiris 3 Jul: **PTY terbukti wajib di dua sisi** — (a) Claude Code "inject continue" ke sesi
interaktif hidup (limit ≠ exit, §2c), (b) Antigravity **hanya mem-bind language server saat ber-PTY** (interaktif
tanpa TTY = 0 port; §5b) → probe usage #2 & continue keduanya butuh PTY nyata. `node-pty` = pustaka PTY lintas-OS
paling matang di ekosistem Node.
**Decision:** TypeScript + Node.js **LTS 24 ("Krypton")** + `node-pty`. **Versi ter-pin saat lock:**
Node **24.x** (mesin lock: v24.18.0), `node-pty` **1.1.0**, TypeScript **5.x**. Pin eksak via lockfile
(`package-lock.json`) di kedua OS; standarisasi Node 24 LTS via `.nvmrc` / `engines`.
**Consequences:** (+) ekosistem PTY/CLI matang, agent lancar, satu bahasa untuk CLI+daemon. (−) bukan single
static binary seperti Go → mitigasi packaging (pkg/SEA) bila perlu. (−) `node-pty` native (node-gyp/prebuild) →
**wajib verifikasi prebuild untuk Node 24 di Win+Ubuntu** saat setup M1 (DEPENDENCY-POLICY).
**Alternatives Rejected:** Go (binary bagus, tapi ekosistem PTY interaktif + kecepatan iterasi kurang cocok
untuk user); Rust (overkill, iterasi lambat untuk solo part-time).

## ADR-004: SQLite untuk state
**Status:** **Accepted** (locked 2026-07-03) — *immutable; revisi = ADR baru yang men-supersede.*
**Context:** Single-user, offline-first, tak butuh server DB.
**Decision:** SQLite via **`better-sqlite3`** (opsional `drizzle-orm`) untuk `sessions`/`events`/`scheduled_jobs`.
**Versi ter-pin saat lock:** `better-sqlite3` **12.11.1**, `drizzle-orm` **0.45.2** (opsional). Native (node-gyp)
→ verifikasi prebuild Node 24 Win+Ubuntu bersama node-pty (ADR-003). WAL mode; uang/kuota **bukan** float
(pakai integer/desimal string — konsisten anti-pattern user).
**Consequences:** (+) zero-config, portable, tahan restart. (−) bukan multi-writer lintas mesin (tak dibutuhkan MVP).
**Alternatives Rejected:** Postgres (butuh server, berlebihan); file JSON (rawan korupsi, tak transaksional).

## ADR-005: Auth / kredensial — pakai sesi login mesin
**Status:** Proposed
**Context:** Supervisor membungkus CLI yang sudah login di mesin user.
**Decision:** **Tidak** menyimpan/mengelola kredensial **akun agent**. Supervisor mewarisi sesi login CLI yang ada.
**Consequences:** (+) tak ada secret di repo/store (sejalan anti-pattern user). (−) bergantung state login mesin.
*(Catatan revisi 2026-07-03:)* bot token Telegram (ADR-011) = **infra-secret**, **bukan** kredensial akun agent —
ditangani terpisah di `.env` gitignored, **tidak** melanggar ADR ini. Kredensial upstream agy (`~/.gemini/oauth_creds.json`,
ADR-010) hanya **dibaca**, tak disalin/di-log. Prinsip tetap: tak ada kredensial **akun** yang disimpan supervisor.
**Alternatives Rejected:** Simpan token akun sendiri (menambah attack surface tanpa manfaat).

## ADR-006: Single-tenant / single-user (MVP)
**Status:** Proposed
**Context:** Persona MVP = solo dev di mesinnya sendiri.
**Decision:** Single-user, tanpa konsep tenant. Multi-user = v2+ (US-12) dengan desain terpisah, **bukan**
janji "tinggal extend".
**Consequences:** (+) sederhana. (−) jika multi-user dibutuhkan, kemungkinan refactor store & auth.
**Alternatives Rejected:** Multi-tenant dari day-1 (anti-pattern user: single-tenant dengan janji extend).

## ADR-007: Deployment sebagai service OS
**Status:** Proposed
**Context:** Auto-resume butuh host **always-on** (kalau mesin tidur/mati, resume tak jalan — batasan PROJECT.md §1).
**Decision:** Daemon dijalankan sebagai systemd unit (Linux) / Task Scheduler (Windows); cocok untuk node
headless 24/7 di LAN (lihat HARDWARE.md — ROG Phone 6 / VPS).
**Consequences:** (+) resume tengah malam tetap jalan di node always-on. (−) di laptop yang tidur, resume
tertunda sampai bangun — dokumentasikan sebagai batasan.
**Alternatives Rejected:** Hanya proses foreground (mati saat terminal ditutup).

## ADR-008: Batas otonomi agent (wajib 2026) — *direvisi 2026-07-03 (fitur Telegram)*
**Status:** Proposed *(revisi 2026-07-03: tambah jalur relay-instruksi human-in-the-loop untuk remote-control Telegram)*
**Context:** Supervisor mengeksekusi perintah CLI otomatis → risiko excessive agency / prompt-injection via transcript.
Revisi 3 Jul: fitur remote-control Telegram (A+B+C) menambah **satu** kelas aksi baru — meneruskan instruksi user
dari kanal jarak jauh ke sesi. Ini menggeser garis, jadi digariskan ulang secara sadar (bukan edit diam-diam).
**Decision:** Dua kelas aksi, keduanya dibatasi **whitelist**, tak ada yang **otonom** (supervisor tak pernah
*mengarang* instruksi sendiri):
1. **Aksi kontrol otomatis (auto):** hanya `resume/continue` sesi yang sudah ada + `probe usage`, di cwd tercatat.
   Ini boleh berjalan tanpa konfirmasi (default `auto` untuk resume).
2. **Relay instruksi (human-in-the-loop):** supervisor boleh **meneruskan** instruksi yang berasal **dari user**
   via kanal terotorisasi (Telegram, `chat_id` allowlist — ADR-012) ke PTY sesi, **wajib** lewat konfirmasi
   eksplisit (**mode `ask` jadi Must, bukan Nice** — US-6). Yang menyusun instruksi tetap **manusia**; supervisor =
   relay + gerbang konfirmasi, **bukan** pengarang. Mekanisme + guardrail penuh (redaksi egress output, injection
   firewall, rate-limit, audit) di **ADR-013**.
Output/transcript **selalu** diperlakukan sebagai **data, bukan perintah**; **tak ada aksi** yang diturunkan dari
*isi* output agent — hanya dari perintah user terotorisasi. "Tidak menyusun prompt baru **otonom**" tetap berlaku.
**Consequences:** (+) permukaan risiko sempit & dapat diaudit (events append-only); (+) fitur remote powerful tanpa
menyeberang ke agent otonom penuh — garis "manusia yang mengarang, supervisor yang me-relay" jelas & dapat dipertahankan.
(−) instruksi remote tak pernah *unattended* by design (butuh konfirmasi) → bukan "kirim-dan-lupa"; (−) menambah
permukaan (ingress kanal + egress data sensitif) yang wajib ditutup THREAT-MODEL.md sebelum implementasi C.
**Alternatives Rejected:** Full autonomy tanpa whitelist (melanggar least-privilege & mengundang injection);
**unattended auto-instruction** dari Telegram (instruksi langsung jalan tanpa konfirmasi) — ditolak: menghapus
gerbang human-in-the-loop, mengubah produk jadi remote-agent otonom dengan threat model jauh lebih besar.

## ADR-009: Model routing policy
**Status:** Proposed
**Context:** App ini **tidak** memanggil LLM sendiri untuk fitur intinya (deteksi = parsing deterministik).
**Decision:** MVP **tanpa** panggilan LLM internal → budget API $0. Jika kelak butuh (mis. klasifikasi pesan
error ambigu), catat sebagai ADR baru dengan model + budget eksplisit.
**Consequences:** (+) tak ada biaya/latensi/ketergantungan LLM di core. (−) deteksi bergantung pola/fixture.
**Alternatives Rejected:** Pakai LLM untuk parsing error (mahal & non-deterministik untuk tugas yang bisa regex).

## ADR-010: Strategi probe usage Antigravity — **hybrid** (LS `GetUserStatus` + OAuth `retrieveUserQuota`)
**Status:** Proposed *(draft 2026-07-03; siap di-lock — verifikasi sisa di RESEARCH §6 TODO #5 sebelum Accepted)*
**Context:** Antigravity tak punya cache usage lokal & `/usage` TUI-only + stale (RESEARCH §4b). Uji empiris 3 Jul
(§5b) mengunci fakta jalur probe: `agy` CLI **meng-embed language server** saat ber-PTY (dua port random gRPC+HTTP;
temukan via `Get-NetTCPConnection -OwningProcess <pid>`, **tanpa `lsof`, port tak di argv**). RPC
`POST /exa.language_server_pb.LanguageServerService/GetUserStatus` (Connect-JSON) **terbukti jalan tanpa csrf** di
localhost — **tapi** LS print-mode sesaat balas `GetCascadeModelConfigData() is nil` (quota belum terisi); quota
hanya penuh di LS sesi interaktif ter-inisialisasi. Sinyal login andal = log `server.go … Auth succeeded` (baris
"not logged into Antigravity" saat boot = transient, **bukan** gagal-login).
**Decision:** **Dua jalur komplementer, dipilih per-konteks:**
1. **Sesi interaktif agy yang hidup** (dibungkus supervisor via PTY) → **probe LS `GetUserStatus`** pada port
   milik PID sesi itu (Connect-JSON, tanpa csrf) → `…quotaInfo.{remainingFraction, resetTime}` per model. Murah,
   real-time, tak spawn proses baru.
2. **Cek quota pre-resume / tak ada sesi hidup** → **OAuth `POST cloudcode-pa.googleapis.com/v1internal:
   retrieveUserQuota`** dengan kredensial `~/.gemini/oauth_creds.json` (undocumented; dipakai CodexBar di produksi)
   — tak bergantung LS/PTY. Fallback: fresh-launch snapshot `/usage` (opsi #1).
**Least-privilege:** kredensial hanya dibaca (tak disalin/di-log); egress hanya ke host Google resmi (whitelist NFR).
Token/csrf yang terlihat diperlakukan rahasia (redaksi di log).
**Consequences:** (+) monitor akurat lintas-OS tanpa csrf-hack; (+) dua konteks (hidup vs pre-resume) tertangani.
(−) dua adapter dirawat; (−) opsi #2 butuh PTY hidup; opsi #3 pakai endpoint undocumented (rawan berubah) → butuh
guard + fallback. **Sisa verifikasi sebelum Accepted (TODO #5):** konfirmasi `quotaInfo` non-nil dari LS sesi
interaktif nyata; bentuk req/resp `retrieveUserQuota`; freshness `/usage`.
**Alternatives Rejected:** Hanya `/usage` (stale, TUI-only); hanya spawn print-mode utk GetUserStatus (quota nil —
terbukti); scraping TUI (rapuh); parsing transcript `.pb` protobuf (tak praktis, RESEARCH §4d).

## ADR-011: Kanal remote-control = Telegram bot via long-polling (bukan webhook)
**Status:** Proposed *(baru 2026-07-03 — fitur remote-control MVP, tier A+B+C)*
**Context:** User ingin notifikasi + kontrol + relay-instruksi dari HP (JTBD inti: "tanpa jaga terminal", kasus
terburuk limit reset jam 02:00 saat user jauh dari mesin — PROJECT §1). Notif desktop lokal (US-5) tak berguna
saat user tak di depan layar. Telegram = kanal yang paling selaras (US-9, dinaikkan Nice→Must). Butuh transport
dua-arah yang **tidak** membuka ingress publik ke host always-on.
**Decision:** Kanal remote = **satu Telegram bot**, koneksi via **long-polling** (`getUpdates`, outbound-only ke
`api.telegram.org`) — **bukan** webhook. Bot token = **infra-secret** di `.env` (gitignored), **bukan** kredensial
akun agent (rekonsiliasi ADR-005). Egress hanya ke `api.telegram.org` (whitelist NFR). Satu adapter Notifier
(outbound, tier A) + command listener (inbound, tier B/C) berbagi bot yang sama, diproses di daemon lewat IPC
lokal yang sama seperti CLI (ARCHITECTURE — container Remote Gateway).
**Consequences:** (+) tak ada port publik/ingress di host (long-polling = daemon yang menarik update, cocok untuk
node headless di LAN/VPS tanpa buka firewall); (+) satu dependency bot Node, tak menyentuh stack lock ADR-003/004.
(−) latensi polling (detik) & butuh koneksi keluar persisten; (−) bot token bocor = siapa pun bisa kirim perintah →
**mutlak** butuh authz (ADR-012) di lapisan aplikasi, token saja tak cukup.
**Alternatives Rejected:** Webhook (butuh endpoint HTTPS publik + TLS + ingress ke host always-on = permukaan
serang besar, ditolak untuk single-user); ntfy/email (satu-arah, tak bisa tier B/C kontrol); Signal/WhatsApp
(API bot kurang matang/berbayar); IPC kustom + app HP sendiri (over-engineering untuk solo-user).

## ADR-012: Otorisasi perintah remote = allowlist `chat_id`, per-command, default-deny
**Status:** Proposed *(baru 2026-07-03 — fitur remote-control MVP)*
**Context:** Long-polling menerima update dari **siapa pun** yang menemukan bot (bot token bukan rahasia
per-pengirim). Tanpa authz aplikasi, penyerang yang tahu token bisa `resume/cancel`/kirim instruksi. ADR-006
single-user harus didefinisikan konkret di konteks remote.
**Decision:** **Default-deny.** Hanya update dari **`chat_id` (atau `user_id`) di allowlist** (`.env`/config) yang
diproses; sisanya di-drop **dan** di-audit (`events`). Otorisasi **per-command**: perintah kontrol (`status`,
`resume-now`, `cancel`) untuk sender terotorisasi boleh jalan; perintah relay-instruksi (tier C) untuk sender yang
sama **tetap** butuh konfirmasi eksplisit (ADR-008 §2 + ADR-013). "Single-user" (ADR-006) di konteks remote =
himpunan `chat_id` terotorisasi (MVP: satu). Rate-limit per sender.
**Consequences:** (+) permukaan perintah remote sempit & auditable; (+) token bocor ≠ kompromi (masih tersaring
allowlist). (−) user wajib mengonfigurasi `chat_id`-nya saat setup (friksi onboarding — dokumentasikan di quick-start);
(−) `chat_id` spoof-resistant tapi bukan kripto-auth → untuk MVP single-user cukup, multi-user (v2) butuh model lebih kuat.
**Alternatives Rejected:** Andalkan kerahasiaan bot token saja (token = bearer, bocor sekali = kompromi total);
password/PIN dalam chat (tersimpan di riwayat Telegram, lemah); tanpa authz (tak dapat diterima untuk jalur yang
mengeksekusi perintah di mesin user).

## ADR-013: Relay instruksi remote + egress output — human-in-the-loop, redaksi, injection firewall
**Status:** Proposed *(baru 2026-07-03 — tier C, jalur paling sensitif; realisasi mekanis ADR-008 §2)*
**Context:** Tier C (cek output agent + kirim instruksi dari Telegram) membuka dua risiko sekaligus: (1) **egress
data sensitif** — transcript/PTY bisa memuat kode, isi file, rahasia → dikirim ke pihak ketiga (Telegram meng-cache);
(2) **jalur injection→aksi** — output agent bisa berisi teks tak tepercaya (web/dokumen); bila ditampilkan lalu user
bisa membalas instruksi, payload injection bisa memancing aksi berbahaya. ADR-008 menggariskan prinsip; ADR ini
mengunci **mekanisme + guardrail**.
**Decision:** Tier C diizinkan **hanya** dengan seluruh kontrol berikut (semua wajib, bukan opsional):
1. **Human-in-the-loop wajib:** instruksi dari Telegram di-**queue** + di-echo balik ke user → **konfirmasi eksplisit**
   (mis. reply `/confirm <token>`) → baru inject ke PTY. Tak ada inject tanpa konfirmasi (mode `ask` = Must).
2. **Egress guard output:** output yang dikirim ke Telegram lewat **redaksi rahasia** (pola token/key/secret),
   **size cap** (truncate + simpan penuh lokal), dan **opt-in per sesi** (default: tidak stream output ke remote).
3. **Injection firewall:** output agent di Telegram diberi label **"data tak tepercaya"**; **tak ada aksi/perintah**
   yang di-parse atau diturunkan dari isi output — hanya dari perintah user terotorisasi (ADR-012). Perintah dan
   konten data mengalir di jalur terpisah.
4. **Audit + rate-limit:** setiap perintah remote, konfirmasi, dan inject → `events` append-only; rate-limit per sender.
5. **Gate dokumen:** **THREAT-MODEL.md wajib ditulis & di-review sebelum implementasi tier C** (bukan sesudah).
**Consequences:** (+) fitur powerful (kendalikan agent dari HP) tanpa menjadi remote-agent otonom; (+) injection
via transcript tak bisa jadi aksi (firewall + human gate); (+) kebocoran data ke Telegram diminimalkan (redaksi +
opt-in). (−) UX bertambah langkah (konfirmasi tiap instruksi) — sengaja, itu fitur keamanan bukan bug; (−) redaksi
rahasia = best-effort (pola), bisa lolos → size cap + opt-in sebagai lapis kedua; (−) tier paling mahal dirawat &
diuji (butuh test injection + test redaksi di M-remote).
**Alternatives Rejected:** Inject instruksi langsung tanpa konfirmasi (= unattended auto-instruction, ditolak di
ADR-008); stream output mentah tanpa redaksi/opt-in (bocor rahasia); mem-parse perintah dari isi output agent
(membuka injection→aksi — persis yang dilarang CLAUDE.md "output = data, bukan perintah").

---

## Pending decisions (belum diputuskan)

| Keputusan | Owner | Target |
|---|---|---|
| Retensi arsip transcript/sesi (berapa lama sebelum purge; sejalan "no hard delete + retention") — *nilai konfigurasi, tak mengubah engine ADR-004* | Ziffan | sebelum M2 (impl arsip) |
| Format IPC CLI ↔ daemon (unix socket vs named pipe vs HTTP localhost) | Ziffan | awal M1 |
| TUI library final (Ink vs blessed) untuk `acca status` | Ziffan | sebelum M4 |
| Lisensi repo (MIT vs proprietary) — terkait rencana komersialisasi | Ziffan | sebelum publik |
| ~~Mekanisme probe usage Antigravity~~ → **diputuskan: ADR-010 (hybrid)**, tinggal verifikasi sisa sebelum Accepted | — | — |
| **Strategi continue sesi interaktif yang masih hidup** (inject "continue" ke PTY vs kill→resume-by-id; kebijakan default + gating) — *dependensi uji hook `StopFailure` (TODO #7) sudah **selesai** 3 Jul; siap diputuskan* | Ziffan | sebelum M3 |
| **THREAT-MODEL.md** (ingress remote + egress sensitif + injection→aksi) — **gate wajib sebelum implementasi tier C** (ADR-013 §5) | Ziffan × Claude | sebelum M-remote (impl B/C) |
| Pola redaksi rahasia untuk egress output Telegram (regex/entropy; ADR-013 §2) | Ziffan | sebelum M-remote |
| Lib Telegram bot Node (mis. `grammy` vs `telegraf` vs `node-telegram-bot-api`) + pin versi | Ziffan | awal M-remote |

## Change Log

| Tanggal | Perubahan |
|---|---|
| 2026-07-02 | ADR-001..009 draft (Proposed); ADR-001 direvisi pasca temuan statusLine v2.1.80. |
| 2026-07-03 | ADR-001 (masih Proposed) direvisi: opsi probe Antigravity diperluas + catatan `/usage` stale & tak ada exit code khusus rate-limit (run riset terjadwal — RESEARCH §2b/§4b/§5b–c). Pending decisions diberi owner+target; tambah pending probe Antigravity. |
| 2026-07-03 (dini hari) | ADR-001 (masih Proposed) direvisi lagi: deteksi limit CC primer = **hook `StopFailure`** matcher `rate_limit` (v2.1.78+); eksplisitkan **limit-hit ≠ proses exit** → dua jalur lanjut (inject-PTY vs resume-by-id). Tambah pending: strategi continue sesi hidup. (Sesi interaktif — RESEARCH §2c.) |
| 2026-07-03 (siang) | **ADR-003 & ADR-004 di-LOCK (Accepted)** — stack TS+Node 24 LTS+node-pty (versi ter-pin) & SQLite/better-sqlite3; diperkuat uji empiris PTY-wajib (§2c/§5b). **ADR-010 baru (Proposed)**: strategi probe usage Antigravity **hybrid** (LS `GetUserStatus` sesi hidup + OAuth `retrieveUserQuota` pre-resume) — dasar uji RPC live §5b. Pending probe ditutup→ADR-010; baris retensi di-retarget (ADR-004 sudah lock); dependensi continue-strategy (TODO #7) ditandai selesai. |
| 2026-07-03 (sore) | **Fitur remote-control Telegram masuk MVP (tier A+B+C, keputusan user).** Prinsip: **human-in-the-loop, never autonomous** — supervisor me-relay instruksi user, tak pernah mengarang. **ADR-008 direvisi** (masih Proposed): tambah kelas aksi #2 relay-instruksi ber-konfirmasi; **unattended auto-instruction ditolak**. **ADR-005 direvisi**: bot token = infra-secret, bukan kredensial akun. **ADR-011/012/013 baru (Proposed)**: kanal Telegram long-polling / authz allowlist `chat_id` default-deny / relay+egress guardrail (mode `ask` Must, redaksi, injection firewall, THREAT-MODEL gate). Pending: THREAT-MODEL.md, pola redaksi, lib bot. Menyusul (sesi lain): PROJECT (US+batasan), ARCHITECTURE (container Remote Gateway), NFR (egress whitelist), MILESTONES (M-remote), THREAT-MODEL.md. |
