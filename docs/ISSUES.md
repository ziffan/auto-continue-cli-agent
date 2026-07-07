# ISSUES.md — issue terbuka & tertutup

> Prioritas: P0 (blocker) · P1 (penting) · P2 (mengganggu) · P3 (nanti). Ditutup = tulis solusinya.

---

## Terbuka

### I-15 — Live-verify actuation dgn kondisi ASLI belum dilakukan (opportunistik) [P2, target saat limit asli]
Kedua actuation seam LIVE-VERIFIED di Windows tapi dengan **proses proxy** (node-pty child echo / stub
`resumeCmd`), bukan CLI agent nyata di limit nyata: (a) apakah `claude`/`agy` hidup di prompt benar-benar
**menerima `continue\r`** lalu melanjutkan turn; (b) apakah `claude --resume <id>` / `agy --conversation <id>`
benar melanjutkan percakapan di sesi wrapper baru. Ini sekelas verifikasi yang genuinely butuh limit/sesi
asli (tak bisa dipaksa) — tangkap **opportunistik** saat limit 5-jam habis. Keystroke pasti agy = TBD
(ADR-014 catatan agy: kandidat "continue"/Enter). **Sumber:** smoke Sub-task 1&2 (6 Jul).

### I-8 — Monitor proaktif "mendekati limit" (proximity) dari usage-probe [P2, target M4/US-13]
Claude Code menampilkan warning ~90% (window 5-jam) & ~75% (mingguan) di terminal, tapi itu **UI-only,
tak di-persist** (G-15) → jangan scrape. Sinyalnya sudah tersedia via usage-probe: `usedFraction` (parser
M3c). Implementasikan proximity-monitor yang threshold `usedFraction` (default **0.90 five_hour**, **0.75
seven_day** — meniru default Claude Code sendiri; agy: `1-remainingFraction` per model) → emit notifikasi/
indikator "perkiraan sisa" dini. Basis fitur US-13 (prediksi proaktif, backlog) + indikator proximity di
`acca status` (M4). Wire saat Usage-Probe live + Notifier ada (M4).

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

### I-4 — `reset-estimator` clock-time wrap tak DST-aware saat lewat tengah malam [P3, target M3/M4]
`resolveClockTime` menambah `MS_PER_DAY` mentah untuk "next occurrence" alih-alih menghitung ulang wall-clock+1
hari di zona target → meleset ±1 jam di ~2 hari transisi DST/tahun (detail GOTCHAS G-13). Non-blocking: jalur
clock-scrape = fallback-of-fallback; sumber exact andal = ISO dari usage-probe. Perbaiki bila presisi reset
lintas-tengah-malam jadi penting (kemungkinan saat wiring reset ke scheduler M3 / tampilan M4).

---

## Tertutup

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
- **Residual (bukan blocker, dibuka sbg pertimbangan future):** konsolidasi **sole-writer** `scheduled_jobs`
  (daemon ambil-alih kepemilikan lifecycle sesi, bukan wrapper) = refactor arsitektur lebih besar — sengaja
  di luar scope slice ini. Bootstrap-exception MAP.md (wrapper tulis `sessions`+`scheduled_jobs`) tetap berlaku
  sampai konsolidasi itu. Lihat catatan MAP.md.

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
