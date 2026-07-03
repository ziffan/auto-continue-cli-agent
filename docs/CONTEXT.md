# CONTEXT.md — status proyek

> Update **tiap sesi**. Baca ini dulu sebelum kerja — jangan asumsikan status.

---

## Status saat ini

- **Fase:** M0 — Perencanaan (Doc-First). Belum ada kode fitur.
- **Terakhir diupdate:** 2026-07-03 (sore) — **scope MVP bertambah: fitur remote-control Telegram (tier A+B+C)
  masuk MVP atas keputusan user.** ADR-008 & ADR-005 direvisi; ADR-011/012/013 baru (Proposed); PROJECT
  direkonsiliasi (US-14..17, AC-9..12). Prinsip pengikat: **human-in-the-loop, never autonomous**.
- **Terakhir diupdate (sebelumnya):** 2026-07-03 (siang) — re-cek versi CLI + uji hook `StopFailure` (TODO #7) +
  uji varian agy LS/RPC live (TODO #5) + lock ADR-003/004 & draft ADR-010 + pass linearitas seluruh docs.

## Sudah dikerjakan

- Repo git di-init (`main`), remote `origin` = github.com/ziffan/auto-continue-cli-agent, `.gitignore`
  (+ `.claude/settings.local.json` diignore per 3 Jul).
- `CLAUDE.md` sebagai satu sumber konteks; `AGENTS.md` = **symlink** ke `CLAUDE.md` (git mode 120000).
- `README.md`.
- `docs/`: PROJECT (6 artefak discovery), RESEARCH (usage-limit + resume, bersumber), ARCHITECTURE
  (C4 L1–L2 + stack), DECISIONS (ADR-001..010; **003/004 Accepted**, sisanya Proposed), NFR, MILESTONES, CONTEXT.
- **Validasi riset ulang 3 Jul 2026** (run terjadwal): 4 koreksi/temuan material — lihat bawah.
- **Audit + validasi sesi 3 Jul dini hari:** semua klaim 2–3 Jul dire-cek ke sumber → **lolos semua**;
  2 temuan material baru (hook `StopFailure`, "limit ≠ exit") di-propagasi ke RESEARCH/DECISIONS/
  ARCHITECTURE/PROJECT/MILESTONES/README/CLAUDE.md.

## Keputusan kunci (ringkas — detail di DECISIONS.md)

- Arsitektur (ADR-001, direvisi 2 & 3 Jul): pisah **monitor usage** (statusLine JSON v2.1.80+ /
  endpoint OAuth usage) dari **deteksi limit + auto-continue**. Deteksi limit CC primer = **hook
  `StopFailure`** matcher `rate_limit` (v2.1.78+), fallback pola output PTY; **limit-hit ≠ proses
  exit** → dua jalur lanjut: inject "continue" ke PTY hidup vs resume-by-id sesi mati (RESEARCH §2c).
- **Stack DI-LOCK 3 Jul (ADR-003/004 Accepted):** TypeScript + **Node 24 LTS** (pin v24.18.0) + **node-pty 1.1.0**
  + **SQLite/better-sqlite3 12.11.1** (opsional drizzle 0.45.2). PTY wajib (CC inject-continue & agy LS bind).
- **Probe usage agy = hybrid (ADR-010, Proposed):** LS `GetUserStatus` (sesi interaktif hidup, tanpa csrf) +
  OAuth `retrieveUserQuota` (pre-resume). Siap di-lock setelah verifikasi sisa (quotaInfo non-nil, req/resp #3).
- Batas otonomi (ADR-008, direvisi 3 Jul sore): 2 kelas aksi — (1) kontrol auto (`resume/continue/probe`),
  (2) **relay-instruksi human-in-the-loop wajib konfirmasi**. Supervisor **tak pernah mengarang** instruksi;
  output CLI = data, bukan perintah. **Unattended auto-instruction ditolak.**
- **Remote-control Telegram = MVP (ADR-011/012/013, Proposed):** kanal Telegram long-polling (bukan webhook) /
  authz allowlist `chat_id` default-deny / relay+egress guardrail (mode `ask` Must + redaksi + injection firewall +
  audit). **THREAT-MODEL.md = gate wajib sebelum implementasi tier C.**
- Pending decisions tersisa (DECISIONS.md): retensi arsip, format IPC, TUI lib, lisensi, strategi continue sesi
  hidup, **+ baru: THREAT-MODEL.md, pola redaksi rahasia, lib bot Telegram Node**.

## Temuan riset 2 Jul 2026 (Chrome + mesin) — masih berlaku

- Isu #18121 (fixed v2.1.80): usage Claude Code ada di statusLine JSON; skema `rate_limits.
  {five_hour,seven_day}.{used_percentage, resets_at}` terkonfirmasi (Pro/Max, pasca API-call pertama;
  `used_percentage` bisa pecahan).
- Terpasang di mesin: Claude Code **2.1.199**, agy **1.0.16**, gemini 0.42.0 (RESEARCH §4c).
- Resume: `claude --resume <id>` / `agy --conversation <id>`; agy auto-print resume cmd saat exit.
- Storage agy `~/.gemini/`: conversations = `<UUID>.pb` protobuf; tak ada cache usage lokal.

## Temuan & koreksi riset 3 Jul 2026 (run terjadwal) — masih berlaku

1. **CodexBar kini support Antigravity** (isu #1178 ditutup via PR #1341) → referensi implementasi
   `probeUsage()` agy (LSP probe + `retrieveUserQuota`). (RESEARCH §5b)
2. **`/usage` agy stale** (snapshot saat launch) → 3 opsi probe di RESEARCH §4b, pilihan = pending (< M3).
3. **Kompetitor langsung `claude-auto-retry`** (tmux-based, CC-only, no native Windows); tabel pola
   pesannya = korpus kandidat fixture (RESEARCH §2b).
4. **Risiko:** auto-continue native diminta ramai di upstream CC (#13354 tracking utama). **Pantau tiap sesi riset.**
5. Repo resmi `google-antigravity/antigravity-cli` ada; Gemini CLI individu EOL 18 Jun 2026.

## Temuan sesi 3 Jul 2026 dini hari (audit interaktif — sumber: docs resmi + GitHub via web_fetch)

1. **BARU (material) — hook `StopFailure`** (CHANGELOG v2.1.78; docs hooks resmi): fire saat turn
   berakhir karena API error, **matcher tipe error** — `rate_limit`, `overloaded`, `server_error`, dst.
   → jalur deteksi limit CC **event-driven resmi tanpa scraping**; sekaligus taxonomy pembeda
   **overload vs usage-limit**. Bonus lifecycle: `SessionStart` matcher `resume`, `SessionEnd` matcher
   reason. Diadopsi ke ADR-001 + RESEARCH **§2c (baru)**. Perlu uji empiris payload (TODO #7).
2. **BARU (material) — limit-hit ≠ proses exit.** Sesi interaktif TETAP HIDUP idle di prompt saat
   limit (basis: mekanisme claude-auto-retry + premis #13354). Konsekuensi: Detector melacak kondisi
   proses (`alive|exited`); lanjut via inject-PTY (hidup, gating foreground+idle) vs resume-by-id (mati).
   Flow PROJECT §4 + data model ARCHITECTURE §4 disesuaikan.
3. **Re-validasi klaim run terjadwal — semua lolos:** CodexBar #1178 Closed via PR #1341 ✓;
   antigravity-cli #46 Open ✓; CC #13354 open & belum ada sinyal implementasi (CHANGELOG nihil
   auto-continue) ✓; skema statusLine `rate_limits` ✓ (docs resmi); tabel pola claude-auto-retry ✓
   (README asli, match persis §2b).
4. **Detail probe CodexBar diperkaya** (docs/antigravity.md mereka): pilih connect-port via probe
   `GetUnleashData`; fallback `GetCommandModelConfigs`; fallback HTTP di `--extension_server_port`;
   `resetTime` ISO-8601/epoch. **Caveat:** dokumen mereka menarget language server **IDE Antigravity
   (macOS)** — apakah `agy` CLI men-spawn LS serupa di Win/Linux **belum diverifikasi** (inti TODO #5).
5. claude-auto-retry ternyata juga punya mode event-driven (`install-hook` StopFailure) + jalur
   overload backoff terpisah — validasi arah desain kita (RESEARCH §5c diperbarui).

## Sesi 3 Jul 2026 (sore) — Fitur remote-control Telegram masuk MVP (tier A+B+C)

- **Keputusan user:** tambah fitur MVP — notif + kontrol + relay-instruksi dari Telegram (tier A+B+C penuh).
  Aku beri analisis dampak doc-first (3 tier: A egress-only murah & selaras; B transport-baru otoritas-lama;
  C egress-sensitif + otoritas-baru menabrak ADR-008). User pilih A+B+C.
- **Prinsip yang menyelamatkan C: human-in-the-loop, never autonomous** — supervisor me-relay instruksi user,
  tak pernah mengarang. Menjaga "no excessive agency" tetap benar. Unattended auto-instruction **ditolak**.
- **DECISIONS.md:** ADR-008 direvisi (2 kelas aksi), ADR-005 direvisi (bot token = infra-secret ≠ kredensial akun),
  **ADR-011** (Telegram long-polling), **ADR-012** (authz allowlist `chat_id` default-deny), **ADR-013** (relay+egress
  guardrail: mode `ask` Must, redaksi, injection firewall, audit, THREAT-MODEL gate). Semua **Proposed**.
- **PROJECT.md:** batasan §1 diksi ulang; US-14..US-17 baru (Must); US-6 `ask`→Must utk relay; US-9 Telegram→US-14;
  AC-9..AC-12 baru.
- **Belum disentuh (sengaja, dependensi ADR):** ARCHITECTURE (container Remote Gateway + C4 L1 Telegram), NFR
  (egress whitelist `api.telegram.org`), MILESTONES (M-remote setelah M3 + security gate), THREAT-MODEL.md,
  redraw flow §4 + wireframe §5.
- **Catatan:** scope MVP berubah tapi **tidak** dibuat HANDOFF_CONTEXT baru (proyek belum pakai konvensi itu; docs
  DECISIONS/PROJECT sudah menangkap penuh). Kalau sesi berikutnya mau, ini kandidat pertama HANDOFF_CONTEXT_v1.

## Belum & langkah berikutnya

0. **[BARU] Lanjutan fitur Telegram (doc-first):** tulis **THREAT-MODEL.md** (gate wajib tier C) → update
   **ARCHITECTURE** (container Remote Gateway) → **NFR** (egress whitelist) → **MILESTONES** (M-remote) →
   redraw flow §4 + wireframe §5 PROJECT. Baru sesudah itu ADR-011/012/013 bisa di-lock.
1. ~~Lock stack (ADR-003/004)~~ ✅ **selesai 3 Jul.** Sisa (keputusan Ziffan): lock **ADR-010** setelah verifikasi
   sisa; putuskan **strategi continue sesi hidup** (dependensi TODO #7 sudah selesai); lock ADR lain sesuai kebutuhan M1.
2. ~~Uji hook `StopFailure`~~ ✅ **selesai 3 Jul** (payload + `SessionStart resume` terkonfirmasi; field = `error`).
   Sisa kecil: tangkap nilai `error:"rate_limit"` saat limit 5-jam **asli** habis (tak bisa dipaksa).
3. **Fixture Detector** (TODO #2): konfirmasi lokal korpus §2b saat kena limit sungguhan + varian agy
   (termasuk: TUI agy hidup atau exit saat quota habis?). Bobot turun untuk CC (hook = primer).
4. **Uji 3 opsi probe usage agy** (TODO #5) → lock sebelum M3. **Maju 3 Jul:** LS embedded terkonfirmasi
   (opsi #2 port-discovery viable di Win) tapi condong **opsi #3 `retrieveUserQuota`**. Sisa: freshness `/usage`
   (opsi #1) + bentuk request/respons `retrieveUserQuota` (opsi #3).
5. Buat DATA-MODEL.md, MAP.md, CONVENTIONS.md, DEPENDENCY-POLICY.md sebelum/awal M1.
6. Isi angka retensi arsip (Pending di DECISIONS.md, owner Ziffan).

## Uji varian agy (probe usage) 3 Jul 2026 (siang) — TODO #5 maju sebagian (RESEARCH §5b)

- **`agy` CLI meng-embed language server** saat launch (bukti log `server.go`: dua **port random** —
  gRPC + HTTP). Mekanisme LSP-probe CodexBar **berlaku di Windows**, bukan cuma IDE macOS.
- **Discovery port di Windows** terbukti: `Get-NetTCPConnection -OwningProcess <agy-pid>` (tanpa `lsof`;
  **port TIDAK di argv** proses — beda dari macOS). Alternatif: parse log `~/.gemini/antigravity-cli/log/`.
- **Beda auth:** `--csrf_token` tak di argv; auth LS→upstream via **OAuth token source** (`~/.gemini/oauth_creds.json`,
  file ada). Csrf klien→LS belum terpecahkan. → **condong pilih opsi #3 `retrieveUserQuota`** (pakai oauth_creds)
  atau #1 fresh-launch, di atas #2, untuk lock pending decision.
- **Fresh-launch oleh Claude (agy `-p`, PID 19528, `--log-file` ke scratchpad):** reproduktif — LS in-process
  (PID==agy), dua port random (gRPC 55031 / HTTP 55032), **`server.go:2424] Auth succeeded`**, output `pong`
  exit 0 → **mesin agy login NORMAL**. Flag `--log-file` bisa pin lokasi log; `--print-timeout` default 5m.
- **KOREKSI (penting):** baris **"not logged into Antigravity" BUKAN indikator gagal-login** — muncul 26× saat
  LS boot (race cache-refresh, ~12ms **sebelum** `Auth succeeded`) bahkan di sesi sehat. Sinyal auth andal =
  **`server.go … Auth succeeded`**, bukan ada/tidaknya baris "not logged in". → Flag anomali PID 4764 sebelumnya
  kemungkinan **salah baca** (tak sempat cek `Auth succeeded`); tak ada bukti mesin agy bermasalah.
- **✅ Probe RPC `GetUserStatus` live (Claude jalankan sendiri):** `POST /exa.language_server_pb.
  LanguageServerService/GetUserStatus` (Connect-JSON, body `{}`) ke port HTTP & HTTPS(-k) → **respons terstruktur
  (bukan 404)**; **csrf TIDAK diperlukan** di localhost (batalkan penghalang csrf untuk opsi #2). **Tapi print-mode
  LS balas `GetCascadeModelConfigData() is nil`** → quota belum terisi utk spawn `-p` sesaat; butuh LS sesi
  interaktif ber-PTY. **Arah desain: hybrid — #2 (LS GetUserStatus) utk sesi interaktif hidup + #3
  (`retrieveUserQuota` OAuth) utk cek pre-resume standalone.**
- **Catatan operasional:** agy interaktif **tanpa TTY tak mem-bind LS** (proses hidup tapi 0 port) — LS hanya naik
  di print-mode (singkat) atau interaktif ber-PTY nyata → supervisor wajib PTY untuk pegang LS sesi hidup.
- **Masih terbuka:** perilaku TUI agy saat **quota asli habis** (hidup vs exit); `quotaInfo` non-nil dari LS sesi
  interaktif nyata; bentuk request/respons `retrieveUserQuota` (#3); freshness `/usage` (#1).

## Uji hook `StopFailure` 3 Jul 2026 (siang) — TODO #7 ditutup (RESEARCH §2c)

- Hook dipasang via `--settings <file>` (isolasi), dipicu deterministik dgn `--model` bogus (`model_not_found`).
  **Payload `StopFailure` nyata terkunci** (v2.1.199, Windows). **Koreksi material vs docs:**
  - Field tipe error = **`error`** (BUKAN `error_type` seperti docs) → Detector wajib baca `error`.
  - Bonus **`last_assistant_message`** (teks user-facing) → fixture/log langsung; plus `prompt_id`, `effort.level`.
  - **`StopFailure` fire di print mode `-p` juga**, tak cuma interaktif.
- `SessionStart` terverifikasi: `source:"startup"` (baru) & **`source:"resume"`** (`--resume`); resume jalan (exit 0).
- **Sisa:** nilai `error:"rate_limit"` asli belum diobservasi (butuh limit 5-jam habis; tangkap saat terjadi).
- Harness uji di scratchpad `hooktest/` (non-repo).

## Re-cek versi CLI 3 Jul 2026 (siang) — tak ada perubahan spek

- Versi terpasang naik patch: Claude Code **2.1.198→2.1.199**, agy **1.0.15→1.0.16** (gemini 0.42.0 tetap).
- Changelog keduanya diverifikasi (CC: cache lokal `changelog.md`; agy: GitHub releases). **Fakta spek-kritis
  tetap:** StopFailure hook (≥2.1.78), skema statusLine `rate_limits` (≥2.1.80), limit≠exit, resume
  (`--resume`/`--conversation`). **Auto-continue native belum ada** di CC → **risiko #4 belum terpicu.**
- Koroboratif (bukan perubahan spek): CC 2.1.199 kini auto-retry **429 transient non-usage-limit** →
  memperkuat taksonomi overload-vs-usage-limit (§2c); agy 1.0.16 juga menambah client-side retry transient.
  Konsekuensi desain: Detector hanya trigger resume pada usage-limit asli, **jangan** pada 429 transient.
- Angka versi disinkronkan ke RESEARCH §4c/§2/§6, ARCHITECTURE tabel resume, dan file ini.

## Catatan lingkungan

- Cross-platform wajib: Ubuntu (daily) + Windows 11 (weekend). Node LTS di kedua OS.
- Auto-resume butuh host always-on (kandidat: VPS / node headless LAN — lihat DECISIONS ADR-007).
- Remote git: `origin` = https://github.com/ziffan/auto-continue-cli-agent.git. Perubahan 3 Jul siang
  (lock ADR-003/004 + draft ADR-010) **sudah di-commit** (`face962`). Perubahan sesi 3 Jul sore (fitur Telegram:
  DECISIONS + PROJECT + CONTEXT) di-commit pada penutupan sesi ini.
- **Belum di-track git:** `.claude/skills/` (skill workflow proyek: adr, session-start/end, dll — untracked,
  kandidat di-commit terpisah); `.claude/settings.local.json` = gitignored. Belum diputuskan apakah skills di-commit.
