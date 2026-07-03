# DECISIONS.md — ADR

> Format Nygard. ADR *Accepted* immutable — revisi = ADR baru yang men-supersede.
> Status per ADR: **Proposed** (masih bisa berubah) / Accepted / Deprecated / Superseded.
> Status per 2026-07-03: **ADR-003 & ADR-004 = Accepted (locked)**; ADR-001/002/005–009 = Proposed;
> ADR-010 = Proposed (draft). Accepted = immutable.

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
**Decision:** **Tidak** menyimpan/mengelola kredensial akun. Supervisor mewarisi sesi login CLI yang ada.
**Consequences:** (+) tak ada secret di repo/store (sejalan anti-pattern user). (−) bergantung state login mesin.
**Alternatives Rejected:** Simpan token sendiri (menambah attack surface tanpa manfaat).

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

## ADR-008: Batas otonomi agent (wajib 2026)
**Status:** Proposed
**Context:** Supervisor mengeksekusi perintah CLI otomatis → risiko excessive agency / prompt-injection via transcript.
**Decision:** Aksi otomatis dibatasi **whitelist**: hanya `resume/continue` sesi yang sudah ada + `probe usage`,
di cwd yang tercatat. **Tidak** menyusun prompt baru otonom. Output/transcript diperlakukan sebagai data.
Mode default `auto` untuk resume; aksi di luar whitelist butuh persetujuan user (mode `ask`, US-6).
**Consequences:** (+) permukaan risiko sempit & dapat diaudit (events append-only). (−) beberapa otomatisasi
lanjutan (mis. auto-lanjut dengan instruksi baru) sengaja tidak didukung.
**Alternatives Rejected:** Full autonomy tanpa whitelist (melanggar least-privilege & mengundang injection).

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

## Change Log

| Tanggal | Perubahan |
|---|---|
| 2026-07-02 | ADR-001..009 draft (Proposed); ADR-001 direvisi pasca temuan statusLine v2.1.80. |
| 2026-07-03 | ADR-001 (masih Proposed) direvisi: opsi probe Antigravity diperluas + catatan `/usage` stale & tak ada exit code khusus rate-limit (run riset terjadwal — RESEARCH §2b/§4b/§5b–c). Pending decisions diberi owner+target; tambah pending probe Antigravity. |
| 2026-07-03 (dini hari) | ADR-001 (masih Proposed) direvisi lagi: deteksi limit CC primer = **hook `StopFailure`** matcher `rate_limit` (v2.1.78+); eksplisitkan **limit-hit ≠ proses exit** → dua jalur lanjut (inject-PTY vs resume-by-id). Tambah pending: strategi continue sesi hidup. (Sesi interaktif — RESEARCH §2c.) |
| 2026-07-03 (siang) | **ADR-003 & ADR-004 di-LOCK (Accepted)** — stack TS+Node 24 LTS+node-pty (versi ter-pin) & SQLite/better-sqlite3; diperkuat uji empiris PTY-wajib (§2c/§5b). **ADR-010 baru (Proposed)**: strategi probe usage Antigravity **hybrid** (LS `GetUserStatus` sesi hidup + OAuth `retrieveUserQuota` pre-resume) — dasar uji RPC live §5b. Pending probe ditutup→ADR-010; baris retensi di-retarget (ADR-004 sudah lock); dependensi continue-strategy (TODO #7) ditandai selesai. |
