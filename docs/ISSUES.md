# ISSUES.md — issue terbuka & tertutup

> Prioritas: P0 (blocker) · P1 (penting) · P2 (mengganggu) · P3 (nanti). Ditutup = tulis solusinya.

---

## Terbuka

> **Audit 11 Jul (`docs/audit/AUDIT-2026-07-11.md`) → I-20..I-28.** Audit menyeluruh pra-M-remote menemukan
> **4 P1 di jalur resume/continue** yang lolos 308 test (test men-stub seam yang justru cacat). Detail lengkap +
> bukti baris-per-baris + rencana remedi R1–R8 ada di file audit — entri di bawah = ringkas + pointer. **Gate keluar
> sebelum M-remote:** I-20..I-22 (R1–R3) selesai + I-15 live-verify LULUS dgn CLI nyata.
> **Progres gate (12 Jul):** R1 (A-2/I—daemon-crash) ✅ · R2a (A-1 korektness) ✅ · **R3 (I-21 multi-siklus) ✅** ·
> **R4 (I-22 agy-exited) ✅ PENUH — pivot ADR-019:** slice 1 (guard probe-impossible) DIGANTI **optimistic resume +
> detect**; probe standalone OAuth (ADR-018 opsi #3) DIBATALKAN karena live-verify buktikan ia baca **pool kuota salah**
> (gemini-cli harian ≠ grup agy weekly+5h, G-38) → ADR-018 di-supersede ADR-019 · **R6 (I-23 hook StopFailure +
> SessionStart) ✅ — LIVE-VERIFIED CC 2.1.207.** · **sisa gate: HANYA I-15 live-verify actuation inject/resume asli.**
>
> **Re-audit 12 Jul (`docs/audit/AUDIT-2026-07-12-FOLLOWUP.md`) → B-1..B-3.** Verifikasi remedi R1–R8 +
> temuan baru di jalur retry/terminal-state. **B-1 (P2, dispatch-terminal-cap) ✅ + B-2 (P3, reset weekly) ✅
> ditutup 12 Jul** (sesi ini). **B-3 (P3) tetap terbuka** — digabung ke I-15/R2b (butuh live-verify).
>
> **Audit menyeluruh KETIGA 13 Jul (`docs/audit/AUDIT-2026-07-12-MENYELURUH.md`, merged PR #1) → C-1..C-8.**
> Gate diverifikasi independen di Linux (388/388). **1 P1 baru: C-1 (resume-load ≠ continue) — MASUK gate keluar M3e.**
> **Ditutup 13 Jul (sesi RC): C-1 (RC-1) ✅ + C-2 (RC-2 validasi UUID hook) ✅ + C-3 (RC-3 capturer last-wins) ✅**
> (393 test). **Terbuka: C-4 (P2, proc_state basi retry-senyap → RC-4, sebelum M5), C-5/C-6/C-7 (P3).** C-8 (drift CONTEXT)
> dikoreksi. **Gate keluar M3e kini: HANYA I-15 live-verify actuation** (inject/resume asli, butuh limit+user).
>
> **Review independen RC-1..RC-3 (16 Jul, `docs/audit/AUDIT-RC-1-3-INDEPENDENT-2026-07-16.md`) → F-1..F-6.**
> Agent CC independen (fresh, tanpa konteks penulisan) me-review batch RC (commit `49de523`) — **verifikasi Opus
> orkestrator ke kode: F-1 CONFIRMED.** Verdict: **RC-1 CHANGES-REQUESTED · RC-2 APPROVE · RC-3 APPROVE-WITH-NITS.**
> **F-1 + F-2 DITUTUP 16 Jul (Opsi B guard, keputusan owner)** → **gate review M3e ✅ HIJAU.** F-3..F-6 (P3) non-blocking.
> **I-30 (guard estimator recent-past) + I-31 (grace-window OUTPUT-CC) DITUTUP 16 Jul** → **SEMUA gate keluar M3e ✅ HIJAU**
> (401 test). Sisa opportunistik non-blocking: konfirmasi live sejati I-31/I-30 + I-15 agy literal English (kelas I-15, butuh limit+user).
>
> **Live-verify I-15 CC full-loop (16 Jul, `docs/audit/LIVE-VERIFY-I15-CC-2026-07-16.md`) — limit CC ASLI.**
> **Deteksi PRIMER `StopFailure rate_limit` = ✅ LULUS** (paruh "tak bisa dipaksa") + **actuation inject-continue FIRE**
> pada sesi CC ter-limit nyata (T-1/T-2). **TAPI membongkar residual live:** **G-37 terkonfirmasi** (repaint pasca-inject
> re-fire LIMIT_HIT palsu → I-31) + **reset clock-wrap** (output "resets 10:20pm" di-parse setelah lewat → jadwal +24 jam,
> padahal probe tahu reset benar → I-30). Sisa I-15 CC = tutup I-30/I-31 lalu re-verify inject benar-benar melanjutkan turn.

> **KONVENSI WAJIB (sejak 17 Jul, I-36):** dokumen ini & seluruh repo di luar `test/fixtures/**` **DILARANG**
> memuat frasa kanonik pesan limit dalam bentuk yang **cocok** dengan `CC_LIMIT_PATTERNS`/`AGY_LIMIT_PATTERNS`
> (`src/adapters/patterns.ts`). Sebut **by-index** (mis. "CC_LIMIT_PATTERNS[3]") atau tulis dalam bentuk regex
> ter-escape (prefiks `\b` mematahkan word-boundary → string tak cocok dirinya sendiri). Alasan: mencetak frasa itu
> ke terminal sesi yang di-supervise = memicu detektor. Lihat I-35/I-36.

> **Audit menyeluruh KEEMPAT 18 Jul (`docs/audit/AUDIT-2026-07-18-MENYELURUH.md`) → D-1..D-5.**
> Verifikasi independen Linux: typecheck+lint+**623/623 test** hijau; semua remedi A-/B-/C-/F- terpasang,
> tak ada regresi remedi lama. **1 P1 baru (D-1)** di interaksi `markExited` × guard I-35 + 1 P2 + 3 P3.

### D-1 — `markExited` clobber `LIMIT_HIT` + guard status probe (I-35) ⇒ auto-resume sesi "limit lalu exit BERSIH" mati senyap; jalur agy-exited ADR-019 praktis tak terjangkau [P1, butuh keputusan owner]
Bukti runtime + baris kode di audit keempat §2. Rantai: `markExited` (`sessions.ts:73`) tanpa guard status
(kontras `markOrphanExited` yang SENGAJA mempertahankan `LIMIT_HIT`) → sesi limit yang exit bersih (Ctrl-C/quit)
jadi `EXITED` → job probe pending di-skip `skipped:probe_stale_status` (guard `3031e54`) → **nol resume, nol
notifikasi**. Pra-guard (≤17 Jul) jalur ini auto-resume. Dampak terberat agy: id resume agy HANYA tertangkap
saat exit bersih (G-36), sesi mati keras tak punya id (BLOCKED) → **optimistic resume ADR-019 tak punya jalur
produksi yang tercapai**. Remedi = **RD-1** (Opsi A: preserve `LIMIT_HIT` di `markExited` [rekomendasi auditor] vs
Opsi B: dokumentasikan "exit bersih = batal resume" + hapus job pending + notif) + 2 test komposisi lifecycle.

### D-2 — Limit ASLI hasil konfirmasi job `verify` di-latch TANPA `status_change`/notifikasi (gap AC-5) [P2]
`supervisor.ts:374-397` menulis hanya `job_dispatch_done verify_latched_real_limit` — tak dipetakan Notifier &
tak ada event `status_change {to:LIMIT_HIT}` (satu-satunya jalur latch yang bisu + audit-trail transisi bolong).
Remedi = **RD-2**: append `status_change` pasca-latch (dekorator notifier otomatis surface) + 1 test.

### D-3 — DATA-MODEL.md belum mencatat `kind='verify'`/migrasi 0003 (drift sumber-kebenaran skema) [P3]
`DATA-MODEL.md:60` masih `CHECK(probe|resume)`. Remedi = **RD-3** (docs-only).

### D-4 — `api.telegram.org` di allowlist egress dengan NOL konsumen produksi [P3, least-privilege]
`shared/http.ts:12-18`. Inkonsisten preseden ADR-019 (cloudcode-pa dihapus krn tak dipanggil produksi);
M-remote kini ditunda tak-tentu (keputusan owner 18 Jul). Remedi = **RD-4**: hapus sampai slice M-remote dibuka
(+ sesuaikan `security-egress.test.ts` + NFR §Security).

### D-5 — Klaim jumlah test bergantung-mesin & drift antar-doc (626 CLAUDE/README vs 615 MILESTONES vs 623 audit-Linux) [P3, higiene klaim]
Gate per-file (literal/artefak) men-generate test atas working tree → angka beda per mesin (file untracked ikut).
Remedi = **RD-5**: pin angka dari checkout bersih di SATU lokasi / berhenti pin angka eksak.

### I-35 — Deteksi limit dari OUTPUT false-positive pada PROSA yang mengutip pesan kanonik → inject token ke sesi SEHAT [P1 — ✅ DITUTUP PENUH 18 Jul: korroborasi (17 Jul) + guard-status (17 Jul) + probe verifikasi eksplisit `kind:'verify'` (18 Jul)]
**Ditemukan live 17 Jul di sesi ini sendiri** (`acca run claude` — dogfood tak sengaja, sesi `z36i`). **DUA FP nyata
dalam ~8 menit**, keduanya siklus penuh sampai actuation.
**BUKTI (tabel `events`, evidence teredaksi — harness read-only di scratchpad):**
| event | waktu | evidence | pemicu |
|---|---|---|---|
| #43 | 09:16:37Z | 22 char (= CC_LIMIT_PATTERNS[3], varian ber-qualifier) | **query pencarian agent sendiri** yang memuat frasa kanonik mentah → tercetak ke terminal |
| #48 | 09:24:14Z | 19 char (= CC_LIMIT_PATTERNS[1]) | **teks notifikasi acca SENDIRI** (`notify/notifier.ts:70` + judul warn) yang di-paste owner untuk didiagnosis |
Keduanya: `status_change LIMIT_HIT {source:'output'}` → `probe_scheduled {resetSource:'backoff'}` (+5m) →
`job_dispatch_done {action:'usage_available_enqueue_resume'}` → `inject_continue` → `RUNNING`.
**AKAR:** kalibrasi konservatif `CC_LIMIT_PATTERNS` (komentar `patterns.ts` + `test/fixtures/cc-noise.txt`) menutup prosa
yang **MENYEBUT** kata "limit"/"usage" — tapi **tak pernah** menutup prosa yang **MENGUTIP pesan kanoniknya**. Padahal
itu persis yang dilakukan dokumentasi, komentar kode, changelog, thread forum, **notifikasi produk ini sendiri**, dan
**paste user**. Untuk persona MVP (agentic engineer yang seharian membaca docs & nge-paste error ke agent-nya), ini
bukan skenario eksotis — ini hari Selasa.
**DAMPAK:**
1. **Metrik `PROJECT.md` §1 "deteksi salah < 1 per 100 sesi" meleset ORDE BESARAN** — terukur **2 FP dalam 1 sesi**.
2. Tiap FP meng-inject `CONTINUE_TOKEN` ke sesi **sehat**. Inject #1 mendarat **di TENGAH ketikan owner** → merusak
   input, bukan sekadar bising.
3. FP#2 = **produk memicu dirinya sendiri lewat notifikasinya sendiri** (loop: limit asli → notif → user paste → FP).
**IRONI YANG MENUNJUK FIX:** probe pasca-FP menemukan `usage_available` (session **53%**) lalu memakai temuan itu untuk
memutuskan **resume**. Informasi pembatalnya **sudah ada, sudah diambil, sudah dikonsultasi** — hanya satu tahap
terlambat. Probe menjawab "kuota tersedia sekarang?" (ya) → "bagus, resume!", bukan "tunggu, kuotanya tak pernah habis."
`acca status` bahkan **memajang kontradiksinya di layar**: `session 53%` berdampingan dengan `LIMIT_HIT`.
**USUL ARAH (BELUM diputuskan — butuh owner):** **korroborasi**. Sinyal `source:'output'` untuk sesi **CC** tak melatch
bila snapshot usage **SEGAR** menunjukkan kuota **jelas longgar** (< ambang) → suppress + audit (`limit_suppressed_*`,
kosakata sama dgn I-31). **Hook `StopFailure` (PRIMER, ADR-001) BYPASS** — otoritatif, tak pernah disuppress.
**Ambang wajib condong ke arah aman (jangan tukar FP dengan false-negative):** T-6 (live-verify 16 Jul) mengukur lag
probe **~2 menit** (terminal 94% vs claude.ai 100%) → pada **94% TETAP latch**; suppress hanya saat jelas longgar.
Snapshot **basi** → jangan suppress (percaya output, perilaku sekarang).
**Scope usulan:** **CC-only + output-only** — meniru persis bentuk I-31 (grace-window). **agy TAK disentuh**: nol hook,
dan G-35 (snapshot LS stale in-sesi) bikin korroborasi agy tak andal.
**Sumber:** insiden live 17 Jul, sesi `z36i`; events #43/#48; `docs/audit/LIVE-VERIFY-I15-CC-2026-07-16.md` (T-6).

**✅ DIKERJAKAN 17 Jul (Opus inline, Tier-1, 474 test):** keputusan owner = **suppress di deteksi, ambang 0.85, hook BYPASS**.
- `adapters/usage.ts`: `claudeMaxBindingUsedFraction` + `bindingLimits` di-ekstrak → **satu definisi** window-mengikat
  dipakai bersama `claudeUsageAvailable` (I-25) supaya keduanya tak pernah menyimpang. `limits` kosong → `null` (tak tahu).
- `limit-watcher.ts`: `usageSnapshot` + `onUsageContradiction` **injektabel** (engine tetap murni — tak menyentuh store).
  Guard CC-only + OUTPUT-only, setelah grace-window I-31. Konstanta: ambang **0.85**, kesegaran **5 menit** (~2,5 siklus
  usage-monitor). **Firewall justru MENGUAT** — lebih sedikit aksi diturunkan dari isi output, bukan lebih banyak.
- `process-wrapper.ts`: `readUsageCorroboration` (di-export utk test) — **setiap** jalur cacat → `null` → latch. Guard
  `tool !== 'claude'` → null = CC-only **struktural di dua tempat** (jangan bergantung guard engine saja).
- Wiring **kedua** pemanggil produksi: `cli/commands/run.ts` + `supervisor.ts` (sesi hasil-resume juga di-supervise).
- **+23 test.** **Negative control TERBUKTI:** ambang→0 ⇒ tepat 2 test merah (suppress + jaring FN), 22 lain tetap hijau.

**⚠ MASIH TERBUKA (sebagian) — jaring FN eksplisit (probe verifikasi) belum dibangun; guard-status DITUTUP.** Owner
menyetujui "suppress + probe verifikasi"; yang terkirim baru **suppress**. Alasan (ditemukan saat implementasi, framing
awal Opus KELIRU):
1. **✅ DITUTUP 17 Jul (Opus inline, Tier-1, 475 test) — guard status cabang `probe`.** Sebelum fix: cabang `probe`
   (`supervisor.ts`) tak pernah menanyakan apakah sesinya **masih** LIMIT_HIT — ia langsung `probeUsage` → "kuota
   tersedia?" → ya → `enqueue resume` → **inject**. Job `probe` stale yang fire pada sesi yang sudah **RUNNING**
   (resume manual, race, atau kelak verifikasi FP dari jalur lain) akan meng-inject sesi yang tak pernah dikonfirmasi
   limit — persis bahaya yang I-35 coba cegah (keluarga F-1). **Fix:** guard `session.status !== 'LIMIT_HIT'` tepat
   sesudah `reconcileDispatchLiveness`, SEBELUM cabang agy-optimistic maupun `adapter.probeUsage` — job stale → audit
   `job_dispatch_done {action:'skipped:probe_stale_status', status}` + `'done'` (no-op, bukan probe/inject). **+1 test**
   (`beforeFire` set status→RUNNING pasca-`start()`, sebelum fire → assert `probeUsage` TAK terpanggil). **Negative
   control TERBUKTI:** guard dihapus sementara → test gagal (`probeUsage` terpanggil 1×) → dikembalikan, 475 hijau.
   Ini **perbaikan korektness berdiri sendiri** (melindungi SEMUA job `probe` stale, bukan cuma yang dari I-35) —
   **bukan** implementasi "probe verifikasi eksplisit" (poin 2 di bawah, masih butuh keputusan desain terpisah).
2. **✅ DITUTUP 18 Jul (Opus inline, Tier-1, 626 test) — "probe verifikasi eksplisit" via job `kind:'verify'`.**
   Keputusan desain owner (sesi 18 Jul): **job `kind:'verify'` baru** (BUKAN overload `probe` — semantik `probe` sudah
   di-guard `status==='LIMIT_HIT'`, kebalikan dari verify yang justru menjalankan sesi RUNNING-belum-di-latch → overload
   mekanis buntu). Semantik latch owner: **verify → habis → latch SAJA** (markLimitHit source `verify` + `scheduleProbeForLimit`,
   mesin normal ambil alih; TIDAK langsung resume) · **delay 2,5 mnt** (>lag probe ~2 mnt/T-6 supaya snapshot menyusul).
   - **Trigger** (`process-wrapper.ts` `onUsageContradiction`): selain emit `limit_suppressed`, enqueue `verify` @ +150s +
     `notifyDaemonRearm`. **Dedup `hasPendingKind(id,'verify')`** — suppress menyala PER BARIS (prosa multi-literal, mis.
     membaca `patterns.ts`/docs) → satu verify per episode cukup (blind-spot penulis=reviewer di-flag & ditutup).
   - **Dispatch** (`supervisor.ts` cabang `verify`): guard tool CC-only + guard status (skip bila bukan RUNNING-alive:
     hook primer melatch di antara suppress&fire, atau exited) → `probeUsage` → **tersedia = `verify_fp_confirmed`** (no-op) /
     **habis = `verify_latched_real_limit`** (latch+probe) / **tak terbaca di cap = `verify_unreadable`** (menyerah TANPA
     markBlocked — beda kritis dari cabang `probe`: sesi RUNNING sehat tak boleh di-BLOCKED).
   - **Migrasi `0003-scheduled-jobs-kind-verify.sql`:** widen `CHECK(kind IN('probe','resume','verify'))` via table-rebuild;
     **upgrade v2→v3 diuji konkret** (baris lama utuh, verify diterima, bogus ditolak, FK tegak).
   - **+5 test** (4 dispatch + 1 integrasi PTY-nyata wiring+dedup). **3 NC terbukti konkret:** (a) enqueue dimatikan →
     wiring merah; (b) paksa `hasAvailable=true` → hanya test latch merah (isolasi); (c) bypass dedup → 2 verify job.
3. **Jaring FN — kini AKTIF (poin 2) + pasif (repaint) sebagai cadangan.** Suppress tak membuang sinyal (repaint melatch
   saat snapshot menyusul) DAN verify aktif memverifikasi. Sisa opportunistik (kelas I-15, butuh limit CC asli + user):
   latch-vs-FP decision path end-to-end di limit NYATA — teruji di sini via probe ter-stub + wiring PTY-nyata, tapi
   verify-under-real-limit sejati menunggu episode limit asli (sama batas I-31/I-15).
**Next:** nihil (I-35 tutup). Verifikasi LIVE verify-under-real-limit = opportunistik saat limit CC berikutnya (dogfood).

### I-36 — Repo ini sendiri = korpus yang memicu detektornya sendiri; `/session-start` = ranjau di bawah acca [P2, higiene dev ✅ DITUTUP 17 Jul — TIDAK menggantikan I-35]
**✅ DITUTUP 17 Jul (Opus inline, Tier-1, 95+570 test).** 61 baris (bukan 103 literal — angka 103 dari korpus mentah
sebelum dobel-cek cc+agy independen per baris menemukan 1 baris lagi [`DECISIONS.md:850`] dan idempotency-loop
menemukan overlap pattern0-vs-pattern1 [+~40 titik sisip lagi]; hitungan akhir = 61 baris, 102 titik sisip) di 12
file (`docs/{CONTEXT,DECISIONS,GOTCHAS,ISSUES,RESEARCH}.md` + 2 audit + 5 file `src/`) diperbaiki: escape `\b`
(word-boundary patah, teks tetap terbaca — mayoritas) atau referensi by-index `CC_LIMIT_PATTERNS[N]` (3 titik yang
merupakan **data record** `evidence:"..."` di audit docs — escape akan salah-representasi nilai yang benar-benar
tercatat). **Dua pengecualian struktural bermarker `gate:allow-canonical-literal`:** `AGY_LIMIT_PATTERNS` array
literal (`patterns.ts` — regex source-nya niscaya memuat teks targetnya, bukan kutipan prosa) + `notifier.ts` title
(string user-facing yang SENGAJA meniru bahasa kanonik untuk kejelasan; risiko notif-memicu-diri-sendiri sudah
ditutup di lapis deteksi oleh I-35, bukan dengan menyembunyikan kata dari user).
**Gate permanen: `test/no-canonical-limit-literals.test.ts`** — scan SEMUA file text-ish (`.ts/.md/.json/.sh/.ps1/
.xml/.service/.yml/.yaml`) di luar `test/**`, pakai `matchLimit`/`matchAgyLimit` PRODUKSI langsung (bukan salinan
regex — tak bisa basi terhadap `patterns.ts`), skip baris ber-marker. Lintas-OS (pure fs+regex). **Negative control
TERBUKTI** (literal mentah disisipkan → gate merah tepat di baris itu; dihapus → hijau) — dan gate ini **langsung
membuktikan gunanya** saat menulis dokumentasi penutupnya sendiri (GOTCHAS G-46 draft pertama memuat 4 literal segar,
tertangkap gate sebelum commit).
**3 jebakan mekanis ditemukan & diperbaiki SAAT membangun gate ini sendiri (detail: GOTCHAS G-46):** (a) JS `'\b'`
= backspace, bukan 2 karakter `\`+`b` → fix pertama no-op senyap; (b) menyisip escape ke baris DEFINISI regex
(bukan komentar) mengubah semantik deteksi produksi — nyaris terjadi pada `AGY_LIMIT_PATTERNS`; (c) menyimpan
SATU evidence per baris (bukan cc+agy independen) melewatkan baris ber-evidence-ganda. Pelajaran umum: gate/fixer
mekanis untuk "teks yang mirip kode" wajib rescan-terverifikasi, jangan percaya "skrip jalan tanpa galat".
**Sumber:** insiden live 17 Jul (I-35); implementasi gate 17 Jul.

<details><summary>Temuan asli (sebelum ditutup)</summary>

**Terukur 17 Jul: 103 literal yang cocok pola detektor, tersebar di 20 file.** Yang gawat — **5 di antaranya adalah file
yang ritual `/session-start` WAJIBKAN dibaca tiap sesi**: `GOTCHAS.md` (13) · `RESEARCH.md` (12) · `DECISIONS.md` (8) ·
`CONTEXT.md` (7) · `ISSUES.md` (6) = **46 literal**. Artinya **ritual pembuka proyek ini adalah ranjau** setiap kali
sesinya jalan di bawah `acca run claude`. Sesi 17 Jul lolos separuh **hanya karena Read-nya ter-truncate** — keberuntungan,
bukan disiplin. FP#1 (I-35) meledak begitu `src/adapters/patterns.ts` dibaca utuh: **detektor membaca komentar sumbernya
sendiri**, yang mengutip pesan asli verbatim justru untuk mendokumentasikan G-15.
**Pengecualian sah:** `test/fixtures/**` **WAJIB** memuat literal itu — itu korpus ujinya. Kecualikan, jangan "perbaiki".
**Usul:** konvensi (sudah ditulis di header "Terbuka" di atas) + **gate kelas I-34** — file di luar `test/fixtures/**`
tak boleh memuat string yang cocok `CC_LIMIT_PATTERNS`/`AGY_LIMIT_PATTERNS`. Bentuk aman yang **terverifikasi**: tulis
pola dalam bentuk regex ter-escape (prefiks `\b` mematahkan word-boundary → string itu tak cocok dirinya sendiri), atau
rujuk **by-index**. Gate ini pure-TS → lintas-OS, tak melanggar pelajaran I-34 (jangan bikin gate yang skip di satu OS).
**Batas tegas:** I-36 = higiene dev (bikin repo ini aman dikerjakan di bawah acca). **I-35 = fix produk.** I-36 **tak**
menggantikan I-35 — user lain punya repo & paste-an mereka sendiri.
**Sumber:** insiden live 17 Jul (lihat I-35).
</details>

### I-34 — Artefak shippable tanpa gate yang MENGEKSEKUSINYA = titik buta review [P2, ✅ DITUTUP 18 Jul — `.ps1` + `.service`/`.sh` (17 Jul) + XML Task Scheduler (M5.5, 18 Jul)]
**Kelas cacat (bukan bug tunggal), ditemukan 17 Jul lewat DUA korban nyata dalam satu sesi:**
1. **`register-backup-task.ps1`** (M5.2 `85be83c`) — **ter-commit, ditandai selesai, LOLOS tier-review Opus**, padahal
   **tak bisa di-parse PowerShell 5.1** (em-dash dalam string, **G-44**) → backup terjadwal Windows tak pernah jalan.
2. **Instruksi README** — `npm install && npm run build` (`&&` tak ada di PS 5.1) + `acca run claude` (`acca` tak pernah
   di PATH tanpa `npm link`). **Sudah diketahui sejak 16 Jul** (CONTEXT: "`acca` tak di PATH") tapi tak pernah diperbaiki
   → menggigit owner dua kali; owner gagal di langkah PERTAMA README saat mencoba menjalankan daemon.
**Akar yang sama:** `npm run check` (typecheck+lint+test) **tak menyentuh** artefak non-TS. Reviewer **membaca** artefak,
tak **mengeksekusi**-nya. Jadi `.ps1`, template unit, XML, dan instruksi README = **shippable tapi tak ter-gate**.
Membaca ≠ menjalankan — dan kelas ini lolos justru karena slice-nya ditandai `[LIVE]` (verifikasi ditunda ke user).
**Ditutup untuk `.ps1` (17 Jul):** `test/ps1-encoding.test.ts` — tiap `*.ps1` wajib pure-ASCII/ber-BOM. Sengaja menguji
**root cause (byte)** bukan gejala (parse): parser PowerShell butuh Windows → test bakal **skip di Ubuntu** (mesin harian)
= gate bocor di tempat kerja paling sering. **Negative control terbukti.** README diperbaiki + **diverifikasi dengan
benar-benar dijalankan** (`npm link` → `acca --version` → `0.1.0` → `acca status` render nyata).
**✅ DITUTUP untuk `.service`/`.sh` (M5.4, 17 Jul, Opus inline Tier-1):** DoD ditegakkan — gate DIDESAIN DULU sebelum
render (bukan sesudah). `test/systemd-unit.test.ts`: struktur unit (tiap baris komentar/section/key=value), + untuk
template daemon **render** (substitusi `<NODE>`/`<ENTRYPOINT>` dgn nilai contoh) → assert `<…>` nol tersisa +
`Restart=on-failure` + `RestartSec` numerik + `Type=simple` + `WantedBy=default.target`, **+ setiap placeholder wajib
disubstitusi oleh `scripts/install-linux.sh`** (ini menutup celah I-34 yang SEBENARNYA: template dikirim, hubungan
template↔substitusi tak pernah di-gate — bukan sekadar "file bisa di-parse"). `test/shell-script.test.ts`: floor
lintas-OS (LF-only [CRLF=`bad interpreter`], shebang, no-BOM) + `sh -n` depth (skip HANYA di Windows-tanpa-sh; Ubuntu
daily selalu punya → tak bocor di daily driver). **Pelajaran tambahan:** assertion "no em-dash" (kelas G-44) TIDAK
disalin ke gate ini — systemd & POSIX-sh baca UTF-8 native, em-dash di komentar tak merusak parser (beda dari .ps1/
CP1252). Menyalin gate lintas-format tanpa mekanisme yang membenarkannya = false-premise. **3 negative control terbukti
konkret** (CRLF, `sh -n` sintaks, baris-tanpa-`=`, placeholder bocor, Restart salah). **585 test.**
**✅ DITUTUP untuk XML (M5.5, 18 Jul, Opus inline Tier-1):** `test/task-scheduler-xml.test.ts` (18 test) memvalidasi
`deploy/windows/acca-daemon.task.xml` + substitusi `scripts/install-windows.ps1`: well-formed (tag-balance) + **`--`-in-comment**
(gap yang naive tag-balance lewatkan tapi parser sungguhan tolak — ditemukan saat MENJALANKAN `System.Xml`, G-50) + ASCII +
LogonTrigger/Principal(LeastPrivilege)/Hidden/PT0S/battery-safe/IgnoreNew/**watchdog Repetition** + render nol-remnant +
substitusi-coverage `.ps1` (celah I-34 sebenarnya). `.ps1` baru ter-gate `ps1-encoding` (G-44). **3 negative control terbukti**
(escalasi 1→2→4→5). **Pelajaran menegaskan I-34:** gate lintas-OS pure-TS TAK bisa memanggil parser XML sungguhan → tetap
verifikasi eksekusi di mesin asli (di sini: `System.Xml` menolak `--`-comment yang gate lolos → gate lalu diperkuat). **Kelas
I-34 kini tertutup untuk SEMUA artefak deploy** (`.ps1`/`.service`/`.sh`/XML). **Sumber:** M5.5 LIVE 18 Jul (kelas dari G-44).

### I-33 — Windows Service ≠ sesi user: daemon-as-service pakai DB & kredensial BERBEDA → produk mati SENYAP [P1 blocker MVP → RESOLVED-BY-PATH-CHANGE (ADR-026, 17 Jul); residual jalur-Service = deferred/P3]
**✅ RESOLUSI (ADR-026, 17 Jul — ganti jalur, bukan pecahkan mismatch):** deployment Windows MVP **tak lagi lewat Windows
Service** → **autostart per-user (Task Scheduler @logon, run-hidden, restart-on-failure)** yang jalan **sebagai user login**
→ mismatch identitas akun (akar seluruh issue ini) **lenyap by construction**: `acca.db` + `.credentials.json` = milik user,
`session-0` PTY tak relevan (daemon di sesi interaktif user, spawn `claude` persis seperti `acca daemon` manual). **4
ketidakpastian jalur "service as-user" (password / `SeServiceLogonRight`+`secedit` / profile-load / session-0 PTY) semua
GUGUR** untuk MVP. **Residual yang tersisa (di-defer, P3):** hanya relevan bila kelak ada host Windows **non-laptop
selalu-login** yang butuh always-on lintas-logout via Windows Service — di situ probe stage-2 di bawah masih berlaku.
Untuk profil laptop (target proyek), always-on lintas-logout **sudah direlakan** (opsi c di bawah, ADR-007); tak ada yang
perlu dikejar. **Blocker MVP DITUTUP.** Sisa bagian di bawah = konteks historis + residual jalur-Service.

**Ditemukan 17 Jul (slice M5.5, probe empiris di Win 11 owner) — SEBELUM kode ditulis.** ADR-021 menetapkan deployment
Windows = Windows Service, tapi tak memeriksa **identitas akun** service. Windows Service default (WinSW tanpa
`<serviceaccount>`) jalan sebagai **LocalSystem**, dan itu **bukan** sesi user. Ini bertabrakan langsung dengan **ADR-005**
("supervisor mewarisi sesi login CLI yang ada di mesin").
**BUKTI PROBE (service uji sekali-pakai, LocalSystem, sudah di-uninstall bersih):**
| | Sesi user | Service (LocalSystem) |
|---|---|---|
| `whoami` | `lab2026zf\ziffa` | `nt authority\system` |
| `os.homedir()` | `C:\Users\ziffa` | `C:\WINDOWS\system32\config\systemprofile` |
| `dataDir()` (`paths.ts:12-26`) | `…\ziffa\AppData\Local\acca` | `…\systemprofile\AppData\Local\acca` |
| **`sameDbAsUser`** | `true` | **`false`** |
| `resolvedDbExists` | `true` | **`false`** |
| **`credentials.exists`** (`credentials.ts:24`) | `true` | **`false`** |
**Dampak (kelas kegagalan TERBURUK — senyap, dan lolos AC yang ada):**
1. **Split-brain DB.** `%LOCALAPPDATA%` **terdefinisi** di bawah SYSTEM (koreksi: bukan "undefined" spt klaim awal) tapi
   menunjuk `systemprofile` → daemon-service resolve `acca.db` **berbeda**. `resolvedDbExists:false` → daemon akan
   menjalankan migrasi + **membuat DB kosong baru**, lalu jalan selamanya melihat **nol sesi**. Tanpa error.
2. **Kredensial putus.** `.claude/.credentials.json` tak ada di profil SYSTEM → `claude`/`agy` yang di-spawn daemon
   **tak terautentikasi** → resume gagal. Premis ADR-005 runtuh.
3. **Menipu total.** `sc query` = RUNNING (hijau). `acca status` menampilkan sesi user (ingat **G-42**: CLI baca DB
   LANGSUNG, bukan lewat IPC) → semuanya *tampak* benar. Jam 02:00: tak terjadi apa-apa.
4. **AC-M5-2 seperti tertulis AKAN LULUS sementara produk mati** — ia hanya mengecek service survive reboot/auto-restart.
   → **AC-M5-2 WAJIB diperkuat** (bukti wajib: daemon baca `acca.db` yang SAMA + CLI ter-spawn TERAUTENTIKASI).
**Kenapa Linux (M5.4) TAK kena:** `systemd --user` + lingering jalan **sebagai user** dgn `$HOME` user + survive logout.
Windows **tak punya padanan** `systemd --user`. Asimetri ini fundamental, bukan detail impl.
**Opsi + status (BELUM diputuskan — butuh solusi sebelum M5.5 jalan):**
- **(a) Service sebagai akun user.** Password sekali saat install → SCM simpan di **LSA secrets** (bukan file).
  **WinSW `<serviceaccount>` DITOLAK** — `sample-allOptions.xml` resmi v2.12.0 menuntut `<password>Pa55w0rd</password>`
  **plaintext di XML**. Jalur waras = install (LocalSystem) → set akun via `PSCredential`/WMI `Change()` (password tak
  pernah ke file/command-line). **4 ketidakpastian bertumpuk (belum diuji):** butuh password owner; kemungkinan butuh
  grant **`SeServiceLogonRight`** (mutasi kebijakan keamanan lokal via `secedit` — invasif, harus di-revert); MS
  mendokumentasikan profil user **tidak** otomatis di-load untuk service → `%LOCALAPPDATA%` bisa TETAP salah walau jalan
  sbg user; service hidup di **session 0** terisolasi → node-pty/ConPTY + auth `claude` di sana **belum pernah dibuktikan**.
  Mitigasi parsial: pin `<env ACCA_DATA_DIR>` + `<env USERPROFILE>` di XML → resolusi path deterministik tak bergantung
  profil ter-load (menutup #1, TIDAK menutup #2 bila auth butuh konteks user).
- **(b) LocalSystem + pin `<env>`.** **DITOLAK atas dasar keamanan** (bukan teknis — SYSTEM bisa baca file user, jadi
  mungkin saja jalan): men-spawn CLI agent arbitrer (`claude`/`agy`) dgn **privilege tertinggi mesin** = eskalasi
  privilege sebagai fitur; proyek yang cermat soal residual DACL (ADR-023) tak boleh menerima ini. Risiko teknis sisa:
  `.credentials.json` DPAPI user-scope → SYSTEM tak bisa decrypt; file tulisan `claude` jadi SYSTEM-owned di profil user.
- **(c) DITUNDA — keputusan owner Ziffan 17 Jul:** **Windows = `acca daemon` manual di terminal** sampai solusi ketemu.
  **ADR-021 TETAP jadi target** Windows (bila kelak jadi service, itu Windows Service — bukan Task Scheduler; keputusan
  ADR-021 TIDAK dibalik); yang ditunda = realisasinya, karena blocker ini. Batasan sudah selaras ADR-007 ("di laptop yang
  tidur, resume tertunda sampai bangun"). Host always-on sejati = node headless/VPS (Linux, M5.4) — di situ nol masalah.
**Konsekuensi:** **M5.5 DITUNDA** (bukan dibatalkan). **AC-M5-2 + paruh Windows AC-M5-3 = terbuka.** M5 akan tutup
**PARSIAL** (Linux hijau, Windows ditunda). ADR-021 dianotasi menunjuk issue ini supaya sesi berikutnya tak menginstall
service lalu jatuh ke lubang yang sama.
**Next bila dibuka lagi:** probe stage-2 (service as-user: profil ter-load? creds kebaca? butuh `secedit`?) lalu, bila
lulus, verifikasi **session-0 PTY** dgn spawn `claude` sungguhan. Keduanya butuh owner + mesin asli.
**Sumber:** probe sekali-pakai 17 Jul (`scratchpad/probe/`, di luar repo, read-only tanpa mutasi sistem — dibuktikan
`resolvedDbExists:false`); `sample-allOptions.xml` WinSW v2.12.0; Microsoft Learn `LoadUserProfile`.

### I-32 — Backup one-shot vs daemon LIVE: race `wal_checkpoint(TRUNCATE)`+`copyFileSync` bisa hasilkan salinan korup [P2 ✅ DITUTUP 18 Jul — online backup API]
**✅ RESOLVED (18 Jul, Opus inline Tier-1, 621 test).** `backupDatabase` diubah dari sinkron
(`wal_checkpoint(TRUNCATE)`+`copyFileSync` file-utama) ke **async SQLite online backup API** (`db.backup(dest)`,
better-sqlite3 12.11.1) — salinan page-by-page dengan lock benar, **concurrency-safe by design** → race copy-vs-checkpoint
(risiko b) lenyap **by construction**. Koneksi sumber tetap terbuka selama transfer, ditutup di `finally`; `integrity_check`
fail-safe dipertahankan; `pruneSnapshots` tak berubah (tetap sinkron, pure fs). Caller diperbarui: `scripts/backup.js`
(top-level await ESM), `test/backup.test.ts` (semua call `await`; error-path `rejects.toThrow`). **+1 test** (T5: backup saat
koneksi WAL kedua aktif → salinan integrity-ok memuat semua baris ter-commit). **Catatan verifikasi jujur (G-53):** race
korupsi lama = nondeterministik → **tak bisa jadi negative-control keras**; uji empiris menunjukkan pendekatan lama pun
lolos T5 di kasus writer-idle (checkpoint sempat flush) → T5 = **scenario/kapabilitas** (bukti path baru jalan), bukan bukti
path lama gagal. Nilai fix tetap nyata (menghapus race by construction). **Sumber:** tier-1 review M5.1/M5.2; implementasi 18 Jul.

<details><summary>Konteks temuan asli</summary>
**Konteks:** M5.1/M5.2 engine `backupDatabase` membuka **koneksi kedua** ke `acca.db`, `wal_checkpoint(TRUNCATE)`, lalu `copyFileSync` file utama. Aman untuk **koneksi tunggal** (sandbox test, CLI one-shot tanpa daemon). Tapi `scripts/backup.js` dijadwalkan jalan **saat daemon HIDUP** memegang koneksinya sendiri (mode WAL) → dua risiko:
- (a) Committed-but-not-checkpointed frames di WAL daemon tak masuk salinan → salinan sedikit basi (RPO gap, ≤beberapa txn — diterima R-6).
- (b) **Lebih serius:** bila checkpoint daemon menulis ke file utama SAAT `copyFileSync` membaca → salinan bisa **korup** (half-written).
**Fail-safe yang ADA:** `integrity_check` pada salinan → korup → `BackupError` → cycle backup itu GAGAL (ter-log, exit 1), **tak ada file korup menyamar sebagai backup baik**. Jadi bukan silent-corrupt; dampak = occasional missed cycle di bawah beban tulis konkuren.
**Remedi (saat M5.2 LIVE / wiring backup):** upgrade mekanisme salin ke **SQLite online backup API** (`better-sqlite3` `db.backup(dest)`) — concurrency-safe by design (page-by-page dengan lock benar), hilangkan race. Sudah di-flag komentar `backup.ts` sejak M5.1. Butuh `backupDatabase` async (atau varian async terpisah untuk jalur daemon). **Verifikasi LIVE:** jalankan backup berulang saat daemon aktif menulis → integrity_check konsisten OK. **Sumber:** tier-1 review M5.1/M5.2 (Opus), 17 Jul.
</details>

### F-1 — RC-1 memperkenalkan loop re-spawn (continue-job landing di sesi hasil-resume yang exit cepat) [P2] ✅ (16 Jul, Opsi B guard)
**RESOLVED (16 Jul, Opus inline Tier-1, keputusan owner = Opsi B tanpa migrasi).** Guard di cabang exited
`supervisor.ts` (SEBELUM cwd/cli_session_id/resume-by-id): `if (session.resumed_from !== null && session.detected_at === null)`
→ `markBlocked` + event `job_dispatch_error {action:'continue_target_exited', reason:'resume_target_exited_before_continue',
status:'BLOCKED'}` + `return 'done'` (TAK re-spawn). **Semantik dua kolom yang menjamin guard tak menyasar siklus SEHAT:**
`markLimitHit` MENGISI `detected_at` (episode limit nyata); `markRunningAfterInject` me-NULL-kannya HANYA di jalur alive
(`proc_state` tetap 'alive' → tak pernah capai cabang exited) → sesi rantai-resume yang benar kena limit lalu exit punya
`detected_at` terisi → lolos guard → resume-by-id sah. Sesi asal biasa (`resumed_from === null`, `acca run`) tak tersentuh.
**Loop-sever tak bergantung `markBlocked`** (bila status sudah EXITED terminal → no-op, tapi `spawnResume` tetap tak dipanggil
+ `return 'done'` → rantai putus; event tetap meng-audit). Firewall utuh (field terkontrol). **+1 test** (F-1: continue-target
`resumed_from` set + `detected_at` null + EXITED → spawnResume NOT called + BLOCKED + no pending job). Tier-1 self-review PASS
(blind-spot penulis=reviewer di-flag: guard implisit, dimitigasi komentar + test yang mengunci semantik). **Detail historis di bawah.**
**Sumber:** review independen F-1.

<details><summary>Detail temuan asli (CONFIRMED)</summary>

**CONFIRMED (verifikasi Opus ke `supervisor.ts:286–398`, 16 Jul).** RC-1 enqueue job continue (`kind:'resume'`, +15s)
untuk sesi hasil-resume. Bila sesi itu **exit <15s** (paling mudah CC — hook `SessionStart` mengisi `cli_session_id`
di startup) → job continue fire → `proc_state==='exited'` → masuk lagi cabang resume-by-id (cwd ada + cli_session_id
ada) → `spawnResumeFn` spawn sesi BARU → RC-1 enqueue continue lagi → **loop ~tiap 15s, tak terbatas**. `MAX_DISPATCH_ATTEMPTS`
**hanya** menjaga jalur `spawnFailed` (baris 340), **bukan** spawn-sukses-lalu-crash — tiap iterasi sesi+job baru `attempts=0`,
retensi never-purge → tabel membengkak + notif RESUMED berulang. Pra-RC-1 loop ini tak ada. Blind-spot penulis=reviewer
(guard FK-loop G-39 ada; guard spawn-loop tidak). **Remedi (pilih owner):** (a) job continue diberi **intent berbeda**
(mis. `kind:'continue'`) yang saat landing di sesi non-alive → surface/terminal, TAK re-resume (rekomendasi — sever di akar
semantik: continue hanya bermakna utk sesi alive); (b) depth-cap rantai `resumed_from`; (c) wariskan `attempts` ke job
continue supaya `MAX_DISPATCH_ATTEMPTS` mengikat rantai. **Sumber:** review independen F-1. **Slice Tier-1 state-machine.**
**Rekonsiliasi remedi (audit doc §Remediasi, konvergen dgn Opus):** rekomendasi = **Opsi A `kind:'continue'`** (JobKind baru +
migrasi rebuild `scheduled_jobs` widen CHECK + handler dispatch `continue`: alive→`injectAlive` helper, exited→`continue_target_exited`
warn TANPA re-resume; loop mustahil by-construction). **Opsi B (tanpa migrasi, ~6 baris):** guard cabang exited
`if (resumed_from !== null && detected_at === null)` → BLOCKED (`detected_at` null = crash vs terisi = siklus-limit sehat;
`markRunningAfterInject` NULL-kan `detected_at` hanya di jalur alive → tak pernah capai cabang exited → guard sahih). **Owner
memilih Opsi B (16 Jul).**
</details>

### F-2 — Gap test: cabang best-effort FK RC-1 (`resume_continue_enqueue_failed`) tak diuji [P2] ✅ (16 Jul)
**RESOLVED (16 Jul, bareng F-1).** Properti anti-loop inti RC-1 — "enqueue gagal JANGAN flip dispatch ke `'retry'`" (G-39,
alasan seluruh try/catch ada) — kini punya test regresi. **+1 test** (F-2/G-39): `spawnResume` stub balikan `sessionId`
**tanpa** membuat baris → FK (`scheduled_jobs.session_id→sessions.id`, `foreign_keys=ON`) throw di RC-1 enqueue → assert
dispatch tetap `'done'` + sesi lama `RESUMED` (`markResumed` jalan sebelum enqueue gagal) + tak ada job retry (loop tak
berlanjut) + event `resume_continue_enqueue_failed` ter-emit dgn `newSessionId`. **Sumber:** review independen F-2.

### F-3..F-6 — nits RC-2/RC-3 [P3, non-blocking]
- **F-3 (RC-2):** ✅ (17 Jul, autonomous-run, Opus inline Tier-1). Validasi UUID kini DITEGAKKAN di jalur PAKAI —
  guard `isCanonicalUuid(session.cli_session_id)` di cabang resume-by-id `supervisor.ts` (SETELAH cek `cli_session_id`
  absen, SEBELUM `adapter.resumeCmd` yang menaruh id ke argv `claude --resume <id>` / `agy --conversation <id>`);
  non-UUID → `markBlocked` + event `job_dispatch_error {action:'blocked', reason:'cli_session_id_malformed', status:'BLOCKED'}`
  + `return 'done'` (terminal, tak retry-spin). TAK PERNAH menolak nilai sah (kedua adapter produksi = UUID-kanonik:
  agy `matchAgyResumeId` anchored; CC hook `SessionStart` di-gate RC-2). Firewall struktural di batas actuation
  (payload tak echo id). **+1 test** (exited + cli_session_id non-UUID → BLOCKED + NO spawn). Fixture uji lama yang
  memakai id palsu non-UUID (`cc-uuid-*`) diganti UUID kanonik (lebih setia ke produksi). **Sumber:** review independen F-3.
- **F-4 (RC-3):** residual pembajakan capturer — kill sebelum agy cetak resume-cmd → uuid palsu (match terakhir) menang.
  Melekat ADR-013; last-match-wins tetap > latch-first (bukan regresi).
- **F-5 (RC-3):** efisiensi — early-return dihapus → `stripAnsi`+regex atas residual ≤64KB tiap chunk seumur-hidup sesi agy.
- **F-6 (RC-3):** emit-on-change bisa `setCliSessionId`/`append` berkali-kali bila output banyak uuid distinct (spam log, bukan korektness).
**Sumber:** review independen F-3..F-6.

### I-30 — Reset clock-wrap: reset dari output-scrape yang sudah lewat di-wrap +24 jam, padahal probe tahu reset benar [P2] ✅ (16 Jul, guard estimator recent-past)
**RESOLVED (16 Jul, Opus inline Tier-1, keputusan owner = guard estimator recent-past, tanpa plumbing).**
`reset-estimator.ts` `resolveClockTime` kini kembalikan `{instant, recentlyPast}`: clock-time hari ini yang `<= now`
TAPI lewat ≤ `RECENT_PAST_HORIZON_MS` (**2 jam**, konservatif < window 5-jam) → `recentlyPast=true` → `estimateReset`
jadwalkan probe **near-now** (`now + 60s`, source `heuristic`) alih-alih wrap +24 jam. Lewat > horizon → tetap wrap besok
(DST-correct, occurrence sah, source `exact`). `clockTime` hanya HH:MM am/pm tanpa hari → memang untuk reset window pendek →
banner tak mungkin cetak jam 2j-lewat untuk reset besok (implausible) → horizon aman. Self-correcting (probe +60s bounded).
**+4 test** (UTC recent-past 11m; boundary 2j PAS = recent-past; 2j1m = wrap exact; IANA 30m recent-past) + **2 test DST-wrap
di-update** `now`=target+3h (tetap validasi wrap DST-correct, di luar horizon). **Sumber:** live-verify I-15 CC full-loop 16 Jul.

<details><summary>Detail temuan asli</summary>

**Live-verify 16 Jul (T-4):** pasca re-LIMIT_HIT via output pada 22:31, `extractResetHint`/reset-estimator parse
"resets 10:20pm" (10:20pm sudah lewat) → "next occurrence" = **BESOK 22:20** (`resetSource:"exact"`, G-13 class),
padahal `usage_snapshot_claude.resetAt` acca = **22:20 malam ini** (benar). → auto-continue terjadwal **24 jam meleset**.
**Remedi:** (a) prioritaskan `resetAt` absolut dari probe/snapshot atas clock-time output (unambiguous > ambigu-arah);
(b) clock-time yang **sudah lewat** jangan otomatis wrap ke besok bila konteks (probe reset baru saja) menunjukkan reset
tadi — anggap "baru saja reset". **Sumber:** live-verify I-15 CC full-loop 16 Jul.
</details>

### I-31 — G-37 terkonfirmasi live: repaint baris limit lama pasca-inject re-fire LIMIT_HIT palsu [P2] ✅ (16 Jul, grace-window OUTPUT-CC)
**RESOLVED (16 Jul, Opus inline Tier-1, keputusan owner = CC-only grace).** `limit-watcher.ts`: pasca `unlatch()`,
sinyal limit dari **OUTPUT** untuk sesi **CC** dalam `POST_UNLATCH_OUTPUT_GRACE_MS` (**5s**) → **diabaikan** (audit-only
`limit_suppressed`, TAK melatch → sinyal SAH setelah window tetap fire). Repaint banner limit LAMA CC (ber-`\n`) pasca-inject
= FP yang disuppress. **Kunci CC-only + OUTPUT-only:** (a) re-limit CC SAH datang via `feedSignal` (hook StopFailure = deteksi
PRIMER, I-23) yang **TAK** disuppress → tetap fire seketika; (b) **agy TAK tersentuh** → re-limit langsung ADR-019 optimistic
("\bIndividual \bquota reached") tetap terdeteksi (immediate detect utuh); (c) genuine CC cycle-2 via output (fallback tanpa hook)
selalu > window → tetap fire. Clock di-inject (deterministik test, purity engine utuh); wrapper feed `nowMs` + audit event
(field terkontrol, firewall G-9 utuh). **+3 test** (repaint suppress + hook tak-disuppress + agy tak-disuppress) + **1 test R3
di-update** (cycle-2 CC output kini setelah advance clock > grace — genuine cycle-2 selalu jauh kemudian).
**+1 PTY-integration test (`run.integration.test.ts`, live TANPA limit):** replay byte banner limit CC nyata lewat **PTY nyata +
wrapper PRODUKSI + control socket nyata** — child "CC palsu" cetak banner (→LIMIT_HIT#1) → **inject-continue via socket nyata**
(idle-gating lulus) → `onInjected`→`markRunningAfterInject`+`unlatch` → child repaint banner → **`limit_suppressed` (BUKAN
LIMIT_HIT#2)**. Menutup gap wiring yang di-stub unit test (`nowMs`→watcher · `onData`→`feedOutput` · socket-inject→`unlatch`).
**Negative-control terbukti:** grace dimatikan → test GAGAL (2 LIMIT_HIT, 0 suppressed) → bukan lolos-vakum. Stabil 3× run (~1.6s).
Yang tetap opportunistik (kelas I-15): repaint CC di limit **nyata** byte-identik replay — byte itu sudah dari capture live 16 Jul.
**Sumber:** live-verify I-15 CC full-loop 16 Jul, G-37.

<details><summary>Detail temuan asli</summary>

**Live-verify 16 Jul (T-3):** detik yang sama dengan inject-continue (`unlatch` R3), `LIMIT_HIT {source:"output",
evidence:CC_LIMIT_PATTERNS[3]}` muncul — indikasi kuat **repaint banner limit LAMA** di TUI CC mengalir lewat
`onData` ber-newline → limit-watcher (baru di-unlatch) klasifikasi ulang sbg limit BARU. Residual G-37/R3-I-21 yang
selama ini teoretis → nyata. **DIKONFIRMASI FALSE-POSITIVE (owner):** CC (Terminal B) jalan normal & selesaikan kerja
pasca-inject → banner LAMA yang di-repaint, bukan limit baru. **Dampak korektness:** sesi ter-tandai LIMIT_HIT palsu +
job probe bogus dijadwalkan (interaksi I-30 → +24 jam) → bila daemon hidup saat itu & sesi sudah EXITED, bisa memicu
resume-by-id tak diinginkan (keluarga F-1). **Remedi (kandidat):**
(a) grace-window pasca-unlatch (abaikan match limit untuk N ms/baris setelah inject); (b) require ≥1 baris output BARU
non-banner sebelum re-latch; (c) korelasi dgn probe (bila probe baru saja usage_available, tolak re-LIMIT_HIT output
dalam window pendek). **Sumber:** live-verify I-15 CC full-loop 16 Jul, G-37.
</details>


### I-20 — Capture `cli_session_id` (R2b, penangkap id CLI untuk resume-by-id) [P1, blocker M-remote] — ✅ agy + CC TUNTAS (12 Jul)
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
  terbukti (`agy --conversation=<id>` memuat percakapan lama).
- **✅ WIRING agy DITUTUP (12 Jul, sesi ini):** capture di-wire ke `setCliSessionId`. `matchAgyResumeId` (patterns,
  UUID-anchored konservatif) → `antigravityAdapter.captureSessionId` → engine murni `daemon/session-id-capture.ts`
  (buffer/strip-ANSI/scan, latched single-fire, tangani baris parsial-tanpa-newline + uuid terbelah antar-chunk) →
  wrapper `runSession` feed `onData` → `setCliSessionId(id, cliId)` + event `cli_session_id_captured`. CC TIDAK memakai
  jalur output (`captureSessionId` undefined) → capturer tak dipasang. **+13 test** (pattern + engine + integrasi PTY
  nyata yg cetak baris G-36 → id terpersist). **Efek: resume-by-id agy exited kini punya id nyata → tak lagi BLOCKED**
  (mengisi paruh korektness R2a untuk agy).
- **✅ LIVE-VERIFY agy DITUTUP (12 Jul, agy 1.1.1, otorisasi user):** spawn agy nyata → 1 turn → Ctrl-C 2× → agy cetak
  `agy --conversation=<uuid>` → **kode capture produksi menangkap uuid persis** yang dicetak (`0c384fd6…`), regex cocok
  format nyata (G-36 anotasi). Jalur produksi tercakup: capturer-vs-agy-nyata ✅ + glue `runSession`→DB-vs-fixture ✅
  (integrasi). Resume-load = G-36 (11 Jul).
- **✅ PARUH CC DITUTUP (12 Jul, I-23, LIVE-VERIFIED CC 2.1.207, otorisasi user):** sumber id CC = payload hook
  **`SessionStart`** (bukan jalur output — `captureSessionId` CC tetap `undefined`). Wrapper generate settings hooks →
  `claude --settings <file>` → SessionStart fire → forwarder `acca __hook <id>` → socket kontrol → `setCliSessionId`.
  **Live production:** `acca run claude` → sesi acca `7vem` dapat `cli_session_id=fd55a7d2-…` (= nama transcript jsonl,
  G-34 → id `--resume` sah) + event `cli_session_id_captured{source:hook_sessionstart}`. **I-20 TUNTAS (agy + CC).**
  Detail hook = I-23 (Tertutup).

### I-22 — agy resume-by-id sesi MATI [P1] — ✅ RESOLVED via **ADR-019 optimistic resume** (12 Jul; ADR-018 opsi #3 GUGUR)
Job `probe` agy pada sesi `exited` → PID mati → tak ada LS → probe-via-LS mustahil. **Riwayat:** ADR-018 (11 Jul)
memilih probe standalone OAuth `retrieveUserQuota` (+refresh `oauth2.googleapis.com`); slice 1 (guard `probe_impossible`
→ BLOCKED) ditutup lebih dulu.
- **✅ LIVE-VERIFY 12 Jul (R4 slice 2, otorisasi user) MEMBANTAH ADR-018:** refresh token gemini-cli **200** +
  `retrieveUserQuota` **200**, tapi isinya = **kuota request harian per-model gemini-cli Code Assist** (`buckets[].{modelId,
  tokenType:REQUESTS,remainingFraction,resetTime}`; gemini 100%, reset ~24j), **BUKAN** limit grup weekly+5h yang agy tegakkan.
  Bukti serentak: OAuth gemini **1.0** vs LS `RetrieveUserQuotaSummary` gemini-5h **0.079**; Summary via OAuth = **403**.
  Kredensial gemini-cli disk fundamental tak bisa baca limit grup agy (G-38). → **probe standalone tak bisa menggerbang
  resume agy = bug korektness bila diteruskan.**
- **✅ RESOLVED — ADR-019 (men-supersede ADR-018): optimistic resume + detect.** `supervisor.ts` cabang `probe`:
  `tool===antigravity && proc_state===exited` → **enqueue `resume` langsung** (skip probe) + event `job_dispatch_done
  {action:'optimistic_resume_agy_exited'}` + `return 'done'`. Sesi hasil-resume = **alive** (daemon pegang PTY) → siklus
  limit berikutnya probe-able via LS normal; bila masih limit → `\bIndividual \bquota reached` (limit-watcher, G-19) → LIMIT_HIT
  → reschedule di reset_at (cap B-1). Guard slice-1 (`probe_impossible`/BLOCKED) DIGANTI jalur ini. **Egress:**
  `oauth2.googleapis.com` tak pernah masuk kode + `cloudcode-pa.googleapis.com` (opsi #3, tak dipakai) **dihapus** dari
  allowlist (least-privilege). **CC tak kena** (probe CC = HTTP `api.anthropic.com` baca limit CC nyata standalone). Firewall
  G-9 utuh. **369 test** hijau (supervisor-dispatch agy-exited→optimistic-resume di-rewrite; http-egress oauth2/cloudcode
  kini diblokir). **Trade-off diterima:** ≤1 resume "sia-sia" per siklus masih-limit (bounded reset_at). **Sumber:** audit
  A-4, ADR-018→ADR-019, G-38. **✅ Cleanup dilakukan (12 Jul, `a82a372`):** mapping `PROBE_IMPOSSIBLE` + union member +
  test tak-terjangkau **DIHAPUS** (dead-code — supervisor emit `optimistic_resume_agy_exited`, nol pemanggil `probe_impossible`).

### I-26 — DACL named pipe Windows terbuka (ADR-015 "owner-only" KELIRU) [P2] → KEPUTUSAN via ADR-023 (17 Jul); verifikasi hardening di M5.3/M5.5
Named pipe Node/libuv default **bisa di-connect user lain** di mesin sama (DACL bukan owner-only spt chmod 0600).
`status` bocorkan daftar cwd; `inject` bisa dipicu pihak lokal (dibatasi: token literal tanpa payload). Single-user
desktop = risiko rendah; node headless multi-akun (ADR-007) = relevan.
- **✅ VERIFIKASI WEB 17 Jul (spec M5, sumber primer) — pertanyaan "apakah terbuka" TERTUTUP: PASTI terbuka by Node design.**
  Node/libuv named pipe = DACL default Windows (**Everybody + Anonymous Logon** generic read; user non-elevated saat ini
  read+write) + **Node tak punya API set-DACL** (issues nodejs/node #47086/#30823/#17743, terbuka bertahun — mengubah DACL
  mustahil tanpa native addon). Kandidat lama **"cek PID same-session-user" GUGUR** — PID named pipe **spoofable** (Google
  Project Zero, CVE-2018-0749 kelas; Microsoft menyarankan JANGAN pakai PID sbg enforcement) → mitigasi palsu (G-41).
- **✅ KEPUTUSAN (ADR-023, owner Ziffan 17 Jul):** DACL terbuka **DITERIMA sbg residual risk (R-5, THREAT-MODEL §8)** +
  **hardening lapisan-app** (minimalkan data sensitif lewat pipe; hanya daemon mutasi state ADR-017; injection firewall
  `inject`-tanpa-payload utuh; audit `events`). **Native addon set-DACL DITOLAK** (over-engineering solo-user). Klaim
  keamanan ADR-015 di-scope-ulang.
- **Sisa (verifikasi di M5):** bukan lagi "apakah terbuka" (sudah tahu) tapi **perilaku hardening** — M5.3 (`status`
  data-minimize + firewall test), M5.5 (service). Node headless multi-akun → mitigasi deploy = akun OS khusus daemon (R-5).
**Sumber:** audit A-8 + verifikasi web spec M5 (17 Jul), ADR-023, G-41.

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
- **Deteksi limit (jalur produksi):** pesan TUI `\bIndividual \bquota reached` NYATA di 1.1.1 → `matchAgyLimit` +
  `antigravityAdapter.detect` fire benar (`{kind:'limit',source:'output'}`). **limit≠exit** dikonfirmasi (agy hidup di
  prompt). (G-19 re-verified, G-33 dikoreksi.)
- **Resume-by-id (paruh load):** `agy --conversation=<id>` **memuat percakapan lama utuh** di sesi baru, hidup di prompt
  (G-36). Sumber id andal = cmd yang agy CETAK saat exit.
- **SISA (genuinely butuh tunggu reset / sesi asli):** (a) **inject `continue` pasca-reset benar melanjutkan turn** —
  butuh 3p-5h reset (~5 jam) lalu inject; belum. (b) **penanda busy agy mid-turn ✅ DITANGKAP (12 Jul, Sub-task B)** +
  **✅ idle-tracker-agy DIIMPLEMENTASI (12 Jul, sesi berikut):** `BUSY_MARKERS.antigravity = /esc to cancel/i` di
  `shared/idle-tracker.ts` (hanya `esc to cancel` — `Generating`/`Working` terselang spinner braille di stream nyata,
  tak dipakai); wiring inject sudah tool-generik (I-13) → agy ter-gate otomatis (busy→`proc_not_idle`, idle→lolos).
  **+7 test**, Tier-1 self-review PASS (firewall utuh, semantik lebih ketat = errs-safe). **Sisa (b) = HANYA live-verify
  gating PTY nyata** (butuh user + limit). (c) **CC** (`claude`) limit asli + inject/resume tetap
  opportunistik (belum). **Efek:** gate keluar I-15 untuk **deteksi+resume-load agy** = LULUS; sisa = actuation inject
  pasca-reset (agy+CC). **Sumber:** I-15 live-verify 11 Jul (scratchpad `agy-*.mjs`).

**✅ TEMUAN TOKEN (16 Jul, agy 1.1.3 + CC 2.1.211, otorisasi user → ADR-020 + G-40):** live-verify actuation inject
membuka temuan material tentang **poin (a)** di atas. Mekanisme inject **terbukti benar** (`injected:true`, keystroke sampai
ke agy via jalur produksi `requestInject`→wrapper→gating→PTY). **TAPI token `'continue\r'` TAK me-resume agy** — agy
menafsirnya pesan NL baru ("I do not have context…"/"more of same"), bukan resume turn (tak punya primitif resume-turn utk
satu kata). **Bukti penentu (limit ASLI owner, sesi sama):** kalimat eksplisit "lanjutkan pekerjaan, tadi terhenti karena
limit" → **agy DAN CC langsung melanjutkan pekerjaan terhenti**. → **`CONTINUE_TOKEN` diganti** ke instruksi NL eksplisit
`'continue the work that was interrupted by the usage limit\r'` (ADR-020, English, owner; literal-tetap → injection firewall
utuh; +1 test guard regresi). **Delta versi tercatat:** agy 1.1.1→1.1.3, CC 2.1.207→2.1.211 (patch; **G-33 `esc to cancel` +
G-36 resume-cmd re-confirmed holds @1.1.3**). **SISA I-15 (opportunistik, reversible):** live-verify literal **English**
pasca-reset agy nyata benar me-resume (yang terbukti owner = frasa Indonesia; English = variasi risiko-rendah) + CC limit
asli. **Sinyal positif English (16 Jul):** inject token English → agy balas *"**Resuming Our Work**. I do not have the
context from your previous session. Please explain… the work that was interrupted so we can continue."* → agy **mengenali
instruksi sebagai resume** (mencari konteks-terputus) — beda dari "continue" telanjang yang dulu → "more of same". Konsisten
pengalaman limit-nyata owner. **Proxy Esc-cancel GAGAL menyediakan konteks-terputus:** prompt esai scripted tak submit di TUI
agy (FASE-3 `esc to cancel` timeout 2× walau readiness-gate sudah diperbaiki) → tak ada turn terputus saat inject → end-to-end
"token me-resume pekerjaan NYATA" = **tetap butuh limit asli** (opportunistik). **Sumber:** I-15 live-verify token 16 Jul (`esc-cancel.log`).

**✅ PARUH CC DETEKSI + ACTUATION-FIRE TERTANGKAP pada LIMIT ASLI (16 Jul full-loop, `docs/audit/LIVE-VERIFY-I15-CC-2026-07-16.md`):**
sesi review ter-wrap `acca run claude` (`6eum`) kena limit 5-jam CC ASLI → (T-1) **`StopFailure rate_limit` jalur PRIMER fire**
→ `LIMIT_HIT {source:"stopfailure"}` @22:06 (menutup paruh CC "tak bisa dipaksa" — bukan output-scrape); (T-2) probe→
usage_available→enqueue resume→**inject-continue SUKSES** ke PTY CC ter-limit @22:31 (`status RUNNING reason:inject_continue`);
(T-3) **outcome dikonfirmasi owner: CC MELANJUTKAN kerja terputus & menyelesaikannya** (rencana remedi) via jalur produksi
penuh → **paruh CC I-15 (deteksi + actuation OTOMATIS end-to-end) = ✅ LULUS.** Residual yang HARUS ditutup (mengotori
state/jadwal, bukan blok bukti): **G-37 re-fire palsu → sesi ter-LIMIT_HIT palsu pasca-resume (I-31)** + **reset clock-wrap
→ probe salah +24 jam (I-30)**. `cli_session_id` CC via `hook_sessionstart` (I-20/I-23) juga re-confirmed live.
**Sumber:** live-verify full-loop 16 Jul.

### I-8 — Monitor proaktif "mendekati limit" (proximity) dari usage-probe [P2 ✅ DITUTUP 18 Jul — wiring I-17 + dedup rising-edge]
**✅ RESOLVED (18 Jul, Opus inline Tier-1, 621 test).** Dua bagian: **(1) Wiring (I-17) sudah ada** — `usage-monitor.ts`
(engine loop probe periodik) + `createUsageMonitor` di `supervisor.ts` (opt-in `startUsageMonitor`) + `daemon.ts` menyalakan
(`startUsageMonitor: true`, interval `DEFAULT_USAGE_PROBE_INTERVAL_MS`=120s) + 2 file test (`usage-monitor.test.ts` engine,
`usage-monitor-wiring.test.ts` integrasi supervisor↔probe↔meta↔notify). Ini **sudah ter-commit** sebelum sesi ini; ISSUES
belum ditandai (docs drift) → dikoreksi sekarang. **(2) Gap nyata ditutup — spam notif (G-54):** `proximityNotifications`
stateless di-deliver **tiap tick** selama sesi bertahan di atas ambang (sesi 1 jam @95% → ~30 notif identik). Fix:
**`createProximityGate`** (rising-edge dedup, state per `(tool, kind)`) — notif hanya saat window BARU melewati ambang;
turun/reset/exhausted → clear key (per-tool scoped) → crossing berikutnya re-notify. Satu gate hidup lintas-tick di monitor.
Threshold logic tetap SATU tempat (`proximityCandidates`, dipakai fungsi stateless & gate). **+5 test** (4 gate: crossing→notif,
repeat→suppress, drop-recross→re-notify, exhausted-clear, per-tool/kind independensi; 1 monitor multi-tick dedup). **Negative
control terbukti** (bypass gate → deliver 3× di test multi-tick). Firewall G-9 utuh (body tetap tool/kind/persen). US-13
(prediksi proaktif) + indikator proximity di `acca status` tetap backlog terpisah (bukan bagian I-8). **Sumber:** wiring I-17
(ter-commit) + gap spam ditutup 18 Jul.

<details><summary>Konteks temuan asli</summary>
Claude Code menampilkan warning ~90% (window 5-jam) & ~75% (mingguan) di terminal, tapi itu **UI-only,
tak di-persist** (G-15) → jangan scrape. Sinyalnya sudah tersedia via usage-probe: `usedFraction` (parser
M3c). **ENGINE SELESAI (10 Jul, `src/notify/notifier.ts`):** `proximityNotifications(snapshot, thresholds)`
MURNI — ambang default **0.90 five_hour / 0.75 weekly** (meniru CC), klasifikasi window weekly (`/week/i`|
`seven_day`) vs 5h (session/five_hour/5h/label-model agy), exhausted (usedFraction=1)=wilayah LIMIT_HIT→dilewati;
body tanpa PII (G-9). 6 test cabang hijau. **WIRING DITUNDA → I-17:** proximity baru bermakna saat sesi AKTIF
dipakai; probe yang ada hanya jalan saat reset (usedFraction rendah di sana) → butuh loop probe periodik saat
RUNNING. Basis fitur US-13 (prediksi proaktif, backlog) + indikator proximity di `acca status` (M4 status-UX).
</details>

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

### B-3 — Sukses resume-by-id disimpulkan dari "spawn tak gagal SINKRON" [P3, watch → I-15/R2b]
`spawnFailed` (R1) hanya menangkap kegagalan **sinkron** (binary hilang). CLI yang spawn sukses lalu **exit
seketika** (arg ditolak, creds rusak, `--resume` id kadaluarsa) tetap membuat dispatch `markResumed` sesi lama +
notif "resumed" PALSU; kegagalan hanya terlihat sebagai sesi baru EXITED non-nol. Risiko mengecil pasca-R2a
(id benar-atau-BLOCKED) tapi kelas kegagalan lain tetap ada. **Remedi (gabung I-15/R2b):** observasi jendela
pendek pasca-spawn (exit <3s + code≠0 → perlakukan `resume_spawn_failed`) ATAU tunda `markResumed` sampai output
pertama sesi baru mengalir. **Putuskan bentuknya saat live-verify** — jangan spekulasi penanda sebelum ada data
nyata (pola G-33/idle-agy). **Sumber:** audit followup B-3.

### C-4 — `proc_state` basi ('alive' padahal wrapper mati keras) menghidupkan lagi retry-senyap A-4/B-1 [P2] ✅ (16 Jul, RC-4)
**RESOLVED (16 Jul, Opus inline Tier-1).** Dua bagian: **(1) reconcile liveness DI AWAL dispatch** (`reconcileDispatchLiveness`,
dipakai di kedua cabang probe+resume): `proc_state==='alive' && pid && !isProcessAlive(pid)` → `markOrphanExited`
(proc_state→'exited', status LIMIT_HIT DIPERTAHANKAN) + event `job_dispatch_reconcile{action:'orphan_reconciled_at_dispatch'}`
→ cabang exited menangani: **agy** → `optimistic_resume_agy_exited` (ADR-019, tak lagi `discoverLocalPorts(pid mati)` throw);
**CC** → resume-by-id (bukan inject ke wrapper mati → auto-recovery, bukan buntu manual). Menutup celah bahwa `reconcileOrphans`
hanya jalan di `start()` (wrapper mati SETELAH start tak ter-cek). **(2) attempts-cap pada catch generik** (RC-4): error
tak-terduga dulu SELALU `'retry'` tanpa baca `job.attempts` → backoff 60m selamanya senyap; kini di batas
`MAX_DISPATCH_ATTEMPTS` → `markBlocked` + `dispatch_gave_up{status:BLOCKED}` + `done`; di bawah batas → retry (transien).
Reconcile = fix primer (agy), attempts-cap = backstop (defense-in-depth). Residual pid-recycle = sama I-1 (diterima).
**+4 test** (reconcile agy-probe→optimistic + CC-resume→resume-by-id [requestInject TAK dipanggil] + attempts-cap batas→BLOCKED +
di-bawah-batas→retry; harness `beforeFire` set pid mati SETELAH start supaya reconcile DISPATCH yang diuji, bukan `start()`).
**Sumber:** audit ketiga C-4.

<details><summary>Detail temuan asli</summary>
`reconcileOrphans` hanya dipanggil di `supervisor.start()` — daemon long-running TAK re-cek liveness; wrapper
yang mati keras SETELAH start meninggalkan `proc_state='alive'` + job pending. **agy:** probe sesi "alive" palsu
→ `discoverLocalPorts(pid mati)` throw → **catch generik → `'retry'` TANPA attempts-cap & TANPA notif** (payload
tanpa `status:BLOCKED` → notifier null) → backoff 60m selamanya senyap (pola A-4 lewat pintu lain, B-1 hanya tutup
cabang spesifik). **CC:** probe sukses → inject wrapper unreachable → `inject_skipped` (ter-surface) tapi buntu
manual padahal auto-recovery bisa (pid mati + cli_session_id ada → resume-by-id). **Remedi (RC-4, sedang):** di awal
dispatch cek `proc_state==='alive' && pid && !isProcessAlive(pid)` → `markOrphanExited` → jalur `exited`; + attempts-cap
pada catch generik (tutup KELUARGA retry-senyap). **Sumber:** audit ketiga C-4. **Rekomendasi:** sebelum M5 (daemon jalan berhari-hari).
</details>

### C-5 — Probe LS agy sesi ALIVE = snapshot launch-time beku (G-35) → gate `still_limited`/`usage_available` agy-alive berbasis data basi [P3] → RC-5
ADR-019 menutup agy-**exited** (optimistic); agy-**alive** masih pura-pura probe-nya bermakna (self-correcting via
inject→detect R3, tapi event `usage_available_enqueue_resume` menyesatkan audit-trail). **Remedi:** perlakukan agy-alive
konsisten ADR-019 (skip probe stale → langsung enqueue resume di reset_at) ATAU minimal tandai `reason:'ls_snapshot_stale'`.
**Sumber:** audit ketiga C-5, G-35.

### C-6 — Pesan limit agy memuat reset eksplisit (`Resets in 4h31m7s`, G-19) tapi `extractResetHint` hanya kenali `in N hours` → jatuh ke backoff [P3] ✅ (17 Jul, autonomous-run)
**RESOLVED (17 Jul, Opus inline Tier-1).** `ResetHint` diperluas `relativeMinutes`/`relativeSeconds`;
`AGY_RELATIVE_RESET_PATTERN = /\bresets?\s+in\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i` (unit RAPAT tanpa spasi —
tak keliru menangkap bentuk kata "in 5 hours") menangkap countdown kompak agy `Resets in 59m14s`/`4h31m7s` di
`extractResetHint`; `estimateReset` menjumlahkan komponen h/m/s → `now + total` (source `exact`). **Presedensi
DIPERTAHANKAN:** relatif tetap DI BAWAH `isoTimestamp` (LS-probe absolut) → sumber reset LS yang lebih andal tetap
menang saat tersedia; parse relatif hanya menggantikan **backoff sia-sia** saat output = satu-satunya sinyal
(mempersempit jendela G-37). **Reversal dicatat:** test lama `detector.test.ts` yang meng-assert "tak mengarang
resetHint dari 59m14s" (rasionalisasi 4 Jul "reset andal = LS probe") diganti — komentar fixture `agy-limit.txt` +
G-19 direkonsiliasi. **+6 test** (2 detector parse+estimate-with-iso-precedence, 4 estimator kombinasi h/m/s +
presedensi iso/clockTime). **Sumber:** audit ketiga C-6.

### C-7 — Empty-state `acca status` masih sarankan `acca run -- <cli>` (bentuk pra-I-29) [P3] ✅ (17 Jul, autonomous-run)
**RESOLVED (17 Jul, Opus inline).** Empty-state `status.ts` kini `Belum ada sesi. Jalankan: acca run <claude|agy>`
(bentuk post-I-29; `--` tak lagi wajib/dipakai). Sweep string bantuan lain: doc-comment `UnknownToolError`
(`adapters/index.ts`) contoh `acca run -- foo` → `acca run foo`. Tak ada tempat lain memakai bentuk `run -- <cli>`.
String UX di `console.log` sengaja TAK dikunci test (brittle, low-value P3). **Sumber:** audit ketiga C-7.

---

## Tertutup

### C-1 — Resume-by-id MEMUAT percakapan tapi tak MELANJUTKANNYA (nol inject `continue` ke sesi hasil-resume) [P1] ✅ (13 Jul, RC-1)
**RESOLVED (RC-1, Opus inline Tier-1).** `claude --resume <id>` / `agy --conversation=<id>` memuat percakapan lalu
**diam di prompt** (bukti live G-36) — tak ada jalur kode meng-inject `continue` ke sesi HASIL-resume → US-3/AC-3 gagal
separuh (sesi ditinggal tidur "resumed" tapi tak lanjut kerja). Juga melemahkan paruh "detect" ADR-019 (sesi yang cuma
di-load tak mencetak `\bIndividual \bquota reached` → LIMIT_HIT tak terpicu). **Fix (`supervisor.ts` cabang resume, pasca
`resume_spawned`):** enqueue job `resume` untuk sesi BARU (`spawned.sessionId`, `run_at = now + RESUME_CONTINUE_DELAY_MS`
15s) → sesi baru RUNNING+alive → dispatch **jalur alive yang ada** meng-`requestInject` (gating idle/foreground, token
literal di wrapper — **nol kanal baru, injection firewall ADR-013 utuh**). Bila masih limit (agy optimistic ADR-019):
inject memicu `\bIndividual \bquota reached` → limit-watcher sesi BARU → LIMIT_HIT → reschedule reset_at → siklus "detect"
berjalan seperti didesain. Enqueue **best-effort** (try/catch + event `resume_continue_enqueue_failed`): kegagalan FK
(baris sesi baru belum ada — tak terjadi pada default `runSession`) tak boleh flip dispatch ke `'retry'` (cegah re-spawn
loop). **+1 test kontrak** (`supervisor-dispatch`: siklus penuh exited→spawn→continue-enqueue→fire→requestInject sesi
BARU). **Nit (→ I-15):** bila CLI tak idle dalam 15s, continue job di-skip (`inject_skipped`→done, tanpa retry) → strict
improvement atas pre-RC-1 (nol inject), kalibrasi delay = live-verify. **Sumber:** audit ketiga C-1.

### C-2 — Kanal `hook` simpan `ccSessionId` tanpa validasi → string arbitrer bisa jadi argv `claude --resume <val>` [P2] ✅ (13 Jul, RC-2)
**RESOLVED (RC-2).** `hook-relay.ts` dulu guard hanya `typeof string && length>0`; nilai tersimpan ke `cli_session_id`
lalu dipakai `resumeCmd` → `['--resume', <val>]`. Permukaan: named pipe Windows ber-ACL terbuka (I-26/A-8) → proses lokal
lain bisa menulis payload hook (kanal DATA sejak I-23). **Fix:** helper `isCanonicalUuid` (`shared/ids.ts`, regex
8-4-4-4-12 case-insensitive) gate di `createHookHandler` **sebelum** capture (dan sebelum latch `!ccIdCaptured` → UUID sah
berikutnya tetap tertangkap); non-UUID → no-op senyap (konsisten kekonservatifan capturer agy). Firewall struktural, bukan
kebetulan spawn tanpa shell. **+3 test** (2 `isCanonicalUuid` + 1 hook non-UUID rejection). **Sumber:** audit ketiga C-2.

### C-3 — Capturer id agy latch pada match PERTAMA → isi transcript bisa membajak `cli_session_id` sebelum print-exit sah [P2] ✅ (13 Jul, RC-3)
**RESOLVED (RC-3).** `session-id-capture.ts` men-latch (`captured=true`) pada match pertama; sumber SAH justru dicetak agy
saat EXIT (G-36) = kandidat TERAKHIR. Capturer di-feed SELURUH output → `--conversation=<uuid>` di ISI transcript (agent
baca web/dokumen/repo, tak tepercaya per ADR-013) bisa mengunci id salah permanen (UUID valid → BLOCKED-guard R2a tak
menolong). **Fix:** latch-first → **last-match-wins** + emit-on-change (`lastEmitted`): tak pernah berhenti scan, id baru
menimpa via `setCliSessionId` (idempoten); id exit-printed (paling akhir) otomatis menang; event `cli_session_id_captured`
hanya saat nilai berubah (tak spam). **+1 test** (uuid palsu di ISI transcript lebih awal → id yang dicetak saat exit menang).
Dampak dibatasi (UUID kanonik saja, mis-resume/DoS bukan exec) tapi ditutup struktural sesuai ADR-013. **Sumber:** audit ketiga C-3.

### I-25 — Gate resume `every(usedFraction<1)` terlalu ketat untuk CC [P2] ✅ (12 Jul, R7)
**RESOLVED (Opus inline Tier-1).** Keputusan "usage available untuk resume" dipindah ke adapter
(`Adapter.isUsageAvailable?(snapshot)`), supervisor pakai `adapter.isUsageAvailable?.(usage) ?? every(<1)`.
**CC override** (`claudeUsageAvailable`, `adapters/usage.ts`): gate HANYA window mengikat — **global** (tanpa
`scope` per-model: `session`/`weekly_all` OAuth, `five_hour`/`seven_day` statusLine) + **scoped-aktif**
(`isActive===true`, model yang benar-benar dipakai). Scoped NON-aktif (mis. weekly Opus habis sementara sesi jalan
Sonnet) **diabaikan** → tak lagi memblokir resume selamanya. Tak ada window gating teridentifikasi (skema tak dikenal)
→ fallback strict `every()` (sisi aman). **agy TIDAK override** → default `every(<1)` (dual-limit per grup, SEMUA
bucket mengikat, G-31 — perilaku agy TAK berubah). **+6 test** (5 `claudeUsageAvailable` cabang: unused-scoped-exhausted→
available, global-exhausted→block, active-scoped-exhausted→block, active-scoped-free→available, fallback; 1 dispatch
regresi CC scoped-unused→enqueue-resume). Tier-1 self-review PASS (arah lebih permisif utk CC → worst-case resume-lalu-
re-detect bounded, sekelas ADR-019 optimistic). **Live-verify skenario exhaustion nyata = opportunistik (I-15-class);
shape probe CC sudah dikonfirmasi nyata di smoke I-17.** **Sumber:** audit A-7, I-15 live-verify 11 Jul (konfirmasi agy per-grup).

### I-29 — `acca run <tool> -<flag>` mis-parse commander (butuh `--` pemisah) [P3] ✅ (12 Jul)
**RESOLVED.** `acca run claude -p "…"` dulu → `error: unknown option '-p'` (commander parse `-p` sbg opsi `run`).
**Fix:** `program.enablePositionalOptions()` (index.ts) + `run.passThroughOptions()` → flag SETELAH `<tool>`
diteruskan apa adanya ke `args` (mis. `-p`/`--model`), tak lagi butuh `--`. **Back-compat:** dgn passThroughOptions
commander tak lagi menelan `--` pemisah (terbawa literal) → action buang **satu** `--` di depan supaya workaround
lama `acca run claude -- -p x` tetap setara & `--` tak keliru diteruskan ke CLI target. Eksekutor sesi dipisah jadi
`runExecutor` (injectable) → arg-parsing teruji tanpa PTY. **+5 test** (`run-command.test.ts`: short-flag/long-flag/
`--`-back-compat/no-args/tool-wajib). Sekelas G-27 (commander mis-parse) — kini tertutup untuk `run`. **Sumber:**
live-verify I-23 (12 Jul).

### I-23 — Deteksi limit CC PRIMER (hook `StopFailure`) + capture `cli_session_id` (hook `SessionStart`) [P2] ✅ (12 Jul, R6, LIVE-VERIFIED CC 2.1.207)
**RESOLVED (M3e/R6, Opus inline Tier-1, otorisasi user).** ADR-001/CLAUDE.md §7 menetapkan hook `StopFailure` matcher
`rate_limit` sbg deteksi limit CC **PRIMER** (event-driven resmi); sebelumnya hanya ada fallback output-scrape
(`limit-watcher`), `feedSignal` **nol pemanggil produksi**. Satu slice menutup DUA hal (kedua hook lewat kanal yang sama):
- **Mekanisme:** wrapper generate settings.json terisolasi (`adapters/claude-hooks.ts`, murni) → `claude --settings <file>`
  (MERGE additif — auth tetap diwarisi kredensial mesin, ADR-005; **BUKAN** `CLAUDE_CONFIG_DIR` yang meng-isolasi auth).
  Hook **exec-form** (`command`+`args[]`, tak ada shell-quoting lintas-OS) = `acca __hook <sessionId>` (perintah internal
  tersembunyi, `cli/commands/hook.ts`): baca payload JSON stdin → teruskan field terkontrol ke **socket kontrol per-sesi**
  (reuse ADR-015, bersama `inject`). Sisi-wrapper `daemon/hook-relay.ts` (`createHookHandler`, testable): **StopFailure** →
  `watcher.feedSignal({type:'stopfailure',error})` (jalur LIMIT_HIT yg sudah ada); **SessionStart** → `setCliSessionId`
  (latched sekali) → **menutup paruh CC I-20/R2b**.
- **Injection firewall (ADR-013):** `hook` = kanal DATA (beda dari `inject` = kanal AKSI tanpa payload). Data hanya mengalir
  ke (a) taxonomy `classify` yang TETAP & (b) kolom identifier `cli_session_id` — tak ada teks payload jadi keystroke/aksi.
  Forwarder best-effort (swallow error, exit 0, nol stdout → tak ganggu CC / tak suntik konteks). Settings file (bukan
  secret) di-unlink saat exit + saat spawn-gagal.
- **Verifikasi (Opus sendiri):** typecheck+lint+**368 test** (+9: `hook-relay` 4 dispatch/firewall + `claude-hooks` 4 builder/
  adapter + 1 integrasi settings-file lifecycle). **LIVE-VERIFY CC 2.1.207 (12 Jul, otorisasi user):** (1) `claude --settings`
  **diterima** (auth diwarisi, sesi jalan) — mengonfirmasi klaim empiris RESEARCH §2c di 2.1.207 (doc resmi tak
  mendokumentasikan flag ini); (2) **SessionStart fire** (`session_id`+`transcript_path`+`source:startup`); (3) **StopFailure
  fire** dgn field **`error`** (via `--model` bogus → `error:"model_not_found"` + `prompt_id`/`effort`/`last_assistant_message`,
  G-5 dikonfirmasi); (4) **jalur PRODUKSI penuh:** `acca run claude` → sesi acca dapat `cli_session_id=fd55a7d2-…` (= nama
  `.jsonl` transcript, G-34 → id `--resume` sah) + event `cli_session_id_captured{source:hook_sessionstart}`; (5) settings
  file dibersihkan saat exit. **Sisa opportunistik (bukan gate):** `rate_limit` StopFailure end-to-end asli (tak bisa
  dipaksa; transport sudah terbukti identik via SessionStart, cabang StopFailure unit-tested). **Sumber:** audit A-5, RESEARCH §2c.

### B-1 — Dispatch retry tanpa terminal (retry backoff cap 60m selamanya) [P2] ✅ (12 Jul)
**RESOLVED (`supervisor.ts` `realDispatch`, Opus inline Tier-1).** PROJECT §4 ("Resume gagal N kali → FAILED,
stop, minta intervensi manual") sebelumnya tak diimplementasi — semua cabang `'retry'` mengandalkan backoff
scheduler tanpa membaca `job.attempts` → retry cap 60m **selamanya** (pola sama A-4 yang audit awal nilai P1).
Empat cabang ditutup: (1) **`resume_spawn_failed`** — konstanta `MAX_DISPATCH_ATTEMPTS=3`; di batas → `markBlocked`
+ event `resume_gave_up {status:BLOCKED}` + `'done'`; **baris FAILED lempar** (runSession selalu create→markFailed
tiap percobaan) kini **diarsipkan** (`sessions.archive`, soft) → tak menumpuk di `acca status`/never-purge.
(2) **`limits_empty`** (probe balas kosong persisten, mis. schema usage berubah) → attempts-cap → `probe_unreadable`
BLOCKED. (3) **`adapter_no_probe`** & (4) **`adapter_no_resumecmd`** — kondisi STATIS (kemampuan adapter) →
terminal LANGSUNG (`probe_unsupported`/`resume_unsupported` BLOCKED, tanpa attempts). `still_limited` SENGAJA tak
dibatasi (limit memang akan reset). Semua terminal ter-surface via mapping BLOCKED generik notifier (level error).
Firewall G-9 utuh (payload hanya field terkontrol). **+4 test** (dispatch) + `jobAttempts` seed di harness. **Sumber:** audit followup B-1.

### B-2 — `formatResetCell` `HH:MM` tanpa hari — menyesatkan utk reset weekly [P3] ✅ (12 Jul)
**RESOLVED (`status.ts`).** Reset window mingguan (agy weekly / CC seven_day, 6 hari lagi) dulu tampil `03:15`
yang terbaca "malam ini". Kini `resetAt - now > 24 jam` → sertakan nama hari lokal (`Sab 03:15`, wireframe §5
"resume ~Sen"); ≤24 jam tetap `HH:MM`. Pure; `now` di-thread lewat `toRow`. **+2 test** (weekly + batas 24 jam).
**Sumber:** audit followup B-2.

### I-27 — `genSessionId` 4-char tanpa retry-on-collision [P3] ✅ (12 Jul, autonomous-run)
**RESOLVED.** `genUniqueSessionId(exists, maxTries=8)` (`ids.ts`) coba ulang `genSessionId()` sampai `exists(id)`
false → tabrakan PK (id ~1 jt kombinasi + retensi never-purge) tak lagi bikin `createSession` throw & `acca run`
gagal misterius; `maxTries` habis → throw pesan JELAS (arsipkan/perpanjang id), bukan `SQLITE_CONSTRAINT` mentah.
`exists` di-inject (repo `getById`) → race-tolerant (INSERT tetap dijaga PK bila race lintas-proses) + testable
tanpa DB. Wired di `runSession`. **+5 test** (`ids.test.ts`). **Sumber:** audit A-9.

### I-28 — Housekeeping audit (drift docs + guard kecil) [P3] ✅ (12 Jul, autonomous-run) — SEMUA A-10..A-15 ditutup
- **A-10 ✅** DEPENDENCY-POLICY: `commander` 14.0.2 masuk tabel pin (0 dep transitif); drizzle/grammy ditandai
  "belum dipasang"; TUI = plain ANSI (Ink/blessed ditolak, bukan lagi "pending"); native gate Ubuntu 24.04 ✅.
- **A-11 ✅** MAP.md: hapus file HANTU `daemon/continue.ts` → ganti file nyata (limit-watcher/inject-continue +
  catatan usage-monitor/ipc-client/reconcile/schedule-reset).
- **A-12 ✅** `.gitattributes` `* text=auto eol=lf` (G-6) → repo & working tree LF lintas-OS, stop warning CRLF;
  `git add --renormalize .` = nol perubahan file lain (repo sudah LF).
- **A-13 ✅** `markResumed` guard `status NOT IN (EXITED,FAILED)` → tak clobber terminal pada race. **+2 test.**
- **A-14 ✅** `markBlocked()` baru + di-wire 2 cabang dispatch blocked (cwd_missing/cli_session_id_missing) →
  status enum **BLOCKED** kini benar-benar ditulis (sebelumnya cuma event+notif) → `acca status` menampilkannya.
  **Keputusan minor reversible** (bukan ADR): pakai nilai enum yang sudah ada. **WAITING dibiarkan tak-terpakai**
  (LIMIT_HIT sudah mewakili tunggu-reset; kandidat drop di migrasi kelak). **+2 test + 2 assert supervisor-dispatch.**
- **A-15 ✅** `stripAnsi` diperluas CSI→+OSC(judul window BEL/ST)+charset → teks di sekitar sekuens tak salah lolos
  ke detektor limit/idle-tracker (G-20 watch ditutup). **+6 test** (`ansi.test.ts`).
- **Verifikasi (Opus sendiri):** typecheck+lint+**338 test** hijau, Tier-1 self-review (A-13/A-14 state-machine). **Sumber:** audit A-10..A-15.

### I-24 — `acca status` tak tampilkan reset_at terjadwal & liveness daemon → AC-4 [P2] ✅ (12 Jul, autonomous-run, Sonnet+Opus)
**RESOLVED (Sonnet impl + Opus tier-review).** `acca status` kini: (1) **kolom `reset`** di tabel sesi —
`formatResetCell(reset_at, reset_source)` pure → `HH:MM` waktu LOKAL + `(sumber)` (wireframe §5 "resume 03:15 WIB"),
`null` → `-`; (2) **baris liveness daemon** sebelum tabel — `formatDaemonLiveness(getHeartbeat(), now, isProcessAlive)`
pure/injectable → `HIDUP (pid X, heartbeat Ys lalu)` / `MATI (…tak hidup)` / `belum pernah jalan`. FIREWALL G-9 utuh
(reset=timestamp/enum, liveness=pid+umur; nol PII). Liveness pakai pid-liveness `isProcessAlive` (konsisten orphan I-1;
residual pid-recycle sama seperti I-1, diterima). **Verifikasi (Opus sendiri):** typecheck+lint+**323 test** (+7:
formatResetCell 4 + formatDaemonLiveness 3). **AC-4 kini benar-benar ✅.** **Sumber:** audit A-6, `src/cli/commands/status.ts`.

### I-21 — Auto-continue hanya bekerja SEKALI per sesi hidup (siklus limit kedua tak terdeteksi) [P1] ✅ (12 Jul, R3, autonomous-run)
**RESOLVED (M3e/R3, Opus inline Tier-1).** `RESUMED` bermakna DUA hal beda: terminal untuk resume-by-id (sesi lama
digantikan) tapi SALAH untuk inject-continue (proses yang SAMA berlanjut) — menandai sesi hidup `RESUMED`-terminal
membekukan `markLimitHit` (guard RUNNING) + `limit-watcher.latched` permanen + usage-monitor (`listRunning` filter
RUNNING) berhenti memantau → auto-continue one-shot per sesi hidup (persona sesi panjang kena limit >1× tak
ter-rescue lagi). **Fix:** (1) `sessions.markRunningAfterInject` — inject-continue sukses → sesi kembali **RUNNING**
(bersihkan `detected_at`/`detect_source`/`reset_at`/`reset_source`; `proc_state` tetap alive; guard IN
('LIMIT_HIT','RESUMED') tak clobber EXITED/FAILED). (2) `limit-watcher.unlatch()` (reset `latched`+buffer). (3)
Transisi+un-latch ditulis **WRAPPER** via `createInjectHandler({onInjected})` (ADR-017: wrapper penulis lifecycle
sesinya; urutan set-RUNNING **lalu** unlatch supaya guard-RUNNING siap). (4) Daemon alive-branch berhenti menulis
status (hapus `markResumed`+`status_change RESUMED`); notif "resumed" pindah ke `notifier` mapping
`job_dispatch_done action:inject_continue` (paralel `resume_spawned`). Usage-monitor **tak diubah** — sesi kembali
RUNNING otomatis terpantau lagi (menutup gejala ke-3 tanpa kode). **Verifikasi (Opus sendiri):** typecheck+lint+
**316 test** hijau (+6: unlatch re-arm output/signal + buffer-reset, markRunningAfterInject + **siklus 2× repo-level**,
onInjected called/not-called, notifier inject_continue→RESUMED, supervisor-dispatch di-update). **Residual (→ I-15,
belum):** repaint TUI baris limit lama ber-newline saat RUNNING bisa re-fire LIMIT_HIT palsu (G-37; sekelas idle
false-positive) — konfirmasi perilaku repaint agy/CC saat limit asli. **Sumber:** audit A-3, R3.

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
