# AUDIT — Review Independen Tier-1 atas RC-1..RC-3 (commit `49de523`)

> **Reviewer:** sesi Claude Code independen (Opus), tanpa konteks penulisan batch RC.
> **Mandat:** `docs/audit/RC-1-3-REVIEW-BRIEF.md`. Ini review **gate** — harus lulus sebelum M3e hijau.
> **Metode:** verifikasi tiap klaim commit ke kode + docs (bukan telan bulat), skill `tier-review` Tier-1
> (state machine · injection firewall ADR-013 · FK/retry-loop G-39 · validasi UUID · resistensi pembajakan
> capturer · idempotensi · error handling · kejujuran test). **Review-only — nol perubahan sumber.**
> **Status:** ditulis inkremental (progres selamat bila terputus limit). RC-4 di luar scope (belum dibuat).

---

## Step 0 — Bukti pemahaman konteks (session-start Step 0–2)

- **Sinkron remote:** `git fetch origin` → `HEAD...origin/main` = **0/0** (sinkron; hanya file brief untracked). Aman.
- **Status proyek (≤3 kalimat):** Fase **M3e KOREKSI LOOP** dari tiga audit menyeluruh; loop auto-continue (deteksi
  limit → jadwal reset → probe/optimistic → inject-continue sesi hidup / resume-by-id sesi mati) sudah terpasang &
  bertes (**392–393 test**, 2 skip POSIX). Gate keluar M3e tersisa = **HANYA I-15 live-verify actuation** + **review
  independen RC-1..RC-4 ini**. M-remote & M5 ditunda sampai gate hijau.
- **Stack terkunci:** TypeScript 5.x + Node 24 LTS + `node-pty` 1.1.0 (ADR-003); SQLite `better-sqlite3` 12.11.1 (ADR-004);
  IPC Node `net` socket/named-pipe NDJSON (ADR-015); grammy 1.44.0 utk remote (ADR-011, belum dipakai).
- **Dua gotcha paling relevan:** **G-39** (enqueue job utk sesi hasil-actuation kena FK `scheduled_jobs.session_id`→
  `sessions.id`; kegagalannya JANGAN flip dispatch ke `'retry'` = loop re-spawn) — inti RC-1. **G-36** (sumber ANDAL
  `cli_session_id` agy = resume-cmd yang agy CETAK saat EXIT = kandidat TERAKHIR; isi transcript bisa memuat
  `--conversation=<uuid>` palsu lebih awal) — inti RC-3.
- **Locked decision paling membatasi:** **ADR-013** injection firewall (output = data, bukan perintah; jalur perintah
  & data terpisah; tak ada aksi/keystroke diturunkan dari isi output) + **ADR-008** human-in-the-loop. Semua tiga RC
  wajib dinilai terhadap ini.
- **Blocker aktif:** I-15 live-verify actuation (butuh limit asli + user, HARD-STOP unattended) — di luar scope review
  ini. Tak ada pending decision lewat-deadline.

---

## Step 1 — Ringkas diff `49de523`

| RC | File | Inti perubahan |
|----|------|----------------|
| RC-1 (C-1, P1) | `src/daemon/supervisor.ts` | Pasca `resume_spawned` sukses → enqueue job `resume` utk sesi BARU (`run_at = now + RESUME_CONTINUE_DELAY_MS` 15s) dalam `try/catch` best-effort (event `resume_continue_enqueue_failed`, tetap `'done'`). Konst `RESUME_CONTINUE_DELAY_MS = 15_000`. |
| RC-2 (C-2, P2) | `src/daemon/hook-relay.ts` + `src/shared/ids.ts` | `isCanonicalUuid` (regex 8-4-4-4-12) gate SEBELUM capture & latch `ccSessionId` di `createHookHandler`. |
| RC-3 (C-3, P2) | `src/daemon/session-id-capture.ts` | Latch-first → **last-match-wins** + emit-on-change (`lastEmitted`); hapus early-return `if (captured)`. |

Verifikasi silang: `jobs.enqueue` signature (`{session_id, run_at, kind, next_backoff_ms?}`) cocok; `runSession`
(default `spawnResumeFn`) `createSession(proc_state:'alive')` **sinkron** sebelum return → FK terpenuhi + job +15s
me-rute ke cabang alive-inject; `matchAgyResumeId` = UUID-anchored `--conversation[=\s]+<uuid>` (match di mana saja
dalam baris, TANPA syarat prefix "Resume with"). Test memakai pattern nyata (bukan stub).

---

## Step 2 — Review Tier-1 per RC

### RC-1 — resume-by-id kini inject `continue` ke sesi hasil-resume (`supervisor.ts`)

**1. Apakah kode melakukan yang diklaim?** **Ya, jalur happy-path benar.** Pasca `markResumed` + event
`resume_spawned`, `if (spawned.sessionId)` → `jobs.enqueue({session_id: spawned.sessionId, run_at: now+15s,
kind:'resume'})`. Sesi baru dibuat `runSession` sebagai **RUNNING+alive** sinkron → saat job +15s jatuh tempo,
`realDispatch` (`job.kind==='resume'` → `session.proc_state==='alive'`) meng-`requestInjectFn(session)` terhadap
**sesi BARU**. Firewall utuh: token literal tetap di wrapper, IPC `inject` tanpa payload — nol kanal baru (verifikasi
independen: cabang alive `supervisor.ts:256–284` tak menerima teks dari mana pun). Best-effort: enqueue dibungkus
`try/catch` sendiri, catch hanya meng-`append` event lalu jatuh ke `return 'done'` — **tak** menyentuh outer catch yang
`return 'retry'`. Konsisten G-39.

**2. Bug korektness / edge-case / celah yang mungkin terlewat penulis:**

- **[P2] Loop re-spawn baru bila sesi hasil-resume MATI cepat sebelum job continue fire** — penulis menutup satu
  jalur loop (FK-enqueue→retry) tapi **membuka jalur loop kedua** yang tak digating `MAX_DISPATCH_ATTEMPTS`. Skenario
  konkret: resume-by-id men-spawn `s-new` (CC). Hook `SessionStart` CC fire **seketika saat startup** → `s-new.
  cli_session_id` terisi (uuid kanonik). `s-new` lalu **exit dalam <15s** (crash startup: state korup, `--resume`
  gagal, dsb). Job continue (`kind:'resume'`, +15s) fire → `session.proc_state==='exited'` → cabang resume-by-id →
  `cwd` ada + `cli_session_id` ada → `spawnResumeFn` **spawn `s-new2`** + RC-1 enqueue continue lagi utk `s-new2` →
  crash → `s-new3` → … **loop ~tiap 15s, tak terbatas** selama daemon hidup. Tiap iterasi = 1 proses CLI nyata +
  1 baris sesi baru (retensi **never-purge** → tabel membengkak) + notif RESUMED. `MAX_DISPATCH_ATTEMPTS` TAK
  membatasi (tiap spawn = sesi & job BARU, `attempts=0`). **Pra-RC-1 tak ada loop ini** (resume-by-id yang crash cuma
  meninggalkan sesi mati; tak ada job lanjutan). Untuk **agy** butuh ≥1 turn agar id tercetak (lebih sulit terpicu);
  untuk **CC** hook menangkap id di startup → paling mudah terpicu. Ini blind-spot penulis=reviewer yang jelas:
  guard FK-loop ada, guard spawn-loop tidak. **Rekomendasi:** batasi rantai — mis. jangan enqueue continue bila sesi
  baru ber-`resumed_from` sudah pada kedalaman-N, atau saat job continue landing di sesi `exited` **jangan** re-resume
  (continue = khusus sesi alive; exited → terminal/BLOCKED), atau bawa `attempts` induk.

- **[P2 — test-adequacy] Cabang best-effort FK tak diuji.** `grep` seluruh `test/` → **nol** referensi
  `resume_continue_enqueue_failed` / `RESUME_CONTINUE_DELAY`. Properti keamanan paling kritis RC-1 — "enqueue gagal
  JANGAN flip ke `'retry'`" (G-39, justru alasan seluruh try/catch ada) — **tak punya test regresi**. Test full-cycle
  hanya melintasi happy-path (enqueue sukses). Audit sebelumnya justru menemukan "test men-stub seam yang cacat";
  di sini seam-nya tak di-stub, tapi **guard-nya tak dieksekusi test mana pun**. Mudah ditutup: stub `spawnResume`
  yang mengembalikan `sessionId` **tanpa** membuat baris → FK throw → assert dispatch tetap `'done'` + `markResumed`
  tetap + event `resume_continue_enqueue_failed` ter-emit.

**3. Apakah test memadai & jujur?** **Sebagian.** Test `full cycle exited→spawn→continue` **jujur & kuat**: tak
men-stub seam yang diuji (stub `spawnResume`/`requestInject` = actuation eksternal yang sah), meniru `runSession`
dengan menyemai baris `s-new` RUNNING+alive (pola G-30/G-39), memajukan jam manual, dan membuktikan `requestInject`
dipanggil **tepat sekali terhadap `s-new`** + job continue dibuang (`'done'`, nol retry-spin). Namun **dua gap**: (a)
cabang FK-failure tak diuji (di atas); (b) skenario "sesi hasil-resume exit cepat → loop" tak diuji (dan kode-nya
memang bermasalah). **Test yang ADA tak meng-encode bug** — ia benar, hanya belum lengkap.

**Verdict RC-1: CHANGES-REQUESTED** — happy-path benar & firewall utuh, tapi ada **P2 loop re-spawn** baru
(sesi hasil-resume yang mati cepat) + **P2 gap test** pada guard yang jadi alasan keberadaan try/catch.

---

### RC-2 — validasi UUID kanonik hook `ccSessionId` (`hook-relay.ts` + `ids.ts`)

**1. Apakah kode melakukan yang diklaim?** **Ya, tepat.** `isCanonicalUuid` di-gate di rantai `&&` **SEBELUM**
`!ccIdCaptured` dan sebelum `captureCcSessionId` → non-UUID membuat seluruh else-if `false` → tak latch, tak simpan;
`ccIdCaptured` tetap `false` → UUID sah **berikutnya** tetap tertangkap. Regex `^[0-9a-f]{8}-…-[0-9a-f]{12}$/i`
ber-anchor penuh (`^…$`) → menolak ekor/awalan (mis. `--resume`, `<uuid> extra`). Firewall: memblok string arbitrer
(mis. berawalan `--`) menjadi argv `claude --resume <val>` — mitigasi struktural sah utk named-pipe Windows ber-ACL
terbuka (I-26).

**2. Bug / celah yang mungkin terlewat:**

- **[P3 — defense-in-depth] Validasi di jalur TULIS, bukan jalur PAKAI.** `isCanonicalUuid` menjaga kanal masuk
  (hook), tapi cabang resume-by-id yang **memakai** `cli_session_id` (`supervisor.ts:304`) hanya cek `if
  (!session.cli_session_id)` — tak re-validasi bentuk. Saat ini **aman** karena kedua penulis id hanya menyimpan
  UUID (agy `matchAgyResumeId` UUID-only; CC hook kini di-gate). Tapi bila penulis id baru muncul (atau `setCliSessionId`
  dipanggil dari jalur lain), argv `--resume`/`--conversation` tak terlindungi di titik-pakai. Saran opsional: gate
  juga di titik-pakai (murah, `isCanonicalUuid` sudah ada) sebagai sabuk-pengaman. Bukan blocker.

- Bukan celah: UUID sah dari penulis tak-sah masih inert sebagai argv (`--resume <uuid-acak>` → resume gagal/muat
  percakapan salah, **bukan** eksekusi kode). Gate menutup vektor argv-injection (flag), yang memang ancaman nyata.

**3. Apakah test memadai & jujur?** **Ya.** `ids.test` menguji terima (kanonik + case-insensitive) & tolak (placeholder
lama `uuid-abc`, `--resume`, ekor, non-hex `z`, kurang-digit, kosong). `hook-relay.test` menolak batch sampah lalu
membuktikan **latch belum terpakai → UUID sah pertama TETAP tertangkap** (justru properti yang mudah salah). Jujur,
tak men-stub apa pun yang relevan.

**Verdict RC-2: APPROVE** (dengan nit P3 defense-in-depth titik-pakai — opsional, non-blocking).

---

### RC-3 — capturer id agy last-match-wins (`session-id-capture.ts`)

**1. Apakah kode melakukan yang diklaim?** **Ya.** `captured` (latch) → `lastEmitted`; `record()` emit hanya bila
`id !== null && id !== lastEmitted`; early-return `if (captured) return` dihapus → seluruh output di-scan, match
berikutnya menimpa. Karena resume-cmd sah dicetak agy **saat exit = paling akhir di stream** (G-36), ia menang atas
`--conversation=<uuid>` palsu yang muncul lebih awal di isi transcript (ADR-013: output tak tepercaya). Klaim benar.

**2. Bug / celah yang mungkin terlewat:**

- **[P3 — residual firewall, BUKAN regresi] Jendela pembajakan bila sesi di-KILL sebelum mencetak resume-cmd.**
  Bila isi transcript memuat `agy --conversation=<uuid-palsu>` sebagai **match terakhir** dan proses berhenti (SIGKILL/
  crash) **tanpa** agy sempat mencetak resume-cmd sahnya, `lastEmitted` = uuid palsu → `setCliSessionId(palsu)`.
  Resume-by-id berikutnya `agy --conversation=<palsu>` = muat percakapan salah / gagal (uuid palsu tetap inert sebagai
  argv — bukan eksekusi). Ini **melekat** pada keputusan "tangkap id dari output" (tegangan ADR-013) dan last-match-wins
  **strictly lebih baik** dari latch-first (yang mengunci match PERTAMA = lebih mudah dibajak). Bukan regresi; residual
  yang diterima. Layak dicatat, bukan blok.

- **[P3 — efisiensi] Hilangnya early-return = scan berkelanjutan seumur-hidup sesi.** Latch-first berhenti bekerja
  setelah capture pertama (`if (captured) return`). Kini `feedOutput` **tak pernah** berhenti: tiap chunk `record(buffer)`
  menjalankan `stripAnsi` atas residual ≤64KB + regex, selamanya, untuk **setiap sesi agy** (capturer hanya dipasang di
  agy). Utk sesi agy yang cerewet (MB output), ini overhead per-chunk kontinu yang dulu tak ada. Fungsional benar,
  tapi bisa dibatasi (mis. hanya scan data BARU, atau berhenti setelah melihat baris resume-cmd exit sejati). Non-blocking.

- **[P3] Emit-on-change bisa memanggil `setCliSessionId` + `append` event berkali-kali** bila output memuat banyak uuid
  berbeda (`lastEmitted` berubah tiap uuid distinct). Terbatas oleh jumlah uuid distinct di output; `setCliSessionId`
  idempoten (nilai terakhir final) & event `cli_session_id_captured` audit-only → dampak = spam log ringan, bukan
  korektness. Diterima.

**3. Apakah test memadai & jujur?** **Ya.** Test `LAST-MATCH-WINS` memakai **pattern nyata** `matchAgyResumeId`
(bukan stub), memasukkan uuid palsu di isi lalu `RESUME_LINE` sah, dan meng-assert urutan emit (nth-1 palsu, nth-2 sah,
last = sah) — persis properti yang diperbaiki, jujur. Test lama "LATCHED fire sekali" dire-frame jadi "emit-on-change:
id identik berulang → sekali" (masih valid). Tak ada test yang meng-encode bug. Gap minor: skenario kill-sebelum-exit-cmd
(residual P3 di atas) tak diuji — wajar karena itu residual yang diterima, bukan yang diklaim ditutup.

**Verdict RC-3: APPROVE-WITH-NITS** — fix benar & test jujur; tiga catatan P3 (residual pembajakan kill-window,
efisiensi scan kontinu, potensi spam emit) semuanya non-blocking & sebagian melekat pada desain.

---

## Ringkasan temuan

| ID | RC | Sev | Ringkas | file:line |
|----|----|-----|---------|-----------|
| F-1 | RC-1 | **P2** | Loop re-spawn baru: sesi hasil-resume yang menangkap `cli_session_id` lalu EXIT <15s → job continue landing di sesi `exited` → re-resume → spawn berulang, tak digating `MAX_DISPATCH_ATTEMPTS` (sesi/job baru tiap iterasi). Paling mudah terpicu CC (hook `SessionStart` menangkap id di startup). | `src/daemon/supervisor.ts:378–398` (+ cabang exited `:286–333`) |
| F-2 | RC-1 | **P2** | Gap test: cabang best-effort FK (`resume_continue_enqueue_failed`, "jangan flip ke `'retry'`", G-39) — properti keamanan inti — tak punya test regresi. | `test/supervisor-dispatch.test.ts` |
| F-3 | RC-2 | P3 | Validasi UUID di jalur TULIS (hook), tak di jalur PAKAI (resume dispatch `if (!cli_session_id)`). Aman sekarang (semua penulis UUID-only); saran defense-in-depth gate titik-pakai. | `src/daemon/supervisor.ts:304` |
| F-4 | RC-3 | P3 | Residual pembajakan: kill sebelum agy cetak resume-cmd → uuid palsu (match terakhir) menang. Melekat ADR-013; last-match-wins tetap > latch-first. | `src/daemon/session-id-capture.ts:41–46` |
| F-5 | RC-3 | P3 | Efisiensi: early-return dihapus → `stripAnsi`+regex atas residual ≤64KB tiap chunk seumur-hidup sesi agy. | `src/daemon/session-id-capture.ts:49–70` |
| F-6 | RC-3 | P3 | Emit-on-change bisa `setCliSessionId`/`append` berkali-kali bila output banyak uuid distinct (spam log, bukan korektness). | `src/daemon/session-id-capture.ts:41–46` |

Verdict: **RC-1 CHANGES-REQUESTED · RC-2 APPROVE · RC-3 APPROVE-WITH-NITS.**

---

## Step 3 — Rekomendasi gate keluar M3e

**BELUM bisa dinyatakan hijau atas batch ini.** Ada **satu temuan blocking (F-1, P2)**: RC-1 memperbaiki C-1 (P1
resume-load≠continue) dengan benar untuk jalur normal, **tetapi memperkenalkan jalur loop re-spawn baru** yang tak
dibatasi `MAX_DISPATCH_ATTEMPTS`. Ini tepat kelas cacat yang mandat audit minta diwaspadai (G-39 re-spawn loop) —
penulis menutup varian FK-nya tapi luput pada varian "continue-job landing di sesi `exited`". Karena RC-1 = slice yang
**masuk gate** M3e, F-1 harus ditutup dulu.

**Prasyarat sebelum gate M3e hijau:**
1. **Tutup F-1 (P2, blocking):** cegah rantai spawn tak-terbatas. Opsi (pilih owner):
   (a) saat job `kind:'resume'` landing di sesi `proc_state==='exited'` **yang ber-`resumed_from`** (artinya ia sendiri
   hasil resume) → jangan re-resume; tandai BLOCKED/terminal + surface; **atau**
   (b) enqueue continue **hanya** setelah verifikasi sesi baru masih alive pada saat fire (sudah implisit), plus
   **depth-cap** via rantai `resumed_from` (mis. tolak bila kedalaman > K); **atau**
   (c) wariskan/akumulasi `attempts` ke job continue supaya `MAX_DISPATCH_ATTEMPTS` mengikat rantai.
2. **Tutup F-2 (P2):** tambah test cabang FK-failure → assert `'done'` + `markResumed` tetap + event
   `resume_continue_enqueue_failed` (murah, mengunci properti anti-loop G-39).
3. F-3..F-6 (P3) = boleh ditunda (catat di ISSUES); tak memblok gate.

Setelah F-1 & F-2 ditutup + di-tier-review, batch RC-1..RC-3 layak lulus gate; **I-15 live-verify actuation tetap
gate M3e terpisah** (butuh limit asli + user). RC-4 belum dibuat → review terpisah saat ada.

---

## Opsional — hasil `typecheck`/`test`

Percobaan `npm run typecheck` + `npm run test` **tak dapat dijalankan sesi ini**: classifier keamanan Bash/PowerShell
sempat *temporarily unavailable* sehingga eksekusi shell diblok harness. Ini **read-only-verification opsional** (bukan
bagian gate); commit `49de523` mengklaim `npm run check` hijau (typecheck 0-error, lint, 393 test). Temuan review di atas
adalah **analisis statis independen** atas kode + test dan tak bergantung pada hasil run. Rekomendasikan menjalankan
`npm run check` saat menutup F-1/F-2 (test baru F-2 akan menambah 1 kasus).

---

## Catatan metode

Review ini **tak menelan klaim commit**: tiap klaim RC diverifikasi ke kode terkini (`supervisor.ts`, `hook-relay.ts`,
`session-id-capture.ts`, `ids.ts`, `patterns.ts`, `process-wrapper.ts`, `scheduled-jobs.ts`) + file test terkait +
docs (ADR-013/014/017/019/020, G-36/G-38/G-39/G-40). Temuan F-1 & F-3 = jenis blind-spot penulis=reviewer yang mandat
audit antisipasi (loop/firewall di jalur yang penulis anggap sudah aman). **Nol file sumber diubah** (review-only,
sesuai mandat).

---

## Remediasi (spec — doc-first, belum kode)

> Spec ini menutup F-1 & F-2 (blocking gate) + memberi penutup opsional F-3..F-6. Perubahan RC-1 =
> **transisi state machine + dispatch** → **Tier-1**, wajib tier-review Opus sebelum commit. Ada **satu
> keputusan owner** (migrasi vs tanpa-migrasi) di F-1 — lihat di bawah.

### Akar masalah F-1 (ringkas)

RC-1 memakai **`kind: 'resume'` yang sama** untuk dua maksud berbeda: (a) resume-by-id sesi MATI (jalur legit
probe→resume, `supervisor.ts:174/228`) dan (b) **inject-continue ke sesi hasil-resume yang HIDUP** (RC-1,
`:383`). Dispatch me-rute `kind:'resume'` **berdasarkan `proc_state`**: `alive`→inject, `exited`→resume-by-id
(`:256` vs `:286`). Job continue (b) **seharusnya hanya bermakna saat target `alive`**; bila target keburu
`exited`, ia **jatuh ke resume-by-id** dan men-spawn sesi baru → job continue baru → loop. Dispatch **tak bisa
membedakan** job-continue dari job-resume-legit karena `kind` identik. Fix = beri diskriminator.

### F-1 — Opsi remediasi (owner pilih satu)

#### Opsi A (REKOMENDASI) — `kind: 'continue'` distinct, loop mustahil by-construction

Pisahkan maksud lewat **JobKind baru**. Job continue tak pernah menyentuh cabang resume-by-id → **spawn-loop
hilang secara struktural** (bukan ditambal cap).

**Perubahan:**
1. `src/shared/types.ts:24` → `export const JOB_KINDS = ['probe', 'resume', 'continue'] as const;`
2. **Migrasi** `src/store/migrations/0002-*.sql` — perlebar CHECK `kind IN ('probe','resume','continue')`.
   SQLite tak dukung ALTER CHECK → **rebuild tabel** `scheduled_jobs` (create-baru → `INSERT … SELECT` →
   drop-lama → rename). **Risiko rendah**: `scheduled_jobs` = state transien (job pending), bukan
   `sessions`/`events`; rebuild aman + tetap patuhi "jangan hard delete state/transcript" (jobs ≠ transcript).
   *(Alternatif tanpa rebuild: DROP CHECK sepenuhnya — `kind` sudah dijaga tipe TS `JobKind`; tapi drop CHECK
   pun butuh rebuild di SQLite → tak lebih murah. Pertahankan CHECK.)*
3. `supervisor.ts:378–398` (RC-1 enqueue) → `kind: 'continue'` (ganti `'resume'`).
4. **Dispatch handler baru `job.kind === 'continue'`** (sisipkan sebelum blok `job.kind === 'resume'` di `:245`):
   ```
   session = getById(job.session_id)
   !session            → done  (event skipped:session_not_found)   // idempoten, sama pola :247
   proc_state==='alive'→ requestInject(session)                     // SAMA PERSIS cabang alive :256–284
                          injected  → done  (event inject_continue)
                          else      → done  (event inject_skipped)  // gating tolak; JANGAN retry
   else (exited/…)      → done  (event continue_target_exited, level warn/surface)
                          // JANGAN resume-by-id, JANGAN markBlocked (sesi lama sudah RESUMED); murni
                          // "target continue keburu mati" → sudah tercatat, biar user/monitor lihat.
   ```
   Ekstrak logika cabang `alive` (`:260–283`) jadi helper `injectAlive(session, job)` supaya dipakai
   `'resume'` **dan** `'continue'` tanpa duplikasi (DRY + satu titik firewall).
5. **Reset-estimator/notifier:** grep `job.kind`/`JobKind` — tak ada switch exhaustive lain yang pecah
   (`schedule-reset.ts` hardcode `'probe'`; notifier mapping by event, bukan kind). Tambah label notifier utk
   `continue_target_exited` (warn) bila mau surface; opsional.

**Test (WAJIB, gate):**
- Full-cycle happy (sudah ada, ubah kind assertion `'resume'`→`'continue'`).
- **Baru:** continue-job fire saat target sudah `exited` → **nol** `spawnResume` dipanggil + dispatch `'done'`
  + event `continue_target_exited`. (Ini test-regresi anti-loop F-1.)
- **Baru (F-2, lihat bawah):** cabang FK best-effort.

**Konsekuensi:** (+) loop mustahil (continue tak punya jalur spawn); (+) audit log lebih jelas (`continue` vs
`resume`). (−) satu migrasi rebuild tabel transien; (−) satu JobKind + handler baru (≈40 baris). Sepadan —
menutup kelas-cacat, bukan menambal.

#### Opsi B (tanpa migrasi) — guard "resumed-child yang mati sebelum berbuat" di cabang exited

Pertahankan `kind:'resume'`. Tambah guard di **cabang exited** (`supervisor.ts:286`, sebelum resume-by-id):
```
// Sesi ini HASIL resume (resumed_from != null) TAPI mati tanpa pernah kena limit (detected_at == null)
// → crashed-resume, bukan siklus sehat. Jangan re-resume (cegah loop F-1). Terminal + surface.
if (session.resumed_from !== null && session.detected_at === null) {
    markBlocked(job.session_id)
    event job_dispatch_error { action:'resume_gave_up', reason:'resumed_child_died_no_progress', status:'BLOCKED' }
    return 'done'
}
```
**Diskriminator:** sesi hasil-resume yang **hidup lalu kena limit** (`detected_at` terisi via `markLimitHit`) =
siklus sehat → boleh resume. Yang **mati tanpa `detected_at`** = crash → stop. **Verifikasi `detected_at` (sudah
dilakukan reviewer):** `markRunningAfterInject` (`sessions.ts:179`) meng-`NULL`-kan `detected_at` **hanya** di jalur
alive→RUNNING (R3) — sesi itu tetap `alive`, **tak pernah** mencapai cabang exited → guard TETAP sahih di cabang
exited. **Konsekuensi:** (+) nol migrasi, nol JobKind, ≈6 baris. (−) menambal gejala, bukan memisah maksud job →
job-continue masih **bisa** memasuki cabang exited (hanya ditolak lebih awal); (−) lubang tipis: child yang kena
limit **lalu** benar-benar `exited` tanpa sempat di-inject (jarang — agy optimistic jaga child `alive` saat limit)
lolos guard. Cukup utk crash-loop utama, kurang bersih dari Opsi A.

**Rekomendasi reviewer:** **Opsi A.** Memisah maksud job = memperbaiki akar (dispatch tak lagi ambigu), migrasinya
murah (tabel transien), dan meniadakan kelas-loop alih-alih meng-cap-nya. Opsi B = tambalan sah bila owner mau
hindari migrasi mid-M3e, dengan caveat `detected_at` di atas.

### F-2 — Test cabang best-effort FK (WAJIB, murah)

`test/supervisor-dispatch.test.ts`, kasus baru:
- `spawnResume` stub kembalikan `{ sessionId: 's-new' }` **TANPA** `createSession('s-new')` → FK
  `scheduled_jobs.session_id→sessions.id` gagal saat enqueue continue.
- Assert: (1) `getById('s-old').status === 'RESUMED'` (actuation tetap sukses); (2) dispatch `'done'` **bukan**
  `'retry'` (tak flip → tak re-spawn, G-39); (3) event `resume_continue_enqueue_failed` ter-emit; (4)
  `spawnResume` dipanggil **tepat sekali** (bukti nol re-spawn).
- Berlaku utk Opsi A (kind `'continue'`) maupun B. Mengunci properti yang jadi **alasan** seluruh `try/catch` ada.

### F-3..F-6 (P3, boleh ditunda ke ISSUES — non-blocking)

- **F-3 (RC-2 defense-in-depth):** di titik-pakai `supervisor.ts:304`, ganti `if (!session.cli_session_id)`
  → `if (!session.cli_session_id || !isCanonicalUuid(session.cli_session_id))` (fungsi sudah ada) → BLOCKED bila
  bentuk id ternoda dari jalur tulis mana pun. ≈1 baris + 1 test.
- **F-4 (RC-3 residual pembajakan):** terima sbg residual ADR-013 **atau** perkuat pattern minta prefix konteks
  exit-hint (mis. wajib baris memuat `Resume with` / awal-baris `agy --conversation`) agar `--conversation=<uuid>`
  yang ter-embed di tengah kalimat isi transcript tak match. Trade-off: lebih ketat = risiko false-negative bila
  format cetak agy berubah → verifikasi live (G-36). Rekomendasi: **catat di ISSUES**, jangan ubah sekarang
  (butuh live-verify format).
- **F-5 (RC-3 efisiensi):** batasi scan ke data BARU — simpan `scanFrom` offset; `record` hanya atas `buffer.
  slice(scanFrom)`; sesuaikan saat pangkas `MAX_BUFFER_LEN`. Atau berhenti scan setelah melihat baris exit-hint
  sejati. Optimatisasi, bukan korektness → ISSUES.
- **F-6 (RC-3 spam emit):** sudah idempoten & audit-only; bila risih, throttle event `cli_session_id_captured`
  (log sekali per nilai final). Kosmetik → ISSUES.

### Urutan eksekusi disarankan

1. Owner pilih **A vs B** utk F-1. 2. Implement F-1 + F-2 (satu slice Tier-1, Opus inline atau Sonnet+tier-review).
3. `npm run check` (typecheck+lint+test; F-2 nambah ≥1 kasus). 4. Tier-review Opus → commit. 5. F-3 opsional nebeng.
6. F-4/F-5/F-6 → ISSUES (P3). 7. Gate M3e: hijau atas RC-1..RC-3; **I-15 live-verify tetap gate terpisah**.

