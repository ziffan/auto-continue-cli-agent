# MILESTONES.md — auto-continue-cli-agent

> Milestone = **atomic vertical slice**, 2–5 hari kerja (≈1–2 minggu weekday atau 1 blok weekend).
> Kriteria selesai testable; integration test di akhir tiap milestone. Branch per milestone.

---

## M0 — Perencanaan (Doc-First) ← **fase sekarang**
**Selesai bila:** `docs/` suite terisi (PROJECT, RESEARCH, ARCHITECTURE, DECISIONS, NFR, MILESTONES, CONTEXT);
CLAUDE.md ≤200 baris + symlink AGENTS.md; repo + .gitignore.
**Status:** hampir selesai. **Stack di-lock 3 Jul (ADR-003/004 Accepted)**; **ADR-010 (probe hybrid) LOCKED 3 Jul
malam** (opsi #2 LS `GetUserStatus` interaktif ber-PTY terbukti — `quotaInfo` non-nil). Uji terminal 3 Jul: hook
`StopFailure` (TODO #7) **selesai**, probe agy item (d) **selesai**. **Semua ADR terkunci kecuali ADR-001.**
Sisa verifikasi (butuh **limit/quota asli**, non-blocking): fixture pesan limit lokal + varian agy TUI saat quota
habis (ADR-001, RESEARCH §6 TODO #2); residual probe agy #3/#1 = impl-tuning M3.

## M1 — Fondasi + Process Wrapper
**Slice:** `acca run -- <cli>` men-spawn CLI target via PTY, mencatat tool/session-id/cwd/pid ke SQLite,
dan menampilkan output apa adanya.
**Selesai bila:** bisa menjalankan Claude Code & Antigravity CLI di bawah wrapper; sesi tercatat di store;
`acca status` menampilkan sesi RUNNING (empty state bila kosong). Integration test: run → exit normal → status EXITED.

## M2 — Detector + Reset Estimator
**Slice:** kenali LIMIT_HIT — CC: hook `StopFailure` (primer) + pola output + exit code (print-mode) +
transcript; agy: pola output/exit — beserta kondisi proses (hidup|exit); isi reset_at (sinyal pasti →
heuristik → backoff, ditandai sumbernya).
**Selesai bila:** AC-1, AC-2 lulus dari fixture + hook event; false positive < 1/100 pada korpus uji;
overload (429/5xx/529) TIDAK terklasifikasi sebagai usage-limit.
**Dependensi:** fixture pesan limit + hasil uji hook (RESEARCH §6 TODO #2/#7).

## M3 — Scheduler + Usage Probe + Auto-continue
**Slice:** jadwalkan lanjut; pada reset_at → probe kuota → lanjut sesuai kondisi proses **(strategi ADR-014:**
inject "continue" ke PTY hidup dengan gating foreground+idle+alive [preferred], ATAU resume-by-id di cwd asli
saat `exited`; gating-gagal sesi hidup → surface manual, tak auto-kill); backoff bila kosong; state tahan restart
daemon. **Catatan agy:** jalur inject provisional — verifikasi perilaku TUI agy saat quota habis dulu (TODO #2).
**Selesai bila:** AC-3, AC-6, AC-7, AC-8 lulus. Integration test end-to-end: simulasi LIMIT_HIT → tunggu →
probe → resume di cwd benar (uji juga kasus cwd hilang → BLOCKED).

### M3 — pecahan slice (status)
M3 dieksekusi sebagai sub-slice. **M3a** (Daemon lifecycle + IPC ADR-015 + reconcile orphan) ✅ ·
**M3b** (Scheduler timer persisten + backoff + recovery) ✅ · **M3c** (Usage-Probe **parser** murni) ✅ —
ketiganya **engine murni**, tier-reviewed, merged `main`. Sisa = **M3d (wiring live + continue-engine)** di bawah.
**M3d = HARD-STOP OTONOM** (outward-facing: sentuh sesi live + jaringan + creds; butuh limit/quota asli;
keputusan user) → dirancang di sini, **dieksekusi dengan user hadir**, bukan otonom.
**Progres M3d (4 Jul):** **M3d.8 ✅** (`a1470b4`) · **M3d.1 ✅** (`8d0a8b1`) · **M3d.2 ✅** (`fc60cd8`, tutup I-6) —
Tier-1, smoke live e2e (LIMIT_HIT→reset_at→probe job).
**M3d.3–M3d.7 ✅ ENGINE (rebuild `3db7fa6`)** — percobaan Haiku di-revert (tag `haiku-m3d-attempt`, alasan: require-ESM,
Linux port-discovery salah, SpawnSpec tanpa cwd, inject-spin, 0 test); ditulis ulang testable (semua I/O di-inject),
**184/184 test**, Tier-1 review Opus. **I-11 CLOSED** (realDispatch).
**Update 5 Jul (live-verify Ubuntu 24.04):** (a) **gate native-prebuild Ubuntu LULUS** (node-pty compile-from-source +
better-sqlite3 prebuild → require+operasi OK; sisa M1 tertutup untuk Ubuntu); build+lint+**184→187/187 test hijau di
Linux** (sebelumnya hanya Windows). (b) **port-discovery agy live-verified** (G-22 terbukti pada proses `agy` LS nyata,
`discoverLocalPorts` → 2 port terkorelasi inode, 4× reproduksi) + GetUserStatus 200 → skema **direkonsiliasi ke respons
live** (I-7 CLOSED, G-23/G-24) + `parseAgyUserStatus` diperbaiki (label/`modelOrAlias.model` + G-17 exhausted usedFraction=1).
**Update 6 Jul (actuation seams TERTUTUP — Windows):** **M3d.7/I-12 poin 1 ✅ (`33e78b5`)** inject-continue via
kanal IPC per-sesi (wrapper host `createIpcServer({inject})` ↔ daemon `requestInject`; token literal hardcoded =
injection firewall struktural; smoke live: child PTY terima `continue\r`) · **M3d.6/I-12 poin 2 ✅ (`76df6ae`)**
resume-by-id spawn wrapper PTY baru di cwd asli via `runSession` in-process (AC-8: cwd hilang→BLOCKED; smoke live:
sesi baru pid nyata + lama RESUMED). **209/209 test, Tier-1 self-review.**
**Update 7 Jul (Ubuntu — gating + verifikasi):** **I-13 ✅ (`7dffcbe`)** gating foreground/idle DITEGAKKAN
(ADR-014 poin ii&iii): `shared/foreground.ts` (`/proc` tpgid==pgrp, live-verified Ubuntu, G-28) + `shared/idle-tracker.ts`
(jendela-sunyi `esc to interrupt`, G-29) di-wire ke `createInjectHandler`; inject tak lagi lolos saat drop-ke-shell /
(Claude) mid-turn. **I-5 ✅ (`280f8d7`)** stale-socket POSIX (G-14) diverifikasi otomatis di Ubuntu (`test/ipc-stale-socket.test.ts`,
POSIX-only). **231/231 test, build+lint bersih, Tier-1 self-review.**
**Update 7 Jul (Windows — utang struktural ditutup):** **I-14 ✅ (`c4cf164`)** relokasi `runSession`
`cli/run-core.ts`→`daemon/process-wrapper.ts` (menutup layer-inversion G-27; cli/ & daemon/ sama-sama import dari
daemon/) + resume-chain link (migrasi `0002` kolom `sessions.resumed_from` FK, `schema_version`=2; `acca status`
render `#new<-#old`; live smoke upgrade v1→v2 pada DB ber-isi + FK enforced, G-30). **I-10 ✅ (`4255c99`)** daemon
hidup re-arm job lintas-proses via IPC `rearm` (`scheduler.rearm()` baca store segar + perintah tanpa payload +
`notifyDaemonRearm` best-effort; live smoke DUA PROSES: daemon nyata idle → proses terpisah tulis job+rearm →
dispatch tanpa restart). **235/235 test, build+lint bersih, Tier-1 self-review.**
**Update 7 Jul (Windows — I-16 hardening probe agy, dari cek CodexBar):** **I-16 ✅** probe agy pindah dari
`GetUserStatus` (buta window MINGGUAN) ke **`RetrieveUserQuotaSummary`** (weekly+5h per grup, G-31). Parser baru
`parseAgyQuotaSummary` (bucket→UsageLimit, `kind`=weekly/5h, absent→exhausted G-17, PII firewall tak sentuh displayName).
Dispatch `every(usedFraction<1)` kini benar mencakup weekly (dulu bisa keliru resume saat weekly habis). **244/244 test,
live PRODUCTION probe balas 4 limit weekly+5h dari agy nyata.** `parseAgyUserStatus` dipertahankan (credits/proximity M4).
**Sisa M3 (follow-up, bukan blocker loop):** live-verify actuation dgn limit ASLI opportunistik (**I-15**: keystroke agy
+ foreground Windows); residual I-10 = konsolidasi sole-writer `scheduled_jobs` (daemon ambil-alih lifecycle sesi, refactor lebih besar).

> Batas scope-file M3d: banyak slice menyentuh `daemon/supervisor.ts` sebagai titik integrasi → slice
> ber-supervisor **diserialkan** (bukan paralel). Slice adapter-probe (M3d.3/M3d.4) & fixture (M3d.8) =
> file terpisah → boleh paralel. Semua slice M3d **Tier 1** (state-machine / egress / creds / inject PTY).

### M3d.1 — Wire Detector ke sesi live (deteksi LIMIT_HIT nyata) ✅ (`8d0a8b1`)
**Slice**: supervisor memasang Detector (`classify()`) ke stream output PTY sesi hidup (+ hook `StopFailure` utk CC);
sinyal limit → status `LIMIT_HIT` + `proc_state` + event `status_change`, tanpa aksi diturunkan dari *isi* output.
**Scope file**: `daemon/supervisor.ts`, `daemon/process-wrapper.ts` (baru/atau `cli/run-core.ts` wiring), `store/repositories/sessions.ts`. Pakai `daemon/detector.ts` apa adanya.
**Di luar scope**: `adapters/*`, `scheduler.ts`, `continue.ts`.
**Kriteria selesai**: sesi live + sinyal limit fixture (di-feed ke stream / hook) → baris `sessions` transisi `LIMIT_HIT` + event tercatat; overload (429/5xx) TIDAK memicu (overload firewall). Empty/tak-ada-sinyal = tetap RUNNING.
**Bukti**: test hijau (paste) transisi state + non-trigger overload; log run.
**Tier review**: **1** (state machine + jalur deteksi security-sensitive; injection firewall).

### M3d.2 — Enqueue reset+probe saat LIMIT_HIT (estimator → scheduler) ✅ (`fc60cd8`)
**Slice**: transisi `LIMIT_HIT` → hitung `reset_at` (`reset-estimator`, tandai sumber) → enqueue `scheduled_jobs` kind=`probe` (scheduler); recovery timer saat restart daemon.
**Scope file**: `daemon/supervisor.ts`, `store/repositories/scheduled-jobs.ts` (pakai), `daemon/scheduler.ts` (pakai), `reset-estimator.ts` (pakai).
**Di luar scope**: adapter probe live, continue.
**Kriteria selesai (AC-7)**: LIMIT_HIT → row `scheduled_jobs.run_at` benar + `reset_source`; restart daemon → job pending re-armed (uji dgn fake timer + persistence asli). Tutup **I-6** (adapter `setTimer` produksi bungkus rejection).
**Bukti**: test hijau recovery-dari-persistence + estimator precedence.
**Tier review**: **1** (persistensi timer/state).

### M3d.3 — Live probe Claude Code (`api/oauth/usage` HTTP, egress whitelist)
**Slice**: `adapters/claude.ts probeUsage()` baca `~/.claude/.credentials.json` (Bearer + `anthropic-beta`) → GET `api/oauth/usage` → `parseClaudeOAuthUsage` → `UsageSnapshot`. Egress **hanya** `api.anthropic.com` (guard).
**Scope file**: `adapters/claude.ts`, `shared/` http+egress-guard kecil (baru), `adapters/usage.ts` (pakai).
**Di luar scope**: `antigravity.ts`, supervisor, continue.
**Kriteria selesai**: HTTP nyata → `usedFraction`/`resetAt` (dua format `resets_at` G-4 tertangani); creds **hanya dibaca** (tak di-log/disalin); egress non-whitelist ditolak (test guard). Error/401/timeout → `UsageProbeError`, bukan crash.
**Bukti**: log run probe nyata (angka, **tanpa** token/PII) + test egress-guard + test parser.
**Tier review**: **1** (egress jaringan + baca creds).

### M3d.4 — Live probe Antigravity (LS `GetUserStatus`, port sesi hidup)
**Slice**: `adapters/antigravity.ts probeUsage()` temukan port LS dari PID sesi hidup **lintas-OS** (Win `Get-NetTCPConnection`; Linux `/proc`/`ss`) → `POST GetUserStatus` (Connect-JSON, tanpa csrf) → `parseAgyUserStatus`. Redaksi PII (G-9).
**Scope file**: `adapters/antigravity.ts`, `shared/` port-discovery lintas-OS (baru), `adapters/usage.ts` (pakai).
**Di luar scope**: `claude.ts`, supervisor, continue.
**Kriteria selesai**: sesi agy live ber-PTY → `quotaInfo` per-model (I-7 skema dikonfirmasi dari respons asli). **Tangani `remainingFraction` ABSENT = exhausted** (G-17, jangan crash `undefined`). **Catat caveat F1** (fraksi cached-at-init → snapshot, bukan real-time) + **`useG1Credits` credit-fallthrough** (G-16: limit agy soft bila credit aktif → probe wajib cek exhaustion=absent DAN credit) di komentar/docs. PII tak bocor ke log/events. Print-mode `-p` **tak** untuk deteksi limit (stdout kosong, G-18).
**Bukti**: log run (angka per-model, tanpa PII) + test parser + test redaksi.
**Tier review**: **1** (jaringan + PII + creds).
> **Live-verified 5 Jul (Ubuntu):** port-discovery inode-correlation ✅ pada `agy` LS nyata; GetUserStatus 200 → skema
> dikonfirmasi (I-7 CLOSED); parser + fixture direkonsiliasi ke respons live. Redaksi PII (G-9) tertutup di parser.
> **✅ WIRING DONE + live-verified Windows 5 Jul:** `probeAgyUsage` (`adapters/antigravity.ts`, standalone injectable) =
> `discoverLocalPorts` → **`https`(rejectUnauthorized:false)** ke tiap port via `loopbackHttpsPostJson` (`shared/http.ts`,
> `node:https`, insecure-TLS dibatasi ketat ke loopback — G-25) → **retry ~tiap 2s cap 15s sampai HTTP 200 ber-`userStatus`**
> (G-23) → `parseAgyUserStatus`. PII/injection firewall: body respons tak pernah masuk pesan error. **Live Windows:**
> `Get-NetTCPConnection` port-discovery ✅ (3× fresh spawn, port cocok log agy) + `probeAgyUsage` balas **8 model nyata**
> (usedFraction/resetTime per-model, reset window beda per-model) dalam ~1s, tanpa PII/token. Tests: `test/agy-probe.test.ts`
> (7, retry-loop + wrong-port skip + PII-not-leaked) + `test/http-egress.test.ts` (+loopback https guard). **199/199 hijau**,
> build+lint bersih, Tier-1 self-review lolos. **Sisa non-blocking:** wiring `probeUsage` ke dispatch resume (M3d.5 sudah
> ada `realDispatch`) sudah nyambung via `adapter.probeUsage`; retrieveUserQuota standalone (#3) tetap impl-tuning.

### M3d.5 — Gate probe→resume/backoff saat reset (scheduler dispatch)
**Slice**: job `probe` jatuh tempo → `probeUsage()`; kuota tersedia → enqueue job `resume`; kosong → backoff reschedule (scheduler) + notif "perkiraan". Tak spam-resume.
**Scope file**: `daemon/supervisor.ts` (dispatch scheduler→probe→keputusan), `scheduler.ts` (pakai).
**Di luar scope**: adapter internals (M3d.3/4), continue internals (M3d.6/7).
**Kriteria selesai (AC-6)**: probe kosong → backoff berjenjang + jadwal ulang (tak resume); probe berisi → enqueue resume sekali. Uji fake-timer.
**Bukti**: test hijau kedua cabang.
**Tier review**: **1** (keputusan aksi-auto + state machine).

### M3d.6 — Continue-engine: resume-by-id (proc `exited`) di cwd asli (ADR-014 §3-4) ✅ (`76df6ae`, 6 Jul)
> **DONE:** `supervisor.realDispatch` cabang `exited` → `spawnResumeFn` (injectable; default `runSession` in-process,
> BUKAN `daemon/continue.ts` — actuation cukup di dispatch + engine wrapper yang sudah ada). Spawn wrapper PTY baru di
> `spec.cwd` (=cwd asli, AC-8) via `resumeCmd`; cwd hilang → BLOCKED sebelum spawn. Sukses → `markResumed` sesi lama +
> event `resume_spawned {newSessionId,spec}`. Sesi hasil resume host socket kontrol → re-injectable. Uji: dispatch
> test (cwd asli + BLOCKED no-spawn) + smoke live Win (sesi baru pid nyata di cwd benar, lama RESUMED). Live-verify
> `claude --resume` dgn sesi asli = opportunistik (I-15). Relokasi runSession→process-wrapper + link old→new = I-14.
**Slice**: sesi `exited` + kuota ok → jalankan resume di **cwd asli** (`claude --resume <id>` / `agy --conversation <id>`) via PTY; **cwd hilang → `BLOCKED`** (jangan resume di tempat salah).
**Scope file**: `daemon/continue.ts` (baru), `adapters/{claude,antigravity}.ts resumeCmd()` (pakai), `daemon/supervisor.ts` (panggil).
**Di luar scope**: jalur inject-PTY (M3d.7).
**Kriteria selesai (AC-3, AC-8)**: exited → resume spawn di cwd benar → status `RESUMED`; cwd hilang/berubah → `BLOCKED` + notif, **tak** resume.
**Bukti**: integration test (cwd benar + cwd hilang→BLOCKED); log run.
**Tier review**: **1** (spawn proses + korektness cwd = AC-8).

### M3d.7 — Continue-engine: inject "continue" ke PTY hidup + gating (ADR-014 §1-2, preferred) ✅ SEAM (`33e78b5`, 6 Jul)
> **DONE (kanal IPC + actuation):** wrapper `acca run` (pemilik PTY) host `createIpcServer({inject})` di socket kontrol
> per-sesi (`sessionControlSocketPath`, ADR-015 — tanpa transport baru); daemon `requestInject` → wrapper gating
> lokal (`checkInjectGating`+`hasPtyHandle`) + `ptyProcess.write(CONTINUE_TOKEN='continue\r')`. Injected → `markResumed`
> (RESUMED, proc alive) + event; gagal/unreachable → `inject_skipped` + done (surface, TANPA spin). **Injection firewall
> STRUKTURAL:** token hardcoded wrapper, perintah `inject` tanpa payload (G-26). Uji: `inject-continue.test.ts` (8, incl
> firewall-ignores-args) + dispatch (injected/unreachable) + smoke live Win (child PTY terima `continue\r`).
> **I-13 ✅ (7 Jul, `7dffcbe`):** komputasi gating `foregroundIsAgent` (`/proc` tpgid==pgrp, Linux; Windows TBD) +
> `idle` (jendela-sunyi `esc to interrupt`) kini ADA & di-wire → inject diblokir saat drop-ke-shell / (Claude) mid-turn.
> Keystroke agy + foreground Windows + live-verify limit asli = I-15.
**Slice**: sesi `alive` + **gating LULUS** (proc alive = child kita · foreground = agent bukan shell · sesi idle bukan mid-turn · probe kuota ok) → inject **literal tetap** `"continue"\n` ke PTY. **Gating GAGAL → surface manual, TAK auto-kill.** Token **tak pernah** dari isi output (injection firewall).
**Scope file**: `daemon/continue.ts`, `shared/proc.ts` (foreground/idle detection lintas-OS — reuse spike burn2 sesi ini: idle marker footer, foreground=agent), `daemon/supervisor.ts` (panggil).
**Di luar scope**: resume-by-id (M3d.6), remote.
**Kriteria selesai**: alive+idle+foreground=agent → inject "continue" → lanjut; drop-to-shell ATAU mid-turn ATAU proc≠child → **tak inject**, di-surface; token = literal (uji tak ada aksi dari output).
**Bukti**: test gating tiap cabang (lulus + 3 gagal) + test literal-only.
**Tier review**: **1** (inject PTY = paling security-sensitive; injection firewall + literal token).

### M3d.8 — Fixture limit agy ASLI ke korpus detektor (observasi 4 Jul SUDAH ada → tinggal encode) ✅ (`a1470b4`)
**Slice**: observasi limit agy ASLI **sudah tertangkap 4 Jul** (`agy-REAL-limit-message.txt`: `⚠ Individual quota
reached. Please upgrade your subscription to increase your limits. Resets in <Xm Ys>.` + Error ID; agy **tetap hidup**;
`remainingFraction` absent). Tinggal: encode fixture pesan ke korpus detektor agy (ganti 4 fixture provisional) + fixture
respons LS exhausted (field absent); set jalur continue agy = **alive/inject** (ADR-014 sudah dianotasi verified). Detector agy corpus provisional→verified.
**Scope file**: `adapters/patterns.ts` (korpus agy), `test/fixtures/agy-limit*`, `test/detector.test.ts`.
**Di luar scope**: supervisor, adapter probe.
**Kriteria selesai**: detector klasifikasi fixture limit agy ASLI benar; ADR-001 (bagian agy) bisa naik **Accepted**; ADR-014 catatan agy diperbarui dari observasi.
**Bukti**: test hijau fixture agy asli; ADR/GOTCHAS diperbarui.
**Tier review**: **1** (korektness deteksi).

> **Urutan eksekusi M3d:** M3d.1→M3d.2→M3d.5 (rantai supervisor, serial) ; M3d.3 ∥ M3d.4 ∥ M3d.8 (file terpisah) ;
> M3d.6→M3d.7 (continue, serial, setelah probe siap). M3d.8 memanfaatkan eksperimen sesi ini → bisa duluan.
> Semua Tier-1 → tier-review Opus wajib. Fixture/observasi live = sumber kebenaran, bukan asumsi.

## M4 — Notifikasi + Monitor UX (inti ✅ 11 Jul; **AC-4 ✅ lengkap 12 Jul — I-24 ditutup**)
**Slice:** notifikasi desktop/CLI pada transisi LIMIT_HIT/RESUMED/FAILED; `acca status` lengkap
(usage best-effort + indikator "perkiraan" + loading/empty/error state); `acca log`.
**Selesai bila:** AC-4 ✅ (usage-view + `acca log` ✅; **reset_at terjadwal + liveness daemon di `acca status` ✅ per
I-24, 12 Jul** — kolom `reset` HH:MM+sumber + baris `daemon: HIDUP/MATI`; overclaim 11 Jul dikoreksi lalu benar-benar
ditutup), AC-5 ✅ lulus; UX states eksplisit teruji ✅. (Sisa opsional: Notifier desktop = gate dep.)

**Progres (10 Jul, Ubuntu):**
- **✅ Notifier core (`src/notify/notifier.ts`):** pemetaan MURNI `notificationForEvent(event)→Notification|null`
  untuk transisi layak-surface (LIMIT_HIT · RESUMED [inject `status_change` + resume-by-id `job_dispatch_done
  resume_spawned`] · FAILED · BLOCKED [`job_dispatch_error status=BLOCKED`]); dipasang sbg **dekorator** atas
  `EventsRepo` (`withNotifications`) → surface otomatis tanpa sentuh call-site. Sink default = stderr (out-of-band);
  desktop node-notifier = opt-in menyusul (gate dep). **Firewall PII (G-9):** body hanya field terkontrol,
  `evidence`/probe/`spec.args` tak di-echo; `deliver` throw di-swallow (tak putus lifecycle). Wired: `cli/commands/run.ts`
  + `daemon/supervisor.ts` (+dep `notify`). Tier-1 self-review. **270/270 test** (+26), build+lint bersih,
  **live smoke PTY** (frasa limit CC asli → `[acca warn] …` stderr, evidence tak bocor).
- **✅ Proximity ENGINE (I-8):** `proximityNotifications(snapshot, thresholds)` murni (0.90 5h / 0.75 weekly,
  exhausted dilewati). **Wiring → I-17 (DONE 11 Jul).**
- **✅ I-17 usage-monitor + wiring (11 Jul, autonomous-run):** engine `daemon/usage-monitor.ts` (Sonnet, murni-
  injectable: dedup per-tool, isolasi, re-entry guard, firewall) + wiring supervisor (Opus, Tier-1): probe periodik
  **~2 mnt** (owner Ziffan) saat RUNNING → `meta` cache snapshot (`usage_snapshot_<tool>`, **tanpa migrasi**) +
  proximity→notify. Opt-in `startUsageMonitor` (produksi `acca daemon`; G-32). **290/290 test** (+11). Live-verify
  sesi asli = opportunistik (I-15). **→ Ini sumber data `acca status` usage-view (AC-4).**
- **✅ `acca log` (US-8) — 11 Jul (autonomous-run, Windows):** perintah read-only `acca log [sessionId] [-n <limit>]`
  → `events.listRecent`/`listBySession` (repo +2 method baca) → `formatEventLine` (PURE, exported). **Firewall (G-9,
  ADR-013):** summary HANYA dari **allowlist** field terkontrol (`to/from/source/reason/action/status/kind/jobId/
  newSessionId/run_at/attempts/exitCode/where/reachable`) — `evidence`/`spec`/kunci tak dikenal TAK PERNAH di-dump;
  parse payload defensif. Dekorator `withNotifications` di-`{...events}` (teruskan method baca; menutup fragilitas
  "method hilang"). Subagent Sonnet + tier-review Opus (firewall + type-soundness). **279/279 test** (+9), build+lint
  bersih. Merender ke stdout lokal (bukan egress).
- **✅ `acca status` usage-view (AC-4) — 11 Jul (autonomous-run, Sonnet+Opus):** plain ANSI (TUI decision), baca cache
  `meta.usage_snapshot_<tool>` → helper pure `renderUsageBar` (`▓▓░` clamp) + `formatUsageLines` (header umur snapshot +
  baris per limit kind/bar/pct; empty-state "usage belum ada—jalankan acca daemon" + "tak terbaca" defensif). **Firewall
  G-9:** hanya tool/kind/bar/pct — `scope` (display-name model) tak dirender (diuji + **smoke render live: 'SECRET' 0×**).
  Blok sesi lama utuh. **305/305 test** (+15). **Smoke render nyata:** bar 37%/36%/92% (CC) + 74%/10% (agy) tampil benar.
- **Sisa M4:** Notifier desktop (node-notifier) — **butuh gate DEPENDENCY-POLICY (dep baru = keputusan user)**.
  **AC-4 ✅ · AC-5 ✅** (notif transisi engine + surface). M4 inti selesai; desktop-notifier = opsional di belakang gate dep.

## M3e — Koreksi loop auto-continue (dari audit 11 Jul) ← **fase sekarang**
**Kenapa ada:** audit menyeluruh 11 Jul (`docs/audit/AUDIT-2026-07-11.md`) menemukan **4 P1 di jalur resume/continue**
yang lolos 308 test (test men-stub seam yang justru cacat). Klaim "loop auto-continue penuh selesai & bertes" =
**overstated** — yang live cuma inject ke proses proxy + spawn wrapper baru, bukan resume percakapan CLI nyata.
**M-remote DITUNDA** sampai gate keluar hijau (tier B `resume-now` akan expose jalur resume yang rusak; I-15 pasti
gagal di A-1).
**Slice (= rencana remedi audit R1–R8):**
- **R1 — daemon-no-crash (I-20/A-2) ✅ (`9027dc4`):** default `spawnResumeFn` konsumsi `waitForExit` (tak ada
  unhandledRejection yang mematikan daemon) + tak keliru markResumed saat spawn gagal. Test menjalankan DEFAULT path
  (bukan stub). **310 test hijau, Tier-1 self-review.**
- **R2a — cli_session_id di dispatch (I-20/A-1 paruh) ✅ (`df3904b`):** resume pakai `session.cli_session_id`; absen →
  BLOCKED (surface), bukan spawn id supervisor yang dijamin ditolak CLI. `setCliSessionId` repo siap. Test bug-encoding
  dikoreksi + test NULL→BLOCKED. **Tier-1 self-review.**
- **R2b — capture cli_session_id (I-20, belum):** tangkap id CLI nyata (CC transcript/`SessionStart` hook; agy printed
  cmd). **Butuh live-verify** (audit §6). Gabung ke slice hook (R6/I-23). Sampai ada → resume-by-id exited = BLOCKED.
- **R3 — resume-cycle (I-21/A-3, belum):** transisi RESUMED→RUNNING + un-latch watcher + monitor mencakup sesi hidup +
  test siklus 2×.
- **R4 — agy-exited-policy (I-22/A-4): ✅ RESOLVED via ADR-019 (12 Jul, pivot dari ADR-018).** Live-verify slice 2
  (otorisasi user) buktikan probe standalone OAuth `retrieveUserQuota` baca **pool kuota SALAH** (gemini-cli harian ≠ grup
  agy weekly+5h; Summary via OAuth=403, G-38) → ADR-018 opsi #3 GUGUR → **ADR-018 di-supersede ADR-019 = optimistic resume
  + detect** (agy-exited: skip probe, enqueue resume langsung di reset_at; sesi hasil-resume alive → deteksi ulang via LS
  bila masih limit; bounded B-1). Guard slice-1 (`probe_impossible`) DIGANTI. `oauth2`/`cloudcode-pa` dihapus dari egress
  (least-privilege). **369 test** hijau, Tier-1 self-review. R5 status-completeness (I-24) ✅.
- **R6 — stopfailure-hook + sessionstart-capture (I-23) ✅ (12 Jul, LIVE-VERIFIED CC 2.1.207):** wrapper generate
  settings.json terisolasi → `claude --settings <file>` memasang hook **StopFailure** (deteksi limit CC PRIMER,
  ADR-001/§7) + **SessionStart** (capture `cli_session_id` → **tutup paruh CC I-20/R2b**). Forwarder internal
  `acca __hook <id>` (exec-form, best-effort) → socket kontrol per-sesi → `feedSignal`/`setCliSessionId`; injection
  firewall (kanal DATA vs AKSI, `daemon/hook-relay.ts`). **368 test** (+9); live production `acca run claude` →
  `cli_session_id` terpersist dari SessionStart nyata. Sisa opportunistik: `rate_limit` StopFailure end-to-end asli.
  R7 resume-gate-per-tool (I-25). R8 housekeeping (I-27/I-28) ✅.
**Gate keluar (sebelum M-remote):** R1–R3 ✅ + **R4 ✅ PENUH (ADR-019 optimistic resume, 12 Jul)** + R6 (I-23, deteksi
limit CC primer + capture id CC) ✅ + I-15 live-verify **lulus dgn CLI nyata** (limit asli, resume nyata melanjutkan
percakapan — **sisa terbesar & satu-satunya gate tersisa**). M5 aman setelah R1 (crash) tertutup — sudah ✅.

## M-remote — Remote-control Telegram (tier A+B+C)
**Slice (bertahap per tier, satu kanal Telegram — ADR-011):**
- **Tier A (egress-only):** Notifier kirim notif transisi (LIMIT_HIT/RESUMED/FAILED) ke `chat_id`
  terotorisasi via long-polling bot (outbound-only ke `api.telegram.org`). (US-14)
- **Tier B (kontrol masuk):** command listener + Authz allowlist `chat_id` default-deny; perintah
  whitelist `status`/`resume-now <id>`/`cancel <id>`; sender tak sah di-drop+audit; rate-limit. (US-15)
- **Tier C (egress sensitif + relay ber-konfirmasi):** lihat output (redaksi rahasia + size-cap +
  opt-in per sesi) + kirim instruksi lewat Confirm gate (queue→echo→`/confirm <token>`→inject PTY);
  injection firewall (isi output = data, tak jadi aksi). (US-16, US-17)
**Selesai bila:** **AC-9..AC-12 lulus** + **security-review gate** (skill `milestone-wrapup`) terhadap
keempatnya. Uji khusus: test injection (payload di output tak memicu aksi), test redaksi (pola rahasia
ter-redaksi), test authz (sender tak sah ditolak+audit), test konfirmasi (tanpa `/confirm` tak ada inject).
**Dependensi (gate ADR-013 §5):** **THREAT-MODEL.md** (✅ ada) di-review; **pola redaksi rahasia** (✅ hybrid
regex+entropy, ADR-013 §2) & **lib Telegram bot Node** (✅ `grammy` 1.44.0, ADR-011) diputuskan & **ADR-011/012/013
di-LOCK** (3 Jul malam); butuh Notifier (M4). Sisa yang di-tune saat M-remote: regex/threshold redaksi eksak + test corpus.
**Catatan:** ini milestone paling sensitif — tak dimulai sebelum tier prasyaratnya hijau dan gate terpenuhi.

## M-web — Web UI monitor read-only (ADR-028, US-10)

> **PRD+TRD di-lock 2026-07-18** (doc-first, skill `docs-first-spec` mode modul). ADR pengikat: **ADR-028**
> (read-only localhost) di atas ADR-008/013 (read-only ⇒ nol aksi) + ADR-023/T-L1 (data-minimize). Gate
> keamanan: **THREAT-MODEL §9** (T-W1..W6 + R-7).
>
> **STATUS: ✅ DITUTUP FORMAL 2026-07-19** (security-review gate M-web LULUS PENUH). M-web.1 diimplementasi +
> verified (18 Jul, `77763a6`); **gate T-W1..T-W6 dijalankan 19 Jul** (skill `milestone-wrapup`, persona
> security-review) — **semua CONFIRMED, nol gap**: T-W1 proyeksi ter-firewall (code + negative-control test:
> JSON kabel tak memuat `cli_session_id`/`cwd`/secret; caller `web.ts:44` proyeksikan via `toSessionStatusView`),
> T-W2 GET-only 405, T-W3 Host-guard 403 (IPv6-aware, tolak subdomain-attack), T-W4 self-contained (grep nol
> aset eksternal), T-W5 `textContent` anti-XSS, T-W6 port validasi + bind-fail exit + proses terisolasi dari
> daemon; R-7 (loopback terjangkau proses lokal) DITERIMA (single-user desktop). **M-web.2 (`daemon --web`)
> tetap opsional (W-2), tak menghalangi penutupan.**

**PRD — apa & untuk siapa:** solo orchestrator ingin memantau usage/sesi/log acca di browser lokal tanpa
terminal (US-10). Read-only murni; nol aksi kontrol (owner 18 Jul).

**TRD — kontrak teknis (ADR-028):** `acca web [--port]` (opt-in, default `4599`, env `ACCA_WEB_PORT`) →
`http.createServer` bind **`127.0.0.1` saja**. `GET /` = HTML self-contained (CSS+JS inline, poll ~5s,
render `textContent`). `GET /api/status` = JSON dari **proyeksi ter-firewall yang SUDAH ADA**
(`toSessionStatusView` + `formatEventLine`/allowlist + data `formatUsageLines`). `Host` non-loopback → **403**;
method non-GET → **405**. Nol dep/framework; nol mutasi; nol aset eksternal.

**Vertical slices:**
- **M-web.1 — Monitor read-only end-to-end** ✅ (`77763a6`, 18 Jul) **[SANDBOX-testable]**: `web/status-json.ts` (PURE — rakit
  payload dari proyeksi ter-firewall) + `web/server.ts` (bind 127.0.0.1, routing GET /(page) + /api/status,
  Host-guard 403, method-guard 405) + `web/page.ts` (HTML self-contained, fetch `/api/status` poll, render
  textContent) + command `acca web`. **Selesai bila:** server hidup di port efemeral, `fetch('/api/status')`
  → JSON **tanpa** `cli_session_id`/`cwd`/secret (test properti); `Host: evil.com` → 403; `POST /` → 405;
  bind non-loopback DILARANG (assert host literal `127.0.0.1`); grep `page.ts` = nol URL eksternal.
- **M-web.2 — `acca daemon --web` co-host** **[SANDBOX]** *(opsional, nilai kemudahan)*: mount server yang
  sama di daemon (flag `--web`, port sama). **Selesai bila:** daemon dgn `--web` melayani `/api/status`;
  tanpa flag = tak ada listener (default-off).

**Selesai (milestone) bila:** **AC-W1..W4 lulus** + **security-review gate** (skill `milestone-wrapup`,
persona security-review) terhadap **T-W1..T-W6** (THREAT-MODEL §9.3): proyeksi ter-firewall terverifikasi
(nol `cli_session_id`/`cwd` di JSON kabel), Host-guard 403, method-guard 405, bind loopback-saja, HTML
nol-aset-eksternal. Uji khusus: test data-minimize (JSON kabel), test Host-guard (DNS-rebinding), test
method-guard, test self-contained (grep aset eksternal).

## M5 — Hardening + Deploy sebagai service

> **STATUS: ✅ DITUTUP PARSIAL 2026-07-17 (Linux track lengkap & LIVE-verified; Windows ditunda).** Slice: **M5.1/M5.2
> backup ✅** (engine SANDBOX + **restore LIVE-verified M5.6** — `tl6x` ter-revert = bukti restore genuine) · **M5.3
> security pass ✅** (T-L1/2/4/5/8 tutup, T-L7 Linux tutup via M5.4, **T-L6 tutup via M5.6 restore LIVE**) · **M5.4 systemd
> `--user` ✅ LIVE** (AC-M5-1 penuh + AC-M5-3 Linux) · **M5.5 Windows ✅ DITUTUP PENUH (ADR-026, LIVE 18 Jul)** — autostart
> per-user (Task Scheduler @logon) menyelesaikan I-33 by construction; **AC-M5-2 hijau LIVE** (daemon=user + same-DB + creds +
> @logon-fire + watchdog ~65s + nol-jendela via `conhost --headless`) · **M5.6 wrap-up ✅**. **Suite hijau di M5-close. M5 TUTUP PENUH
> (Linux + Windows).** (Jumlah test bergantung-mesin; angka-of-record di CLAUDE.md §2 — RD-5.) **Gate security-review ke M-remote BERSIH** (semua T-L lokal tutup; T-L3 N/A). Paruh Windows AC-M5-3
> (reboot→login saat job pending) = **kelas I-15** (butuh limit asli utk stage job resume; recovery-on-start sudah terbukti Linux).

> **PRD+TRD di-lock 2026-07-17** (doc-first, skill `docs-first-spec` mode modul). ADR pengikat: **ADR-021**
> (Windows Service), **ADR-022** (backup/DR minimal), **ADR-023** (IPC DACL residual + hardening I-26), di atas
> ADR-007/015/017 yang sudah ada. Slice formal (vertical) ada di sub-bagian "Vertical slices M5" bawah.

### PRD — apa & untuk siapa
**Tujuan M5:** jadikan daemon dari "jalan saat user buka terminal" menjadi **layanan OS selalu-nyala** yang survive
reboot + auto-restart on-crash, lalu **audit keamanan fondasi** sebelum M-remote memperluas permukaan, plus **jalur
backup/restore** state. Ini yang membuat JTBD inti (auto-resume tengah-malam saat user jauh/tidur) **benar-benar
terjamin** — bukan bergantung terminal terbuka.
**Untuk:** Solo Orchestrator (PROJECT §2) di host always-on (laptop Ubuntu daily, PC Windows weekend, node headless 24/7).
**Batasan M5 (DILARANG scope-creep):** BUKAN dashboard web (US-10, Later); BUKAN multi-user (US-12); BUKAN fitur `acca
backup` in-daemon (skrip+doc cukup MVP, ADR-022); BUKAN native addon DACL (ADR-023 tolak). Install = **template + skrip
manual**, DILARANG menambah dependency npm runtime baru (ADR-021).

### TRD — bagaimana (kontrak teknis)

**A. Service lifecycle lintas-OS (ADR-007 + ADR-021).**
- **Linux — systemd `--user` service + lingering.** HARUS: sediakan template unit `acca-daemon.service` (`ExecStart`
  = `node <path>/dist/cli/index.js daemon`, `Restart=on-failure`, `RestartSec`) + skrip install yang `systemctl --user
  enable --now acca-daemon` **dan** `loginctl enable-linger $USER` (WAJIB — tanpa linger, service mati saat user logout;
  verified 17 Jul via ArchWiki/systemd docs). Daemon runtime DILARANG butuh root.
- **Windows — Windows Service (ADR-021, bukan Task Scheduler).** HARUS: template config **WinSW XML** (primary) yang
  membungkus `node <path>\dist\cli\index.js daemon` dengan **auto-restart on failure** + log redirect; dokumentasikan
  jalur **`sc.exe`** (built-in) sebagai fallback nol-tool. Install butuh admin **sekali** (registrasi); daemon runtime
  least-privilege. DILARANG dep npm runtime baru; WinSW = binary vendored terpisah (pin versi+hash, gate DEPENDENCY-POLICY).
- **Recovery state lintas-restart** (sudah ada, AC-7): service yang restart HARUS memanggil `supervisor.start()` yang
  recover `scheduled_jobs` pending → job LIMIT_HIT yang jatuh tempo saat daemon mati tetap dijalankan. Slice service
  HARUS memverifikasi ini end-to-end (bukan asumsi): reboot host saat ada job pending → job tetap fire pasca-boot.

**B. Security pass menyeluruh-terfokus (persona security-review, skill `tier-review` tier 4).**
Audit 5 permukaan fondasi; tiap temuan → tutup atau catat residual di THREAT-MODEL.md:
1. **IPC / named pipe DACL (I-26, ADR-023).** HARUS: dokumentasikan DACL terbuka sbg residual risk + terapkan hardening
   lapisan-app (minimalkan data sensitif lewat pipe; hanya daemon mutasi state — verifikasi; `inject` tanpa payload —
   verifikasi firewall struktural utuh). DILARANG native addon / cek-PID (spoofable, ADR-023).
2. **Egress whitelist (NFR §Security).** HARUS: verifikasi kode hanya egress ke host allowlist (`api.anthropic.com`,
   localhost loopback agy LS, `api.telegram.org` bila M-remote nanti) via `guardEgress`/`ALLOWED_HOSTS`; tak ada jalur
   lolos. Test: egress ke host non-allowlist → `EgressBlockedError`.
3. **Credential-read at rest (ADR-005/010).** HARUS: verifikasi `oauth_creds.json`/`.credentials.json` hanya **dibaca**,
   tak disalin/di-log; tak ada secret di `events.payload`/log. Test: grep jalur log/DB untuk kebocoran token.
4. **Inject firewall (ADR-008/013/014/020).** HARUS: verifikasi token inject = literal hardcoded wrapper, IPC `inject`
   tanpa payload; tak ada aksi diturunkan dari isi output. Test regresi sudah ada (ADR-020 guard) — konfirmasi cakupan.
5. **Retensi state (ADR-004).** HARUS: verifikasi no-hard-delete (arsip `archived_at`, tak ada DELETE); `events`
   append-only. Test: coba path yang menghapus → tak ada.

**C. Backup/DR minimal (ADR-022).**
- HARUS: skrip backup lintas-OS — `PRAGMA wal_checkpoint(TRUNCATE)` → salin `acca.db`(+`-wal`/`-shm`) ke lokasi backup
  ber-timestamp → pangkas ke N snapshot terakhir (N + lokasi + interval = **konfigurasi**, bukan hardcode).
- HARUS: dokumentasikan restore (stop service → ganti file → start) di quick-start.
- DILARANG: fitur backup in-daemon di MVP; DR penuh (replikasi/PITR).

**D. Dokumentasi user + install (docs + template + skrip).**
- HARUS: `README`/quick-start berisi — instalasi service per-OS (langkah admin sekali), konfigurasi (path, backup,
  `chat_id` bila M-remote), backup/restore, uninstall. HARUS: template unit/XML + skrip di `scripts/` (atau folder
  `deploy/`). DILARANG: dokumentasi yang mengklaim "service hijau" tanpa bukti verifikasi live di mesin asli.

### Acceptance criteria M5 (checklist test milestone)
- [x] **AC-M5-1** Service Linux (systemd --user + linger) survive **logout** + **reboot**; auto-restart on-crash. *(live-verify Ubuntu)* — **✅ PENUH 17 Jul (Ubuntu, systemd 255):** install→`active (running)` · **auto-restart on-crash** (SIGKILL→restart PID baru ~5s, `NRestarts=1`, <30s; G-47) · same-DB (`acca status`→daemon HIDUP, kontras I-33) · **logout→login survive** (owner) · **reboot→auto-start** (owner + korroborasi: `up 1min`, daemon `active since` +6s pasca-boot, PID baru 2642, `enabled`+`Linger=yes` bertahan).
- [x] **AC-M5-2** ✅ **DITUTUP 18 Jul (LIVE, mesin Windows asli + 2× logout/login owner)** *(DI-REVISI ADR-026 — jalur autostart per-user, bukan Windows Service; restart target DIAMANDEMEN <30s→<90s, 18 Jul)* Autostart Windows per-user (Task Scheduler @logon, run-hidden) **auto-start saat login** + **auto-restart on-crash <90s** (SIGKILL, bukan exit-bersih). **Amandemen restart (18 Jul, keputusan owner):** floor `RestartOnFailure` Task Scheduler = **PT1M (60s)**, tak bisa <30s spt systemd (`RestartSec=5`) → target Windows direlakan ke **<90s** (konsisten ADR-026 yang sudah menerima always-on terdegradasi utk laptop). **Mekanisme restart = watchdog repetisi** (`LogonTrigger` ber-`Repetition PT1M` + `MultipleInstancesPolicy=IgnoreNew`), BUKAN `RestartOnFailure` sendiri — **LIVE 18 Jul membuktikan `RestartOnFailure` TAK me-restart proses yang di-kill** (G-49). **Bukti WAJIB (diperkuat — "task RUNNING" TAK cukup, kelas kegagalan I-33):** (a) daemon baca `acca.db` **yang SAMA** dengan CLI user (`acca status` konsisten, bukan DB kosong baru) **DAN** (b) `claude`/`agy` ter-spawn **TERAUTENTIKASI** (resume nyata jalan, bukan gagal-auth senyap) **DAN** (c) nol jendela konsol (run-hidden terverifikasi). **Scope jujur:** logon-scoped — **tak** dituntut survive-logout / at-boot-pra-login (direlakan untuk profil laptop, ADR-026/ADR-007; truly always-on = Linux M5.4). **✅ LIVE 18 Jul (hampir penuh):** (a) identitas daemon=user (`lab2026zf\ziffa`, bukan SYSTEM) + (b) **same-`acca.db`** (`acca status`→HIDUP di PID hasil-spawn task) + (c) credentials `.credentials.json` terlihat + (d) **@logon trigger FIRE terkonfirmasi** (owner logout→login → `LastRunTime`=waktu login, daemon start otomatis sbg user) + (e) **watchdog restart ~65s<90s** + (f) **nol jendela konsol via `conhost.exe --headless`**. **Koreksi jujur:** klaim awal "nol-jendela (MainWindowHandle=0)" **SALAH** — logon nyata memunculkan `PseudoConsoleWindow` node terlihat walau Hidden=true (mata owner + detektor `EnumWindows`; `MainWindowHandle` naif lolos-palsu, **G-52**); fix = jalankan node via `conhost --headless` (nol jendela, conhost=induk → IgnoreNew tetap sah), terverifikasi on-demand + watchdog. **✅ SEMUA terkonfirmasi 18 Jul:** logout/login final owner → daemon auto-start (pid 420, owner=ziffa, parent=conhost), **nol tampilan terminal** (mata owner + `EnumWindows`→NONE), `acca status`→HIDUP, watchdog armed. **Catatan (b) spawn-terautentikasi:** dibuktikan pada level KAPABILITAS (daemon jalan sbg user → `.credentials.json` terlihat → basis sama Linux M5.4); **resume-nyata end-to-end = kelas I-15** (butuh limit asli, gate lintas-cutting, bukan spesifik M5.5). *(live-verify Windows asli — sandbox tak bisa registrasi Task Scheduler)*
- [x] **AC-M5-3** Reboot host saat ada job LIMIT_HIT pending → job tetap fire pasca-boot (recovery AC-7 end-to-end). *(live-verify)* — **✅ Linux 17 Jul:** job `probe` pending di-stage (sesi EXITED → guard I-35 = no-op aman, nol resume), daemon di-stop, host reboot → daemon **auto-start** → recovery-on-start fire job **7s pasca-boot** (`job_dispatch_done skipped:probe_stale_status`, created_at > boot) + job **terkonsumsi**. Paruh Windows menunggu M5.5 (ditunda/I-33).
- [x] **AC-M5-4** Security pass 5-permukaan selesai; tiap temuan ditutup atau tercatat residual di THREAT-MODEL.md. — **✅ M5.3** (T-L1 hardened + T-L2/4/5/8 verified, T-L3 N/A, T-L6/T-L7 kelak LIVE → keduanya kini ✅); THREAT-MODEL §8.4 close-out per-item.
- [x] **AC-M5-5** Egress ke host non-allowlist → `EgressBlockedError` (test); credential-read tak bocor ke log/DB (test/grep). — **✅ M5.3** `test/security-egress.test.ts` (exact-hostname `Set.has`, typosquat/malformed→blocked) + `test/security-credential.test.ts` (8 bentuk error tak bocor token).
- [x] **AC-M5-6** Backup: `wal_checkpoint`+copy hasilkan `.db` konsisten yang bisa di-restore & daemon start bersih. *(sandbox-testable + 1 live)* — **✅ LIVE 17 Jul (M5.6):** backup-saat-daemon-live → `integrity_check: ok`; restore (prosedur terdokumentasi) → daemon start bersih (HIDUP) + marker `tl6x` ter-revert + `m53t` terjaga. `test/backup.test.ts` (SANDBOX) + LIVE ini.
- [x] **AC-M5-7** Retensi backup pangkas ke N (config), tak hapus di luar N; no-hard-delete state terverifikasi. — **✅** `pruneSnapshots` tiered (24 hourly + 30 daily, ADR-024) di `test/backup.test.ts`; `events`/`sessions` no-hard-delete (arsip, CONVENTIONS); LIVE `backup.js` `pruned 0` (1 snapshot, nihil di luar N).
- [x] **AC-M5-8** Quick-start install/backup/restore/uninstall lengkap per-OS; template unit/XML + skrip ada. — **✅ Linux 17 Jul:** install (`install-linux.sh`) + backup (`deploy/backup/systemd/` + `backup.js`) + restore (README, LIVE) + **uninstall (`uninstall-linux.sh`, round-trip LIVE: uninstall→gone→reinstall→active)**; semua ter-gate `test/shell-script.test.ts`. Windows = `acca daemon` manual + Task Scheduler backup (M5.5 ditunda/I-33).
- [x] **AC-M5-9** Security-review gate (persona, skill `milestone-wrapup`) lolos untuk keseluruhan M5. — **✅ 17 Jul (M5.6 wrap-up):** T-L1/2/4/5/6/7/8 tutup (Linux) + T-L3 N/A → gate BERSIH untuk track Linux; checklist web-app N/A (CLI lokal). Paruh Windows (T-L7) menunggu M5.5/I-33.

### Pembagian verifikasi (COWORK-TOOLING-NOTES — build/service = mesin asli)
- **Sandbox-testable** (unit/integration, tak butuh mesin asli): logika backup (checkpoint+copy+prune) atas DB fixture,
  egress guard, credential-read firewall, retensi/no-delete, generator template unit/XML (string-render).
- **WAJIB live-verify di mesin asli** (DILARANG klaim hijau tanpa output nyata dari user): registrasi service per-OS,
  survive logout/reboot, auto-restart on-crash, recovery job pasca-boot, DACL hardening behavior. Orkestrator siapkan
  skrip + perintah; **user jalankan di terminal disk asli** + setor bukti (output service status, log pasca-reboot).

**Selesai bila:** AC-M5-1..9 lulus (yang live-verify dengan bukti dari mesin asli) + security-review gate lolos +
quick-start siap. Backlog M5 (post-MVP): `acca backup`/`acca install` in-CLI, native DACL (bila multi-akun host nyata).

### Vertical slices M5

> Di-generate 2026-07-17 (skill `vertical-slice`). Urutan = dependency: backup (pure, fondasi) → security-audit
> (pure/review) → service per-OS (template+live) → integration+gate. Tiap slice tandai **[SANDBOX]** (testable tanpa
> mesin asli) atau **[LIVE]** (WAJIB verifikasi mesin asli, user setor bukti — COWORK-TOOLING-NOTES). Slice security &
> service = **Tier 1** (security-sensitive: IPC, egress, credential, service privilege). Backup = Tier 1 (state/DB).

#### M5.1 — Engine backup state (checkpoint + copy + prune) **[SANDBOX]**
**Slice**: Fungsi murni yang meng-checkpoint WAL `acca.db` (`wal_checkpoint(TRUNCATE)`), menyalin **file utama saja**
(bukan sidecar `-wal`/`-shm` — menyalin `-wal` basi = korupsi; pasca-TRUNCATE data ada di file utama) ke lokasi backup
ber-timestamp, lalu memangkas ke N snapshot terakhir — di-test end-to-end atas DB fixture (bukan CLI nyata).
**Scope file**: `src/store/backup.ts` (baru), `src/shared/paths.ts` (helper lokasi backup bila perlu), `test/backup.test.ts` (baru).
**Di luar scope**: `daemon/`, `cli/`, service template. DILARANG fitur backup in-daemon (skrip = M5.2).
**Kriteria selesai (testable)**:
- Given `acca.db` WAL aktif dengan data, When `backupDatabase(cfg)`, Then `PRAGMA wal_checkpoint(TRUNCATE)` dijalankan → file `.db` yang disalin **konsisten** (integrity_check OK, tak ada `-wal` sisa transaksi di salinan).
- **Retensi tiered (ADR-024, amandemen 17 Jul):** pertahankan `hourly` snapshot terbaru (default 24) + 1 representatif per hari-kalender lokal (epoch terbesar hari itu) untuk `daily` hari terakhir (default 30); prune sisanya. Snapshot yang di-keep **tak** dihapus (no-hard-delete state asli — ini salinan). *(Kriteria lama "pangkas ke N terakhir" di-amandemen ADR-024; engine `retention:number` → `{hourly,daily}`.)*
- Config (lokasi, hourly, daily, interval) dibaca dari **konfigurasi** (env `ACCA_BACKUP_*`), bukan hardcode (ADR-022/024).
- Edge: DB tak ada → error jelas; lokasi backup tak bisa ditulis → error jelas (tak silent).
**Bukti verifikasi**: paste output `test/backup.test.ts` hijau + integrity_check pasca-restore atas fixture.
**Tier review**: **1** (menyentuh DB/state + jalur restore — korupsi = kehilangan data).

#### M5.2 — Skrip backup + restore lintas-OS + dokumentasi **[SANDBOX render + LIVE 1×]**
**Slice**: Skrip backup (memanggil engine M5.1) + langkah restore, dengan template penjadwalan (cron/systemd-timer Linux,
Task Scheduler/skrip Windows), didokumentasikan di quick-start.
**Scope file**: `src/store/backup.ts` (**amandemen ADR-024:** retensi tiered `{hourly,daily}`), `test/backup.test.ts` (test tiered), `scripts/backup.js` (baru — `.js` ESM, pola `copy-migrations.js`), `deploy/backup/*` (template timer/task), `README`/`docs` bagian backup.
**Di luar scope**: service unit daemon (M5.4/M5.5).
**Kriteria selesai (testable)**:
- **Engine amandemen (ADR-024):** `backupDatabase` config `retention:number`→`{hourly,daily}`; prune tiered (24 hourly + 1 representatif/hari-lokal × 30 hari). Test tiered (bucket hourly + representatif-per-hari + gap-hari + hourly=1/daily=0 = rolling murni back-compat).
- Skrip render/exec atas engine → hasil backup valid (sandbox: jalankan skrip atas DB fixture). Template jadwal default = **hourly** (ADR-024).
- Restore terdokumentasi: stop service → ganti file → start; **1× LIVE**: user backup→restore→daemon start bersih.
- Template penjadwalan per-OS ada + dokumentasi interval config.
**Bukti verifikasi**: output skrip atas fixture (sandbox) + **[LIVE]** bukti user: backup→restore→`acca status` daemon hidup.
**Tier review**: **1** (jalur restore state).

#### M5.3 — Security pass audit 5-permukaan + hardening + THREAT-MODEL close-out **[SANDBOX test + REVIEW]**
**Slice**: Audit + hardening 5 permukaan fondasi (IPC/DACL, egress, credential-read, inject firewall, retensi); tiap
temuan ditutup (kode/test) atau tercatat residual di THREAT-MODEL §8; verifikasi via test + persona security-review.
**Scope file**: `src/shared/http.ts` (egress guard test), `src/daemon/ipc-*.ts` (hardening `status` data-minimize),
`src/shared/credentials.ts` (audit), `test/security-*.test.ts` (baru), `docs/THREAT-MODEL.md` (close-out T-L1..T-L8).
**Di luar scope**: service registration (M5.4/5), backup (M5.1/2). DILARANG native addon DACL (ADR-023).
**Kriteria selesai (testable)**:
- Egress: request ke host non-allowlist → `EgressBlockedError` (test). Loopback agy LS tetap lolos guard (test).
- Credential: grep/test — `oauth_creds.json`/token tak muncul di `events.payload`/log; hanya dibaca.
- Inject firewall: konfirmasi `inject` IPC tanpa payload (test regresi cakup); token literal wrapper.
- IPC DACL hardening: `status` via IPC tak dump cwd tak perlu (data-minimize); residual R-5 tercatat.
- Retensi: no-hard-delete state (`events` append-only) terverifikasi (test/review).
- Tiap dari T-L1..T-L8 (THREAT-MODEL §8) → status "tutup" atau "residual + alasan".
**Bukti verifikasi**: paste `test/security-*.test.ts` hijau + ringkasan audit per-permukaan (persona security-review) + THREAT-MODEL §8 ter-update.
**Tier review**: **1** (auth/IPC/egress/credential — inti keamanan; persona security-review skill `tier-review` tier 4).

#### M5.4 — Service Linux (systemd --user + lingering) template + skrip + LIVE **[SANDBOX render + LIVE]** — ✅ SANDBOX + LIVE PARSIAL (17 Jul)
> **✅ 17 Jul (Opus inline, Tier-1).** Gate artefak DIDESAIN DULU (pelajaran I-34) lalu render: `test/systemd-unit.test.ts`
> (struktur unit + render placeholder→assert `<…>` nol + Restart/RestartSec/Type/WantedBy + **install-sh menyubstitusi tiap
> placeholder** = celah I-34 ditutup) + `test/shell-script.test.ts` (LF/shebang/BOM floor lintas-OS + `sh -n` depth) +
> `deploy/linux/acca-daemon.service` + `scripts/install-linux.sh`. **585 test** (+15), 3 negative control terbukti konkret.
> **LIVE (mesin Ubuntu) — AC-M5-1 PENUH:** install→active, **auto-restart SIGKILL ~5s** (G-47), same-DB (kontras I-33),
> linger, **logout + reboot auto-start terverifikasi owner** (daemon `active` +6s pasca-boot, PID baru). **AC-M5-3 ✅**
> (job probe pending di-stage pada sesi EXITED → reboot → recovery-on-start fire 7s pasca-boot, no-op aman guard I-35).
> **Semua AC Linux M5.4 (AC-M5-1 + AC-M5-3 paruh Linux) HIJAU.** Paruh Windows AC-M5-2/M5-3 = M5.5 (ditunda/I-33).
**Slice**: Template unit `acca-daemon.service` + skrip install (`systemctl --user enable --now` + `loginctl enable-linger`),
di-verify survive logout+reboot+auto-restart di Ubuntu asli.
**Scope file**: `deploy/linux/acca-daemon.service` (template), `scripts/install-linux.sh` (baru), `docs` bagian install Linux.
**Di luar scope**: Windows (M5.5), backup (M5.2). Generator template = string-render (testable); registrasi = LIVE.
**Kriteria selesai (testable)**:
- Template render dengan path `dist/cli/index.js daemon`, `Restart=on-failure`, `RestartSec` (sandbox: assert isi unit).
- **[LIVE Ubuntu]** install → `systemctl --user status` active; logout→login → masih hidup (linger); **reboot** → auto-start; kill daemon → auto-restart <30s. (AC-M5-1)
- **[LIVE]** reboot saat job LIMIT_HIT pending → job fire pasca-boot (AC-M5-3 paruh Linux).
**Bukti verifikasi**: assert render (sandbox) + **[LIVE]** paste `systemctl --user status` pasca-reboot + log recovery job.
**Tier review**: **1** (service privilege + lifecycle; least-privilege runtime).

#### M5.5 — Autostart Windows per-user (Task Scheduler @logon) template + skrip + LIVE **[RE-SCOPED ADR-026 — ✅ DITUTUP PENUH 18 Jul (SANDBOX + LIVE)]**
> **✅ 18 Jul (Opus inline Tier-1, mesin Windows asli).** Gate DIDESAIN DULU (I-34): `test/task-scheduler-xml.test.ts`
> (18 test) — well-formed + `--`-in-comment (gap ditemukan saat MENJALANKAN `System.Xml`, naive tag-balance lolos) +
> ASCII + LogonTrigger/Principal(LeastPrivilege)/Hidden/PT0S/battery-safe/IgnoreNew/**watchdog Repetition**/RestartOnFailure
> + render nol-remnant + substitusi-coverage `.ps1`. Render: `deploy/windows/acca-daemon.task.xml` +
> `scripts/install-windows.ps1`/`uninstall-windows.ps1` (ter-gate `ps1-encoding` G-44). **LIVE (hampir penuh): lihat AC-M5-2**
> (identitas user + same-DB + creds + **@logon-fire terkonfirmasi** + watchdog-restart ~65s + **nol-jendela via conhost**;
> sisa = logon-final owner). **3 temuan LIVE mengubah artefak:** (1) `RestartOnFailure` TAK andal restart proses di-kill →
> **watchdog repetisi + IgnoreNew** (G-49); (2) XML comment `--` ditolak parser sungguhan (G-50); (3) `Hidden=true` TAK cegah
> jendela konsol node @logon → jalankan via **`conhost.exe --headless`** (G-52). **615 test hijau.**
> **♻ RE-SCOPED 17 Jul (ADR-026, owner Ziffan) — dari "Windows Service via WinSW" ke "autostart per-user via Task
> Scheduler @logon".** Probe empiris (17 Jul) membuktikan **Windows Service ≠ sesi user**: default LocalSystem → `acca.db`
> BERBEDA + `.claude/.credentials.json` tak ada → **produk mati SENYAP** (**I-33**). Ganti jalur menyelesaikan I-33 **by
> construction**: Task Scheduler trigger "At log on" (current user) jalan **sebagai user login** → DB + kredensial benar,
> session-0 PTY tak relevan. **Windows Service = jalur dorman** (opsi host non-laptop, tetap ter-blok I-33; pin WinSW
> ADR-025 disimpan sah bila dibuka lagi — spec WinSW lama diarsipkan di bawah `<details>`/riwayat git).
> **DILARANG** Task Scheduler "run whether user is logged on or not" (butuh password/S4U → reintroduce I-33). **DILARANG**
> Startup-folder/`Run`-key polos sbg primary (nol restart + flash konsol). **Butuh owner + mesin Windows asli** (LIVE-only).

**Slice**: Template Task Scheduler XML (trigger LogonTrigger current-user + Settings restart-on-failure + `<Hidden>true</Hidden>`)
+ skrip install `.ps1` (`Register-ScheduledTask`/`schtasks /create /xml` + idempotensi + uninstall), di-verify auto-start-saat-login
+ auto-restart + hidden di Windows asli.
**Scope file**: `deploy/windows/acca-daemon.task.xml` (Task Scheduler template), `scripts/install-windows.ps1` + `scripts/uninstall-windows.ps1` (baru), `docs` bagian install Windows.
**Di luar scope**: Linux (M5.4), backup, jalur Windows Service/WinSW (dorman — ADR-026). DILARANG dep npm baru.
**Kriteria selesai (testable)**:
- **Gate artefak lintas-OS DULU (I-34, sebelum render):** `.ps1` ter-gate `test/ps1-encoding.test.ts` (pure-ASCII/BOM — G-44); XML template ter-gate (well-formed + assert `LogonTrigger` + `<UserId>` current-user + restart-on-failure settings + `<Hidden>true`). Desain gate **sebelum** template di-render (pelajaran I-34).
- Template Task Scheduler XML render dengan `Actions/Exec/Command` = `node`, `Arguments` = path `...\dist\cli\index.js daemon`, **trigger @logon current-user**, **restart-on-failure** (`RestartCount`/`RestartInterval`), **`<Hidden>true</Hidden>`** (sandbox: assert isi XML).
- Skrip install idempoten (task sudah ada → update, bukan gagal) + uninstall bersih (round-trip, ala `uninstall-linux.sh`).
- **[LIVE Windows]** install (nol admin, task per-user) → **logout→login** → daemon auto-start di sesi user; **kill (SIGKILL)** → auto-restart <30s; **nol jendela konsol**. **Bukti I-33-proof:** `acca status` tunjuk `acca.db` **SAMA** (bukan DB kosong) + `claude` ter-spawn **TERAUTENTIKASI** (resume nyata). (AC-M5-2)
- **[LIVE]** reboot→login saat job pending → fire pasca-login (AC-M5-3 paruh Windows). *(Catatan: at-boot-pra-login TIDAK dituntut — logon-scoped, ADR-026.)*
**Bukti verifikasi**: assert render + gate XML/`.ps1` (sandbox) + **[LIVE]** paste `Get-ScheduledTask`/`schtasks /query` pasca-login + `acca status` (DB sama) + log resume terautentikasi + log recovery.
**Tier review**: **1** (autostart privilege boundary + spawn-agent path).

#### M5.6 — Quick-start install/uninstall + integration + milestone-wrapup gate **[SANDBOX + LIVE + GATE]**
**Slice**: Quick-start lengkap (install/backup/restore/uninstall per-OS) + integration test M5 + security-review gate
menyeluruh (skill `milestone-wrapup`), menutup M5.
**Scope file**: `README`/`docs/QUICKSTART.md`, `docs/CONTEXT.md`, `CHANGELOG`; agregasi (tak sentuh src slice lain).
**Di luar scope**: implementasi slice (sudah di M5.1–5.5).
**Kriteria selesai (testable)**:
- Quick-start: install service, konfigurasi, backup/restore, uninstall — lengkap per-OS, langkah admin ditandai.
- Integration test M5 (agregasi) hijau; AC-M5-1..9 tercentang (yang LIVE dengan bukti user).
- **Security-review gate** (persona, `milestone-wrapup`): T-L1..T-L8 tertutup/residual; egress/credential/inject/retensi checklist lolos.
**Bukti verifikasi**: quick-start lengkap + integration test hijau + laporan gate security-review (paste).
**Tier review**: **1** (gate keamanan menyeluruh — persona security-review).

**Ringkasan M5:** 6 slice. **Semua Tier 1** (state/keamanan/service-privilege). Dependency: M5.1→M5.2 (engine→skrip);
M5.3 independen (bisa paralel M5.1/2 — scope file tak tumpang-tindih); M5.4/M5.5 paralel (OS beda, file beda) tapi
keduanya butuh **1 pemegang mesin per-OS** untuk LIVE; M5.6 terakhir (agregasi + gate). Slice **[LIVE]** (M5.2 sebagian,
M5.4, M5.5, M5.6) WAJIB bukti dari mesin asli — DILARANG klaim hijau tanpa output user (COWORK-TOOLING-NOTES insiden 5).

---

## Backlog (post-MVP, dari user stories)

- v1 (Nice): mode `ask` konfirmasi resume (US-6), backoff cerdas (US-7), riwayat kaya (US-8), notifikasi eksternal opt-in (US-9).
- v2+ (Later): dashboard web (US-10), adapter OpenCode & lain (US-11), multi-user/tim (US-12), prediksi proaktif (US-13).

## Urutan dependency dokumen (Bagian 2.6)

PROJECT → ARCHITECTURE (+DECISIONS) → DATA-MODEL/CONTRACTS → NFR/CAPACITY/FAILURE/SECURITY → MILESTONES → MAP+CONVENTIONS.
Sudah dibuat: **THREAT-MODEL.md** (✅ 3 Jul, gate tier C), **DATA-MODEL.md** (✅ 3 Jul malam, skema store),
**MAP.md** (✅), **CONVENTIONS.md** (✅), **DEPENDENCY-POLICY.md** (✅) — **fondasi M1 siap**.
File yang **belum** dibuat (menyusul saat dibutuhkan): FAILURE-MODES.md, SECURITY.md, CONTRACTS (adapter interface — bisa di kode M1).
