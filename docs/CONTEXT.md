# CONTEXT.md — status proyek

> Update **tiap sesi**. Baca ini dulu sebelum kerja — jangan asumsikan status.

---

## Status saat ini

- **Fase:** **M3 sedang berjalan (dipecah jadi slice).** M3a (Daemon+IPC+orphan) ✅ · **M3b (Scheduler) ✅** —
  keduanya tier-reviewed & merge `main`. Berikutnya slice M3: **M3c Usage-Probe parser** → M3d Continue-logic
  (di sini scheduler + detector + probe di-wire ke daemon; jalur inject/resume live = butuh keputusan/limit asli).
  **Hard-stop** di jalur yang butuh limit asli / inject sesi live / keputusan user.
- **Terakhir diupdate:** 2026-07-04 (dini hari, otonom via cron) — **M3b SELESAI.** Engine Scheduler: timer
  persisten dari `scheduled_jobs` + recovery saat restart daemon + backoff berjenjang (5m→15m→60m cap). Dibuat:
  `store/repositories/scheduled-jobs.ts` (enqueue/listPending/due/getById/remove/reschedule — parameterized),
  `daemon/scheduler.ts` (`createScheduler` arm/runDue/backoff; timer & clock **di-inject** → fake-timer-testable;
  re-entry guard; dispatch probe/resume **di-suntik**, belum di-wire ke supervisor — "engine first" seperti M2).
  Extend `shared/types.ts` (`JOB_KINDS`/`JobKind`/`ScheduledJob`). Test: `scheduled-jobs.test.ts` (7, CRUD+FK),
  `scheduler.test.ts` (7 — recovery-dari-persistence asli, backoff escalation state-dependent, dispatch-order,
  throw→retry+onError, enqueue-re-arm, stop). **Terverifikasi (Opus sendiri):** build bersih, **94/94 test**, lint
  clean. **Nit dicatat:** I-6 (adapter `setTimer` produksi wajib tangkap rejection `runDue` saat wiring M3d).
  Impl = subagent Sonnet, tier-review Tier-1 Opus.
- **Terakhir diupdate (sebelumnya):** 2026-07-04 (dini hari, otonom via cron) — **M3a SELESAI.** Daemon lifecycle + IPC (ADR-015)
- **Terakhir diupdate:** 2026-07-04 (dini hari, otonom via cron) — **M3a SELESAI.** Daemon lifecycle + IPC (ADR-015)
  + rekonsiliasi orphan (menutup I-3). Dibuat: `daemon/ipc-protocol.ts` (NDJSON codec murni), `ipc-server.ts`
  (Node `net` socket/named-pipe, per-request terisolasi, mode 0600 POSIX, **single-instance via connect-probe
  stale-vs-live** — bukan unlink buta, lihat G-14), `ipc-client.ts` (`sendCommand` + `DaemonNotRunningError`),
  `reconcile.ts` (`reconcileOrphans` — I-3), `supervisor.ts` (`createSupervisor` start/stop/heartbeat +
  `DaemonAlreadyRunningError`), `cli/commands/daemon.ts` (`acca daemon` entrypoint tipis timer/sinyal). Extend:
  `paths.ts` (`runtimeSocketPath`), `sessions.ts` (`markOrphanExited`), `meta.ts` (`setHeartbeat`/`getHeartbeat`).
  **Tier-1 (Opus): temuan MAJOR** — `listen()` unlink socket POSIX tanpa syarat → men-steal socket daemon hidup
  di Linux (dua daemon senyap, langgar single-instance ADR-002/sole-writer ADR-015); **diperbaiki inline** (probe
  connect bedakan stale vs hidup). **Terverifikasi (Opus sendiri):** build bersih, **80/80 test**, lint clean;
  single-instance path teruji di Windows (named pipe EADDRINUSE). **Sisa:** jalur stale-unlink-retry POSIX =
  logic-only (I-5, verifikasi Ubuntu); graceful SIGINT/SIGTERM Windows tak teruji interaktif (match pola `run.ts`).
  Impl = subagent Sonnet, tier-review Tier-1 Opus.
- **Terakhir diupdate (sebelumnya):** 2026-07-04 (dini hari, otonom via cron) — **M2 SELESAI.**
- **Terakhir diupdate:** 2026-07-04 (dini hari, otonom via cron) — **M2 SELESAI.** Mesin deteksi murni +
  estimasi reset, tervalidasi fixtures (belum di-wire ke sesi live — itu jatah M3, sesuai acceptance MILESTONES).
  Dibuat: `adapters/types.ts` (+tipe deteksi & method `detect()`), `adapters/patterns.ts` (korpus regex + helper),
  `claude.ts`/`antigravity.ts` `detect()`, `daemon/detector.ts` (`classify(tool,signal)` + `DetectorError`),
  `daemon/reset-estimator.ts` (`estimateReset` presedensi exact→heuristik→backoff + resolusi jam/tz DST-correct),
  `test/fixtures/` (cc-limit 12, cc-overload 11 +3 guard Retrying, agy-limit 4 provisional, cc-noise 138 +adversarial,
  cc-stopfailure 5 payload), `test/detector.test.ts` + `test/reset-estimator.test.ts`. **Klasifikasi:** CC hook
  `error==rate_limit`→limit, `overloaded`/`server_error`→overload, lain→none; output guard Retrying→overload→limit;
  **overload firewall** (429/5xx/529 TAK PERNAH limit). **Terverifikasi (Opus jalankan sendiri):** build bersih,
  **71/71 test**, lint exit 0; fixtures non-trivial + prosa adversarial lolos 0 false-positive dari 138 baris.
  Impl = subagent Sonnet, tier-review Tier-1 line-by-line oleh Opus (pola orkestrator). **Nits (non-blocking):**
  DST clock-wrap (I-4/G-13). agy corpus provisional (RESEARCH TODO #2, butuh limit asli). **Sisa dari M1:** I-3
  (tulis-balik orphan → daemon M3), verifikasi native Ubuntu 24.04 (weekday).
- **Terakhir diupdate (sebelumnya):** 2026-07-03 (malam, M1) — **M1 SELESAI.** Scaffold TS/ESM (pin eksak: node-pty 1.1.0 +
  better-sqlite3 12.11.1 + commander 14 + vitest), store SQLite (WAL+FK, migrasi skema penuh 4 tabel, repo
  sessions/events/meta), `acca run -- <cli>` spawn via node-pty + `acca status`. **Terverifikasi di terminal nyata
  (Windows):** `claude` interaktif terluncur di bawah wrapper → RUNNING→EXITED → wrapper balik ke shell bersih;
  `status` jujur menandai sesi orphan `(basi)`. 9/9 test hijau, lint bersih, native prebuild Node 24 Win. Fix saat
  smoke: `which()` resolve PATH/PATHEXT (G-12), `process.exit` pasca-exit (I-2), liveness `status` (I-1). Implementasi
  = subagent Sonnet, di-tier-review Opus. Commits `591c1c9`→`5cb1577`. **Sisa:** I-3 (tulis-balik orphan → daemon M3),
  verifikasi native **Ubuntu 24.04** (weekday).
- **Terakhir diupdate (sebelumnya):** 2026-07-03 (malam) — **(a)** lock **ADR-011/012/013** (grammy 1.44.0 + redaksi hybrid
  regex+entropy), **ADR-014** (strategi continue sesi hidup: inject-PTY preferred + gating), **ADR-010** (verifikasi
  terminal item (d) **lulus** — LS `GetUserStatus` interaktif ber-PTY balas quotaInfo non-nil), **ADR-015** (IPC Node
  `net` socket/pipe NDJSON); **(b)** buat fondasi M1: **DATA-MODEL, MAP, CONVENTIONS, DEPENDENCY-POLICY**; **(c)** node-pty
  1.1.0 prebuild Node 24 Win terverifikasi. **Proposed tersisa: hanya ADR-001** (butuh limit/quota asli).
- **Terakhir diupdate (sebelumnya):** 2026-07-03 (sore, lanjutan) — rantai doc-first Telegram TUNTAS (THREAT-MODEL +
  Remote Gateway + egress + M-remote + flow/wireframe); 6 ADR di-LOCK (002/005/006/007/008/009); riset real-CLI
  (`api/oauth/usage` CC terbukti; `retrieveUserQuota` agy reachable-tapi-401 token stale); CC bump 2.1.200.
- **Terakhir diupdate (sebelumnya):** 2026-07-03 (sore) — scope MVP bertambah: remote-control Telegram (tier A+B+C)
  masuk MVP. ADR-008 & ADR-005 direvisi; ADR-011/012/013 baru (Proposed); PROJECT direkonsiliasi (US-14..17, AC-9..12).
- **Terakhir diupdate (sebelumnya):** 2026-07-03 (siang) — re-cek versi CLI + uji hook `StopFailure` (TODO #7) +
  uji varian agy LS/RPC live (TODO #5) + lock ADR-003/004 & draft ADR-010 + pass linearitas seluruh docs.

## Sudah dikerjakan

- Repo git di-init (`main`), remote `origin` = github.com/ziffan/auto-continue-cli-agent, `.gitignore`
  (+ `.claude/settings.local.json` diignore per 3 Jul).
- `CLAUDE.md` sebagai satu sumber konteks; `AGENTS.md` = **symlink** ke `CLAUDE.md` (git mode 120000).
- `README.md`.
- `docs/`: PROJECT (6 artefak discovery + flow/wireframe Telegram), RESEARCH (usage-limit + resume, bersumber),
  ARCHITECTURE (C4 L1–L2 + Remote Gateway + stack), DECISIONS (ADR-001..013; **Accepted = 002/003/004/005/006/
  007/008/009/011/012/013**, Proposed = ADR-001 & ADR-010), NFR, MILESTONES (+M-remote), **THREAT-MODEL** (gate tier C), **GOTCHAS**, CONTEXT.
- **Validasi riset ulang 3 Jul 2026** (run terjadwal): 4 koreksi/temuan material — lihat bawah.
- **Audit + validasi sesi 3 Jul dini hari:** semua klaim 2–3 Jul dire-cek ke sumber → **lolos semua**;
  2 temuan material baru (hook `StopFailure`, "limit ≠ exit") di-propagasi ke RESEARCH/DECISIONS/
  ARCHITECTURE/PROJECT/MILESTONES/README/CLAUDE.md.

## Keputusan kunci (ringkas — detail di DECISIONS.md)

- Arsitektur (ADR-001, direvisi 2 & 3 Jul): pisah **monitor usage** (statusLine JSON v2.1.80+ /
  endpoint OAuth usage) dari **deteksi limit + auto-continue**. Deteksi limit CC primer = **hook
  `StopFailure`** matcher `rate_limit` (v2.1.78+), fallback pola output PTY; **limit-hit ≠ proses
  exit** → dua jalur lanjut: inject "continue" ke PTY hidup vs resume-by-id sesi mati (RESEARCH §2c).
- **Strategi continue sesi hidup = ADR-014 (LOCKED 3 Jul malam):** inject "continue" ke PTY (preferred, kelas
  kontrol-auto, token literal tetap) + **gating** (alive + foreground=agent bukan shell + idle + probe kuota dulu);
  fallback resume-by-id saat `exited`; cwd hilang → BLOCKED; **gating-gagal sesi hidup = surface manual, tak auto-kill**.
  Jalur inject agy provisional (butuh verifikasi TUI agy quota-habis, TODO #2).
- **Stack DI-LOCK 3 Jul (ADR-003/004 Accepted):** TypeScript + **Node 24 LTS** (pin v24.18.0) + **node-pty 1.1.0**
  + **SQLite/better-sqlite3 12.11.1** (opsional drizzle 0.45.2). PTY wajib (CC inject-continue & agy LS bind).
- **Probe usage agy = hybrid (ADR-010, LOCKED 3 Jul malam):** LS `GetUserStatus` (sesi interaktif hidup, tanpa csrf) +
  OAuth `retrieveUserQuota` (pre-resume). **Opsi #2 terbukti end-to-end** — LS interaktif ber-PTY (node-pty) balas
  `quotaInfo` non-nil per model (tanpa csrf, tanpa prompt, 0 kuota). Residual (#3 body-sukses + #1 freshness) = impl-tuning M3.
- Batas otonomi (ADR-008, direvisi 3 Jul sore): 2 kelas aksi — (1) kontrol auto (`resume/continue/probe`),
  (2) **relay-instruksi human-in-the-loop wajib konfirmasi**. Supervisor **tak pernah mengarang** instruksi;
  output CLI = data, bukan perintah. **Unattended auto-instruction ditolak.**
- **Remote-control Telegram = MVP (ADR-011/012/013, LOCKED 3 Jul malam):** kanal Telegram long-polling via
  **`grammy` 1.44.0** (bukan webhook) / authz allowlist `chat_id` default-deny / relay+egress guardrail (mode `ask`
  Must + redaksi **hybrid regex+entropy** + injection firewall + audit). **THREAT-MODEL.md = gate wajib sebelum
  implementasi tier C.**
- Pending decisions tersisa (DECISIONS.md): retensi arsip, format IPC, TUI lib, lisensi, strategi continue sesi
  hidup. *(Ditutup 3 Jul: THREAT-MODEL.md ✅, pola redaksi ✅ hybrid regex+entropy, lib bot ✅ grammy 1.44.0 → ADR-011/012/013 LOCKED.)*

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

## Sesi 3 Jul 2026 (sore, lanjutan) — doc-first Telegram tuntas + lock 6 ADR + riset real-CLI

- **Doc-first Telegram TUNTAS:** `docs/THREAT-MODEL.md` **baru** (aset, trust boundary, STRIDE 4 vektor,
  matriks kontrol→AC-9..12, residual risk); ARCHITECTURE +container **Remote Gateway** & Telegram di C4 L1 &
  §5 batas otonomi; NFR §Security +`api.telegram.org` (tutup doc-drift) +blok kontrol remote; MILESTONES
  **M-remote** (tier A/B/C, security-gate); PROJECT flow §4 sub-flow remote + wireframe §5 mobile. Pass linearitas
  (grep 8 file konsisten). **ADR-011/012/013 kini bisa di-lock** setelah 2 pending (pola redaksi + lib bot).
- **6 ADR di-LOCK (Accepted, immutable):** ADR-002/005/006/007/008/009. Set minimal ADR lengkap-terkunci.
  ADR-008: **prinsip** human-in-the-loop dikunci, **mekanisme** (ADR-011/012/013) tetap Proposed. Sengaja tetap
  Proposed: ADR-001/010/011/012/013 (masih ada verifikasi terbuka).
- **Riset real-CLI (jawab "test real cli cc & agy"):**
  - ✅ **CC `api/oauth/usage`** (2.1.200): **200 OK** (Bearer dari `~/.claude/.credentials.json` +
    `anthropic-beta: oauth-2025-04-20`). Skema **lebih kaya dari statusLine**: array `limits[]`
    (`kind`/`severity`/`is_active`/`scope.model`), `resets_at` **ISO-8601** (bukan epoch), `spend.amount_minor`
    integer. **Jalur monitor daemon-standalone CC terbukti** → perkuat ADR-001. **TODO #4 ditutup.**
  - ⚠️ **agy `retrieveUserQuota`**: endpoint **reachable** (bukan 404) + request-shape valid, **tapi 401**
    karena token on-disk **stale**. Temuan: **agy refresh token internal, `oauth_creds.json` tak ditulis ulang**
    (GOTCHAS G-1). Konsekuensi lock ADR-010: opsi #3 butuh refresh via `oauth2.googleapis.com` (egress tambahan)
    atau token dari LS sesi hidup. **Body-sukses ditunda ke M3 (keputusan user).**
  - ⛔ **Blocked (bukan hari ini):** TODO #5d (`quotaInfo` LS interaktif — butuh PTY/M1), TODO #2/#7 (pesan
    limit & `error:"rate_limit"` asli — butuh limit/quota benar-benar habis).
- **CC update 2.1.199→2.1.200** (agy tetap 1.0.16): **tak ada perubahan spek-kritis** (StopFailure, statusLine,
  resume, limit≠exit tetap; auto-continue native belum ada → risiko #4 aman). Disinkron ke RESEARCH §4c.
- **`docs/GOTCHAS.md` dibuat** (G-1..G-6): token agy stale, log login palsu, PTY wajib, dua format reset, field
  hook `error`, CRLF.

## Sesi 3 Jul 2026 (malam) — lock ADR sisa (kecuali ADR-001) + verifikasi terminal ADR-010 + fondasi M1

- **ADR-011/012/013 di-LOCK.** Dua pending ditutup: **lib bot = `grammy` 1.44.0** (MIT, long-polling `getUpdates`
  outbound-only, TS-first, 4 dep) + **pola redaksi = hybrid regex+entropy** (ruleset kurasi in-repo + Shannon entropy;
  threshold eksak di-tune M-remote). Propagasi ke THREAT-MODEL/ARCHITECTURE/MILESTONES.
- **ADR-014 baru + LOCK** — strategi continue sesi hidup: **inject "continue" ke PTY (preferred, token literal tetap,
  kelas kontrol-auto)** + gating (alive + foreground=agent bukan shell + idle + probe kuota dulu); fallback resume-by-id
  saat `exited`; cwd hilang→BLOCKED; **gating-gagal sesi hidup = surface manual, tak auto-kill** (judgment call, sisi aman).
- **ADR-010 di-LOCK** — verifikasi terminal item (d) **LULUS**: agy interaktif dibungkus **PTY nyata (node-pty 1.1.0)**
  → LS `POST GetUserStatus` (tanpa csrf) → **200 OK, `quotaInfo` NON-NIL per model, TANPA prompt (0 kuota)**. Skema
  probe direkam (`remainingFraction` float + `resetTime` ISO-8601, **per model**; reset window per-kelas-model). Opsi #2
  terbukti end-to-end. Residual (#3 body-sukses + #1 freshness) = impl-tuning M3. **Bonus:** GetUserStatus memuat PII →
  feed redaksi ADR-013 (GOTCHAS G-9). node-pty prebuild Node 24 Win OK (de-risk ADR-003 M1).
- **ADR-015 baru + LOCK** — IPC CLI↔daemon = **Node `net` stream socket** (Unix socket/named pipe via satu API),
  NDJSON, mode 0600, tanpa TCP. `status` read-only boleh baca store; mutasi lewat IPC. Menutup pending IPC.
- **Fondasi M1 dibuat:** `docs/DATA-MODEL.md` (skema `sessions/events/scheduled_jobs/meta`, waktu=epoch-ms, no-float),
  `docs/MAP.md` (layout `src/` + kontrak modul), `docs/CONVENTIONS.md` (TS/keamanan/store/penamaan/test),
  `docs/DEPENDENCY-POLICY.md` (pin + gate prebuild native dua-OS).
- **GOTCHAS G-7/8/9 ditulis** (LS quota nil print vs terisi interaktif-PTY; winpty passthrough vs ConPTY; PII di GetUserStatus).
- **Status ADR:** Accepted = 002–015 (13 ADR); **Proposed = ADR-001 saja** (fixture pesan limit + TUI agy saat quota
  habis — genuinely butuh limit/quota asli, tak bisa dipaksa; opportunistik saat terjadi).

## Belum & langkah berikutnya

0. ~~Lanjutan fitur Telegram (doc-first) + lock ADR-011/012/013~~ ✅ **SELESAI (3 Jul malam).** Dua pending
   ditutup: **lib bot = `grammy` 1.44.0** (ADR-011) + **pola redaksi = hybrid regex+entropy** (ADR-013 §2);
   **ADR-011/012/013 di-LOCK (Accepted)**. Sisa saat eksekusi M-remote (bukan sekarang): tune regex/threshold
   redaksi eksak + test corpus. M-remote dieksekusi setelah M3 + security-gate.
1. ~~Lock stack (ADR-003/004)~~ ✅ **selesai 3 Jul.** ~~Strategi continue sesi hidup~~ ✅ **ADR-014 (3 Jul malam).**
   ~~Lock ADR-010~~ ✅ **LOCKED 3 Jul malam** (verifikasi item (d) lulus — opsi #2 terbukti). Sisa: lock ADR lain
   sesuai kebutuhan M1. **Proposed tersisa: hanya ADR-001** (butuh limit/quota asli).
2. ~~Uji hook `StopFailure`~~ ✅ **selesai 3 Jul** (payload + `SessionStart resume` terkonfirmasi; field = `error`).
   Sisa kecil: tangkap nilai `error:"rate_limit"` saat limit 5-jam **asli** habis (tak bisa dipaksa).
3. **Fixture Detector** (TODO #2): konfirmasi lokal korpus §2b saat kena limit sungguhan + varian agy
   (termasuk: TUI agy hidup atau exit saat quota habis?). Bobot turun untuk CC (hook = primer).
4. ~~**Uji 3 opsi probe usage agy** (TODO #5)~~ ✅ **item (d) DITUTUP 3 Jul malam → ADR-010 LOCKED.** Opsi #2
   (LS `GetUserStatus` interaktif ber-PTY) terbukti: `quotaInfo` non-nil per model, tanpa csrf, tanpa prompt (0 kuota).
   Sisa impl-tuning M3 (non-blocking): body-sukses `retrieveUserQuota` (#3, butuh token segar) + freshness `/usage` (#1).
5. ~~Buat DATA-MODEL.md, MAP.md, CONVENTIONS.md, DEPENDENCY-POLICY.md~~ ✅ **selesai 3 Jul malam** + **IPC di-lock
   (ADR-015)** → **fondasi M1 siap, bisa mulai coding sesi depan.**
6. Isi angka retensi arsip (Pending di DECISIONS.md, owner Ziffan — target sebelum M2, **bukan** blocker M1).
7. **Sisa verifikasi prebuild (DEPENDENCY-POLICY):** node-pty + better-sqlite3 di **Ubuntu 24.04**; better-sqlite3 di Windows.

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
