# ISSUES.md — issue terbuka & tertutup

> Prioritas: P0 (blocker) · P1 (penting) · P2 (mengganggu) · P3 (nanti). Ditutup = tulis solusinya.

---

## Terbuka

### I-8 — Monitor proaktif "mendekati limit" (proximity) dari usage-probe [P2, target M4/US-13]
Claude Code menampilkan warning ~90% (window 5-jam) & ~75% (mingguan) di terminal, tapi itu **UI-only,
tak di-persist** (G-15) → jangan scrape. Sinyalnya sudah tersedia via usage-probe: `usedFraction` (parser
M3c). Implementasikan proximity-monitor yang threshold `usedFraction` (default **0.90 five_hour**, **0.75
seven_day** — meniru default Claude Code sendiri; agy: `1-remainingFraction` per model) → emit notifikasi/
indikator "perkiraan sisa" dini. Basis fitur US-13 (prediksi proaktif, backlog) + indikator proximity di
`acca status` (M4). Wire saat Usage-Probe live + Notifier ada (M4).

### I-7 — Skema agy `GetUserStatus` teramati dari respons asli (4 Jul) — tinggal rapikan parser [P3, target M3d.4]
**Update 4 Jul (eksperimen limit agy):** respons asli teramati (scratchpad probe.log). Bentuk nyata:
`cascadeModelConfigData.clientModelConfigs[]` (flat, **tanpa** pembungkus `userStatus`), tiap entri punya field
**`model`** = **display name** (mis. `"Gemini 3.1 Pro (High)"`, bukan slug), plus `quotaInfo.{remainingFraction,
resetTime}`. **Penting (G-17):** saat exhausted, **`remainingFraction` HILANG** dari entri (hanya `resetTime`) —
parser wajib perlakukan absent = exhausted (0), jangan crash `undefined`. Plan/credit di
`planStatus.planInfo` + `userTier.availableCredits[].creditAmount`. Sisa (non-blocking): rapikan `parseAgyUserStatus`
(M3c) ke skema nyata + tambah fixture dari respons asli (M3d.4/M3d.8). Parser sudah defensif + test-covered.

### I-11 — Placeholder dispatch scheduler daemon backoff-spin sampai M3d.5 [P3, target M3d.5]
`supervisor.ts` mem-wire scheduler dengan **dispatch placeholder** (`deps.dispatch ?? …`) yang mengembalikan
`'retry'` + emit event `job_dispatch_pending` — karena `probeUsage()`/resume nyata baru ada di M3d.5. Efek: bila
daemon **benar-benar jalan** dgn job `probe` pending, scheduler memicunya → 'retry' → reschedule backoff
(5m→15m→60m cap) → memicu lagi tiap ~60m selamanya, menumpuk event `job_dispatch_pending`. **Non-blocking
sekarang** (daemon belum dijalankan di alur normal; `acca run` = wrapper, bukan daemon; tak ada job produksi
yang dipicu daemon hidup). **Hilang otomatis saat M3d.5** mengganti dispatch dgn probe sungguhan (done/retry
nyata). Jangan jalankan `acca daemon` jangka panjang sebelum M3d.5 tanpa sadar ini.

### I-10 — Cross-process gap: `run-core` enqueue probe vs scheduler daemon re-arm hanya saat restart [P2, target M3d.5/wiring]
M3d.2: sesi live di bawah `acca run` (proses run-core) mendeteksi LIMIT_HIT lalu **meng-enqueue** job `probe`
ke `scheduled_jobs` (SQLite). Tapi scheduler daemon (proses **terpisah**) hanya membaca job pending saat
`start()` (recovery) atau `enqueue()` **in-process** — ia **tak tahu** job baru yang ditulis proses lain sampai
**restart**. Jadi hari ini: enqueue benar & persisten, recovery-saat-restart jalan (AC-7 terpenuhi), tapi daemon
**hidup** tak langsung men-arm job dari run-core. **Cara benar (slice wiring berikutnya):** run-core kirim IPC
notify ke daemon ("job baru, re-arm") ATAU daemon yang memiliki lifecycle sesi (bukan run-core) — konsolidasi
sole-writer `scheduled_jobs` saat daemon ambil-alih kepemilikan sesi. Sampai itu, `acca run` + daemon jalan
paralel = probe tak dipicu tepat waktu di daemon hidup (hanya saat daemon restart). Bootstrap-exception MAP.md
(run-core tulis `sessions`) di sesi ini **diperluas** ke `scheduled_jobs` — dicatat untuk direkonsiliasi.

### I-5 — Jalur stale-socket unlink+retry POSIX belum teruji otomatis [P3, target verifikasi Ubuntu]
`ipc-server.listen()` membedakan socket **stale** (daemon lama crash) vs daemon **hidup** via
connect-probe sebelum unlink (fix tier-review M3a — lihat GOTCHAS G-14). Jalur "daemon hidup → reject"
teruji di Windows (named pipe EADDRINUSE). Jalur **stale-unlink-retry POSIX** (unix socket file
tertinggal → probe ECONNREFUSED → unlink → listen ulang) = **logic-only**, tak bisa diuji di mesin
Windows ini. Verifikasi saat sesi Ubuntu 24.04 (barengan gate native prebuild — masih SISA dari M1).

### I-4 — `reset-estimator` clock-time wrap tak DST-aware saat lewat tengah malam [P3, target M3/M4]
`resolveClockTime` menambah `MS_PER_DAY` mentah untuk "next occurrence" alih-alih menghitung ulang wall-clock+1
hari di zona target → meleset ±1 jam di ~2 hari transisi DST/tahun (detail GOTCHAS G-13). Non-blocking: jalur
clock-scrape = fallback-of-fallback; sumber exact andal = ISO dari usage-probe. Perbaiki bila presisi reset
lintas-tengah-malam jadi penting (kemungkinan saat wiring reset ke scheduler M3 / tampilan M4).

---

## Tertutup

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
