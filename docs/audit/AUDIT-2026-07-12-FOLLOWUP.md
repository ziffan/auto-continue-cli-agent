# AUDIT-2026-07-12-FOLLOWUP.md — Re-audit pasca-remedi (tindak lanjut AUDIT-2026-07-11)

> **Scope:** verifikasi seluruh remedi R1–R8 / temuan A-1..A-15 terhadap kode nyata pasca-commit
> `9027dc4`..`ecbda73` (14 commit sejak audit awal), termasuk docs yang menyertainya (ISSUES I-20..I-28,
> ADR-018, NFR egress, GOTCHAS G-34..G-37) + pencarian temuan BARU di kode remedi.
> **Metode:** review diff `7fb83bf..HEAD` per temuan, baca ulang file yang berubah (supervisor,
> process-wrapper, inject-continue, limit-watcher, sessions, notifier, status, ids, ansi) line-by-line,
> cross-check klaim ISSUES vs implementasi.
> **Catatan verifikasi independen:** typecheck ulang di lingkungan audit TIDAK valid sesi ini — mount
> sandbox menyajikan versi BASI file yang baru diubah (mis. `ids.ts` tampil 18 baris = versi pra-I-27,
> padahal disk & `git show HEAD` = 33 baris utuh). Verifikasi dilakukan dengan membandingkan isi file
> di disk (utuh, sintaks valid) terhadap blob `git HEAD` (identik) + gate yang dilaporkan hijau di mesin
> Windows (**340 test**). Error `tsc` dari mount basi BUKAN temuan.

---

## 1. Ringkasan eksekutif

Remedi berjalan **benar arah dan benar bentuk**. Dari 15 temuan audit awal: **9 tertutup penuh, 2 tertutup
sebagian (paruh yang tersisa terlacak sebagai issue P1/P2 eksplisit), 4 sengaja dijadwalkan** (I-23/I-25/
I-26 + I-15). Tidak ada remedi yang sekadar kosmetik; pola kegagalan proses yang dikritik audit §6 juga
dikoreksi nyata — test R1 kini menjalankan **default** `spawnResumeFn` (bukan stub), test bug-encoding A-1
dikoreksi, dan penutupan issue ditulis jujur (paruh/sisa dilabeli, tidak di-✅-kan).

Re-audit menemukan **3 temuan baru (1 P2, 2 P3)** — semuanya di jalur retry/terminal-state yang menjadi
lebih terlihat justru karena remedi lama menutup kasus yang lebih besar. Tidak ada regresi keamanan;
injection firewall, PII firewall, dan egress guard utuh di semua kode baru.

**Gate keluar M-remote (dari audit awal): BELUM terpenuhi.** Sisa: I-20 (capture `cli_session_id` CC),
I-22 slice 2 (probe standalone OAuth agy), I-15 actuation inject pasca-reset. Penilaian ini SAMA dengan
yang sudah tercatat di CONTEXT — status proyek kini jujur.

## 2. Status remedi per temuan

| Temuan | Remedi | Status | Verifikasi kode |
|---|---|---|---|
| A-1 resume pakai id salah | R2a `df3904b` | **✅ paruh korektness** | `supervisor.ts:266-287` — `cli_session_id` dipakai; absen → `markBlocked` + BLOCKED, tanpa spawn. Test bug-encoding dikoreksi. **Sisa capture id = I-20 (P1)**; sumber agy sudah pasti (G-36, printed cmd saat exit), CC menunggu hook `SessionStart` (I-23/G-34) |
| A-2 daemon crash spawn-gagal | R1 `9027dc4` | **✅ penuh** | `supervisor.ts:112-129` — `waitForExit` dikonsumsi (`.catch`), `spawnFailed` dideteksi via status FAILED sesi baru, dispatch tak lagi `markResumed` saat gagal (→ `resume_spawn_failed` + retry). Test menjalankan default path (blind-spot §6 ditutup) |
| A-3 auto-continue one-shot | R3/I-21 `a37cf42` | **✅ penuh** | `sessions.markRunningAfterInject` (guard LIMIT_HIT/RESUMED, bersihkan field limit) + `watcher.unlatch()` (reset latch+buffer) + `onInjected` di wrapper (urutan RUNNING→unlatch benar) + notifier mapping `inject_continue`→RESUMED. Usage-monitor otomatis tercakup. Test siklus 2× ada. Residual TUI-repaint → G-37/I-15, wajar |
| A-4 agy-exited loop senyap | R4 slice 1 `ecbda73` + ADR-018 | **✅ sebagian (by-design)** | Guard `supervisor.ts:155-163`: agy+exited → `markBlocked` + `probe_impossible` + done (loop-senyap TUTUP). Notifier `PROBE_IMPOSSIBLE` menang atas branch BLOCKED generik (urutan benar). Slice 2 (OAuth standalone) = I-22 pending; ADR-018 locked + NFR egress `oauth2.googleapis.com` sudah sinkron |
| A-5 hook StopFailure | — | **Dijadwalkan** | I-23 (P2) terbuka, digabung sumber id I-20 — tepat |
| A-6 status tanpa reset/liveness | I-24 `2eec2b4` | **✅ penuh** | Kolom `reset` (`formatResetCell`) + baris `formatDaemonLiveness` (pure, injectable, +7 test). Lihat temuan baru B-2 (tampilan reset >24 jam) |
| A-7 gate `every()` terlalu ketat | — | **Dijadwalkan** | I-25 (P2) terbuka; diperkuat bukti live 11 Jul (grup 3p vs gemini agy). Catatan: bukti live menunjukkan masalah ini juga MENGGIGIT agy antar-grup, bukan CC-saja — pertimbangkan naikkan prioritas sebelum I-15 inject pasca-reset (lihat §4) |
| A-8 ACL named pipe | — | **Dijadwalkan** | I-26, target M5 security pass — sesuai rekomendasi |
| A-9 id collision | I-27 `0c67913` | **✅** | `genUniqueSessionId(exists, maxTries=8)` + wired `runSession` + pesan jelas + 5 test |
| A-10..A-15 housekeeping | I-28 `953ae2f`/`1f765a0`/`5f37ec2` | **✅ semua** | markResumed guard; `markBlocked` ditulis nyata di 2 cabang (BLOCKED kini status DB betulan, WAITING dibiarkan = keputusan minor tercatat); stripAnsi +OSC/charset (+6 test); DEPENDENCY-POLICY & MAP sinkron; `.gitattributes` LF |

**Kualitas tambahan yang layak dicatat:** ADR-018 ditulis dengan mitigasi implementasi eksplisit
(allowlist, creds read-only, PII firewall, refresh pre-resume-only) SEBELUM kode ada — konsisten
doc-first; I-15 live-verify agy 1.1.1 menutup paruh deteksi+resume-load dengan bukti, dan menahan diri
menandai paruh actuation.

## 3. Temuan BARU

### B-1 — Retry dispatch tanpa terminal: "Resume gagal N kali → FAILED, stop" (flow §4) belum diimplementasi [P2]

**Bukti.** Semua cabang `'retry'` di `realDispatch` mengandalkan backoff scheduler (5m→15m→**cap 60m**)
tetapi **tak ada satu pun batas attempts** — `job.attempts` bertambah (`scheduler.ts:96-97`) namun tak
pernah dibaca untuk menyerah. PROJECT §4 cabang error eksplisit: *"Resume gagal N kali → status FAILED,
stop auto-retry, notifikasi minta intervensi manual."* Cabang yang terdampak:

1. `resume_spawn_failed` (baru, R1): PATH permanen rusak → tiap jam **spawn dicoba ulang selamanya**;
   tiap percobaan menciptakan **baris sesi FAILED baru** (`runSession` create→markFailed) + notif FAILED —
   row spam pada retensi never-purge + noise notifikasi berkala tanpa akhir.
2. `adapter_no_resumecmd` / `skipped:adapter_no_probe`: kondisi **statis** (kemampuan adapter tak akan
   berubah di runtime) → retry selamanya tanpa mungkin sembuh.
3. `still_unknown limits_empty`: respons probe kosong permanen (mis. schema berubah upstream) → retry
   60m selamanya, user tak pernah diberi tahu bahwa probe tak lagi bisa dibaca.

(`still_limited` boleh retry-panjang — limit memang akan reset; bukan bagian temuan.)

**Kenapa P2 bukan P1:** tak merusak jalur sukses dan tak crash; tapi ini pola yang sama dengan A-4
("silent forever-retry") yang audit awal nilai P1 — bedanya di sini ada notifikasi FAILED per attempt
(#1) sehingga tidak sepenuhnya senyap.

**Remedi (slice `dispatch-terminal-cap`, Tier-1 state machine).**
1. Di cabang retry yang **tak bisa sembuh sendiri** (#1 setelah N gagal, #2 langsung, #3 setelah N gagal):
   baca `job.attempts`; ≥ N (usul: 3 utk #1/#3) → `sessions.markFailed`/`markBlocked` + event terminal
   (`resume_gave_up` / `probe_unreadable`) + notif level error + `return 'done'`.
2. Untuk #1: JANGAN buat baris sesi baru per percobaan gagal — deteksi `spawnFailed` bisa mengarsipkan
   (`archived_at`) baris FAILED percobaan, atau cek `which()` DULU sebelum `runSession` (pre-flight murah).
3. Test: attempts-cap tiap cabang + assert tak ada baris sesi menumpuk.

### B-2 — `formatResetCell` menampilkan `HH:MM` tanpa hari — menyesatkan untuk reset weekly [P3]

`status.ts` `formatResetCell` merender `reset_at` sebagai jam:menit lokal saja. Reset window mingguan
(7 hari ke depan — agy weekly / CC seven_day) tampil sebagai mis. `03:15 (exact)` yang terbaca "malam
ini" padahal 6 hari lagi. Wireframe §5 sendiri membedakan: `resume ~Sen (wk)`.
**Remedi kecil:** bila `resetAt - now > 24 jam` → tampilkan hari/tanggal (`Sen 03:15` atau `+6h`/`+6d`),
else `HH:MM`. Pure function, tambah 2-3 test.

### B-3 — Sukses resume-by-id disimpulkan dari "spawn tak gagal sinkron" [P3, watch → I-15]

`spawnFailed` (R1) hanya menangkap kegagalan **sinkron** (binary hilang). CLI yang spawn sukses lalu
**exit seketika** (arg ditolak, creds rusak, `--resume` id kadaluarsa) tetap membuat dispatch
`markResumed` sesi lama + notif "resumed" palsu; kegagalan hanya terlihat sebagai sesi baru EXITED
non-nol. Risiko mengecil pasca-R2a (id benar-atau-BLOCKED), tapi kelas kegagalan lain tetap ada.
**Remedi (gabung ke I-15/slice R2b):** observasi jendela pendek pasca-spawn (mis. exit < 3 detik + exit
code ≠ 0 → perlakukan sbg `resume_spawn_failed`), atau tunda `markResumed` sampai output pertama sesi
baru mengalir. Putuskan bentuknya saat live-verify — jangan spekulasi penanda sebelum ada data nyata
(konsisten pola G-33/idle-agy).

## 4. Penilaian gate & urutan berikutnya

Gate keluar M-remote (audit awal §7) — status:

| Syarat | Status |
|---|---|
| R1 daemon-no-crash | ✅ |
| R2 cli_session_id | ◐ R2a korektness ✅ · **R2b capture (I-20) BELUM** — agy sumber pasti (G-36) tinggal wiring; CC butuh I-23 |
| R3 resume-cycle | ✅ |
| R4 agy-exited | ◐ slice 1 guard ✅ · slice 2 OAuth (I-22) BELUM |
| I-15 live-verify CLI nyata | ◐ deteksi + resume-load agy LULUS · **inject pasca-reset (agy+CC) + limit asli CC BELUM** |

**Urutan yang disarankan (revisi ringan dari R-plan awal):**
1. **I-20 wiring agy** (sumber sudah pasti — capture printed cmd/`.db` saat exit → `setCliSessionId`):
   murah, membuka resume-by-id agy end-to-end pertama.
2. **I-23 hook StopFailure + SessionStart** — satu slice menutup A-5 sekaligus paruh CC I-20.
3. **B-1 dispatch-terminal-cap** — sebelum daemon dibiarkan jalan berhari-hari (M5) atau di-expose remote.
4. **I-25 `isUsageAvailable` per-adapter** — naikkan sebelum I-15 inject pasca-reset: bukti live 11 Jul
   menunjukkan gate `every()` akan MEMBLOKIR inject test kamu sendiri (grup 3p habis memblokir resume
   Gemini) → I-15 actuation bisa gagal bukan karena actuation-nya.
5. **I-22 slice 2** (OAuth standalone) + **I-15 inject pasca-reset** — keduanya butuh kondisi live.
6. B-2/B-3 nebeng slice terdekat.

M-remote tetap DITUNDA sampai tabel di atas hijau (kecuali I-26 yang memang jatah M5).

---

## Change Log

| Tanggal | Perubahan | Oleh |
|---|---|---|
| 2026-07-12 | Re-audit pasca-remedi: 9 temuan tertutup penuh, 2 sebagian, 4 terjadwal; 3 temuan baru (B-1 P2, B-2/B-3 P3) + usulan urutan lanjutan. Catatan artefak verifikasi mount. | Claude (audit session) × Ziffan |
| 2026-07-12 | **B-1 (dispatch-terminal-cap) + B-2 (reset weekly) DIREMEDIASI** (`supervisor.ts`/`status.ts`/`sessions.archive`, +6 test → 346). B-3 tetap terbuka (gabung I-15/R2b, butuh live-verify). Detail: ISSUES B-1/B-2 Tertutup + CONTEXT. | Opus (impl session) × Ziffan |
