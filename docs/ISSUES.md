# ISSUES.md — issue terbuka & tertutup

> Prioritas: P0 (blocker) · P1 (penting) · P2 (mengganggu) · P3 (nanti). Ditutup = tulis solusinya.

---

## Terbuka

> **Audit 11 Jul (`docs/audit/AUDIT-2026-07-11.md`) → I-20..I-28.** Audit menyeluruh pra-M-remote menemukan
> **4 P1 di jalur resume/continue** yang lolos 308 test (test men-stub seam yang justru cacat). Detail lengkap +
> bukti baris-per-baris + rencana remedi R1–R8 ada di file audit — entri di bawah = ringkas + pointer. **Gate keluar
> sebelum M-remote:** I-20..I-22 (R1–R3) selesai + I-15 live-verify LULUS dgn CLI nyata.

### I-20 — Capture `cli_session_id` (R2b, penangkap id CLI untuk resume-by-id) [P1, blocker M-remote]
**Konteks:** A-1. Paruh korektness sudah ditutup R2a (`df3904b`): resume-by-id kini pakai `session.cli_session_id`;
absen → BLOCKED (bukan spawn id supervisor 4-char yang dijamin ditolak CLI). `setCliSessionId(id, cliId)` repo sudah
siap. **Sisa (issue ini):** benar-benar MENANGKAP id CLI → sampai itu ada, setiap resume-by-id sesi `exited` = BLOCKED.
- **CC:** encoding transcript **terverifikasi empiris 11 Jul** = `~/.claude/projects/<cwd.replace(/[^a-zA-Z0-9]/g,'-')>/<uuid>.jsonl`,
  filename `<uuid>` = id `claude --resume <uuid>` (lihat G-34). Korelasi "jsonl termuda pasca-spawn" = **racy** (dua sesi
  di cwd sama) → **jalur robust = hook `SessionStart`** (payload beri id langsung; gabung ke I-23).
- **agy:** printed resume cmd saat exit + `~/.gemini/` conversations dir (belum diinvestigasi).
- **DoD:** live-verify dgn CLI nyata (audit §6: jangan ✅ actuation tanpa live smoke jalur default). **Sumber:** audit A-1.
- **✅ PARUH agy TERPECAHKAN (live-verify 11 Jul, G-36):** sumber id agy = perintah yang agy **CETAK saat exit**
  `agy --conversation=<uuid>` (andal, bukan racy) + `~/.gemini/antigravity-cli/conversations/<uuid>.db`. Resume-load
  terbukti (`agy --conversation=<id>` memuat percakapan lama). **Sisa I-20:** (a) **CC** masih butuh hook `SessionStart`
  (I-23) / G-34; (b) menghubungkan capture ini ke `setCliSessionId` di wrapper agy (tangkap dari output exit atau saat
  spawn). Sampai wiring itu, resume-by-id agy exited masih BLOCKED (paruh korektness R2a), tapi **sumbernya kini pasti**.

### I-21 — Auto-continue hanya bekerja SEKALI per sesi hidup (siklus limit kedua tak terdeteksi) [P1]
`limit-watcher` `latched` permanen + tak ada transisi RESUMED→RUNNING + monitor `listRunning` filter `RUNNING` saja →
sesi RESUMED yang masih hidup berhenti dipantau. Flow PROJECT §4 langkah 10 ("Kembali ke 3") tak terjadi: sesi panjang
yang kena limit 2× (persona target) hanya ter-rescue sekali. **Remedi:** transisi RESUMED→RUNNING (wrapper tandai saat
inject diterima) + un-latch watcher pasca-inject + monitor mencakup sesi hidup + test siklus 2×. **Sumber:** audit A-3.

### I-22 — agy resume-by-id sesi MATI: implement opsi #3 (probe standalone OAuth) [P1] — **keputusan LOCK (ADR-018), impl pending**
Job `probe` agy pada sesi `exited` → PID mati → `discoverLocalPorts` kosong → throw → `'retry'` backoff cap 60m
**selamanya, senyap**. **KEPUTUSAN 11 Jul (Ziffan → ADR-018): Opsi 1** — implement probe standalone pre-resume
(`retrieveUserQuota`) + refresh token via **`oauth2.googleapis.com`** (masuk egress whitelist NFR). Otonomi penuh agy-exited.
**Dua slice (M3e/R4):**
1. **Guard minimal — LEBIH DULU (kecil, independen):** deteksi agy+exited+probe-impossible → notif `PROBE_IMPOSSIBLE` +
   **stop retry** (tutup bug loop-senyap). Aman dikerjakan tanpa nunggu #2.
2. **Probe standalone (Tier-1: creds + egress, butuh live-verify):** refresh token `oauth2.googleapis.com` (client-id
   Gemini CLI) → `retrieveUserQuota` → `UsageSnapshot`. Mitigasi ADR-018: allowlist host ketat (`guardEgress`), token
   dibaca-saja (tak di-log), PII firewall (G-9), refresh pre-resume-only. Live-verify: token disk stale (G-1) → flow
   refresh harus terbukti balas 200 + body-sukses (yang ADR-010 tunda ke M3). **Sumber:** audit A-4, ADR-018.

### I-23 — Deteksi limit CC PRIMER (hook `StopFailure`) belum diimplementasi [P2]
ADR-001/CLAUDE.md §7 tetapkan hook `StopFailure` matcher `rate_limit` sbg jalur deteksi **primer**; yang ada hanya
fallback pola output (`limit-watcher`). `feedSignal` ada tapi **nol pemanggil produksi**. M3d ditutup tanpa hook + tak
ada issue yang melacaknya. **Remedi:** tulis settings hooks (`CLAUDE_CONFIG_DIR`/`--settings`) + kanal callback (reuse
socket kontrol per-sesi) → `feedSignal({type:'stopfailure',error})`. **Sekaligus sumber `cli_session_id` (I-20) via
payload `SessionStart`.** **Sumber:** audit A-5.

### I-24 — `acca status` tak tampilkan reset_at terjadwal & liveness daemon → AC-4 belum benar-benar lulus [P2]
Tabel `status` tanpa `reset_at`/`reset_source` (padahal AC-4 = "usage + sesi + reset terjadwal", wireframe §5 tampilkan
`LIMIT_HIT → resume 03:15 WIB`); `meta.getHeartbeat()` ada tapi tak pernah dibaca (NFR Observability minta liveness).
MILESTONES/CONTEXT menandai AC-4 ✅ = **overclaim** (dikoreksi sesi ini). **Remedi:** kolom `reset` (HH:MM + sumber) +
baris header liveness daemon. **Sumber:** audit A-6.

### I-25 — Gate resume `every(usedFraction<1)` terlalu ketat untuk CC [P2]
`supervisor.ts` blokir resume bila **satu** limit exhausted. Untuk CC, model scoped yang tak dipakai sesi (mis. weekly
Opus habis, sesi jalan Sonnet) → blokir resume selamanya. Untuk agy `every` justru benar (dual-limit per grup, G-31).
**Remedi:** pindah keputusan "usage available" ke adapter (`isUsageAvailable(snapshot)`) — CC pakai `five_hour`/`seven_day`
global + `is_active`; agy semua bucket. **Sumber:** audit A-7.
**✅ CONFIRMED live 11 Jul (agy 1.1.1):** `3p-5h` (dibagi Opus/Sonnet 4.6 + GPT-OSS) habis → `usedFraction=1`, sedangkan
`gemini-5h` masih 100% (`usedFraction=0`, grup terpisah) → `every(usedFraction<1)` = **false** → resume terblokir walau
Gemini penuh. Persis skenario yang issue ini antisipasi (per-grup untuk agy). Memperkuat perlu `isUsageAvailable(snapshot)`
per-adapter. **Sumber:** I-15 live-verify 11 Jul.

### I-26 — ACL named pipe Windows belum diverifikasi (ADR-015 "owner-only") [P2, verifikasi di M5]
Named pipe Node/libuv default **bisa di-connect user lain** di mesin sama (DACL bukan owner-only spt chmod 0600).
`status` bocorkan daftar cwd; `inject` bisa dipicu pihak lokal (dibatasi: token literal tanpa payload). Single-user
desktop = risiko rendah; node headless multi-akun (ADR-007) = relevan. **Remedi:** verifikasi DACL nyata di M5 security
pass → bila terbuka, catat residual risk THREAT-MODEL atau cek PID same-session-user. **Sumber:** audit A-8.

### I-27 — `genSessionId` 4-char tanpa retry-on-collision + retensi never-purge [P3]
`ids.ts` random tanpa cek unik → PK collision → `createSession` throw → `acca run` gagal misterius. Retensi tak terbatas
(5 Jul) → birthday ~50% di ~1.200 baris. **Remedi:** retry loop (≤3×) saat `SQLITE_CONSTRAINT_PRIMARYKEY` atau naikkan
panjang id. **Sumber:** audit A-9.

### I-28 — Housekeeping audit (drift docs + guard kecil) [P3, bisa dicicil]
Bundel A-10..A-15: (A-10) DEPENDENCY-POLICY basi (pending TUI sudah diputus plain-ANSI; `commander` belum di tabel pin);
(A-11) MAP.md cantumkan `daemon/continue.ts` yang tak pernah ada + file nyata tak tercermin; (A-12) CRLF noise lintas-OS
NYATA (G-6) → `.gitattributes` (`* text=auto` + `*.md eol=lf`) + `git add --renormalize .`; (A-13) `markResumed` tanpa
guard status → bisa clobber EXITED/FAILED pada race (tak konsisten disiplin `markLimitHit`); (A-14) status `WAITING`/
`BLOCKED` = enum DB tak pernah ditulis ke baris sesi → `acca status` tak pernah tampilkan (putuskan pakai/buang via ADR
kecil); (A-15) `stripAnsi` belum strip OSC/charset (G-20, watch). **Sumber:** audit A-10..A-15.

### I-15 — Live-verify actuation dgn kondisi ASLI belum dilakukan (opportunistik) [P2, target saat limit asli]
Kedua actuation seam LIVE-VERIFIED di Windows tapi dengan **proses proxy** (node-pty child echo / stub
`resumeCmd`), bukan CLI agent nyata di limit nyata: (a) apakah `claude`/`agy` hidup di prompt benar-benar
**menerima `continue\r`** lalu melanjutkan turn; (b) apakah `claude --resume <id>` / `agy --conversation <id>`
benar melanjutkan percakapan di sesi wrapper baru. Ini sekelas verifikasi yang genuinely butuh limit/sesi
asli (tak bisa dipaksa) — tangkap **opportunistik** saat limit 5-jam habis. Keystroke pasti agy = TBD
(ADR-014 catatan agy: kandidat "continue"/Enter). **Sumber:** smoke Sub-task 1&2 (6 Jul).
**+ Ditambahkan (delta-check versi 11 Jul):** live-verify kini di **agy 1.1.1** (naik minor dari 1.0.16) & **CC 2.1.207**.
Saat menangkapnya, sekalian: (a) **re-verify schema LS** `GetUserStatus`/`RetrieveUserQuotaSummary` di 1.1.1 (changelog nol
LS-change → diduga utuh, belum dibuktikan live); (b) tentukan penanda **idle/foreground agy** terhadap **mode `request-review`
default baru** (G-33) — agy yang "berhenti" bisa = menunggu review `f`, bukan idle-at-prompt; pertimbangkan `--mode default`
bila mengganggu auto-continue. Catatan positif: CC **2.1.206** memperbaiki bug keyboard-input `--resume`/`--continue` saat
startup → jalur resume-by-id lebih mulus di 2.1.207.

**✅ SEBAGIAN BESAR TERVERIFIKASI untuk agy 1.1.1 (11 Jul, burn `3p-5h` ~11% ke limit, otorisasi user):**
- **Deteksi limit (jalur produksi):** pesan TUI `Individual quota reached` NYATA di 1.1.1 → `matchAgyLimit` +
  `antigravityAdapter.detect` fire benar (`{kind:'limit',source:'output'}`). **limit≠exit** dikonfirmasi (agy hidup di
  prompt). (G-19 re-verified, G-33 dikoreksi.)
- **Resume-by-id (paruh load):** `agy --conversation=<id>` **memuat percakapan lama utuh** di sesi baru, hidup di prompt
  (G-36). Sumber id andal = cmd yang agy CETAK saat exit.
- **SISA (genuinely butuh tunggu reset / sesi asli):** (a) **inject `continue` pasca-reset benar melanjutkan turn** —
  butuh 3p-5h reset (~5 jam) lalu inject; belum. (b) **penanda idle/foreground agy mid-turn** (busy marker saat generate)
  belum ditangkap presisi (idle-tracker agy masih `undefined`). (c) **CC** (`claude`) limit asli + inject/resume tetap
  opportunistik (belum). **Efek:** gate keluar I-15 untuk **deteksi+resume-load agy** = LULUS; sisa = actuation inject
  pasca-reset (agy+CC). **Sumber:** I-15 live-verify 11 Jul (scratchpad `agy-*.mjs`).

### I-8 — Monitor proaktif "mendekati limit" (proximity) dari usage-probe [P2, target M4/US-13] — ENGINE READY (10 Jul), wiring→I-17
Claude Code menampilkan warning ~90% (window 5-jam) & ~75% (mingguan) di terminal, tapi itu **UI-only,
tak di-persist** (G-15) → jangan scrape. Sinyalnya sudah tersedia via usage-probe: `usedFraction` (parser
M3c). **ENGINE SELESAI (10 Jul, `src/notify/notifier.ts`):** `proximityNotifications(snapshot, thresholds)`
MURNI — ambang default **0.90 five_hour / 0.75 weekly** (meniru CC), klasifikasi window weekly (`/week/i`|
`seven_day`) vs 5h (session/five_hour/5h/label-model agy), exhausted (usedFraction=1)=wilayah LIMIT_HIT→dilewati;
body tanpa PII (G-9). 6 test cabang hijau. **WIRING DITUNDA → I-17:** proximity baru bermakna saat sesi AKTIF
dipakai; probe yang ada hanya jalan saat reset (usedFraction rendah di sana) → butuh loop probe periodik saat
RUNNING. Basis fitur US-13 (prediksi proaktif, backlog) + indikator proximity di `acca status` (M4 status-UX).

### I-7 — Skema agy `GetUserStatus` direkonsiliasi ke respons LIVE Ubuntu (5 Jul) [P3] ✅ (live-verify)
**RESOLVED (5 Jul, live Ubuntu 24.04 / agy 1.0.16):** GetUserStatus ditembak dari sesi agy NYATA ber-PTY → HTTP 200.
**Koreksi material vs asumsi 4 Jul:** (a) respons **DIBUNGKUS `userStatus`** (bukan flat); (b) identitas model = **`label`**
(display, mis. "Claude Opus 4.6 (Thinking)") + **`modelOrAlias.model`** (enum slug, mis. `MODEL_PLACEHOLDER_M26`) —
**field datar `model` TAK ADA** (asumsi lama salah, G-24). `quotaInfo.{remainingFraction,resetTime}` per-model ✓
(reset window beda per-model: 10:16:37Z vs 09:32:55Z). Credits di `userStatus.planStatus.{availablePromptCredits,
availableFlowCredits}` + `userStatus.userTier.availableCredits[]`. **Solusi:** `parseAgyUserStatus` diperbaiki (prioritas
`label` + baca `modelOrAlias.model`; **G-17 exhausted → usedFraction=1, tak di-skip** supaya consumer `limits.every(usedFraction<1)`
tak keliru resume); fixture `test/fixtures/usage/agy-userstatus.json` diganti **capture live redaksi PII** (G-9). 187/187
test hijau. Sisa non-blocking untuk M3d.4: mekanika endpoint (HTTPS/Connect + retry ~2–4s) terdokumentasi G-23.

### I-11 — Placeholder dispatch scheduler daemon backoff-spin sampai M3d.5 [P3] ✅ (M3d.5 rebuild `3db7fa6`)
**RESOLVED:** `realDispatch` di `supervisor.ts` mengganti placeholder — probe→enqueue-resume / backoff / masih-limit
retry / error retry nyata; jalur resume-alive kini `'done'` (bukan `'retry'`) sehingga **tak ada lagi backoff-spin
tak berujung**. Cabang-cabang ini ditutup test `test/supervisor-dispatch.test.ts` (7 kasus). Catatan historis di bawah.

`supervisor.ts` mem-wire scheduler dengan **dispatch placeholder** (`deps.dispatch ?? …`) yang mengembalikan
`'retry'` + emit event `job_dispatch_pending` — karena `probeUsage()`/resume nyata baru ada di M3d.5. Efek: bila
daemon **benar-benar jalan** dgn job `probe` pending, scheduler memicunya → 'retry' → reschedule backoff
(5m→15m→60m cap) → memicu lagi tiap ~60m selamanya, menumpuk event `job_dispatch_pending`. **Non-blocking
sekarang** (daemon belum dijalankan di alur normal; `acca run` = wrapper, bukan daemon; tak ada job produksi
yang dipicu daemon hidup). **Hilang otomatis saat M3d.5** mengganti dispatch dgn probe sungguhan (done/retry
nyata). Jangan jalankan `acca daemon` jangka panjang sebelum M3d.5 tanpa sadar ini.

---

## Tertutup

### A-2 — Spawn-gagal resume-by-id = unhandled rejection → daemon CRASH [P1] ✅ (11 Jul, R1 `9027dc4`)
**RESOLVED (M3e/R1, Opus inline Tier-1).** Default `spawnResumeFn` membuang `waitForExit` dari `runSession`; pada spawn
gagal-sinkron (binary CLI hilang — skenario nyata daemon service PATH minimal) `runSession` return `waitForExit` yang
REJECT → unhandledRejection → Node ≥15 mematikan **daemon**. Selain itu dispatch `markResumed` sesi lama tanpa syarat
(menandai RESUMED walau resume gagal). **Fix:** default `spawnResumeFn` konsumsi `waitForExit` (`.catch`) + lapor
`spawnFailed` via status sesi baru (runSession `markFailed` SEBELUM return pada jalur gagal-sinkron); dispatch:
`spawnFailed` → event `job_dispatch_error 'resume_spawn_failed'` + `'retry'`, sesi lama TAK di-RESUMED (tetap LIMIT_HIT).
`ResumeSpawnResult` +`spawnFailed?`. **Test baru menjalankan DEFAULT `spawnResumeFn` (bukan stub)** via binary hilang →
`which()` null → gagal sinkron tanpa spawn nyata (menutup blind-spot audit §6). **310 test hijau.** **Sumber:** audit A-2.

### A-1 (paruh korektness) — Resume-by-id pakai id supervisor, bukan `cli_session_id` [P1] ✅-paruh (11 Jul, R2a `df3904b`)
**RESOLVED paruh korektness (M3e/R2a, Opus inline Tier-1).** Dispatch cabang `exited` dulu panggil `resumeCmd(session.id)`
= id supervisor 4-char → `claude --resume <acca-id>` PASTI ditolak CLI → resume-by-id gagal 100% (test malah meng-encode
bug sbg ekspektasi). **Fix:** dispatch pakai `session.cli_session_id`; absen → `job_dispatch_error 'blocked'`
`reason=cli_session_id_missing status=BLOCKED` (surface via notifier), tak spawn id salah + tak keliru markResumed. Guard
`cli_session_id` SETELAH `cwd_missing` (dua-duanya BLOCKED). `sessions.setCliSessionId` repo siap. Test bug-encoding
dikoreksi (assert cli id) + test baru "NULL → BLOCKED". **Sisa (penangkap id) → I-20.** **Sumber:** audit A-1.

### I-19 — File `test/` tak ter-typecheck di gate mana pun (tsconfig.eslint.json rootDir TS6059) [P3] ✅ (11 Jul, delta-check session)
**RESOLVED (sesi Ubuntu 11 Jul, docs-only branch `m4-version-delta`).** `npm run build` (tsconfig.json) meng-exclude `test/`;
`lint` (eslint type-aware) tak surface full structural-diagnostics; vitest (esbuild) buang tipe → error tipe di test **lolos
ketiga gate**. `tsconfig.eslint.json` tak bisa dipakai `tsc --noEmit` langsung krn warisi `rootDir: src` → `test/**` = **TS6059**.
- **Fix:** **`tsconfig.typecheck.json`** baru (extends `tsconfig.json`, override **`rootDir: "."`** + `noEmit: true`, include
  `src`+`test`) → `tsc -p` mencakup dua-duanya tanpa TS6059. Script **`typecheck`** + agregat **`check`** (`typecheck && lint &&
  test`) ditambah ke `package.json`. `tsconfig.eslint.json` **tak disentuh** (tetap dipakai eslint parser; lint lolos apa adanya).
- **Gate membuktikan diri:** run pertama menangkap **14 type-error test yang selama ini tersembunyi** di 3 file → semua diperbaiki
  (test-only, nol kode produksi): `credentials.test.ts` (2× cast `()=>string`→`readFileSync` via `unknown`, sesuai saran TS2352);
  `notifier.test.ts` (8× akses index array tanpa guard → optional-chaining `?.`, **konsisten konvensi codebase** mis. `limited[0]?.type`);
  `usage-monitor.test.ts` (4× `vi.fn()` tanpa param → tuple call-arg kosong TS2493 → deklarasi signature asli `(tool, pid)`).
- **Verifikasi:** build ✅ · **typecheck ✅ (0 error, kini cakup `test/`)** · lint ✅ · **308/308 test** hijau. **Sumber:**
  `tsconfig.typecheck.json`, `package.json`, delta-check session 11 Jul.

### I-18 — `inject_skipped` (gating-gagal sesi hidup) tak ter-surface ke Notifier → sesi macet senyap [P3] ✅ (11 Jul)
**RESOLVED (autonomous-run 11 Jul).** `notificationForEvent` kini memetakan `job_dispatch_pending`
`action:'inject_skipped'` → notifikasi **`INJECT_SKIPPED`** (level `warn`, body "Session #x could not auto-continue
(reason) — manual action needed"; `reason` = label terkontrol, firewall G-9 utuh). Surfacing OTOMATIS lewat dekorator
`withNotifications` (event sudah di-emit `supervisor.ts:204` → di-append → di-surface; **tanpa ubah supervisor**).
`still_limited`/aksi pending lain tetap `null`. **+1 test** (`notifier.test.ts`), 306/306 hijau, build+lint bersih.
**Sumber:** `src/notify/notifier.ts`.

### I-17 — Loop probe usage PERIODIK saat RUNNING (wiring proximity I-8 + cache usage `acca status`) [P2] ✅ (11 Jul, engine+wiring; live-verify sesi asli → I-15)
**RESOLVED engine+wiring (autonomous-run 11 Jul, Windows; interval ~2 mnt owner Ziffan).**
- **Engine `src/daemon/usage-monitor.ts`** (subagent Sonnet, murni-injectable, pola scheduler): `createUsageMonitor`
  tick periodik → `pickRepresentatives` (dedup per tool, prefer sesi ber-pid utk port-discovery agy) → `probeFor`
  per tool → `saveSnapshot` + `proximityNotifications`→`deliver`; **isolasi per-tool** (satu tool reject tak
  hentikan lain, `runOnce` selalu resolve); **re-entry guard** (skip tick bila runOnce in-flight); start idempotent/
  stop cegah re-arm. FIREWALL G-9: tak menyurface field probe selain via proximity (PII-safe) + snapshot terstruktur.
- **Wiring supervisor (Opus, Tier-1):** `probeFor`=`adapters[tool].probeUsage?.({sessionPid})` (skip tool tanpa
  probe), `listRunning`=`listActive` filter RUNNING+alive, `saveSnapshot`=`meta.set('usage_snapshot_<tool>', JSON)`
  (**tanpa migrasi** — meta key/value), `deliver`=notify sink. **Opt-in `startUsageMonitor`** (default false; `acca
  daemon` produksi=true) supaya timer monitor tak mengacaukan assertion timer test scheduler lama (**G-32**).
- **Verifikasi (Opus sendiri):** build+lint bersih, **290/290 test** (+9 usage-monitor +2 wiring: probe→meta cache +
  proximity→notify, dan monitor-off-default = nol timer/probe). Tier-1 self-review.
- **Live smoke jalur data (11 Jul, Windows):** `adapters.claude.probeUsage()` NYATA (OAuth usage) → snapshot asli
  `session 0.37 / weekly_all 0.36 / weekly_scoped 0` → `proximityNotifications` = **0 notif** (semua < ambang 0.90/0.75,
  benar), **nol PII** (firewall G-9 tahan di data live). Membuktikan pipeline probe→normalisasi→proximity end-to-end
  di data asli (sekaligus live-verify M3d.3 CC-probe yg dulu belum diuji limit asli).
- **Sisa (opportunistik, sekelas I-15):** (a) loop daemon NYATA end-to-end (start `acca daemon` + sesi RUNNING → tick
  memicu probe+cache+notify) vs pemanggilan `probeUsage` langsung; (b) **agy** probe live (butuh sesi LS hidup ber-PTY).
- **⚠ CAVEAT BARU (live-verify 11 Jul, G-35):** probe agy via **sesi LS hidup = snapshot saat launch, STALE dalam-sesi**
  (tak refresh saat sesi membakar kuota). Monitor periodik yang probe sesi agy RUNNING panjang → angka **basi** →
  proximity meleset. **Mitigasi:** untuk agy, kuota real-time butuh **probe FRESH** (sesi baru / standalone OAuth ADR-018),
  atau andalkan deteksi limit dari **output TUI** (live, terbukti). CC OAuth-probe tak kena (HTTP standalone selalu fresh).
  Konsumen `acca status` baca cache = **slice status-UX** berikut.

### I-4 — `reset-estimator` clock-time wrap tak DST-aware saat lewat tengah malam [P3] ✅ (11 Jul, `resolveClockTime` DST-correct)
**RESOLVED (autonomous-run 11 Jul, Windows).** `resolveClockTime` dulu menambah `MS_PER_DAY` mentah ke instant UTC
untuk "next occurrence" → di ~2 hari transisi DST/tahun meleset ±1 jam (hari lokal = 23/25 jam, bukan 24).
**Fix:** cabang **UTC** tetap `+MS_PER_DAY` (benar, tanpa DST); cabang **zona IANA** kini menghitung ulang
wall-clock SAMA di tanggal kalender berikutnya (`Date.UTC(…, day+1)` untuk normalisasi rollover → `resolveWallClockToUtc`,
offset dihitung ulang DI tanggal itu). Pure, `now` injected. **+2 test** (`test/reset-estimator.test.ts`): wrap
melintasi **spring-forward** (New York 7→8 Mar 2026, tetap 15:00 EDT=19:00Z, bukan 16:00) & **fall-back** (31 Okt→1 Nov,
tetap 15:00 EST=20:00Z, bukan 14:00) — ekspektasi hand-verified via Intl, versi lama meleset tepat 1 jam di keduanya.
**270/270 test** (2 skip POSIX), build+lint bersih, Tier-1 self-review. GOTCHAS G-13 ditandai teratasi. **Sumber:**
`src/daemon/reset-estimator.ts`, G-13.

### I-16 — Probe agy `GetUserStatus` BUTA window MINGGUAN → dispatch keliru-resume [P1] ✅ (7 Jul, ditemukan+diperbaiki+live-verified)
**Temuan (cross-check CodexBar 0.41.0) → CONFIRMED live → FIXED, semua 7 Jul (Windows, agy 1.0.16, sesi ber-PTY).**
- **Bukti gap (spike live):** `GetUserStatus` (yang dulu kita pakai) = **window 5-JAM SAJA** — 8 model
  `remainingFraction:1`, satu reset, **body tak memuat "week"**. `RetrieveUserQuotaSummary` = **KEDUA window per-grup**:
  `response.groups[].buckets[].{bucketId, window:"weekly"|"5h", remainingFraction, resetTime}`; live grup Gemini weekly
  0.263 + 5h 1.0, grup Claude/GPT weekly 0.399 + 5h 1.0 (*"models share a weekly limit AND a 5-hour limit"*).
  `RetrieveUserQuota` singular = 404. Dampak: dispatch `every(usedFraction<1)` atas GetUserStatus **buta weekly** →
  bisa keliru resume saat weekly habis (sekelas G-17). Lihat **G-31**.
- **Fix (Tier-1 — network+parser+dispatch):** (1) `adapters/antigravity.ts` probe pindah ke
  **`RetrieveUserQuotaSummary`** (reuse `loopbackHttpsPostJson` + retry G-23 — header `Connect-Protocol-Version` TAK
  diperlukan, dikonfirmasi live). (2) parser baru **`parseAgyQuotaSummary`** (`adapters/usage.ts`): tiap bucket
  (weekly+5h, semua grup) → `UsageLimit` (`kind`=`weekly`/`5h`, `scope`=`bucketId` non-PII;
  `usedFraction=1-remainingFraction`; **absent→exhausted=1** G-17; bucket tanpa identitas → skip). PII firewall:
  **displayName/description grup-bucket TAK PERNAH disentuh** (G-9). (3) dispatch tak berubah — kini mencakup weekly → benar.
- **Verifikasi:** 242→**244 test** (+parseAgyQuotaSummary 9 kasus incl. "weekly=0 blokir resume saat 5h penuh"; probe test
  di-update ke shape summary; fixture `agy-quota-summary.json` = capture live redaksi). **Live PRODUCTION probe** (dist,
  `loopbackHttpsPostJson`) balas 4 limit weekly+5h dari agy nyata (gemini-weekly used 0.74, 3p-weekly 0.60). Tier-1 self-review.
- **Catatan:** `parseAgyUserStatus` (GetUserStatus) DIPERTAHANKAN (masih diekspor+bertes) — GetUserStatus punya
  `planStatus`/credits yang RetrieveUserQuotaSummary tak punya → kandidat sumber deteksi **credit-fallthrough** (G-16) &
  proximity (I-8) di M4. **Minor CodexBar (dicatat):** `GetUnleashData` (pilih-port instan), `ANTIGRAVITY_OAUTH_CREDENTIALS_JSON`
  (creds standalone, opsi #3), `lsof` (POSIX port-discovery — kita pakai inode, pertahankan).

### I-14 — `runSession` di-import daemon (layer terbalik) + link old→new session longgar [P3] ✅ (7 Jul, `c4cf164`)
**RESOLVED (relokasi + resume-chain link):**
- **(a) Relokasi:** `runSession` dipindah `cli/run-core.ts` → **`daemon/process-wrapper.ts`** (tempat yang MAP
  niatkan; `run-core.ts` = bootstrap M1). `cli/commands/run.ts` (jalur user) + `daemon/supervisor.ts` (actuation
  resume-by-id) kini **sama-sama import dari `daemon/`** → arah dependency benar (bukan lagi daemon→cli). Git
  mendeteksi sbg rename (87%); nol referensi `run-core` tersisa di kode; build+lint bersih.
- **(b) Resume-chain link:** sesi hasil resume = row BARU; dulu kaitan ke sesi lama hanya via event `resume_spawned`
  (longgar). Kini migrasi **`0002-session-resumed-from.sql`** tambah kolom `sessions.resumed_from` (FK→sessions.id,
  `schema_version`=2); default `spawnResumeFn` meneruskan `session.id` sbg parent; `acca status` render rantai
  **`#new<-#old`**. Dipilih `resumed_from` (bukan reuse `cli_session_id` yang = id milik CLI, semantik beda).
- **Verifikasi:** 231→235 test (+store persist +integration persist). **Live smoke Windows:** upgrade v1→v2 pada
  DB **ber-isi** (ALTER TABLE aman, baris lama terjaga), FK menolak parent menggantung (G-30), status render benar.
  Tier-1 self-review APPROVE.

### I-10 — Cross-process gap: wrapper enqueue probe vs scheduler daemon re-arm hanya saat restart [P2] ✅ (7 Jul, `4255c99`)
**RESOLVED (Option A — IPC notify → re-arm; BUKAN konsolidasi sole-writer):** wrapper `acca run` (proses terpisah)
enqueue job `probe` ke `scheduled_jobs` saat LIMIT_HIT, tapi scheduler daemon **hidup** hanya baca pending saat
`start()`/`enqueue()` in-process → tak tahu tulisan proses lain sampai restart. Fix:
- **`scheduler.rearm()`** = `arm()` yang **selalu baca `jobs.listPending()` segar** dari store (termasuk tulisan
  proses lain) & arm timer terdekat. Aman dipanggil mid-dispatch (finally re-arm).
- **Supervisor** expose perintah IPC **`rearm`** (ipcServer dipindah setelah scheduler; handler tanpa TDZ).
  Perintah **tanpa payload** — injection firewall konsisten (G-26); socket tetap 0600 owner-only.
- **`process-wrapper.notifyDaemonRearm()`** = best-effort fire-and-forget setelah `scheduleProbeForLimit`
  enqueue. **Non-fatal:** tak ada daemon (`DaemonNotRunningError`)/timeout → di-swallow; recovery-saat-`start()`
  tetap jamin job tak hilang (AC-7). Notify hanya memangkas latensi "sampai restart" → "seketika".
- **Verifikasi:** +4 test (scheduler.rearm cross-process, supervisor rearm-over-IPC **real socket**,
  notifyDaemonRearm live+dead-socket). **Live smoke DUA PROSES:** `acca daemon` nyata (pid 13904) idle → proses
  terpisah tulis job + kirim rearm → daemon dispatch (blocked/cwd_missing) **tanpa restart**. Tier-1 self-review.
- **Residual → RESOLVED by-design (11 Jul, ADR-017):** konsolidasi **sole-writer** penuh (daemon ambil-alih lifecycle
  sesi wrapper) **DITOLAK**. Investigasi jalur-penulis membuktikan: auto-continue toh sudah daemon-dependent, desain
  wrapper-tulis-lalu-`rearm` + recovery-saat-start sudah resilient (AC-7), tak ada write-race nyata. Konsolidasi penuh
  hanya menukar resilience "tulis-sekarang-recover-nanti" + mode monitoring standalone demi invariant tanpa manfaat.
  **Batas kepemilikan di-scope ulang ADR-017:** wrapper = penulis SAH lifecycle sesinya + enqueue `probe`; daemon =
  sole *coordinator*/dispatcher + reconciler (bukan sole *writer*). Bootstrap-exception MAP.md kini **permanen by-design**,
  bukan utang. Revisit hanya bila multi-node (v2) menuntut. Lihat DECISIONS ADR-017 + MAP §Kontrak.

### I-13 — Gating inject-continue foreground/idle belum dihitung [P2] ✅ (7 Jul, `7dffcbe`)
**RESOLVED:** ADR-014 poin (ii) foreground=agent-bukan-shell & (iii) idle-bukan-mid-turn kini **dihitung &
ditegakkan** (sebelumnya `undefined` → tak memblokir, inject lolos hanya dgn alive+hasPtyHandle).
- **`shared/foreground.ts`** (poin ii): foreground = grup proses child memegang foreground pts. Linux
  `/proc/<childPid>/stat`: `tpgid == pgrp` → agent (true) · `!=` (>0) → grup lain/subshell job-control (false,
  block) · `<=0`/Windows/unreadable → `undefined` (unknown, tak memblokir). **Robust tanpa daftar nama proses**
  (lebih baik dari name-matching shell). Never-throws. **Live-verified real /proc Ubuntu:** child ber-PTY →
  `tpgid==pgrp` → true; proses piped → `tpgid=-1` → undefined; pid mati → undefined.
- **`shared/idle-tracker.ts`** (poin iii): idle = tak ada penanda busy (`esc to interrupt`, Claude) di output
  selama jendela sunyi (default 1000ms; footer generate repaint sub-detik). agy: penanda TBD → `undefined` (I-15).
  Waktu di-inject (deterministik). ANSI-strip + carry-over antar-chunk.
- **`shared/ansi.ts`**: `stripAnsi` diekstrak dari limit-watcher → dipakai idle-tracker (DRY).
- **`cli/run-core.ts`**: wire `foregroundIsAgent(childPid)` + `idleTracker` (feed di `onData`) ke `createInjectHandler`.
Poin (iv) probe-kuota-dulu sudah dipenuhi pipeline (M3d.5). Token literal firewall utuh (undefined tak memblokir,
tapi yang ditulis tetap `CONTINUE_TOKEN` hardcoded). **+20 test** (foreground 11 · idle-tracker 7 · inject-continue 2),
229/229 hijau, Tier-1 self-review APPROVE. **Minor diterima (ADR-014 risk band):** idle bisa false-positive bila
agent pause mid-turn >1s tanpa repaint footer → inject = Enter-keystroke (bukan perintah). **Sisa:** foreground
Windows (tpgid tak tersedia sederhana) = TBD; keystroke agy + live-verify limit asli = **I-15**.

### I-5 — Jalur stale-socket unlink+retry POSIX belum teruji otomatis [P3] ✅ (7 Jul, `280f8d7`)
**RESOLVED:** jalur stale-unlink-retry POSIX (`ipc-server.listen`, G-14) kini **diverifikasi otomatis di Ubuntu
nyata** — `test/ipc-stale-socket.test.ts` (POSIX-only, `describe.skip` win32) mereproduksi socket **stale ASLI**:
spawn listener node → **SIGKILL** (file socket tertinggal, tak ada cleanup) → `connect` = **ECONNREFUSED** →
server pulih (unlink + retry bind → layani ping). Test kedua = kontras listener **HIDUP** → bind kedua reject
`EADDRINUSE`, socket tak diganggu (pembeda stale-vs-hidup benar di POSIX nyata, bukan cuma named pipe Windows).
**Tak ada perubahan kode produksi** — logic G-14 sudah benar, hanya verifikasi yang kurang. 231/231 hijau.

### I-12 — Actuation seams M3d: inject-continue & resume-by-id [P2] ✅ (6 Jul, `33e78b5`+`76df6ae`)
Rebuild M3d.3–7 menyelesaikan **keputusan** (probe→resume/backoff, gating, spec resume) tapi menunda
**actuation** (supervisor bukan pemilik proses PTY). Ketiga poin kini tertutup:
1. ✅ **inject-continue (alive) — `33e78b5`:** kanal IPC per-sesi (ADR-015, tanpa transport baru). Wrapper
   `acca run` host `createIpcServer({inject})` di `sessionControlSocketPath(id)`; daemon `requestInject`
   → wrapper gating lokal + `ptyProcess.write(CONTINUE_TOKEN)`. Injected → `markResumed`+RESUMED; gagal/
   unreachable → `inject_skipped`+done (surface, tanpa spin). **Injection firewall struktural:** token
   di-hardcode wrapper, perintah `inject` tanpa payload. Baru: `daemon/inject-continue.ts`,
   `sessionControlSocketPath`, `sessions.markResumed`, `checkInjectGating`+`hasPtyHandle`. Smoke live Win:
   pipe → `{injected:true}` → child PTY terima `continue\r`. Sisa gating foreground/idle → **I-13**.
2. ✅ **resume-by-id (exited) — `76df6ae`:** `spawnResumeFn` (injectable; default `runSession` in-process)
   spawn wrapper PTY baru di cwd asli (`resumeCmd`; which/G-12; sesi baru host socket kontrol →
   re-injectable). cwd hilang → BLOCKED (AC-8). Sukses → `markResumed` lama + event `resume_spawned`.
   Smoke live Win: sesi baru pid nyata di cwd benar, lama RESUMED. Layer/link → **I-14**; live-verify
   nyata → **I-15**.
3. ✅ **live-verify agy port-discovery (5 Jul, Ubuntu+Windows):** `discoverLocalPorts` menembak `agy` LS
   nyata → 2 port terkorelasi inode; GetUserStatus 200 per-model. G-22 terbukti live lintas-OS.

### I-6 — Adapter `setTimer` produksi wajib menangkap rejection `runDue` [P2] ✅ (M3d.2)
**Ditutup M3d.2:** `supervisor.ts` mengekspor `createDaemonTimer(onError)` = `(fn, ms) => setTimeout(() => { try
{ void Promise.resolve(fn()).catch(onError); } catch (e) { onError(e); } }, ms)` — membungkus **rejection async
MAUPUN throw sinkron** dari `runDue` → `onError` (append event `daemon_error`), cegah unhandledRejection
mematikan daemon. Di-inject sbg default `setTimer` scheduler saat supervisor membangunnya. Teruji
`test/supervisor.test.ts` (async-reject + sync-throw). Non-blocking saat ditulis (I-6/P2), kini tertutup nyata.

### I-3 — Rekonsiliasi tulis-balik sesi orphan (RUNNING basi) [P2] ✅
**Gejala:** wrapper mati keras (SIGKILL/terminal ditutup/crash) sebelum `markExited` → baris `sessions`
tetap `RUNNING/alive` selamanya. M1 hanya memitigasi di **tampilan** (`status` "(basi)", I-1), tanpa
tulis-balik.
**Solusi (M3a):** `daemon/reconcile.ts reconcileOrphans()` dijalankan **saat daemon start** (ADR-015:
daemon = penulis tunggal `sessions`). Scan `listActive()` → `proc_state='alive'` + PID mati (`isProcessAlive`
di-inject) → `sessions.markOrphanExited(id)` (RUNNING→EXITED; LIMIT_HIT/WAITING dipertahankan tapi
`proc_state→exited` supaya continue-engine pilih resume-by-id) + event `status_change`
`{reason:'orphan_reconciled'}`. Teruji `test/reconcile.test.ts` (4 kasus, API produksi asli).

### I-1 — `acca status` menampilkan sesi orphan sebagai `RUNNING` (menyesatkan) [P2] ✅
**Gejala:** setelah wrapper di-interrupt, `#pwy6 claude RUNNING alive pid 25584` bertahan padahal PID 25584
sudah mati (terverifikasi). `status` menampilkannya seolah sesi hidup.
**Solusi:** `status` kini cek liveness (`shared/proc.ts isProcessAlive` via `process.kill(pid,0)`); sesi
`proc_state='alive'` yang PID-nya mati ditandai `RUNNING (basi)` di tampilan. **Read-only** (tak menulis DB —
tulis-balik = I-3/M3). Ditemukan saat smoke interaktif M1 (3 Jul).

### I-2 — Wrapper tak kembali ke shell prompt setelah CLI target keluar [P2] ✅
**Gejala:** setelah `claude` keluar, `acca run` tak segera balik ke prompt terminal; user harus Ctrl-C.
Dugaan: handle ConPTY node-pty (Windows) menahan event-loop Node walau child sudah exit dan `markExited`
sudah jalan (sesi tetap tercatat `EXITED` — jalur benar, hanya proses wrapper menggantung).
**Solusi:** `cli/commands/run.ts` memanggil `process.exit(exitCode)` eksplisit setelah `closeDb` pada jalur
sukses (pola umum wrapper PTY), sehingga wrapper mengembalikan kontrol segera. Jalur spawn-gagal tetap lewat
`index.ts` catch → exit 1 (tak ada pty menggantung). Ditemukan saat smoke interaktif M1 (3 Jul).
