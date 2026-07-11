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

## M4 — Notifikasi + Monitor UX (inti ✅ 11 Jul; **AC-4 dikoreksi ⚠ per audit — I-24**)
**Slice:** notifikasi desktop/CLI pada transisi LIMIT_HIT/RESUMED/FAILED; `acca status` lengkap
(usage best-effort + indikator "perkiraan" + loading/empty/error state); `acca log`.
**Selesai bila:** AC-4 ⚠ (usage-view + `acca log` ✅; **reset_at terjadwal + liveness daemon di `acca status` BELUM →
I-24**, klaim AC-4 ✅ sebelumnya = overclaim, dikoreksi 11 Jul), AC-5 ✅ lulus; UX states eksplisit teruji ✅. (Sisa
opsional: Notifier desktop = gate dep.)

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
- **R4 — agy-exited-policy (I-22/A-4): keputusan LOCK (ADR-018, Ziffan) = Opsi 1** (probe standalone opsi #3 + egress
  `oauth2.googleapis.com`). Dua slice: (1) guard minimal probe-impossible→surface+stop-retry (dulu, kecil); (2) probe
  standalone OAuth (Tier-1 creds+egress, live-verify). R5 status-completeness (I-24). R6 stopfailure-hook
  (I-23, sekaligus sumber R2b). R7 resume-gate-per-tool (I-25). R8 housekeeping (I-27/I-28).
**Gate keluar (sebelum M-remote):** R1–R3 selesai + I-15 live-verify **lulus dgn CLI nyata** (limit asli, resume nyata
melanjutkan percakapan). R4 minimal varian "surface manual". M5 aman setelah R1 (crash) tertutup — sudah ✅.

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

## M5 — Hardening + Deploy sebagai service
**Slice:** jalankan daemon sebagai systemd (Linux) / Task Scheduler (Windows); security pass
(least-privilege whitelist, audit events); dokumentasi user + install.
**Selesai bila:** daemon survive reboot host; security review lolos; README/quick-start user siap.

---

## Backlog (post-MVP, dari user stories)

- v1 (Nice): mode `ask` konfirmasi resume (US-6), backoff cerdas (US-7), riwayat kaya (US-8), notifikasi eksternal opt-in (US-9).
- v2+ (Later): dashboard web (US-10), adapter OpenCode & lain (US-11), multi-user/tim (US-12), prediksi proaktif (US-13).

## Urutan dependency dokumen (Bagian 2.6)

PROJECT → ARCHITECTURE (+DECISIONS) → DATA-MODEL/CONTRACTS → NFR/CAPACITY/FAILURE/SECURITY → MILESTONES → MAP+CONVENTIONS.
Sudah dibuat: **THREAT-MODEL.md** (✅ 3 Jul, gate tier C), **DATA-MODEL.md** (✅ 3 Jul malam, skema store),
**MAP.md** (✅), **CONVENTIONS.md** (✅), **DEPENDENCY-POLICY.md** (✅) — **fondasi M1 siap**.
File yang **belum** dibuat (menyusul saat dibutuhkan): FAILURE-MODES.md, SECURITY.md, CONTRACTS (adapter interface — bisa di kode M1).
