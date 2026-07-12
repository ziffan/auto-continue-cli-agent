# AUDIT-2026-07-12-MENYELURUH.md — Audit menyeluruh ketiga (pasca-M3e hampir tutup)

> **Scope:** seluruh kode produksi `src/` (37 file TS + 2 migrasi SQL) dibaca line-by-line, dengan fokus
> **8 commit sejak re-audit followup** (`88e63fb`..`b15d685`: B-1/B-2, I-20 wiring agy, I-23 hook
> StopFailure+SessionStart, ADR-019 optimistic resume, idle-tracker-agy, I-29 passthrough, notifier
> cleanup, I-25/R7 per-adapter gate) + cross-check klaim docs (CONTEXT/ISSUES/MILESTONES/DECISIONS/
> GOTCHAS/NFR) terhadap implementasi nyata + spot-check `test/` (supervisor-dispatch, hook-relay,
> session-id-capture).
> **Metode verifikasi independen:** `npm ci` + `npm run check` dijalankan ULANG di lingkungan audit
> (**Ubuntu**, Node 22) → typecheck 0 error · lint bersih · **388/388 test pass** (= klaim "386 + 2 skip
> POSIX-only di Windows"; dua test POSIX itu JALAN dan lulus di sini). Ini run hijau penuh suite
> independen pertama di Linux sejak klaim 12 Jul — klaim gate CONTEXT **terverifikasi**.
> `git rev-list origin/main...HEAD` = 0/0 (sinkron).
> **Auditor:** Claude (sesi audit khusus), 12 Jul 2026. Penomoran temuan melanjutkan konvensi:
> A- (audit 11 Jul) → B- (followup 12 Jul) → **C- (audit ini)**.

---

## 1. Ringkasan eksekutif

Remedi M3e berjalan **jujur dan berkualitas**: 4 P1 audit awal benar-benar tertutup di kode (bukan
kosmetik), B-1/B-2 diimplementasi persis seperti direkomendasikan, pivot ADR-018→ADR-019 didasari
bukti live yang membantah premis sendiri (disiplin yang jarang), dan firewall (egress/injection/PII)
tetap utuh di semua kode baru — termasuk pembersihan `oauth2`/`cloudcode` dari allowlist egress.

**Namun audit ini menemukan satu lubang semantik P1 di ujung loop yang belum pernah tercatat:**
**resume-by-id memuat percakapan tapi TIDAK melanjutkan pekerjaan** — tak ada satu pun jalur kode yang
meng-inject `continue` ke sesi HASIL-resume. Untuk persona target (sesi ditinggal tidur), sesi mati yang
di-"resume" hanya terbuka diam di prompt; notifikasi "resumed" menjanjikan kelanjutan yang tak terjadi.
Lubang yang sama juga melemahkan paruh "detect" ADR-019 (lihat C-1). I-15 live-verify actuation —
satu-satunya gate M3e tersisa — **akan menemukan ini sebagai kegagalan**, jadi lebih murah ditutup
sekarang daripada saat menunggu limit asli.

Selain itu: 3 temuan P2 (validasi id dari kanal hook; latch-first capturer id agy vs prompt-injection;
proc_state basi membangkitkan lagi pola retry-senyap yang B-1 tutup) dan 4 P3. Tidak ada regresi
terhadap temuan A-/B- yang sudah ditutup.

Verdict per area:

| Area | Nilai | Catatan |
| --- | --- | --- |
| Remedi A-/B- (R1–R7, B-1/B-2) | Baik sekali | Semua terverifikasi di kode; tak ada yang kosmetik |
| Korektness loop — sesi HIDUP (inject) | Baik | Siklus-2 (R3) benar; residual G-37 tercatat |
| Korektness loop — sesi MATI (resume-by-id) | **Cacat semantik** | C-1: load ≠ continue; tak ada actuation pasca-spawn |
| Keamanan (egress/injection/PII) | Baik | C-2/C-3 = pengerasan kanal data baru (hook, capturer) |
| State machine & retry terminal | Baik dengan celah | C-4: proc_state basi lolos dari cap B-1 |
| Test suite & gate | Baik sekali | 388/388 independen di Linux; kontrak-test A-1 kini benar |
| Dokumentasi | Baik | Drift kecil (C-7, C-8) |

---

## 2. Temuan P1

### C-1 — Resume-by-id MEMUAT percakapan tapi tak MELANJUTKANNYA: nol jalur inject `continue` untuk sesi hasil-resume

**Bukti.**

- `supervisor.ts:321-360` (cabang `resume`, `proc_state==='exited'`): `spawnResumeFn(spec, session)` →
  sukses → `markResumed(sesi lama)` + event `resume_spawned` → **`return 'done'`**. Tak ada apa pun
  yang di-enqueue untuk **sesi BARU** hasil spawn.
- `process-wrapper.ts` (`runSession`): sesi baru di-host socket kontrolnya (re-injectable by design,
  komentar baris 151-159) — tapi satu-satunya penulis job `resume` adalah cabang probe/limit-hit;
  sesi baru RUNNING tanpa LIMIT_HIT tak pernah menerima inject.
- `claude --resume <id>` / `agy --conversation=<id>` **memuat** percakapan lalu **diam di prompt**
  (terbukti live G-36: "hidup di prompt"). Turn yang terputus tidak disubmit ulang oleh CLI mana pun.
- Flow PROJECT §4 langkah 9-10: resume sesi mati dianggap menghasilkan kelanjutan kerja ("Status =
  RESUMED … Kembali ke 3") — dengan perilaku sekarang, yang terjadi hanyalah *terbuka kembali*.

**Dampak berantai ke ADR-019.** Paruh "detect" optimistic-resume agy berasumsi: "bila masih limit,
sesi hasil-resume mencetak `Individual quota reached` → limit-watcher fire" (DECISIONS ADR-019;
ISSUES I-22). Pesan itu terverifikasi muncul saat **generate dicoba** (G-19) — sesi yang hanya
di-load **tanpa pernah disubmit prompt** kemungkinan besar tidak mencetak apa-apa → LIMIT_HIT baru
tak terpicu → siklus deteksi ADR-019 mati diam: sesi baru RUNNING+idle selamanya, user mengira
resumed. Inject `continue` pasca-load justru yang MEMICU detect itu (ditolak → pesan quota → LIMIT_HIT
→ reschedule di reset_at, persis desain ADR-019).

**Kenapa P1.** Ini nilai inti produk (US-3/AC-3) pada salah satu dari dua jalur actuation; kelasnya
sama dengan A-1/A-3 (loop "selesai di atas kertas", gagal menyelesaikan kerja di dunia nyata), dan
I-15 — gate keluar M3e satu-satunya yang tersisa — **pasti gagal** menabrak ini saat live-verify
resume-by-id. Belum tercatat di issue mana pun (I-15 item (b) hanya mencakup inject ke sesi hidup
pasca-reset).

**Remedi (slice `post-resume-continue`, Tier-1 state machine — kecil-sedang).**

1. Setelah `resume_spawned` sukses: **enqueue job `resume` untuk sesi BARU** (`session_id =
   spawned.sessionId`, `run_at = now + delay` kecil ~10-30s agar CLI selesai load). Dispatch yang ada
   sudah benar menangani sesi alive → `requestInject` + gating idle/foreground — nol kanal baru,
   injection firewall utuh (token tetap literal di wrapper).
2. Idle-tracker sesi baru: belum pernah busy → `isIdle()===true` → inject lolos begitu load selesai;
   bila CLI masih rendering, gating foreground/busy yang menahan (perilaku benar yang sudah ada).
3. Bila masih limit (agy): inject memicu pesan quota → limit-watcher sesi BARU → LIMIT_HIT →
   `scheduleProbeForLimit` → siklus ADR-019 berjalan seperti didesain.
4. Test kontrak (pola audit awal §6): "setelah `resume_spawned`, ada job pending untuk
   `newSessionId`" + siklus penuh exited→spawn→inject di harness supervisor-dispatch.
5. Live-verify tetap milik I-15 (audit §6: actuation tak boleh ✅ tanpa smoke CLI nyata).

---

## 3. Temuan P2

### C-2 — Kanal `hook` menyimpan `ccSessionId` TANPA validasi bentuk → string arbitrer bisa menjadi argv `claude --resume <val>`

**Bukti.** `hook-relay.ts:36-44` — guard hanya `typeof === 'string' && length > 0`; `cli/commands/hook.ts:43-48`
meneruskan `payload.session_id` apa adanya. Nilai tersimpan ke `sessions.cli_session_id` dan kelak
dipakai `resumeCmd()` → `['--resume', <val>]` (`claude.ts:45-47`). Bandingkan jalur agy yang justru
KONSERVATIF (UUID kanonik saja, `patterns.ts:61`, dengan alasan eksplisit "lebih baik BLOCKED daripada
id salah").

**Permukaan.** (a) payload hook nyata dari CC (tepercaya-ish, selalu uuid — G-34); (b) **siapa pun yang
bisa connect ke socket kontrol per-sesi**: POSIX aman (0600), tapi **named pipe Windows ber-ACL terbuka
(I-26/A-8)** — dan sejak I-23 socket itu bukan lagi kanal-aksi-tanpa-payload saja, melainkan membawa
KANAL DATA. Proses lokal lain dapat menulis `cli_session_id` pilihan mereka → di-resume-kan otomatis
oleh daemon (percakapan salah), atau nilai berawalan `--` yang bergantung parsing argv CLI target.
Spawn tanpa shell (exec-form) membatasi dampak, tapi ADR-013 menuntut ini struktural, bukan kebetulan.

**Remedi (kecil).** Validasi UUID kanonik (regex sama dgn agy) di `createHookHandler` sebelum
`captureCcSessionId` — payload non-UUID → no-op senyap (+1-2 test). Ini juga menaikkan urgensi I-26:
sejak kanal `hook` ada, verifikasi DACL pipe Windows sebaiknya tak menunggu M5 penuh.

### C-3 — Capturer id agy latch pada match PERTAMA dari seluruh stream → isi transcript bisa membajak `cli_session_id` sebelum print-exit yang sah

**Bukti.** `session-id-capture.ts:33-40` — `tryCapture` men-latch (`captured=true`) pada match pertama;
sumber yang SAH justru dicetak agy **saat exit** (G-36) = kandidat **terakhir** di stream. Capturer
di-feed SEMUA output sesi (`process-wrapper.ts:258`), dan `matchAgyResumeId` match di baris mana pun
yang memuat `--conversation=<uuid>` — termasuk **isi transcript**: agent yang membaca web/dokumen
(threat model ADR-013 eksplisit: transcript bisa berisi teks dari luar) atau sekadar bekerja pada repo
yang memuat contoh perintah agy ber-uuid nyata. Sekali latch salah → permanen (single-fire), resume-by-id
memuat percakapan yang keliru — dan karena UUID valid, BLOCKED-guard R2a tak menolong.

**Dampak dibatasi:** UUID kanonik saja; resume memuat percakapan milik user sendiri (mis-resume/DoS
auto-continue, bukan eksekusi). Tapi ini kanal isi-output→aksi-masa-depan — persis kelas yang ADR-013
larang secara struktural.

**Remedi (kecil).** Ganti latch-first → **last-match-wins**: jangan set `captured`, biarkan match baru
menimpa via `setCliSessionId` (idempoten, penulisan eksplisit); id yang dicetak saat exit otomatis
menang karena paling akhir. Downgrade event `cli_session_id_captured` agar tak spam (emit hanya saat
nilai berubah). +test: baris uuid palsu di tengah sesi lalu print-exit sah → yang tersimpan = yang sah.

### C-4 — `proc_state` basi ('alive' padahal wrapper mati keras) menghidupkan lagi retry-senyap kelas A-4/B-1

**Bukti rantai.**

1. `reconcileOrphans` hanya dipanggil di `supervisor.start()` (`supervisor.ts:431`) — daemon
   long-running **tak pernah re-cek liveness**; wrapper yang mati keras SETELAH daemon start
   meninggalkan baris `proc_state='alive'` + job probe/resume pending.
2. **agy:** dispatch probe sesi "alive" palsu → `probeAgyUsage` → `discoverLocalPorts(pid mati)` →
   throw → **catch generik `supervisor.ts:361-368` → `'retry'` TANPA attempts-cap** (B-1 hanya menutup
   cabang-cabang spesifik) dan **tanpa notifikasi** (payload `job_dispatch_error` tanpa `status:
   'BLOCKED'` → `notificationForEvent` return null) → backoff cap 60m **selamanya, senyap** — pola
   persis A-4 yang dinilai P1 di audit awal, lolos lewat pintu lain.
3. **CC:** probe HTTP sukses → enqueue resume → jalur alive → `requestInject` → wrapper unreachable →
   `inject_skipped` (ter-surface, I-18) → `'done'`. Ter-surface tapi **buntu manual permanen** padahal
   semua bahan auto-recovery ada (PID nyata mati terdeteksi via `isProcessAlive`, `cli_session_id`
   tertangkap sejak I-20) — sesi baru bisa di-resume-by-id.

**Remedi (slice `dispatch-liveness-reconcile`, sedang).**

1. Di awal dispatch (probe & resume): `session.proc_state==='alive' && session.pid !== null &&
   !isProcessAlive(session.pid)` → `sessions.markOrphanExited` + event (reuse pola reconcile) → lanjut
   proses job sebagai jalur `exited` (yang sudah benar: cli_session_id-or-BLOCKED).
2. Beri attempts-cap pada catch generik (`job.attempts+1 >= MAX_DISPATCH_ATTEMPTS` → `markBlocked` +
   `job_dispatch_error status:BLOCKED` + `'done'`) — menutup KELUARGA retry-senyap, bukan per-cabang.
3. Test: wrapper-mati-keras (pid mati) probe agy → tak retry selamanya; CC inject-unreachable+pid-mati
   → jatuh ke resume-by-id.

---

## 4. Temuan P3

| ID | Temuan | Remedi |
| --- | --- | --- |
| C-5 | Probe LS agy pada sesi **ALIVE** = snapshot launch-time yang beku (G-35, sudah dibuktikan live 11 Jul) → keputusan gate `still_limited`/`usage_available` untuk agy-alive berbasis data basi; kebetulan self-correcting (inject→detect→re-schedule, R3) tapi event `usage_available_enqueue_resume` menyesatkan audit-trail, dan caveat I-17 belum tercermin di jalur dispatch. ADR-019 menutup agy-**exited**; agy-**alive** masih pura-pura probe-nya bermakna | Perlakukan agy-alive konsisten ADR-019: skip probe → langsung enqueue `resume` di `reset_at` (optimistic + detect), ATAU minimal tandai event `reason:'ls_snapshot_stale'` + catat eksplisit di ISSUES |
| C-6 | Pesan limit agy memuat reset **eksplisit** `Resets in 59m14s` / `4h31m7s` (G-19) tapi `extractResetHint` hanya mengenali `in N hours` (`patterns.ts:67`) → `resetHint` kosong → jadwal reset agy jatuh ke **backoff 5m→15m→60m** padahal jam pasti tersedia; boros siklus probe/inject sia-sia & memperbesar jendela G-37 | Tambah pola relatif `(\d+h)?(\d+m)?(\d+s)?` pada `Resets in …` → `relativeHours`/`relativeMinutes` (perlu perluasan kecil `ResetHint`); fixture dari korpus G-19 nyata |
| C-7 | Empty-state `acca status` (`status.ts:171`) masih menyarankan `acca run -- <cli>` — bentuk pra-I-29; `--` kini justru dibuang dan `<tool>` wajib | Ganti `acca run <claude\|agy>`; sekalian cek string bantuan lain |
| C-8 | Drift CONTEXT.md: entri teratas masih menyatakan "`main` ahead origin 4 commit — BELUM di-push" padahal `origin/main` sudah di `b15d685` (sinkron, diverifikasi audit ini) | Koreksi di update CONTEXT berikutnya |

Catatan (bukan temuan): `api.telegram.org` sudah lama di `ALLOWED_HOSTS` dengan nol pemanggil produksi
(M-remote ditunda). Ini keputusan sadar ADR-011/NFR — tapi bila ingin least-privilege murni ala
pembersihan `cloudcode` (ADR-019), host ini pun bisa ditunda masuk sampai `remote/bot.ts` ada. Terserah
owner; cukup disebut supaya eksplisit.

---

## 5. Hal yang sudah BENAR (verifikasi ulang, dipertahankan)

- **Remedi B-1/B-2** persis rekomendasi followup: `MAX_DISPATCH_ATTEMPTS` di cabang yang tepat
  (`still_limited` benar TAK dibatasi), arsip-soft baris FAILED lempar (no-hard-delete utuh),
  `formatResetCell` hari-lokal >24h.
- **I-23 (hook)**: exec-form tanpa shell-quoting; forwarder sempit (3 field terkontrol), selalu exit 0,
  nol stdout; settings terisolasi per-sesi + cleanup di exit & spawn-gagal; StopFailure→`feedSignal`
  masuk taxonomy `classify` tetap. Pemisahan kanal-aksi vs kanal-data dinyatakan eksplisit di kode.
- **ADR-019 di kode**: guard agy-exited → optimistic resume, `oauth2`/`cloudcode` benar-benar hilang
  dari `ALLOWED_HOSTS` (diverifikasi + test http-egress memblokirnya), dead-code `PROBE_IMPOSSIBLE`
  dibersihkan tuntas (nol referensi tersisa di src/).
- **I-25**: `claudeUsageAvailable` — semantik gating (global + scoped-aktif; fallback strict bila tak
  teridentifikasi) diimplementasi persis seperti didesain; agy sengaja tak override (G-31). Benar.
- **I-20 agy**: engine capture terpisah murni, UUID-anchored konservatif, buffer parsial-tanpa-newline
  ditangani; live-verified. (Pengerasan lanjutan = C-3.)
- **I-29**: `enablePositionalOptions`+`passThroughOptions` + back-compat `--` — benar dan teruji.
- **R3 siklus-2**: `markRunningAfterInject` (guard benar) + `unlatch` (reset buffer) + urutan
  RUNNING→unlatch di wrapper — kohern dengan G-37 tercatat sebagai residual live-verify.
- Egress guard, injection firewall token-literal, PII allowlist (parser/notifier/log/status), store
  parameterized + append-only + migrasi transaksional, IPC stale-socket & 0600 — semua masih utuh.
- **Disiplin proses membaik nyata** vs kritik audit awal §6: test R1 menjalankan default path; test
  bug-encoding A-1 sudah dikoreksi jadi kontrak `cli_session_id`; penutupan issue ditulis paruh-per-paruh.

---

## 6. Catatan proses — kenapa C-1 bisa lolos sampai audit ketiga

Pola lamanya bergeser, bukan hilang: audit awal menemukan *seam yang di-stub*; kali ini yang lolos
adalah **akhir rantai yang tak pernah ditanya "lalu apa?"**. Setiap slice benar secara lokal (spawn ✓,
markResumed ✓, notif ✓, socket kontrol sesi baru ✓) dan test kontrak berhenti di `resume_spawned` —
tak ada test/AC yang meng-assert **"pekerjaan berlanjut"** sebagai invarian ujung-ke-ujung. Definisi
"resumed" di DB (status sesi lama) diam-diam menggantikan definisi "resumed" milik user (kerja lanjut).
**Remedi proses:** untuk tiap jalur actuation, tulis satu test kontrak yang meng-assert kondisi AKHIR
dari sudut pandang user story (di sini: "ada actuation terjadwal terhadap sesi pengganti"), bukan hanya
transisi state internal terakhir. Checklist tier-review tambah satu pertanyaan: *"setelah event terakhir
slice ini, siapa yang bergerak berikutnya?"* — jawaban "tidak ada" harus dipertanggungjawabkan eksplisit.

---

## 7. Rencana remedi terurut (usulan)

Semua slice atomic vertical; Tier-1 kecuali disebut. Urutan memprioritaskan gate I-15:

| # | Slice | Isi | Temuan | Estimasi |
| --- | --- | --- | --- | --- |
| RC-1 | `post-resume-continue` | Enqueue job `resume` utk sesi BARU pasca-`resume_spawned` (+delay load) → inject via jalur alive yang ada; test kontrak siklus exited→spawn→inject | C-1 | kecil-sedang |
| RC-2 | `hook-id-validation` | Validasi UUID kanonik `ccSessionId` di `createHookHandler` | C-2 | kecil (≤15 baris) |
| RC-3 | `agy-capture-last-wins` | Capturer id agy: latch-first → last-match-wins + event on-change | C-3 | kecil |
| RC-4 | `dispatch-liveness-reconcile` | Cek `isProcessAlive` di dispatch → markOrphanExited → jalur exited; attempts-cap catch generik | C-4 | sedang |
| RC-5 | `agy-alive-probe-policy` | Konsistenkan agy-alive dgn ADR-019 (skip probe stale) ATAU label eksplisit | C-5 | kecil + catatan docs |
| RC-6 | `agy-reset-hint` | Parse `Resets in XhYmZs` → resetHint exact | C-6 | kecil |
| RC-7 | housekeeping | C-7 (string status), C-8 (CONTEXT drift) — nebeng slice terdekat | P3 | trivial |

**Dampak ke gate keluar M3e:** RC-1 **masuk gate** — tanpa itu I-15 live-verify resume-by-id pasti
gagal separuh (load tanpa lanjut) dan paruh detect ADR-019 tak teruji. RC-2/RC-3 sebaiknya ikut sebelum
M-remote (keduanya mengeras kanal data yang M-remote tier B akan sentuh). RC-4 sebelum M5
(daemon jalan berhari-hari). Urutan I-15 tetap terakhir, opportunistik saat limit+user tersedia.

---

## Change Log

| Tanggal | Perubahan | Oleh |
| --- | --- | --- |
| 2026-07-12 | Audit menyeluruh ketiga pasca-remedi M3e (8 commit sejak followup): gate diverifikasi independen di Linux (388/388); 1 P1 baru (C-1 resume-load ≠ continue), 3 P2 (C-2 validasi id hook, C-3 capturer latch-first, C-4 proc_state basi retry-senyap), 4 P3 (C-5..C-8); rencana remedi RC-1..RC-7; RC-1 dimasukkan ke gate keluar M3e. | Claude (audit session) × Ziffan |
