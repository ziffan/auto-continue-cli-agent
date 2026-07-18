# AUDIT-2026-07-18-MENYELURUH.md — Audit menyeluruh keempat (pasca-M5 tutup penuh + backlog 18 Jul)

> **Scope:** seluruh kode produksi `src/` + artefak deploy (`deploy/**`, `scripts/**`) + gate `test/`,
> dengan fokus **~40 commit sejak audit ketiga & review RC** (`dd57b72`..`5ec6c3a`): gate keluar M3e
> (F-1/F-2, I-30/I-31), C-4/RC-4, C-6/C-7/F-3, seluruh M5 (M5.1 backup, M5.2 skrip/restore, M5.3
> security pass, M5.4 systemd, M5.5 Task Scheduler @logon ADR-026, M5.6 wrap-up), tiga lapis I-35
> (korroborasi → guard status probe → job `verify` + migrasi 0003), I-36 (gate literal), I-32 (online
> backup API), I-8/I-17 (proximity gate) — plus cross-check klaim docs (CLAUDE.md/CONTEXT/ISSUES/
> MILESTONES/DATA-MODEL/GOTCHAS) terhadap implementasi nyata.
> **Metode verifikasi independen:** `npm ci` + `npm run check` + `npm run build` dijalankan ULANG di
> lingkungan audit (Linux, Node 22): typecheck 0 error · lint bersih · **623/623 test pass, 0 skip**
> (49 file; dua test POSIX-only ikut JALAN dan lulus) · build + copy-migrations OK (0001–0003 tersalin).
> `git rev-list HEAD...origin/main` = 0/0 (sinkron). Temuan kunci **dibuktikan runtime** (bukan hanya
> baca kode): reproduksi clobber status di store nyata (lihat D-1).
> **Auditor:** Claude (sesi audit khusus, 18 Jul 2026). Penomoran temuan melanjutkan konvensi:
> A- (11 Jul) → B- (followup 12 Jul) → C- (menyeluruh 12–13 Jul) → F- (review RC 16 Jul) → **D- (audit ini)**.
> **Catatan penulisan (I-36/G-45):** dokumen ini sengaja TIDAK memuat frasa kanonik pesan limit dalam
> bentuk yang cocok pola detektor — rujukan pakai by-index (`CC_LIMIT_PATTERNS[N]`) / deskripsi.

---

## 1. Ringkasan eksekutif

Kualitas kerja sejak audit ketiga **tinggi dan jujur**: semua gate M3e benar-benar tertutup di kode
(bukan kosmetik), M5 mengirim artefak deploy yang **semuanya ber-gate yang mengeksekusinya** (I-34 —
pelajaran G-44 diinternalisasi sungguhan), pivot-pivot atas bukti live (ADR-025 sc.exe void, ADR-026
autostart, G-49 watchdog repetisi, G-52 conhost) terdokumentasi dengan disiplin supersede yang bersih,
dan ketiga lapis I-35 memperkuat injection firewall (keputusan latch kini digerbang probe usage, bukan
isi output). Suite test lulus penuh di lingkungan independen; firewall egress/injection/PII utuh di
semua kode baru.

**Namun audit ini menemukan satu regresi semantik P1 di ujung loop yang justru diperkenalkan oleh
perbaikan I-35 sendiri:** guard `status !== 'LIMIT_HIT'` di cabang `probe` (commit `3031e54`)
berinteraksi dengan `markExited` yang **meng-clobber `LIMIT_HIT` → `EXITED` tanpa guard** — akibatnya
sesi yang kena limit lalu **exit bersih** (Ctrl-C/quit di prompt) kehilangan auto-resume **senyap**,
dan jalur **resume-by-id agy (ADR-019 optimistic resume) praktis tak lagi punya jalur produksi yang
bisa dicapai** (detail D-1). Ini kelas yang sama dengan C-1 audit ketiga: lubang semantik di seam yang
tak pernah diuji end-to-end ("limit → exit bersih → probe fire"), lolos 623 test karena test men-stub
status langsung.

Selain itu: 1 temuan P2 (limit ASLI yang dikonfirmasi job `verify` tak pernah dinotifikasikan ke user
— gap AC-5) dan 3 P3 (allowlist egress memuat host tak terpakai; klaim jumlah test bergantung-mesin
dan drift antar-doc; DATA-MODEL.md belum mencatat migrasi 0003). Tidak ada regresi terhadap temuan
A-/B-/C-/F- yang sudah ditutup — semua remedi terverifikasi masih terpasang di kode (§4).

Verdict per area:

| Area | Nilai | Catatan |
| --- | --- | --- |
| Remedi gate M3e (F-1/F-2, I-30, I-31) | Baik sekali | Terverifikasi di kode + test; tak ada yang kosmetik |
| I-35 tiga lapis (korroborasi/guard/verify) | Baik, **dengan 1 regresi** | Firewall menguat; tapi guard status memutus jalur resume sesi exit-bersih (D-1) + verify-latch bisu (D-2) |
| Korektness loop — sesi HIDUP (inject) | Baik | Grace-window I-31 + un-latch R3 solid; PTY-integration test nyata |
| Korektness loop — sesi MATI (resume-by-id) | **Regresi P1** | D-1: exit-bersih pasca-limit = no-op senyap; agy-exited ADR-019 tak terjangkau |
| M5 deploy (systemd/Task Scheduler/backup) | Baik sekali | Semua artefak ber-gate (I-34); LIVE-verified di kedua OS; least-privilege benar |
| Keamanan (egress/injection/PII/IPC) | Baik | T-L1 data-minimize terverifikasi; 1 nit least-privilege (D-4) |
| Test suite & gate | Baik sekali | 623/623 independen; gate artefak & literal bekerja; 1 nit klaim jumlah (D-5) |
| Dokumentasi | Baik | Drift kecil (D-3 DATA-MODEL, D-5 counts); sisanya akurat & jujur |

---

## 2. Temuan P1

### D-1 — `markExited` meng-clobber `LIMIT_HIT` + guard status probe (I-35) ⇒ auto-resume sesi "limit lalu exit bersih" mati SENYAP; jalur agy-exited ADR-019 praktis tak terjangkau di produksi

**Rantai bukti.**

1. **Clobber (dibuktikan runtime di store nyata, lingkungan audit):**
   `sessions.markExited` (`src/store/repositories/sessions.ts:73-79`) menulis `status='EXITED'` **tanpa
   guard status** — sesi `LIMIT_HIT` (alive di prompt) yang CLI-nya kemudian exit bersih (Ctrl-C 2×,
   `/exit`) di-clobber jadi `EXITED` oleh `onExit` wrapper (`src/daemon/process-wrapper.ts:409`).
   Reproduksi: `createSession(RUNNING)` → `markLimitHit` → `markExited` → baris = `EXITED/exited`
   (`detected_at` tersisa, status limit hilang). Kontras tajam dengan **`markOrphanExited`**
   (`sessions.ts:94-102`) yang **sengaja mempertahankan `LIMIT_HIT`** dengan alasan eksplisit di
   komentarnya: *"supaya continue-engine berikutnya tahu harus resume-by-id"*. Asimetri ini tidak
   pernah diputuskan/didokumentasikan — flow PROJECT §4 langkah 9 justru mengasumsikan sesi limit yang
   proc-nya mati akan resume-by-id.
2. **Guard baru menjadikannya fatal:** sejak `3031e54` (17 Jul), cabang `probe`
   (`src/daemon/supervisor.ts:195-202`) men-skip job bila `status !== 'LIMIT_HIT'`
   (`skipped:probe_stale_status`). **Sebelum guard**, job probe sesi `EXITED` tetap berjalan → agy →
   optimistic resume (ADR-019); CC → probeUsage → resume-by-id. **Sesudah guard**, job yang sama =
   no-op teraudit. Guard-nya sendiri benar untuk target aslinya (job stale pada sesi RUNNING —
   keluarga F-1), tapi ia menelan skenario sah "limit ter-latch lalu proses exit bersih" karena
   status keburu di-clobber ke `EXITED` di langkah 1.
3. **Dampak per-tool:**
   - **agy:** `cli_session_id` agy HANYA tertangkap dari perintah resume yang agy **cetak saat exit
     bersih** (G-36; `patterns.ts:68`, capturer `process-wrapper.ts:238-250`). Sesi agy yang mati
     keras (terminal ditutup/crash) → orphan path mempertahankan `LIMIT_HIT` ✓ tapi **tak punya id**
     → BLOCKED `cli_session_id_missing` (`supervisor.ts:491-500`). Sesi agy yang exit **bersih** →
     **punya id** tapi status ter-clobber → probe di-skip. **Kombinasi keduanya: tidak ada satu pun
     jalur produksi di mana optimistic resume agy-exited (ADR-019) benar-benar berjalan sampai
     resume.** Keputusan arsitektur yang dibayar mahal (live-verify G-38, supersede ADR-018) kini
     efektif dead-code — tanpa satu test pun gagal.
   - **CC:** mati keras → orphan preserve + id dari hook `SessionStart` → resume-by-id ✓ tetap jalan.
     Exit bersih pasca-limit → sama seperti agy: skip senyap.
4. **Senyap dua kali:** `skipped:probe_stale_status` tidak dipetakan Notifier (`notifier.ts` — hanya
   `inject_continue`/`resume_spawned`/`inject_skipped`/BLOCKED) dan transisi `EXITED` memang tak
   di-surface → user yang menunggu "sesi lanjut sendiri jam 03:00" tidak pernah diberi tahu bahwa
   auto-resume DIBATALKAN. Job pending dibiarkan fire-lalu-skip alih-alih dibersihkan/di-surface.
5. **Konteks jujur:** AC-M5-3 (MILESTONES:340) memakai persis perilaku ini sebagai fixture recovery
   ("sesi EXITED → guard I-35 = no-op aman") — bukti recovery-on-start, tapi sekaligus menunjukkan
   skenario user "limit → exit → tunggu reset" tak pernah dievaluasi sebagai skenario PRODUK.

**Kenapa lolos 623 test:** test dispatch men-set status baris langsung (`supervisor-dispatch.test.ts:331`
menguji skip dengan framing "resume manual/race"); tidak ada test komposisi
`markLimitHit → markExited → probe-fire`. Kelas yang sama dengan C-1 (seam antar-modul di-stub).

**Remedi yang disarankan (butuh keputusan owner — dua opsi sah, jangan diputuskan diam-diam):**

- **Opsi A (auto-resume dipertahankan — selaras flow §4/US-3/ADR-019):** `markExited` meniru
  `markOrphanExited` (`status = CASE WHEN status='RUNNING' THEN 'EXITED' ELSE status END`,
  `proc_state='exited'`) → sesi limit yang exit bersih tetap `LIMIT_HIT/exited` → probe jalan →
  agy optimistic / CC probeUsage → resume-by-id (id agy TERSEDIA persis di jalur ini). Satu klausa
  SQL + test komposisi baru. Konsekuensi: sesi yang SENGAJA ditinggal user akan di-respawn di cwd-nya
  saat reset — itu memang janji produk, tapi layak dikonfirmasi owner.
- **Opsi B (exit bersih = user memilih berhenti):** dokumentasikan semantiknya eksplisit (PROJECT §4 +
  DATA-MODEL), **hapus job probe pending saat markExited** (jangan biarkan fire-lalu-skip), dan
  surface notifikasi "auto-resume dibatalkan (sesi ditutup)" supaya tak senyap. Plus: akui di
  DECISIONS bahwa jalur agy-exited ADR-019 hanya hidup untuk kasus orphan-dengan-id (praktis: nihil)
  — atau tangkap id agy lebih awal bila memungkinkan.

Prioritas P1 karena: jalur resume-by-id = separuh actuation inti produk; regresinya senyap; dan
metrik sukses PROJECT §1 ("≥90% interupsi ter-resume otomatis") tak bisa dicapai untuk kelas sesi ini.

---

## 3. Temuan P2

### D-2 — Limit ASLI yang dikonfirmasi job `verify` di-latch TANPA `status_change` dan TANPA notifikasi (gap AC-5/US-5)

**Bukti.** Cabang `verify` (`src/daemon/supervisor.ts:374-397`): kuota terbukti habis →
`sessions.markLimitHit(source:'verify')` + `scheduleProbeForLimit` + event
`job_dispatch_done action:'verify_latched_real_limit'`. Berbeda dari SEMUA jalur latch lain
(wrapper `onLimit`, `process-wrapper.ts:304-321`) yang menulis event `status_change {to:'LIMIT_HIT'}`:

- `events` di supervisor DIBUNGKUS `withNotifications`, tapi `notificationForEvent` tidak memetakan
  `verify_latched_real_limit` (`notifier.ts:56-157`) dan tak ada `status_change` yang ditulis →
  **user tidak pernah dinotifikasi** bahwa sesinya benar-benar kena limit (padahal ini justru kasus
  "limit asli sempat tertutup snapshot basi" — yang paling butuh disurface). AC-5: notifikasi wajib
  pada transisi LIMIT_HIT.
- Audit-trail jadi tak konsisten: `events` selama ini menjamin tiap transisi status punya
  `status_change`; transisi via verify = satu-satunya yang tidak. Konsumen `acca log`/audit masa
  depan akan melewatkannya.

**Remedi kecil:** setelah `latched === true`, append `status_change {to:'LIMIT_HIT', source:'verify'}`
(dekorator notifier otomatis men-surface, nol mapping baru) — atau tambah mapping eksplisit di
`notificationForEvent`. +1 test notifier/dispatch.

---

## 4. Temuan P3

### D-3 — DATA-MODEL.md belum mencatat `kind='verify'` / migrasi 0003 (drift "sumber kebenaran")

`docs/DATA-MODEL.md:60` masih `kind TEXT CHECK(probe|resume)`; migrasi
`0003-scheduled-jobs-kind-verify.sql` menambah `'verify'` + rebuild tabel. File itu menyebut dirinya
sumber kebenaran skema dan rapi mencatat 0002 (`resumed_from`) — 0003 terlewat. Perbaikan 2 baris
(kolom `kind` + catatan migrasi 0003 + `schema_version=3`).

### D-4 — `api.telegram.org` duduk di allowlist egress dengan NOL konsumen produksi (inkonsisten preseden least-privilege ADR-019)

`src/shared/http.ts:12-18`. ADR-019 menghapus `cloudcode-pa.googleapis.com` dari allowlist dengan
alasan eksplisit "host yang tak pernah dipanggil produksi dihapus (least-privilege)". Standar yang
sama berlaku untuk `api.telegram.org`: M-remote belum diimplementasi dan **owner (18 Jul) menyatakan
M-remote tidak urgent** → host ini kini pra-otorisasi tanpa pemakai untuk jangka waktu tak tentu.
Hapus dari `ALLOWED_HOSTS` (kembalikan saat slice M-remote nyata dibuka); sesuaikan
`test/security-egress.test.ts` + NFR §Security.

### D-5 — Klaim jumlah test bergantung-mesin dan drift antar-dokumen

Klaim: CLAUDE.md §2 & README = **"626 (2 skip POSIX)"**; header MILESTONES M5 = **"615"**; run
independen Linux audit ini = **623 pass, 0 skip** (49 file). Ketiganya "benar" di mesinnya
masing-masing karena beberapa gate men-generate test **per-file atas working tree** —
`no-canonical-limit-literals.test.ts` men-scan seluruh repo (97 test di checkout bersih; file
untracked lokal di mesin owner menambah hitungan), `ps1-encoding`/`shell-script`/`systemd-unit`
per-artefak. Akibat: angka yang di-pin di tiga dokumen tak akan pernah cocok lintas mesin dan cepat
basi. Saran: pin angka dari **checkout bersih** + satu lokasi saja (CLAUDE.md), atau berhenti mem-pin
angka eksak (tulis "±620, lihat CI/run lokal"). Bukan bug produk — murni higiene klaim.

---

## 5. Verifikasi remedi audit-audit sebelumnya (tetap terpasang, tidak ada regresi)

Semua dicek langsung di kode HEAD (`5ec6c3a`):

| Remedi | Bukti di kode | Status |
| --- | --- | --- |
| F-1 guard loop re-spawn (Opsi B) | `supervisor.ts:459-472` (`resumed_from!=null && detected_at==null` → BLOCKED) | ✅ utuh |
| F-2 test FK best-effort RC-1 | `supervisor.ts:584-604` try/catch `resume_continue_enqueue_failed` + test | ✅ utuh |
| I-31 grace-window OUTPUT-CC | `limit-watcher.ts:74,106-111` (5s, CC-only, OUTPUT-only; hook bypass) + PTY-integration test nyata (`run.integration.test.ts:186-`) | ✅ utuh |
| I-30 guard recent-past estimator | `reset-estimator.ts:22-25,144-158,203-205` (≤2h → probe near-now, source heuristic) | ✅ utuh |
| C-4/RC-4 reconcile liveness + attempts-cap | `supervisor.ts:158-169` + catch generik `:606-627` | ✅ utuh |
| RC-1 continue-chain resume-by-id | `supervisor.ts:573-604` (+15s continue job utk sesi baru) | ✅ utuh (tapi lihat D-1 utk kasus target exit) |
| B-1 terminal-cap semua cabang retry | `MAX_DISPATCH_ATTEMPTS=3` di probe-kosong/resume-gagal/catch | ✅ utuh |
| I-35 lapis 1 korroborasi (0.85 / 5mnt / hook bypass) | `limit-watcher.ts:84-92,118-128`; CC-only struktural ganda (`readUsageCorroboration` `process-wrapper.ts:77` + guard engine) | ✅ utuh |
| I-35 lapis 2 guard status probe | `supervisor.ts:195-202` | ✅ terpasang (efek samping = D-1) |
| I-35 lapis 3 job `verify` | `supervisor.ts:287-398` (CC-only + RUNNING-alive + latch-only, TANPA markBlocked saat unreadable — benar) + dedup `hasPendingKind` (`scheduled-jobs.ts:63-68`) + migrasi 0003 (rebuild CHECK, diuji upgrade konkret) | ✅ terpasang (gap notif = D-2) |
| I-36 gate literal kanonik | `no-canonical-limit-literals.test.ts` re-derive dari fungsi produksi; marker exempt untuk definisi regex + title notifier | ✅ bekerja (97 file di-scan) |
| I-32 online backup API | `backup.ts:122-133` (sumber tetap terbuka selama transfer, close di finally; mkdir dulu; integrity_check dipertahankan) — sesuai G-53, klaim T5 "scenario bukan hard-NC" jujur | ✅ utuh |
| I-8/I-17 proximity gate rising-edge | `notifier.ts:233-256` (clear per-tool scoped) + monitor multi-tick test | ✅ utuh |
| T-L1 data-minimize IPC status | `sessions.ts:216-240` `toSessionStatusView` (8 field, tanpa `cli_session_id`/`cwd`) di-wire `supervisor.ts:677` | ✅ utuh |
| Egress whitelist pasca-ADR-019 | `http.ts:12-18` tanpa host Google; loopback-TLS dibatasi ketat | ✅ utuh (nit D-4) |
| Injection firewall inject tanpa payload | `inject-continue.ts:25,51-65` token literal wrapper; `requestInject` tanpa args | ✅ utuh |
| C-2/C-3 validasi id (hook UUID + last-match-wins) + F-3 gate titik-pakai | `hook-relay.ts:46`, `supervisor.ts:511-519` | ✅ utuh |
| Artefak deploy ber-gate (I-34) | `systemd-unit`/`shell-script`/`ps1-encoding`/`task-scheduler-xml` — semua mengeksekusi/memvalidasi byte & render, bukan baca-saja | ✅ utuh |

Artefak M5 dinilai baik secara desain: unit systemd `--user` + linger (least-privilege, tanpa root);
Task XML `LeastPrivilege`/`InteractiveToken`/`PT0S`/watchdog `Repetition PT1M`+`IgnoreNew`/conhost
headless — semua konsisten bukti LIVE G-47..G-52; installer meng-escape XML & memvalidasi sisa
placeholder; uninstaller idempoten & tak menyentuh data (no-hard-delete).

---

## 6. Cross-check klaim docs vs kode

- **CONTEXT/ISSUES/GOTCHAS akurat dan jujur** — termasuk kejujuran yang patut dicatat: batas LIVE
  I-35 ("teruji via probe ter-stub; latch-vs-FP di limit nyata menunggu episode"), G-53 ("T5 bukan
  negative-control keras"), G-56 (kehilangan kerja saat NC di-re-apply). Tidak ditemukan klaim
  "selesai" yang tidak didukung kode — kontras sehat dengan temuan audit pertama.
- **MILESTONES M5**: semua AC ditandai dengan bukti; AC-M5-2 amandemen `<90s` terdokumentasi.
  Jumlah test di header = basi (D-5).
- **DATA-MODEL**: drift 0003 (D-3).
- **CLAUDE.md §2 "Next: M-remote tier A"** — per keputusan owner 18 Jul (sesi ini) M-remote tidak
  urgent; roadmap di CLAUDE.md/CONTEXT perlu diperbarui pada session-end berikut (bukan temuan,
  catatan tindak lanjut; berdampak juga ke D-4).
- **ISSUES I-35 "DITUTUP PENUH"** — sah untuk scope yang ditulisnya; D-1/D-2 adalah temuan BARU di
  interaksi antar-komponen, bukan pembatalan closure itu.

---

## 7. Suite test & gate

- 623/623 hijau independen (Linux, Node 22) — pertama kalinya suite penuh diverifikasi ulang di
  lingkungan netral sejak 13 Jul. `npm run build` + copy-migrations hijau (G-10 tetap tertutup).
- Kekuatan menonjol: PTY-integration test I-31/I-35 memakai wrapper PRODUKSI + socket kontrol nyata
  (menutup kelas "seam di-stub" yang jadi akar temuan audit pertama); gate artefak I-34 benar-benar
  mengeksekusi validasi (bukti: G-50 tertangkap gate yang diperkuat).
- Gap yang tersisa (melahirkan D-1): belum ada test **komposisi lifecycle** lintas repo+dispatch
  (`markLimitHit → markExited → probe fire`) — test state-machine selalu men-seed status akhir
  langsung. Rekomendasi: tambahkan 2 test komposisi (agy & CC) apa pun opsi D-1 yang dipilih owner —
  keduanya akan mengunci semantik yang diputuskan.

---

## 8. Rekomendasi remedi (urutan pengerjaan)

| # | Temuan | Aksi | Ukuran | Gate |
| --- | --- | --- | --- | --- |
| RD-1 | D-1 (P1) | Keputusan owner Opsi A (preserve `LIMIT_HIT` di `markExited`) vs Opsi B (dokumentasi + bersihkan job + notif). Rekomendasi auditor: **Opsi A** — selaras flow §4/US-3/ADR-019 & satu-satunya jalur yang membuat id agy berguna; + 2 test komposisi | ~10 baris + test | Tier-1 (state machine) |
| RD-2 | D-2 (P2) | Append `status_change LIMIT_HIT` (source `verify`) pasca-latch verify; +1 test notifikasi | ~5 baris + test | Tier-1 (jalur I-35) |
| RD-3 | D-3 (P3) | Update DATA-MODEL.md (kind verify + 0003) | docs-only | — |
| RD-4 | D-4 (P3) | Hapus `api.telegram.org` dari `ALLOWED_HOSTS` sampai M-remote dibuka; sesuaikan test egress + NFR | ~3 baris | Tier-1 (egress) |
| RD-5 | D-5 (P3) | Satu sumber angka test (checkout bersih) / berhenti pin angka eksak di README+MILESTONES | docs-only | — |

Tidak ada temuan yang memblokir pemakaian harian daemon saat ini (jalur utama — sesi hidup + inject —
sehat dan kini terlindungi I-35). D-1 memblokir klaim "loop auto-continue penuh untuk sesi mati" dan
sebaiknya ditutup sebelum mengandalkan resume-by-id di skenario nyata.
