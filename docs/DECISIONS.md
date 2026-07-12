# DECISIONS.md — ADR

> Format Nygard. ADR *Accepted* immutable — revisi = ADR baru yang men-supersede.
> Status per ADR: **Proposed** (masih bisa berubah) / Accepted / Deprecated / Superseded.
> Status per 2026-07-12: **ADR-001…017 + ADR-019 Accepted (locked); ADR-018 Superseded by ADR-019** (12 Jul —
> premis probe OAuth standalone terbukti baca pool kuota salah saat live-verify → optimistic resume + detect).
> (ADR-017, 11 Jul: wrapper=penulis-sah lifecycle-sesinya + daemon=sole-coordinator-bukan-sole-writer → menutup residual
> I-10 by-design.) ADR-001 di-**Accept 4 Jul** setelah
> verifikasi terakhir tertutup: pesan limit CC ASLI (4 Jul pagi) + **pesan limit agy TUI ASLI + varian quota-habis
> (4 Jul, `Individual quota reached`, limit≠exit, `remainingFraction` absent)**. **Tak ada lagi ADR Proposed.**
> Accepted = immutable. ADR-005 & ADR-008 di-lock **termasuk** revisi Telegram 3 Jul (bot token = infra-secret;
> kelas aksi relay human-in-the-loop). ADR-008 §2 kini **dilengkapi mekanisme** ADR-011/012/013 (Accepted):
> lib bot = **grammy 1.44.0** (ADR-011), redaksi = **hybrid regex+entropy** (ADR-013).

Wajib ada (Bagian 2.2): monolith vs services · stack utama · auth · multi-tenancy · deployment ·
data retention · **model routing policy** · **batas otonomi agent**.

---

## ADR-001: Pisahkan "monitor usage" (jalur resmi) dari "deteksi sesi mati" (wrapper)
**Status:** **Accepted** (locked 2026-07-04) — *immutable; revisi = ADR baru yang men-supersede.* Di-Accept setelah
dua verifikasi terakhir tertutup dgn limit ASLI: **(CC, 4 Jul pagi)** pesan `You've hit your session limit` + limit≠exit;
**(agy, 4 Jul)** pesan TUI `Individual quota reached` + limit≠exit + sinyal exhaustion LS (`remainingFraction` absent) +
nuansa credit-fallthrough. Arsitektur dua-jalur (monitor resmi vs deteksi+continue) terbukti end-to-end kedua CLI.
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
*(Progres 4 Jul 2026: pesan limit CC **nyata tertangkap lokal** dari limit 5-jam asli — `You've hit your
session limit · resets 7:30am (Asia/Jakarta)`, fixture + fix false-negative merged (M2-fix). `limit≠exit`
terverifikasi di limit nyata. RESEARCH §2b, GOTCHAS G-15.)*
*(**Penutup 4 Jul 2026 — varian agy DITUTUP → ADR di-Accept:** kuota 5-jam agy dihabiskan terkontrol → pesan TUI
ASLI `⚠ Individual quota reached … Resets in <Xm Ys>.` + Error ID; **agy limit≠exit** (tetap hidup di prompt);
sinyal exhaustion LS = `remainingFraction` **absent** (G-17); limit agy **soft** bila credit ada (fallthrough, G-16);
print-mode `-p` stdout kosong saat limit (G-18/19). Sisa non-blocking: nilai hook CC `error:"rate_limit"` (butuh hook
terpasang, jalur M3d). RESEARCH §2b, GOTCHAS G-16..G-19, scratchpad FINDINGS F4-F12.)*
*(Skema statusLine `rate_limits` & resume kedua CLI sudah terkonfirmasi — lihat RESEARCH.md §2/§4b/§4c.)*
**Alternatives Rejected:** Hanya wrapper+scraping transcript untuk usage (tak perlu lagi — ada jalur resmi);
hanya statusLine/hook (tak bisa deteksi sesi mati); scraping claude.ai (rapuh, dilarang di RESEARCH).

## ADR-002: Monolith proses tunggal (satu daemon)
**Status:** **Accepted** (locked 2026-07-03) — *immutable; revisi = ADR baru yang men-supersede.*
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
**Status:** **Accepted** (locked 2026-07-03) — *immutable; revisi = ADR baru yang men-supersede. Termasuk rekonsiliasi bot token Telegram = infra-secret (revisi 3 Jul).*
**Context:** Supervisor membungkus CLI yang sudah login di mesin user.
**Decision:** **Tidak** menyimpan/mengelola kredensial **akun agent**. Supervisor mewarisi sesi login CLI yang ada.
**Consequences:** (+) tak ada secret di repo/store (sejalan anti-pattern user). (−) bergantung state login mesin.
*(Catatan revisi 2026-07-03:)* bot token Telegram (ADR-011) = **infra-secret**, **bukan** kredensial akun agent —
ditangani terpisah di `.env` gitignored, **tidak** melanggar ADR ini. Kredensial upstream agy (`~/.gemini/oauth_creds.json`,
ADR-010) hanya **dibaca**, tak disalin/di-log. Prinsip tetap: tak ada kredensial **akun** yang disimpan supervisor.
**Alternatives Rejected:** Simpan token akun sendiri (menambah attack surface tanpa manfaat).

## ADR-006: Single-tenant / single-user (MVP)
**Status:** **Accepted** (locked 2026-07-03) — *immutable; revisi = ADR baru yang men-supersede.*
**Context:** Persona MVP = solo dev di mesinnya sendiri.
**Decision:** Single-user, tanpa konsep tenant. Multi-user = v2+ (US-12) dengan desain terpisah, **bukan**
janji "tinggal extend".
**Consequences:** (+) sederhana. (−) jika multi-user dibutuhkan, kemungkinan refactor store & auth.
**Alternatives Rejected:** Multi-tenant dari day-1 (anti-pattern user: single-tenant dengan janji extend).

## ADR-007: Deployment sebagai service OS
**Status:** **Accepted** (locked 2026-07-03) — *immutable; revisi = ADR baru yang men-supersede.*
**Context:** Auto-resume butuh host **always-on** (kalau mesin tidur/mati, resume tak jalan — batasan PROJECT.md §1).
**Decision:** Daemon dijalankan sebagai systemd unit (Linux) / Task Scheduler (Windows); cocok untuk node
headless 24/7 di LAN (lihat HARDWARE.md — ROG Phone 6 / VPS).
**Consequences:** (+) resume tengah malam tetap jalan di node always-on. (−) di laptop yang tidur, resume
tertunda sampai bangun — dokumentasikan sebagai batasan.
**Alternatives Rejected:** Hanya proses foreground (mati saat terminal ditutup).

## ADR-008: Batas otonomi agent (wajib 2026) — *direvisi 2026-07-03 (fitur Telegram)*
**Status:** **Accepted** (locked 2026-07-03) — *immutable; revisi = ADR baru yang men-supersede.* Prinsip human-in-the-loop dikunci; **mekanisme** relay-instruksi kini di-lock di ADR-011/012/013 (Accepted 2026-07-03 malam — lib bot + pola redaksi diputuskan). *(Pointer status sibling di-refresh; keputusan ADR-008 sendiri tak berubah.)*
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
**Status:** **Accepted** (locked 2026-07-03) — *immutable; revisi = ADR baru yang men-supersede.*
**Context:** App ini **tidak** memanggil LLM sendiri untuk fitur intinya (deteksi = parsing deterministik).
**Decision:** MVP **tanpa** panggilan LLM internal → budget API $0. Jika kelak butuh (mis. klasifikasi pesan
error ambigu), catat sebagai ADR baru dengan model + budget eksplisit.
**Consequences:** (+) tak ada biaya/latensi/ketergantungan LLM di core. (−) deteksi bergantung pola/fixture.
**Alternatives Rejected:** Pakai LLM untuk parsing error (mahal & non-deterministik untuk tugas yang bisa regex).

## ADR-010: Strategi probe usage Antigravity — **hybrid** (LS `GetUserStatus` + OAuth `retrieveUserQuota`)
**Status:** **Accepted** (locked 2026-07-03 malam) — *immutable; revisi = ADR baru yang men-supersede.*
Verifikasi kunci **opsi #2 ditutup** (quotaInfo non-nil dari LS interaktif ber-PTY — bukti di §"Verifikasi ditutup" bawah).
Residual opsi #3 (body-sukses `retrieveUserQuota`) + opsi #1 (freshness `/usage`) = **impl-tuning M3, bukan decision-blocking**.
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
guard + fallback.
**Verifikasi ditutup (2026-07-03 malam — agy 1.0.16, Node 24.18.0 Win, PTY via node-pty 1.1.0):** item (d) TODO #5
**LULUS.** Sesi agy interaktif dibungkus **PTY nyata** (node-pty; **winpty passthrough gagal** — stdin non-tty) → LS
bind (port via `Get-NetTCPConnection -OwningProcess`, mis. HTTP 28838/gRPC 28837) → `POST /exa.language_server_pb.
LanguageServerService/GetUserStatus` (Connect-JSON, body `{}`, **tanpa csrf**) → **200 OK, `cascadeModelConfigData`
terisi penuh, `quotaInfo` NON-NIL per model — TANPA kirim prompt** (init interaktif saja cukup; **0 kuota terpakai**).
Ini mengoreksi keterbatasan print-mode (§5b nil) → **opsi #2 terbukti end-to-end** sebagai jalur monitor sesi hidup.
Skema `probeUsage()` (agy): `cascadeModelConfigData.clientModelConfigs[].quotaInfo.{remainingFraction (float 0..1),
resetTime (ISO-8601 Z)}` **per model**; `planStatus.planInfo.{monthlyPromptCredits, monthlyFlowCredits}` +
`availablePromptCredits`/`availableFlowCredits`; `userTier`; `availableCredits`. **Reset window per-kelas-model**
(teramati: Gemini-fast frac≈0.37 reset 17:15Z vs premium Claude/GPT frac≈0.20 reset 14:55Z) → probe **wajib baca
per-model**, bukan satu angka. **Catatan keamanan (feed ADR-013):** respons memuat **PII (nama+email)** → modul
redaksi wajib perlakukan output jalur ini sensitif. **Residual (M3, impl-tuning):** (c) body-sukses `retrieveUserQuota`
(butuh token segar — refresh `oauth2.googleapis.com` atau tarik dari LS hidup; ditunda keputusan user); (a) freshness
`/usage` (bukti eksternal cukup — forum).
**Refinement 3 Jul 2026 (probe live):** endpoint `retrieveUserQuota` **reachable** (routing benar) tapi
**token on-disk `oauth_creds.json` stale → 401**; `agy -p` tak menulis ulang file (agy refresh **internal**).
→ **Konsekuensi lock:** opsi #3 standalone butuh **refresh token sendiri via `oauth2.googleapis.com`**
(**egress tambahan di luar whitelist NFR saat ini** + client-id Gemini CLI) **atau** ambil token dari LS sesi
hidup (→ malah condong opsi #2 utk sesi hidup). Bila opsi #3 dipilih saat lock, **NFR §Security egress wajib
+ `oauth2.googleapis.com`**. Body-sukses `retrieveUserQuota` ditunda ke M3 (keputusan user 3 Jul).
**Alternatives Rejected:** Hanya `/usage` (stale, TUI-only); hanya spawn print-mode utk GetUserStatus (quota nil —
terbukti); scraping TUI (rapuh); parsing transcript `.pb` protobuf (tak praktis, RESEARCH §4d).

## ADR-011: Kanal remote-control = Telegram bot via long-polling (bukan webhook)
**Status:** **Accepted** (locked 2026-07-03 malam) — *immutable; revisi = ADR baru yang men-supersede.*
**Context:** User ingin notifikasi + kontrol + relay-instruksi dari HP (JTBD inti: "tanpa jaga terminal", kasus
terburuk limit reset jam 02:00 saat user jauh dari mesin — PROJECT §1). Notif desktop lokal (US-5) tak berguna
saat user tak di depan layar. Telegram = kanal yang paling selaras (US-9, dinaikkan Nice→Must). Butuh transport
dua-arah yang **tidak** membuka ingress publik ke host always-on.
**Decision:** Kanal remote = **satu Telegram bot**, koneksi via **long-polling** (`getUpdates`, outbound-only ke
`api.telegram.org`) — **bukan** webhook. Bot token = **infra-secret** di `.env` (gitignored), **bukan** kredensial
akun agent (rekonsiliasi ADR-005). Egress hanya ke `api.telegram.org` (whitelist NFR). Satu adapter Notifier
(outbound, tier A) + command listener (inbound, tier B/C) berbagi bot yang sama, diproses di daemon lewat IPC
lokal yang sama seperti CLI (ARCHITECTURE — container Remote Gateway).
**Lib bot ter-pin (diputuskan 2026-07-03 malam):** **`grammy` 1.44.0** (MIT; rilis 2026-06-14 — aktif; 4 dep
runtime: `@grammyjs/types`, `abort-controller`, `debug`, `node-fetch`; engines `>=14.13.1` → kompatibel Node 24
ADR-003). `bot.start()` = long-polling `getUpdates` default (outbound-only, **tanpa** server webhook) → cocok
langsung mandat ADR ini. Alasan pilih: TS-first (typing kelas satu), footprint dep minimal, ekosistem plugin
aktif (grammy-inline-menu dsb bermigrasi ke grammy), tak menyentuh stack lock ADR-003/004. **Pin eksak via
lockfile** (konsisten disiplin ADR-003/004). Notifier (tier A, `sendMessage`) + command listener (tier B/C,
`getUpdates`) berbagi satu instance `Bot`.
**Consequences:** (+) tak ada port publik/ingress di host (long-polling = daemon yang menarik update, cocok untuk
node headless di LAN/VPS tanpa buka firewall); (+) satu dependency bot Node, tak menyentuh stack lock ADR-003/004.
(−) latensi polling (detik) & butuh koneksi keluar persisten; (−) bot token bocor = siapa pun bisa kirim perintah →
**mutlak** butuh authz (ADR-012) di lapisan aplikasi, token saja tak cukup.
**Alternatives Rejected:** Webhook (butuh endpoint HTTPS publik + TLS + ingress ke host always-on = permukaan
serang besar, ditolak untuk single-user); ntfy/email (satu-arah, tak bisa tier B/C kontrol); Signal/WhatsApp
(API bot kurang matang/berbayar); IPC kustom + app HP sendiri (over-engineering untuk solo-user).
**Lib bot ditolak:** `telegraf` (typing v4 kompleks & sulit, docs = API-ref generated tanpa penjelasan,
sebagian plugin ekosistem tak lagi dirawat/bermigrasi ke grammy); `node-telegram-bot-api` (callback-style
lawas, dukungan TypeScript lemah).

## ADR-012: Otorisasi perintah remote = allowlist `chat_id`, per-command, default-deny
**Status:** **Accepted** (locked 2026-07-03 malam) — *immutable; revisi = ADR baru yang men-supersede.*
*(Policy authz sudah spesifik penuh; di-lock bersama ADR-011/013 setelah lib bot & pola redaksi diputuskan.)*
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
**Status:** **Accepted** (locked 2026-07-03 malam) — *immutable; revisi = ADR baru yang men-supersede.*
Realisasi mekanis ADR-008 §2; pola redaksi (§2) di-lock sebagai **strategi** (regex/threshold eksak di-tune M-remote).
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
   **Pola redaksi ter-lock (strategi, 2026-07-03 malam) = hybrid regex + entropy** (pola industri gitleaks/
   detect-secrets): (a) **ruleset regex kurasi in-repo** untuk kelas rahasia relevan ke egress kita — Anthropic
   `sk-ant-…`/OAuth bearer, Google `ya29.…`/refresh-token & `oauth_creds.json`, **token bot Telegram sendiri**
   `\d+:[A-Za-z0-9_-]{35}`, generic `sk-…`, GitHub `gh[pousr]_…`, AWS `AKIA…`, private-key block
   `-----BEGIN … PRIVATE KEY-----`, JWT `eyJ…`, `.env`-style `KEY=secret`; (b) **fallback Shannon entropy**
   (≥~4.0 bit/char pada token base64/hex panjang ≥N) untuk rahasia tak dikenal. Implementasi = **modul kecil
   in-repo** (bukan dep berat) — input = teks-bebas PTY & set rahasia spesifik butuh tuning false-positive.
   **Regex/threshold eksak + allowlist di-tune di M-remote dengan test corpus redaksi** (sudah diwajibkan
   MILESTONES M-remote). Redaksi = best-effort **lapis-1** di belakang size-cap (lapis-2) + opt-in per sesi (lapis-3).
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
**Pola redaksi ditolak:** hanya-regex tanpa entropy (lolos rahasia format tak dikenal); hanya-entropy tanpa regex
(false-positive tinggi pada kode/hash non-rahasia); dep scrubber generik berorientasi-objek/log (mis. fast-redact/
pino-noir — menarget field object, bukan teks-bebas PTY; tak menutup kelas rahasia spesifik kita).

## ADR-014: Strategi continue sesi interaktif yang masih hidup — inject "continue" ke PTY (preferred) + gating ketat, fallback resume-by-id
**Status:** **Accepted** (locked 2026-07-03 malam) — *immutable; revisi = ADR baru yang men-supersede.*
**Context:** Temuan §2c (terverifikasi, TODO #7 selesai): saat usage-limit, sesi **interaktif** Claude Code
**TETAP HIDUP** idle di prompt (limit-hit ≠ proses exit); print-mode `-p` **exit** non-nol; sesi mati di luar
limit (reboot/crash) = proses tak ada. Supervisor memegang PTY sesi sendiri (node-pty, ADR-003 — tanpa tmux).
Prior art `claude-auto-retry` (§5c) membuktikan kirim "continue" ke pane hidup berhasil, dengan **gating
alive-at-prompt** (foreground = agent, sesi idle). Dua cara lanjut mungkin: **(a)** inject "continue" ke PTY
hidup; **(b)** kill → resume-by-id (`claude --resume <id>` / `agy --conversation <id>` di cwd asli).
Dependensi keputusan (uji hook `StopFailure`) sudah **selesai** 3 Jul.
**Decision:** Pilih jalur **per `proc_state`**, dengan **inject-ke-PTY sebagai preferred untuk sesi hidup**:
1. **`alive` + gating LULUS → inject "continue" ke PTY** yang kita pegang. Ini kelas **kontrol-auto** (ADR-008 §1)
   → tanpa konfirmasi. Token yang di-inject = **literal tetap** (`"continue"` + newline), **tak pernah** diturunkan
   dari isi output agent (injection firewall, ADR-008/013). Alasan preferred: pertahankan konteks sesi in-memory/TUI
   yang **tak** dipulihkan penuh oleh resume-by-id, lebih murah/cepat (tak re-load transcript, tak spawn proses baru).
2. **`alive` + gating GAGAL → JANGAN inject; surface + notifikasi (manual).** Tak meng-auto-kill sesi hidup
   (bisa sedang di shell/kerja tak ter-persist) — konsisten "jangan hard delete" + human-in-the-loop.
3. **`exited` → resume-by-id** di cwd asli: `claude --resume <id>` / `agy --conversation <id>` (print-mode:
   `claude -p --resume <id>`).
4. **cwd asli hilang → `BLOCKED`** (jangan resume di tempat salah — AC-8).
**Gating inject (semua wajib, tiru claude-auto-retry + injection-firewall kita):**
(i) `proc_state==alive` terverifikasi (PID = child kita, masih ada); (ii) **foreground process di PTY = agent yang
diharapkan** (claude/node, agy) — **bukan** shell (kalau drop ke shell: jangan ketik apa pun, surface); (iii) **sesi
idle** (bukan tengah-turn — mis. footer Claude "esc to interrupt" absen), jangan inject saat generate; (iv) **probe
usage pasca-reset** konfirmasi kuota tersedia dulu (flow §4 langkah 8); (v) token = literal tetap, bukan dari output.
**Consequences:** (+) lanjut cepat & hemat untuk kasus umum (interaktif hidup) tanpa kehilangan konteks; (+) permukaan
aman — literal tetap + gating berlapis + kelas kontrol-auto yang sudah di-whitelist (ADR-008); (+) tak pernah
meng-auto-destroy sesi hidup. (−) **judgment call: gating-gagal = manual, bukan auto-recover** → beberapa kasus butuh
tangan user (disengaja, sisi aman; bisa di-revisit bila terlalu sering). (−) inject **PTY-driver-specific** (gating
foreground/idle rapuh terhadap perubahan TUI CLI → butuh test + fixture footer).
*(**Verifikasi agy ditutup 4 Jul 2026 — anotasi, keputusan tak berubah:** perilaku TUI agy saat quota 5-jam habis
**terverifikasi ASLI = TETAP HIDUP di prompt** (limit≠exit, seperti CC) setelah pesan `Individual quota reached` →
**jalur inject-continue agy tak lagi provisional, viable** (kelas `alive`). Nuansa penting: limit agy **soft** bila
AI Credits aktif (fallthrough senyap tanpa stop — G-16) → gating agy harus konfirmasi exhaustion via probe LS
(`remainingFraction` absent, G-17) **dan** credit off, bukan hanya "sesi berhenti". Keystroke continue agy = TBD saat
impl M3d.7 (agy hidup di prompt → kandidat "continue"/Enter, uji di M3d). RESEARCH §2b, GOTCHAS G-16..G-19.)*
**Alternatives Rejected:** **Selalu kill→resume-by-id** (mental model lebih simpel) — ditolak: buang konteks in-memory,
lebih lambat (re-load transcript + startup baru), dan mubazir untuk sesi yang masih hidup; **auto-kill saat gating gagal**
— ditolak: berisiko menghancurkan kerja tak ter-persist / mengetik ke shell yang salah; **inject tanpa gating foreground/idle**
(ala tmux-blind) — ditolak: bisa mengetik "continue" ke shell atau di tengah generate (persis yang dicegah claude-auto-retry).

## ADR-015: IPC CLI ↔ daemon = Node `net` socket (Unix domain socket / Windows named pipe), NDJSON
**Status:** **Accepted** (locked 2026-07-03 malam) — *immutable; revisi = ADR baru yang men-supersede.*
**Context:** Monolith daemon (ADR-002) tapi `acca` CLI = proses terpisah yang mengirim perintah (`run`,
`resume-now`, `cancel`) + baca status ke/dari daemon yang hidup. Constraint keras: jalan di **Ubuntu + Windows**
(ADR-003/CLAUDE.md §6). Butuh transport lokal-saja tanpa buka port jaringan (sejalan egress whitelist NFR — tak
ada ingress). Node `net` menyediakan **satu API** yang memetakan ke **Unix domain socket** di Linux/macOS dan
**named pipe** di Windows lewat `net.createServer(path)` / `net.connect(path)`.
**Decision:** IPC via **Node `net` stream socket** — path `$XDG_RUNTIME_DIR/acca/daemon.sock` (fallback
`$HOME/.acca/daemon.sock`) di Linux/macOS, `\\.\pipe\acca-daemon` di Windows. Framing pesan = **NDJSON**
(satu objek JSON per baris `\n`): `{id, cmd, args}` → `{id, ok, data|error}`. **Least-privilege:** socket file
mode `0600` (owner-only) di Linux; named pipe pakai ACL default owner di Windows. Read-only `acca status` **boleh**
baca SQLite store langsung (cepat, tak butuh daemon hidup — tampilkan liveness dari heartbeat store); perintah yang
mengubah state (`resume-now`/`cancel`) **wajib** lewat IPC ke daemon hidup. Tak ada TCP/port.
**Consequences:** (+) satu abstraksi lintas-OS (tak ada `#ifdef` platform di call-site); (+) tak buka port →
tak ada firewall-prompt Windows / exposure ke proses lain di host; (+) sejalan "tak ada ingress" NFR. (−) named
pipe Windows vs unix socket punya nuansa (path, cleanup file socket stale di Linux saat crash → daemon hapus
socket saat start); (−) bukan lintas-mesin (tak dibutuhkan MVP single-user, ADR-006).
**Alternatives Rejected:** **HTTP/TCP localhost** (butuh manajemen port, **proses/user lain di host bisa connect**,
memicu firewall-prompt Windows, permukaan lebih besar) — ditolak; **gRPC** (dep native + codegen, overkill untuk
solo IPC); **stdin/stdout satu-shot** (tak bisa layani `status` multi-klien selagi daemon jalan); **file-polling**
(latensi + race). *(Nuansa cleanup socket stale = catatan implementasi M1, bukan pengubah keputusan.)*

---

## ADR-016: Model-routing workflow — Opus = orkestrator, Sonnet = kuda beban
**Status:** **Accepted** (locked 2026-07-03 malam) — *immutable; revisi = ADR baru yang men-supersede.*
**Context:** Set minimal ADR (Bagian 2.2, §atas) mensyaratkan **model routing policy**; slot ini belum terisi.
Proyek ini **tak memanggil LLM saat runtime** (mensupervisi CLI agent, bukan produk ber-LLM) → "model routing"
di sini = kebijakan **workflow pengembangan**: model mana mengerjakan jenis task apa, demi hemat token & konteks.
Terbukti di M1: implementasi mekanis-padat (scaffold+store+CLI) diturunkan ke subagent, sesi utama menjaga desain
& review → M1 selesai dalam satu putaran dengan konteks Opus tetap ramping.
**Decision:** **Opus = orkestrator** (desain, keputusan, ADR, tier-review, commit, koordinasi); **Sonnet = kuda beban**
implementasi via subagent (`Agent` `model: sonnet`) dengan **spec presisi + docs sebagai sumber kebenaran**. Diff
subagent **wajib** lewat tier-review Opus sebelum commit. **Pengecualian:** slice kecil/subtil (state/exit path,
~≤30 baris) boleh Opus kerjakan inline bila spawn subagent dingin justru lebih boros token. Juga dicatat di CLAUDE.md §5.
**Consequences:** (+) hemat token/biaya + konteks Opus ramping → sesi panjang tak cepat penuh; (+) pemisahan peran =
review lebih jujur (reviewer ≠ penulis, tier-review Step 0). (−) subagent mulai dingin (baca docs tiap spawn) →
overhead untuk task kecil (karenanya ada pengecualian inline); (−) butuh spec presisi — spec buruk = diff buruk.
**Alternatives Rejected:** **Semua di Opus** (boros token/konteks) — ditolak untuk task mekanis; **semua di Sonnet
tanpa review Opus** (langgar tier-review Step 0: penulis me-review diri sendiri) — ditolak; **model termurah untuk
semua** (kualitas desain/keamanan Tier-1 turun) — ditolak. Budget API/bulan belum ditetapkan (owner Ziffan;
non-blocking — model langganan, bukan pay-per-token).

---

## ADR-017: Wrapper `acca run` = penulis SAH lifecycle sesinya sendiri (+ enqueue `probe`); daemon = sole *coordinator*/dispatcher, bukan sole *writer* — konsolidasi penuh DITOLAK
**Status:** **Accepted** (locked 2026-07-11) — *immutable; revisi = ADR baru yang men-supersede.* Menutup residual I-10
("konsolidasi sole-writer `scheduled_jobs`") sebagai **keputusan by-design**, bukan utang tertunda. Tidak men-supersede
ADR-002/015 — meng-**scope ulang** invariant "penulis tunggal" (yang selama ini hidup sbg konvensi MAP + pengecualian bootstrap).
**Context:** MAP.md §Kontrak menetapkan "daemon = penulis tunggal `sessions`/`scheduled_jobs`" dengan **pengecualian bootstrap
M1**: `acca run` = wrapper pemilik PTY → menulis `sessions` (RUNNING→EXITED/FAILED) + enqueue `scheduled_jobs` (`probe` saat
LIMIT_HIT) langsung via repo. I-10 (Option A, 7 Jul) menutup celah cross-process re-arm (IPC `rearm` best-effort + recovery-saat-
`start()`, AC-7) tapi meninggalkan residual terbuka: "konsolidasi sole-writer penuh = refactor arsitektur lebih besar, di luar
scope." **Investigasi jalur-penulis 11 Jul** (`process-wrapper.ts`/`supervisor.ts`) menemukan: (1) **auto-continue SUDAH
daemon-dependent** — scheduler yang men-dispatch `probe`/`resume` hidup **di daemon**; wrapper tak punya scheduler → tanpa daemon,
job hanya mengendap. (2) Desain sekarang **resilient**: wrapper tulis lokal → `rearm` best-effort → daemon hidup re-arm seketika;
daemon mati saat enqueue → recovery-saat-`start()` tetap jamin job tak hilang (AC-7). (3) Konsolidasi penuh = `acca run` stream
SEMUA write via IPC → **daemon jadi dependency KERAS** `acca run` (mematikan mode monitoring standalone), memperbesar permukaan IPC
(create/setPid/limitHit/exit/fail) + failure-mode, dan **menukar resilience "tulis-sekarang-recover-nanti" demi kerapian invariant**
— net-value meragukan (tak ada write-race nyata untuk dikonsolidasi).
**Decision:** Formalkan pengecualian bootstrap sebagai **desain permanen**. Batas kepemilikan state di-scope ulang eksplisit:
1. **Wrapper `acca run` (proses pemilik PTY) = penulis SAH** untuk (a) lifecycle sesinya sendiri (`sessions`:
   create/setPid/markLimitHit/markExited/markFailed/markResumed) & (b) enqueue `probe` ke `scheduled_jobs` saat LIMIT_HIT.
   Bukan pelanggaran — penulis = proses yang MEMEGANG sumber kebenaran runtime (PTY + deteksi limit dari output-nya).
2. **Daemon = sole COORDINATOR/dispatcher + reconciler**, bukan sole *writer*: pemilik tunggal **scheduler** (dispatch
   `probe`/`resume`), rekonsiliasi orphan saat start (AC-7/I-3), re-arm atas IPC `rearm` (I-10). Daemon juga menulis sesi hasil
   actuation resume-by-id — konsisten karena di situ **daemon-lah pemilik PTY** sesi baru.
3. **Konsistensi lintas-proses** dijaga dua mekanisme yang sudah ada: recovery-saat-`start()` (jaminan keras, AC-7) + `rearm`
   IPC best-effort (jaminan latensi). Tak ada penulis konkuren pada BARIS yang sama (wrapper menulis sesinya; daemon menulis
   dispatch job & sesi hasil-resume) + SQLite WAL transaksional (ADR-004) → tak ada write-race untuk dikonsolidasi.
4. **Konsolidasi sole-writer penuh (daemon ambil-alih lifecycle sesi wrapper) DITOLAK** untuk MVP.
**Consequences:** (+) Residual I-10 tertutup tanpa refactor berisiko; `acca run` tetap jalan tanpa daemon (monitoring/deteksi) —
daemon wajib hanya untuk **actuation** (auto-continue), yang memang sifatnya. (+) Batas kepemilikan state kini eksplisit &
dapat-dipertahankan (bukan "utang menunggu" yang mengundang relitigasi). (+) Selaras M5 (daemon always-on tetap koordinator tunggal).
(−) "Penulis tunggal" harfiah tak tercapai — dua proses menulis `sessions`/`scheduled_jobs` (baris berbeda); mitigasi = pembagian
baris tegas + WAL + recovery/rearm. (−) Bila kelak butuh multi-writer ketat (multi-node v2), keputusan ini di-revisit via ADR baru.
**Alternatives Rejected:** **Konsolidasi sole-writer penuh** (daemon owns lifecycle, `acca run` stream via IPC) — ditolak:
daemon jadi dependency-keras (mematikan standalone), permukaan IPC + failure-mode membesar, resilience "tulis-sekarang-recover-nanti"
hilang, demi invariant tanpa write-race nyata (revisit bila multi-node v2). **Enqueue `probe` murni via IPC tanpa tulis lokal** —
ditolak: kehilangan jaminan AC-7 (daemon mati saat enqueue → job hilang, tak pernah ter-recover). **Biarkan sebagai residual
terbuka** — ditolak: keputusan menggantung mengundang relitigasi tiap sesi; lebih baik diputus tegas.

---

## ADR-018: Probe agy pre-resume standalone (opsi #3) + `oauth2.googleapis.com` masuk egress whitelist
**Status:** **Superseded by ADR-019** (2026-07-12) — *isi keputusan di bawah TIDAK diedit (immutable). Premisnya —
bahwa probe standalone `retrieveUserQuota` OAuth bisa menggerbang resume agy-exited — terbukti **KELIRU secara empiris**
saat live-verify 12 Jul: OAuth `retrieveUserQuota` (client gemini-cli) mengembalikan kuota **request harian per-model
gemini-cli Code Assist** (semua 100%), BUKAN limit grup **weekly+5h** yang agy tegakkan; `retrieveUserQuotaSummary` via
OAuth = 403. Lihat ADR-019 (optimistic resume + detect). Awalnya Accepted (locked 2026-07-11, owner Ziffan).*
Meresolusi keputusan yang **ADR-010 sengaja tunda** ("bila opsi #3 dipilih, NFR egress wajib + `oauth2.googleapis.com`").
**Context:** I-22/A-4 (audit 11 Jul). agy = dual-limit; saat sesi agy **MATI** (`exited`: reboot/crash/terminal ditutup)
lalu limitnya reset, dispatch tak bisa **probe** kuota karena probe agy wajib **LS hidup** (port lokal dari PID hidup) —
PID mati → `discoverLocalPorts` kosong → `'retry'` backoff cap 60m **selamanya, senyap**. Jalur pre-resume standalone
(`retrieveUserQuota` OAuth di `cloudcode-pa.googleapis.com`, opsi #3 ADR-010) **belum diimplementasi**, dan token on-disk
`oauth_creds.json` **stale** (G-1: agy refresh in-memory, tak nulis disk) → butuh **refresh token sendiri via
`oauth2.googleapis.com`** (+ client-id Gemini CLI), egress **di luar whitelist NFR**. (CC tak kena — probe CC = HTTP
standalone ke `api.anthropic.com`, sudah whitelist.)
**Decision:** **Adopt opsi #3.** Implement probe agy standalone pre-resume: refresh token via `oauth2.googleapis.com`
→ `retrieveUserQuota` → normalisasi ke `UsageSnapshot`. **Tambah `oauth2.googleapis.com` ke NFR §Security egress
whitelist** (host baru, khusus refresh token OAuth Gemini). Memberi **auto-resume penuh agy-exited** (parity dgn CC) —
owner memilih otonomi penuh di atas surface-manual.
**Consequences:**
- (+) Loop auto-continue lengkap lintas-tool; agy mati saat limit tetap ter-rescue otomatis (JTBD inti — limit reset
  jam 02:00 saat user jauh dari mesin).
- (−) **Attack surface egress melebar 1 host** (`oauth2.googleapis.com`). **Mitigasi wajib di impl:** allowlist host ketat
  (`guardEgress`, non-allowlist → `EgressBlockedError`); token diperlakukan **kredensial** (dibaca-saja, tak di-log/echo —
  pola `credentials.ts`); body respons tak pernah masuk pesan error + PII firewall (G-9); refresh **hanya saat pre-resume**
  (bukan polling). Client-id Gemini CLI = infra-config, bukan kredensial akun.
- **Implementasi = slice tersendiri (M3e/R4, Tier-1: creds + egress)**, butuh **live-verify** flow refresh token nyata
  (G-1: token disk stale → refresh harus terbukti balas 200 + `retrieveUserQuota` body-sukses, yang ADR-010 tunda ke M3).
- **Guard minimal dikerjakan LEBIH DULU** (independen, tak menunggu R4 penuh): agy+exited+probe-impossible → surface notif
  `PROBE_IMPOSSIBLE` + **stop retry** (tutup bug loop-senyap A-4) supaya tak ada regresi selama flow OAuth belum jadi.
- Revisit bila endpoint `oauth2`/`retrieveUserQuota` (undocumented) tak stabil.
**Alternatives Rejected:** **Opsi 2 fresh-launch** (spawn agy throwaway ber-PTY untuk bind LS) — rapuh (print-mode quota
nil G-7 → butuh PTY interaktif; timing LS 2–4s G-23; agy tak boleh konkuren G-19; throwaway lifecycle). **Opsi 3
"agy-exited = manual"** — paling aman/least-privilege tapi owner tolak (mau otonomi penuh). **Status quo** (silent 60m
retry) — bug.

## ADR-019: Resume agy sesi MATI = optimistic resume + detect-on-refire (men-supersede ADR-018; opsi #3 OAuth tak viable)
**Status:** **Accepted** (locked 2026-07-12, owner Ziffan) — *immutable; revisi = ADR baru yang men-supersede.*
Men-**supersede ADR-018**. Juga menandai **opsi #3 ADR-010** (`retrieveUserQuota` OAuth pre-resume) **tak viable** untuk
membaca limit agy — ADR-010 tetap Accepted karena **opsi #2** (LS `GetUserStatus`/`RetrieveUserQuotaSummary` sesi hidup)
masih benar & dipakai; hanya komponen opsi #3-nya yang gugur.
**Context:** ADR-018 mengunci probe standalone `retrieveUserQuota` (refresh token via `oauth2.googleapis.com` + client-id
gemini-cli) sebagai gerbang kuota untuk resume agy yang **`exited`** (tak ada LS hidup untuk di-probe). **Live-verify
12 Jul (Windows, agy 1.1.1, otorisasi user) MEMBANTAH premis itu** — refresh token gemini-cli **berhasil (HTTP 200)**
dan `retrieveUserQuota` balas 200, TAPI isinya = **kuota request HARIAN per-model gemini-cli Code Assist**
(`buckets[].{modelId, tokenType:"REQUESTS", remainingFraction, resetTime}`; gemini-2.5/3.1 semua `remainingFraction=1`,
reset ~24 jam) — **bukan** limit **grup weekly+5h** yang agy tegakkan untuk keputusan resume. Bukti divergensi (akun sama,
serentak): OAuth `retrieveUserQuota` gemini = **1.0 (100%)** sementara LS `RetrieveUserQuotaSummary` = **gemini-5h 0.079
(7.9%)** + gemini-weekly 0.688 + 3p-weekly 0.330. `retrieveUserQuotaSummary` via OAuth = **403 PERMISSION_DENIED** (client
gemini-cli tak berhak atas quota-group Antigravity 2.0). **Kesimpulan:** kredensial gemini-cli di `~/.gemini/oauth_creds.json`
**fundamental tak bisa** membaca limit grup agy — hanya **LS sesi-hidup** yang bisa (G-3). Untuk sesi agy yang MATI, tak ada
LS → tak ada pembacaan kuota agy yang murah/standalone. (Detail live: GOTCHAS G-38.)
**Decision:** Untuk sesi agy **`exited`** yang jatuh tempo di `reset_at`, **lewati probe kuota (mustahil standalone) dan
resume-by-id secara OPTIMISTIC** langsung. Sesi hasil-resume mem-bind LS-nya sendiri; bila kuota **masih** habis, output TUI
`Individual quota reached` (limit-watcher, G-19, terbukti fire) → LIMIT_HIT baru → jadwalkan ulang `probe`/resume di `reset_at`
berikut (backoff berjenjang + cap `MAX_DISPATCH_ATTEMPTS` B-1). **Actuation menjadi probe.** Karena job `probe` memang
dijadwalkan **pada `reset_at`** (kuota sangat mungkin sudah tersedia), resume optimistik di titik itu wajar. **Nol egress/creds/
OAuth baru** → `oauth2.googleapis.com` **DIBATALKAN** dari egress whitelist NFR (tak pernah masuk kode), dan
`cloudcode-pa.googleapis.com` (host opsi #3 yang tak pernah dipanggil produksi) **dihapus** dari allowlist (least-privilege).
Guard slice-1 `probe_impossible` (ADR-018) diganti oleh jalur optimistik ini. CC **tak** terpengaruh: probe CC = HTTP OAuth
`api.anthropic.com/api/oauth/usage` yang memang membaca limit CC nyata (standalone, tanpa sesi hidup) → CC-exited tetap
di-probe normal sebelum resume.
**Consequences:**
- (+) Loop auto-continue agy-exited tetap otonom (JTBD inti — limit reset jam 02:00 saat user jauh) **tanpa** memperluas
  attack surface egress (nol host baru; malah 1 host tak-terpakai dihapus). Selaras least-privilege ADR-008/NFR.
- (+) Tak ada bug korektness "resume ke kuota salah" (yang justru akan diperkenalkan implementasi ADR-018): keputusan resume
  tak lagi bergantung pada pembacaan kuota yang keliru-pool.
- (+) Sederhana: hapus jalur creds+OAuth+parser+egress; hanya perubahan state-machine kecil di dispatcher.
- (−) **Trade-off diterima:** bila `reset_at` meleset (estimasi heuristik) atau grup lain (weekly) masih habis, terjadi
  **1 resume "sia-sia"** per siklus — sesi baru spawn lalu langsung LIMIT_HIT. Di-bound oleh penjadwalan `reset_at` (jeda
  jam-an, bukan spin) + cap attempts (B-1) + arsip baris gagal (soft, no-purge). Bukan kebocoran sumber daya.
- (−) Retensi never-purge → beberapa baris sesi per siklus masih-limit (jarang; jeda reset). Diterima MVP.
- (−) Menyerah pada "probe-sebelum-resume" untuk agy-exited (yang CC punya) — asimetri tool yang jujur (agy limit hanya
  terbaca via LS hidup). Bila kelak agy mengekspos endpoint kuota-grup ber-OAuth, revisit via ADR baru.
**Alternatives Rejected:** **Pertahankan ADR-018 (probe OAuth standalone)** — ditolak: terbukti membaca pool kuota SALAH
(gemini-cli harian ≠ grup agy weekly+5h) → gerbang resume keliru = bug korektness. **Fresh-launch probe (opsi #2 throwaway):**
spawn agy throwaway ber-PTY → baca LS `RetrieveUserQuotaSummary` (kuota agy BENAR) sebelum resume — membaca pool yang tepat,
tapi rapuh (print-mode nil G-7 → butuh PTY interaktif; timing LS 2–4s G-23; **agy tak boleh konkuren** G-19 → throwaway bisa
bentrok dgn resume; lifecycle proses buang) dan **mahal** (spawn dua sesi: probe lalu resume) padahal resume sendiri sudah
mem-probe via LS-nya → redundan. Ditolak demi kesederhanaan (owner). **agy-exited = manual** (guard slice-1 permanen) —
paling least-privilege, tapi owner tetap ingin otonomi penuh & optimistic-resume mencapainya tanpa biaya egress.

## Pending decisions (belum diputuskan)

| Keputusan | Owner | Target |
|---|---|---|
| ~~Retensi arsip transcript/sesi (berapa lama sebelum purge)~~ → **diputuskan 5 Jul (Ziffan): TIDAK PERNAH purge** — retensi tak terbatas (arsip `archived_at`, tak ada job purge). Selaras penuh prinsip "no hard delete". *Nilai konfigurasi, tak mengubah engine ADR-004.* | — | ✅ selesai |
| ~~Format IPC CLI ↔ daemon~~ → **diputuskan: ADR-015** (Node `net` unix socket / named pipe, NDJSON) | — | ✅ selesai |
| ~~TUI library final (Ink vs blessed) untuk `acca status`~~ → **diputuskan 11 Jul (Ziffan): TANPA TUI lib — plain ANSI render.** `acca status` = snapshot sekali-cetak (extend `status.ts` yg ada + karakter bar `▓▓░` + warna ANSI), `watch acca status` utk refresh; footer aksi = command terpisah (`resume-now`/`cancel`/`log`). Nol dependency baru (paling selaras DEPENDENCY-POLICY + cross-platform). Ink/blessed ditolak: dep berat/tua vs kebutuhan monitor sederhana. Live-refresh TUI = backlog bila kelak perlu. | — | ✅ selesai |
| ~~**Kebijakan resume agy sesi MATI** (I-22/A-4)~~ → 11 Jul (Ziffan): ADR-018 (opsi #3 OAuth). **→ REVISI 12 Jul: ADR-018 di-SUPERSEDE ADR-019** — opsi #3 terbukti baca pool kuota SALAH (gemini-cli harian ≠ grup agy weekly+5h; live-verify) → **optimistic resume + detect**; `oauth2.googleapis.com` dibatalkan. | — | ✅ selesai (ADR-019) |
| Lisensi repo (MIT vs proprietary) — terkait rencana komersialisasi | Ziffan | sebelum publik |
| ~~Mekanisme probe usage Antigravity~~ → **ADR-010 (hybrid) LOCKED 3 Jul malam** (opsi #2 terbukti; residual #3/#1 = impl-tuning M3) | — | ✅ selesai |
| ~~**Strategi continue sesi interaktif yang masih hidup** (inject "continue" ke PTY vs kill→resume-by-id; kebijakan default + gating)~~ → **diputuskan: ADR-014** (inject-ke-PTY preferred + gating ketat; fallback resume-by-id; gating-gagal = manual) | — | ✅ selesai (3 Jul malam) |
| ~~**THREAT-MODEL.md** (ingress remote + egress sensitif + injection→aksi) — gate wajib tier C (ADR-013 §5)~~ → **dibuat 3 Jul (sore)**, di-review; **ADR-011/012/013 di-LOCK 3 Jul malam** | — | ✅ selesai |
| ~~Pola redaksi rahasia untuk egress output Telegram (regex/entropy; ADR-013 §2)~~ → **diputuskan: hybrid regex+entropy** (ADR-013 §2 Accepted); regex/threshold eksak di-tune M-remote | — | ✅ strategi lock |
| ~~Lib Telegram bot Node (`grammy` vs `telegraf` vs `node-telegram-bot-api`) + pin versi~~ → **diputuskan: `grammy` 1.44.0** (ADR-011 Accepted) | — | ✅ selesai |

## Change Log

| Tanggal | Perubahan |
|---|---|
| 2026-07-12 (sesi Windows, R4 slice 2 → **ADR-019**) | **ADR-018 di-SUPERSEDE ADR-019.** Live-verify (otorisasi user) R4 slice 2 membuktikan **premis ADR-018 keliru**: refresh token gemini-cli **200** + `retrieveUserQuota` **200**, tapi isinya = **kuota request harian per-model gemini-cli Code Assist** (`buckets[].{modelId,tokenType:REQUESTS,remainingFraction,resetTime}`, gemini 100% reset ~24j), **BUKAN** limit grup **weekly+5h** yang agy tegakkan. Bukti divergensi serentak (akun sama): OAuth gemini **1.0** vs LS `RetrieveUserQuotaSummary` gemini-5h **0.079**; `retrieveUserQuotaSummary` via OAuth = **403**. Kredensial gemini-cli disk **fundamental tak bisa** baca limit grup agy. **Keputusan (Ziffan): ADR-019 = optimistic resume + detect** — agy-exited: skip probe (mustahil standalone), resume-by-id di `reset_at`; sesi hasil-resume tangkap `Individual quota reached` bila masih limit → reschedule (bounded reset_at + B-1 cap). **Nol egress/creds/OAuth baru** → `oauth2.googleapis.com` DIBATALKAN + `cloudcode-pa.googleapis.com` (opsi #3, tak dipakai) DIHAPUS dari allowlist. Deliverable sampingan: shape `retrieveUserQuota` OAuth akhirnya tertangkap (item RESEARCH terbuka sejak 3 Jul). Dampak docs: DECISIONS (ADR-018→Superseded, ADR-019 baru, header/Pending), NFR §Security egress (−2 host), GOTCHAS G-38, ISSUES I-22, MILESTONES M3e/R4, CONTEXT. |
| 2026-07-12 (sesi Windows, R6/I-23) | **Realisasi ADR-001 (deteksi limit CC primer) + tutup paruh CC I-20 — TANPA ADR baru.** Implementasi hook CC yang ADR-001/CLAUDE.md §7 tetapkan sejak awal: `StopFailure` (matcher `rate_limit`) = deteksi limit CC **PRIMER** event-driven + `SessionStart` = sumber `cli_session_id` CC. **Keputusan implementasi (dicatat, bukan ADR):** (a) hook dipasang via **`claude --settings <file>`** terisolasi (MERGE additif — auth tetap diwarisi kredensial mesin ADR-005; **ditolak** `CLAUDE_CONFIG_DIR` yang meng-isolasi seluruh config → putus auth); (b) hook **exec-form** (`command`+`args[]`) → nol shell-quoting lintas-OS (hindari kelas G-12); (c) forwarder = perintah internal tersembunyi `acca __hook <id>` (best-effort, exit 0, nol stdout — tak ganggu CC) → **socket kontrol per-sesi yang sudah ada** (reuse ADR-015, tanpa transport baru); (d) **injection firewall ADR-013 diperkuat struktural:** `hook` = kanal DATA (data→taxonomy `classify` tetap + kolom identifier), `inject` tetap kanal AKSI tanpa payload → jalur perintah & data terpisah, nol teks→keystroke. LIVE-VERIFIED CC 2.1.207 (`--settings` diterima + kedua hook fire + jalur produksi `acca run claude` persist `cli_session_id`). Tier-1 self-review, **368 test** (+9). Dampak docs: ISSUES (I-23→Tertutup, I-20 CC ✅, I-29 baru, gate header), GOTCHAS G-34 anotasi, MILESTONES M3e R6, CONTEXT, CLAUDE.md §2/README test count. |
| 2026-07-12 (sesi Windows, B-1/B-2 + I-20) | **Keputusan MINOR reversible (bukan ADR).** (a) **B-1 dispatch-terminal-cap:** cabang retry yang tak bisa sembuh-sendiri kini terminal → semua give-up ditandai **`BLOCKED`** (bukan `FAILED` spt kata PROJECT §4 verbatim) — konsisten dgn A-14 (BLOCKED = "butuh manual"; sesi tak "gagal", auto-resume yang terblokir). Konstanta `MAX_DISPATCH_ATTEMPTS=3` (spawn-fail & probe-kosong attempts-capped; adapter-static terminal langsung). Baris FAILED lempar dari resume gagal **diarsipkan** (`sessions.archive`, soft — hard-rule no-delete). (b) **I-20 capture agy:** id dari OUTPUT via method adapter `captureSessionId` + engine murni `session-id-capture.ts` (bukan parse `.db` racy); CC sengaja TAK pakai jalur output (sumber id CC = hook `SessionStart`, I-23). **LIVE-VERIFIED** agy 1.1.1 (otorisasi user). Semua reversible; tak ubah arsitektur. Dampak docs: ISSUES B-1/B-2/B-3/I-20, GOTCHAS G-36, CONTEXT, CLAUDE.md/README test count. |
| 2026-07-12 (sesi Windows, I-22 R4 slice 1) | **Realisasi ADR-018 slice 1 — TANPA ADR baru** (impl keputusan yang sudah di-LOCK 11 Jul). Guard di `supervisor.realDispatch` cabang `probe`: `tool===antigravity && proc_state==='exited'` → `markBlocked` + event `job_dispatch_error {action:'probe_impossible', reason:'agy_exited_no_live_ls', status:'BLOCKED'}` + `return 'done'` → **menutup bug loop-senyap** (dulu `probeAgyUsage` throw pada PID mati → outer catch → `'retry'` backoff cap 60m selamanya, audit A-4). **Guard agy-only** (keputusan implementasi, bukan ADR): probe CC = HTTP OAuth standalone (tak butuh PID/PTY hidup) → CC-exited tetap dapat di-probe; hanya agy butuh LS sesi hidup (G-3). Notifier event **`PROBE_IMPOSSIBLE`** baru (warn, pesan jelas, menang atas branch BLOCKED generik; reason-code internal tak dibocorkan — firewall G-9). Saat slice 2 (probe standalone OAuth) ada, guard dilonggarkan. Tier-1 self-review, **340 test** (+2). Dampak docs: ISSUES I-22 (slice 1 ✅ + header gate), MILESTONES M3e/R4, CONTEXT, CLAUDE.md §2, README (test count + M3e status). |
| 2026-07-12 (autonomous-run, I-28/A-14) | **Keputusan MINOR reversible (bukan ADR).** Nilai enum status **`BLOCKED`** kini benar-benar DITULIS ke baris sesi (`markBlocked`, di-wire di 2 cabang dispatch blocked) supaya `acca status` menampilkan sesi butuh-manual (sebelumnya cuma event+notif). **`WAITING` dibiarkan TAK-terpakai** (LIMIT_HIT sudah mewakili "tunggu reset"; kandidat drop di migrasi kelak). Bukan perubahan arsitektur — sekadar mengonsistenkan enum yang sudah ada; reversible bila user tak setuju. Juga R3/I-21 (auto-continue multi-siklus): inject-continue → sesi kembali RUNNING (bukan RESUMED-terminal), transisi ditulis wrapper (ADR-017, tak melahirkan ADR baru). Dampak docs: ISSUES I-21/I-24/I-27/I-28, GOTCHAS G-37, MILESTONES M4 AC-4, CONTEXT. |
| 2026-07-11 (I-15 live-verify, agy 1.1.1) | **Bukan keputusan baru — konfirmasi empiris.** Live-verify agy 1.1.1 (burn `3p-5h` ~11% ke limit, otorisasi user) **memperkuat ADR-018**: probe LS sesi-hidup ternyata **stale dalam-sesi** (snapshot launch, G-35) → probe pre-resume **wajib fresh/standalone** (persis alasan ADR-018 opsi #3). Juga **mengonfirmasi live** premis I-25/A-7 (gate `every(usedFraction<1)` blokir resume walau grup lain penuh — `3p-5h` habis vs `gemini-5h` 100%). ADR-014 (inject-continue) dikoroborasi: pesan limit agy 1.1.1 identik + limit≠exit + detektor produksi fire benar (G-19 re-verified). Tak ada ADR berubah. Dampak docs: GOTCHAS G-35/G-36 + anotasi, ISSUES I-15/I-20/I-25/I-17, CLAUDE.md §2/§7, CONTEXT. |
| 2026-07-11 (M3e/R4, keputusan agy-exited) | **ADR-018 baru + di-LOCK (Accepted, owner Ziffan).** Meresolusi pending yang **ADR-010 tunda**: kebijakan resume agy sesi MATI (I-22/A-4). **Opsi 1 dipilih** — adopt opsi #3 (probe standalone `retrieveUserQuota` + refresh token via `oauth2.googleapis.com`) → **`oauth2.googleapis.com` masuk NFR §Security egress whitelist** (host baru). Otonomi penuh agy-exited (parity CC), owner pilih di atas surface-manual (rekomendasi Opus = Opsi 3 least-privilege, di-override). Konsekuensi: attack surface egress +1 host (mitigasi: allowlist ketat + creds dibaca-saja + PII firewall + refresh pre-resume-only); impl = slice M3e/R4 Tier-1 + **live-verify** refresh token (G-1 stale); **guard minimal (probe-impossible → surface + stop retry)** lebih dulu (tutup bug loop-senyap). Dampak docs: NFR §Security egress (+oauth2.googleapis.com), ISSUES I-22, MILESTONES M3e/R4, DECISIONS Pending+Change Log, CONTEXT. |
| 2026-07-11 (M3e, audit pra-M-remote) | **Re-prioritas: M-remote DITUNDA, M3e "koreksi loop" disisipkan sbg gate — TANPA ADR baru.** Audit menyeluruh (`docs/audit/AUDIT-2026-07-11.md`) menemukan **4 P1 di jalur resume/continue** yang lolos 308 test (seam actuation di-stub → id resume tak pernah diuji thd kontrak CLI nyata; siklus limit-2 tak punya test). Klaim "loop auto-continue penuh selesai" = **overstated** (yang live cuma proxy). Keputusan: tutup R1–R3 dulu (M-remote tier B `resume-now` akan expose jalur rusak; I-15 pasti gagal di A-1). **Dua fix implementasi (dalam ADR-014, bukan ADR baru): R1** — default `spawnResumeFn` konsumsi `waitForExit` (unhandledRejection dulu mematikan daemon) + tak keliru markResumed saat spawn gagal; **R2a** — resume-by-id pakai `cli_session_id`; absen → **BLOCKED jujur** (bukan spawn id supervisor yang dijamin ditolak CLI). Penangkapan `cli_session_id` (R2b) sengaja ditunda: **butuh live-verify** (audit §6: jangan ✅ actuation tanpa smoke jalur default) → jalur robust = hook `SessionStart`. Juga koreksi klaim AC-4 (overclaim → I-24). Dampak docs: MILESTONES (M3e baru + M4 AC-4 ⚠), ISSUES (A-2/A-1-paruh CLOSED + I-20..I-28), GOTCHAS G-34, CONTEXT. **Proses:** tambah kelas test "kontrak integrasi" (invarian lintas-slice) + DoD actuation = live smoke jalur default. |
| 2026-07-11 (delta-check session, Ubuntu) | **ADR-017 baru + di-LOCK (Accepted).** Memformalkan residual I-10 sebagai **by-design**: wrapper `acca run` (pemilik PTY) = penulis SAH lifecycle sesinya sendiri + enqueue `probe`; **daemon = sole COORDINATOR/dispatcher + reconciler, bukan sole *writer***. Konsolidasi sole-writer penuh **DITOLAK** (bikin daemon dependency-keras `acca run`, hapus resilience daemon-optional, demi invariant tanpa write-race nyata — auto-continue toh sudah daemon-dependent; desain rearm+recovery sudah resilient/AC-7). Tidak men-supersede ADR-002/015 — scope-ulang invariant "penulis tunggal" (dulu konvensi MAP + pengecualian bootstrap). Dampak docs: MAP §Kontrak (pengecualian bootstrap → permanen by-design, rujuk ADR-017), ISSUES (residual I-10 → RESOLVED by-design), CONTEXT. |
| 2026-07-11 (autonomous-run, Windows) | **Pending "TUI library `acca status`" DITUTUP (owner Ziffan): TANPA TUI lib — plain ANSI render** (extend `status.ts` + bar `▓▓░` + ANSI; `watch` utk refresh; footer=command terpisah). Nol dep baru (selaras DEPENDENCY-POLICY/ADR-003-004 few-deps + cross-platform); Ink (dep berat) & blessed (tua, TS lemah) ditolak; live-refresh TUI=backlog. Framing "Ink vs blessed" ditantang → jawaban = tak butuh lib. *Nilai tooling, tak mengubah engine.* Dampak docs: DECISIONS Pending, ARCHITECTURE §3 (baris CLI framework koreksi "Ink"→plain-render), MILESTONES M4 (status-UX unblocked; usage-bar tetap butuh sumber data I-17), CONTEXT. **Catatan:** slice `acca status` usage-view penuh (AC-4) tetap bergantung **I-17** (loop probe periodik → cache snapshot) sbg sumber data. |
| 2026-07-10 (Ubuntu) | **M4 Notifier core + proximity-engine (I-8 sebagian) — TANPA ADR baru** (dalam ADR-008/013 firewall + ADR-016 workflow). Modul `src/notify/notifier.ts`: pemetaan murni event→notifikasi + dekorator `withNotifications` atas `EventsRepo` (surface transisi LIMIT_HIT/RESUMED/FAILED/BLOCKED tanpa sentuh call-site) + sink stderr default. **Keputusan implementasi (dicatat, bukan ADR):** (a) seam = **dekorator events-repo** (bukan notify() eksplisit tiap site) → future-proof; (b) **firewall PII struktural** — body notif hanya dari field terkontrol, teks bebas tak tepercaya (`evidence` PTY, respons probe, `spec.args`) tak pernah di-echo → slice ini **tak butuh** `remote/redact.ts` (itu tetap urusan M-remote streaming); (c) sink baseline = stderr (out-of-band), desktop node-notifier = opt-in menyusul di belakang gate DEPENDENCY-POLICY. Proximity engine (I-8) selesai tapi **wiring ditunda → I-17** (butuh loop probe periodik saat RUNNING). Pola Opus-inline (Tier-1 user-facing output + PII) + self-tier-review. Dampak docs: ISSUES (I-8 engine-ready + I-17 baru), MILESTONES M4, CONTEXT. Keputusan ADR tak berubah. |
| 2026-07-07 (Windows) | **Utang struktural M3d ditutup (I-14 + I-10) — TANPA ADR baru** (dalam ADR-002/014/015). **I-14:** `runSession` direlokasi `cli/run-core.ts`→`daemon/process-wrapper.ts` (menegakkan arah dependency MAP: daemon = pemilik engine wrapper, bukan di-import dari cli/) + kolom `sessions.resumed_from` (migrasi `0002`, `schema_version`=2) menautkan rantai resume (dulu longgar via event). Dipilih `resumed_from` bukan reuse `cli_session_id` (semantik beda: id milik CLI). **I-10:** celah cross-process re-arm ditutup lewat **Option A (IPC notify)** — bukan konsolidasi sole-writer: `scheduler.rearm()` baca store segar + perintah IPC `rearm` **tanpa payload** (injection firewall konsisten ADR-008/013, G-26) + `notifyDaemonRearm` best-effort di wrapper. **Residual (dibuka, bukan diputuskan):** konsolidasi sole-writer `scheduled_jobs` (daemon ambil-alih lifecycle sesi) = refactor lebih besar, di luar scope. Dampak docs: GOTCHAS G-30, ISSUES (I-14/I-10 CLOSED), DATA-MODEL (kolom `resumed_from`), MILESTONES M3d, CONTEXT. Keputusan ADR tak berubah. |
| 2026-07-07 (Ubuntu) | **Gating inject-continue foreground/idle DITEGAKKAN (I-13) — realisasi ADR-014 poin (ii)&(iii), TANPA ADR baru.** Sebelumnya kedua input `undefined` (tak dihitung) → inject lolos hanya dgn alive+hasPtyHandle. Kini: **foreground** (`shared/foreground.ts`) = grup child memegang foreground pts (`/proc/<pid>/stat` `tpgid==pgrp`→agent, `!=`→block, `<=0`/Windows→unknown) — robust tanpa name-match, live-verified /proc Ubuntu (G-28); **idle** (`shared/idle-tracker.ts`) = jendela-sunyi penanda busy `esc to interrupt` (G-29). Semantik gating tak berubah (undefined tak memblokir; token-literal firewall utuh — ADR-008/013). Poin (iv) probe-kuota sudah dari M3d.5. Juga: **I-5 CLOSED** (stale-socket POSIX G-14 diverifikasi otomatis di Ubuntu — tak ada perubahan kode produksi). Dampak docs: GOTCHAS G-28/G-29, ISSUES (I-13/I-5 CLOSED), MILESTONES M3d.7, CONTEXT. Keputusan ADR-014 sendiri tak berubah. |
| 2026-07-06 (Windows) | **Actuation seams M3d di-wire (I-12 poin 1&2) — realisasi ADR-014 §1&§3, TANPA ADR baru** (keputusan tetap dalam ADR-002/014/015). Dua pilihan implementasi dicatat: **(a) inject-continue** = kanal IPC per-sesi (ADR-015 reuse): wrapper host `createIpcServer({inject})` di socket kontrol; **injection firewall dibuat STRUKTURAL** — token `continue\r` hardcoded di wrapper, perintah `inject` tanpa payload (memperkuat ADR-008/013, GOTCHAS G-26). **(b) resume-by-id** = `runSession` **in-process** dari daemon (bukan re-spawn `acca run` via CLI — commander salah-parse `--resume`, G-27); konsekuensi: daemon jadi pemilik PTY sesi hasil-resume (headless) — konsisten ADR-002 monolith. `checkInjectGating` +`hasPtyHandle`, `sessions.markResumed` baru. Live-verified Windows (2 smoke). Follow-up non-decision: gating foreground/idle (I-13), relokasi runSession→process-wrapper (I-14), live-verify limit asli (I-15). |
| 2026-07-05 (Windows) | **Pending "retensi arsip" DITUTUP (owner Ziffan): tidak pernah purge** — retensi tak terbatas, arsip `archived_at` tanpa job purge (selaras "no hard delete"; nilai konfigurasi, tak mengubah engine ADR-004). Tabel Pending diperbarui. |
| 2026-07-05 | **ADR-010 dikoroborasi di Linux (bukan perubahan status).** Opsi #2 (LS `GetUserStatus` sesi hidup ber-PTY) yang sebelumnya terbukti di Windows kini **live-verified di Ubuntu 24.04**: port-discovery inode-correlation menembak `agy` LS nyata → GetUserStatus **HTTP 200** per-model. **Koreksi skema (I-7, bukan pengubah ADR):** respons **dibungkus `userStatus`**; identitas model = `label` + `modelOrAlias.model` (bukan flat `model`). Mekanika endpoint (port HTTPS(gRPC) + Connect-JSON + retry ~2–4s pasca bind) → GOTCHAS G-23/G-24. Parser `parseAgyUserStatus` di-fix (label + G-17 exhausted=usedFraction 1). Dampak docs: GOTCHAS, ISSUES (I-7 CLOSED, I-12 poin 3), MILESTONES M3d.4. Keputusan ADR-010 sendiri tak berubah. |
| 2026-07-04 | **ADR-001 di-ACCEPT (locked)** — verifikasi terakhir tertutup dgn limit ASLI kedua CLI: CC (`You've hit your session limit`, 4 Jul pagi) + **agy** (kuota 5-jam dihabiskan terkontrol → pesan TUI `⚠ Individual quota reached … Resets in <Xm Ys>` + Error ID; **agy limit≠exit** tetap hidup; sinyal exhaustion LS `remainingFraction` **absent**; limit agy **soft** bila credit aktif = fallthrough senyap; print-mode kosong saat limit). **Tak ada lagi ADR Proposed — set ADR lengkap-terkunci.** **ADR-014 dianotasi** (keputusan tak berubah): jalur inject-continue agy **tak lagi provisional** (agy hidup di prompt saat limit). Header status + ADR-001 status + progres diperbarui. Dampak docs: GOTCHAS G-16..G-19, RESEARCH §2b/§4b, MILESTONES M3d.4/M3d.8, CONTEXT. Sumber: scratchpad FINDINGS F4-F12. |
| 2026-07-02 | ADR-001..009 draft (Proposed); ADR-001 direvisi pasca temuan statusLine v2.1.80. |
| 2026-07-03 | ADR-001 (masih Proposed) direvisi: opsi probe Antigravity diperluas + catatan `/usage` stale & tak ada exit code khusus rate-limit (run riset terjadwal — RESEARCH §2b/§4b/§5b–c). Pending decisions diberi owner+target; tambah pending probe Antigravity. |
| 2026-07-03 (dini hari) | ADR-001 (masih Proposed) direvisi lagi: deteksi limit CC primer = **hook `StopFailure`** matcher `rate_limit` (v2.1.78+); eksplisitkan **limit-hit ≠ proses exit** → dua jalur lanjut (inject-PTY vs resume-by-id). Tambah pending: strategi continue sesi hidup. (Sesi interaktif — RESEARCH §2c.) |
| 2026-07-03 (siang) | **ADR-003 & ADR-004 di-LOCK (Accepted)** — stack TS+Node 24 LTS+node-pty (versi ter-pin) & SQLite/better-sqlite3; diperkuat uji empiris PTY-wajib (§2c/§5b). **ADR-010 baru (Proposed)**: strategi probe usage Antigravity **hybrid** (LS `GetUserStatus` sesi hidup + OAuth `retrieveUserQuota` pre-resume) — dasar uji RPC live §5b. Pending probe ditutup→ADR-010; baris retensi di-retarget (ADR-004 sudah lock); dependensi continue-strategy (TODO #7) ditandai selesai. |
| 2026-07-03 (sore) | **Fitur remote-control Telegram masuk MVP (tier A+B+C, keputusan user).** Prinsip: **human-in-the-loop, never autonomous** — supervisor me-relay instruksi user, tak pernah mengarang. **ADR-008 direvisi** (masih Proposed): tambah kelas aksi #2 relay-instruksi ber-konfirmasi; **unattended auto-instruction ditolak**. **ADR-005 direvisi**: bot token = infra-secret, bukan kredensial akun. **ADR-011/012/013 baru (Proposed)**: kanal Telegram long-polling / authz allowlist `chat_id` default-deny / relay+egress guardrail (mode `ask` Must, redaksi, injection firewall, THREAT-MODEL gate). Pending: THREAT-MODEL.md, pola redaksi, lib bot. Menyusul (sesi lain): PROJECT (US+batasan), ARCHITECTURE (container Remote Gateway), NFR (egress whitelist), MILESTONES (M-remote), THREAT-MODEL.md. |
| 2026-07-03 (sore, lock) | **ADR-002, 005, 006, 007, 008, 009 di-LOCK (Accepted)** atas keputusan Ziffan — semua tak punya verifikasi terbuka; prinsipnya matang. ADR-008: prinsip human-in-the-loop dikunci, mekanisme relay (ADR-011/012/013) tetap Proposed sampai pola redaksi + lib bot diputuskan. **Tetap Proposed (sengaja):** ADR-001 (fixture limit + varian agy), ADR-010 (probe agy sisa), ADR-011/012/013 (mekanisme remote). Immutable mulai kini — revisi = ADR baru yang men-supersede. |
| 2026-07-03 (sore, lanjutan) | **Rantai doc-first Telegram dilanjutkan.** **THREAT-MODEL.md dibuat** (gate ADR-013 §5): aset, trust boundary, STRIDE 4 vektor, matriks kontrol→AC-9..12, residual risk. **ARCHITECTURE**: container **Remote Gateway** + Telegram di C4 L1 + §5 batas otonomi direvisi. **NFR §Security**: `api.telegram.org` masuk whitelist egress (tutup doc-drift) + blok kontrol remote wajib. **MILESTONES**: **M-remote** disisipkan (tier A/B/C, security-review gate, dependensi THREAT-MODEL). Sisa (sesi lain): redraw flow §4 + wireframe §5 PROJECT; putuskan pola redaksi + lib bot; lalu lock ADR-011/012/013. |
| 2026-07-03 (malam) | **ADR-015 baru + di-LOCK (Accepted)** — menutup pending "format IPC CLI↔daemon". IPC = **Node `net` stream socket** (Unix domain socket Linux/macOS ↔ named pipe Windows via satu API), framing **NDJSON**, socket mode 0600, tanpa TCP/port. `acca status` read-only boleh baca store langsung; perintah mutasi (`resume-now`/`cancel`) wajib lewat IPC. Ditolak: HTTP/TCP localhost (port+exposure+firewall Windows), gRPC (overkill), stdin one-shot. Membuka jalan mulai M1. Dampak: MAP/CONVENTIONS/DATA-MODEL (fondasi M1). |
| 2026-07-03 (malam) | **ADR-010 di-LOCK (Accepted).** Verifikasi terminal item (d) TODO #5 **lulus**: agy interaktif dibungkus **PTY nyata** (node-pty 1.1.0, Node 24.18.0 Win — winpty passthrough gagal krn stdin non-tty) → LS `GetUserStatus` **200 OK, `quotaInfo` non-nil per model, tanpa csrf, tanpa prompt (0 kuota)** → **opsi #2 terbukti end-to-end**. Skema quota per-model (`remainingFraction` float + `resetTime` ISO-8601; reset window per-kelas-model) + credits plan direkam. Respons memuat PII → feed redaksi ADR-013. node-pty prebuild Node 24 Win terverifikasi (de-risk ADR-003 M1). Residual (c/#3 body-sukses + a/#1 freshness) = impl-tuning M3, non-blocking. ADR-010 Proposed→Accepted; header + TODO #5 (RESEARCH) + GOTCHAS + CONTEXT diperbarui. Proposed tersisa: **hanya ADR-001**. |
| 2026-07-03 (malam) | **ADR-014 baru + di-LOCK (Accepted).** Strategi continue sesi interaktif hidup: **inject "continue" ke PTY = preferred** (kelas kontrol-auto, tanpa konfirmasi, token literal tetap — injection firewall) dengan **gating berlapis** (proc alive + foreground=agent bukan shell + sesi idle + probe kuota dulu); **fallback resume-by-id** saat proses `exited`; **cwd hilang → BLOCKED**; **gating-gagal pada sesi hidup = surface manual, tak auto-kill** (judgment call, sisi aman). Dependensi (uji hook `StopFailure` TODO #7) sudah selesai. Menutup pending "strategi continue". Catatan: jalur inject agy **provisional** sampai perilaku TUI agy saat quota habis diverifikasi (TODO #2, M3). Dampak: ARCHITECTURE (Detector/§5), MILESTONES M3, CONTEXT. |
| 2026-07-03 (malam, M1) | **ADR-016 baru + di-LOCK (Accepted).** Mengisi slot wajib **model-routing policy** (Bagian 2.2) yang kosong: workflow pengembangan = **Opus orkestrator / Sonnet kuda beban** (subagent implementasi + tier-review Opus; pengecualian slice kecil inline). Ruang lingkup = proses dev (proyek tak ber-LLM runtime). Terbukti di M1. Juga dicatat CLAUDE.md §5. Budget API/bulan = pending non-blocking (owner Ziffan). Proposed tersisa: **hanya ADR-001**. |
| 2026-07-03 (malam) | **ADR-011, 012, 013 di-LOCK (Accepted, immutable).** Dua pending penutup diputuskan (owner Ziffan, riset terverifikasi): **(a) lib bot = `grammy` 1.44.0** (MIT, rilis 2026-06-14, 4 dep, long-polling `getUpdates` default outbound-only, TS-first, engines kompatibel Node 24 — ADR-011; ditolak telegraf & node-telegram-bot-api); **(b) pola redaksi = hybrid regex+entropy** ala gitleaks/detect-secrets — ruleset kurasi in-repo (Anthropic/Google/Telegram-token/GitHub/AWS/private-key/JWT/`.env`) + fallback Shannon entropy, modul in-repo, regex/threshold eksak di-tune M-remote dgn test corpus (ADR-013 §2). ADR-012 (authz allowlist) di-lock bersama (policy sudah spesifik). Header status + Pending table di-update (3 baris pending remote → selesai); ADR-008 §2 pointer sibling di-refresh (keputusan ADR-008 tak berubah). Proposed tersisa: **ADR-001, ADR-010**. Dampak lanjut: ARCHITECTURE §3 (+baris lib bot), MILESTONES M-remote (dependensi terpenuhi), CONTEXT. |
