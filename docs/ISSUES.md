# ISSUES.md — issue terbuka & indeks tertutup

> Prioritas: P0 (blocker) · P1 (penting) · P2 (mengganggu) · P3 (nanti). Ditutup = tulis solusinya.
> **Writeup LENGKAP semua issue tertutup** (termasuk `<details>` bukti) → [`.archived/ISSUES-closed.md`](.archived/ISSUES-closed.md) (greppable, di luar jalur session-start).

> **KONVENSI WAJIB (I-36):** dokumen ini & seluruh repo di luar `test/fixtures/**` **DILARANG** memuat frasa
> kanonik pesan limit yang **cocok** `CC_LIMIT_PATTERNS`/`AGY_LIMIT_PATTERNS` (`src/adapters/patterns.ts`).
> Sebut **by-index** atau tulis regex ter-escape (prefiks `\b`). Gate: `test/no-canonical-limit-literals.test.ts`.

> **Jejak audit** (writeup di `docs/audit/`): **07-11** (I-20..I-28 / R1–R8, gate keluar M3e) · **07-12-FOLLOWUP**
> (B-1..B-3) · **07-12-MENYELURUH** (C-1..C-8) · **RC-16-INDEPENDENT** (F-1..F-6) · **07-18-MENYELURUH** (D-1..D-5).
> **Semua P1/P2 tertutup; audit ketiga (C-1..C-8) & keempat (D-1..D-5) TUNTAS.** Sisa hanya P3 oportunistik/ditahan.

---

## Terbuka

> **Status roadmap (owner 18 Jul):** M-remote DITUNDA tanpa target. Modul aktif = **M-web** (Web UI monitor,
> ADR-028) — M-web.1 ✅ diimplementasi+verified; belum ditutup formal (gate di bawah). Sisa lain = P3.

### W-1 — Security-review gate M-web belum dijalankan [P2, ditunda 2 sesi berturut]
M-web.1 (`acca web`) sudah diimplementasi + verified runtime (bind loopback, Host-guard 403, method-guard 405,
`/api/status` firewalled) + 21 unit test. **Belum:** gate `milestone-wrapup` persona security-review formal vs
**T-W1..T-W6** (THREAT-MODEL §9.3) — verifikasi sistematis proyeksi ter-firewall, Host/method-guard, bind, HTML
nol-aset. **Ditunda 18 Jul** (owner tutup sesi dgn `acca prune`+README), **ditunda lagi 19 Jul** (owner alihkan
ke ops: update daemon terinstall + packaging instalasi lintas-mesin, lihat CONTEXT.md). Milestone M-web tak
ditutup formal sampai ini jalan — **prioritaskan di sesi berikutnya** sebelum kerja lain, bila tak ada permintaan
mendesak lain dari owner.

### W-2 — M-web.2 `acca daemon --web` co-host [P3, opsional]
Mount server web yang sama di daemon (flag `--web`). Nilai kemudahan (satu proses). Belum dikerjakan.

### W-3 — Polish halaman Web UI [P3, kosmetik]
Kolom `reset_at`/`updated_at` masih epoch-ms mentah di tabel (belum human-readable spt `formatResetCell`);
favicon inline; kolom `now` header. Fungsional, murni kosmetik.

### F-4 / F-5 / F-6 — nits RC-2/RC-3 [P3, non-blocking, sengaja ditahan]
- **F-4** — residual pembajakan capturer id agy: kill sebelum agy cetak resume-cmd → uuid palsu (match terakhir)
  menang. **Ditahan:** melekat ADR-013, jalur paling sensitif; last-match-wins tetap > latch-first (**bukan regresi**).
  Risiko sentuh > nilai P3.
- **F-5** — efisiensi: `stripAnsi`+regex atas residual ≤64KB tiap chunk seumur sesi agy (early-return dihapus).
- **F-6** — `emit-on-change` bisa `setCliSessionId`/`append` berkali-kali bila output banyak uuid distinct (spam log,
  **bukan** korektness).
**Sumber:** review independen RC-1..RC-3 (`docs/audit/AUDIT-RC-1-3-INDEPENDENT-2026-07-16.md`).

### B-3 — Sukses resume-by-id disimpulkan dari "spawn tak gagal SINKRON" [P3, butuh live-verify]
`spawnFailed` (R1) hanya menangkap kegagalan **sinkron** (binary hilang). CLI yang spawn sukses lalu **exit seketika**
(arg ditolak, creds rusak, `--resume` id kadaluarsa) tetap `markResumed` sesi lama + notif "resumed" PALSU. Risiko
mengecil pasca-R2a (id benar-atau-BLOCKED) tapi kelas lain tetap ada. **Remedi (gabung I-15/R2b):** observasi jendela
pendek pasca-spawn (exit <3s + code≠0 → `resume_spawn_failed`) ATAU tunda `markResumed` sampai output pertama sesi baru
mengalir. **Putuskan bentuk saat live-verify** — jangan spekulasi penanda sebelum data nyata (pola G-33). **Sumber:** audit followup B-3.

### I-15 — Live-verify actuation dgn kondisi ASLI [P2, oportunistik — butuh limit asli + user]
Sebagian besar **sudah** terverifikasi: **CC full-loop 16 Jul** (deteksi PRIMER `StopFailure` + inject-continue otomatis
end-to-end melanjutkan kerja CC, `docs/audit/LIVE-VERIFY-I15-CC-2026-07-16.md`); agy 1.1.1 live-verify 11 Jul. **Sisa
oportunistik** (menunggu episode limit asli, tak bisa dipaksa — classifier blok driving unattended): (a) agy literal
English pasca-reset; (b) **verify-under-real-limit** (job `kind:'verify'` I-35 — latch-vs-FP di limit NYATA); (c)
**skenario D-1**: limit → tutup CLI bersih → tunggu reset → resume-by-id nyata (jalurnya kini ADA lagi pasca RD-1).
**Sumber:** audit 11 Jul I-15; live-verify 16 Jul.

### I-33 (residual jalur-Service) — Windows Service always-on lintas-logout untuk host non-laptop [P3, deferred]
**Blocker MVP DITUTUP** (ADR-026: autostart per-user Task Scheduler @logon → mismatch identitas akun lenyap by
construction; writeup penuh di arsip). **Residual (deferred):** hanya relevan bila kelak ada host Windows **non-laptop
selalu-login** yang butuh always-on lintas-logout via Windows Service — di situ butuh probe stage-2 (service as-user:
profil ter-load? creds kebaca? butuh `secedit`/`SeServiceLogonRight`? session-0 PTY?). Untuk profil laptop (target
proyek) always-on lintas-logout **sudah direlakan** (ADR-007). Tak ada yang perlu dikejar. **Sumber:** probe 17 Jul; ADR-026.

---

## Tertutup — indeks (writeup lengkap + bukti di [`.archived/ISSUES-closed.md`](.archived/ISSUES-closed.md))

**Audit keempat (D):**
| ID | Ringkas | Resolusi |
|---|---|---|
| D-1 | `markExited` clobber `LIMIT_HIT` → auto-resume sesi exit-bersih mati senyap | 18 Jul RD-1 Opsi A |
| D-2 | Limit hasil `verify` di-latch tanpa `status_change`/notif (gap AC-5) | 18 Jul RD-2 |
| D-3 | DATA-MODEL belum catat `kind='verify'`/migrasi 0003 | 18 Jul RD-3 |
| D-4 | `api.telegram.org` di allowlist egress tanpa konsumen produksi | 18 Jul RD-4 (hapus) |
| D-5 | Klaim jumlah test drift antar-doc & bergantung-mesin | 18 Jul RD-5 (satu sumber) |

**I-35/I-36/I-34/I-33/I-32 (M5-era + insiden live):**
| ID | Ringkas | Resolusi |
|---|---|---|
| I-35 | Deteksi limit OUTPUT false-positive pada prosa yang mengutip pesan kanonik → inject sesi sehat | 18 Jul PENUH (korroborasi + guard-status + job `verify`) |
| I-36 | Repo memicu detektornya sendiri; `/session-start` = ranjau di bawah acca | 17 Jul (gate literal permanen) |
| I-34 | Artefak shippable tanpa gate yang mengeksekusinya | 18 Jul (`.ps1`/`.service`/`.sh`/XML semua ter-gate) |
| I-33 | Windows Service ≠ sesi user → DB & creds beda → mati senyap (blocker MVP) | 17 Jul RESOLVED-BY-PATH (ADR-026); residual→Terbuka |
| I-32 | Race backup `wal_checkpoint`+`copyFileSync` bisa korup | 18 Jul (SQLite online backup API) |

**Review RC independen (F) + residual live (I-30/I-31):**
| ID | Ringkas | Resolusi |
|---|---|---|
| F-1 | RC-1 loop re-spawn (continue-job di sesi hasil-resume exit cepat) | 16 Jul Opsi B guard |
| F-2 | Gap test cabang best-effort FK RC-1 | 16 Jul |
| F-3 | Validasi UUID tak ditegakkan di jalur pakai | 17 Jul |
| I-30 | Reset clock-wrap +24 jam padahal probe tahu reset benar | 16 Jul (guard estimator recent-past) |
| I-31 | Repaint baris limit lama pasca-inject re-fire LIMIT_HIT palsu | 16 Jul (grace-window OUTPUT-CC) |

**Audit ketiga (C) + gate M3e (I-20..I-29, A, B):**
| ID | Ringkas | Resolusi |
|---|---|---|
| C-1 | Resume-by-id memuat percakapan tapi tak melanjutkan (nol inject) | 13 Jul RC-1 |
| C-2 | Kanal `hook` simpan `ccSessionId` tanpa validasi | 13 Jul RC-2 |
| C-3 | Capturer id agy latch match pertama → transcript bisa membajak | 13 Jul RC-3 |
| C-4 | `proc_state` basi menghidupkan retry-senyap A-4/B-1 | 16 Jul RC-4 |
| C-5 | Probe LS agy sesi ALIVE = snapshot beku → audit-trail menyesatkan | 18 Jul RC-5 (`reason:'ls_snapshot_stale'`) |
| C-6 | Reset relatif agy (`Resets in 4h31m7s`) jatuh ke backoff | 17 Jul |
| C-7 | Empty-state `acca status` sarankan bentuk pra-I-29 | 17 Jul |
| I-20 | Capture `cli_session_id` (R2b) agy + CC | 12 Jul TUNTAS |
| I-21 | Auto-continue hanya sekali per sesi hidup | 12 Jul R3 |
| I-22 | agy resume-by-id sesi MATI | 12 Jul ADR-019 optimistic |
| I-23 | Deteksi limit CC PRIMER hook `StopFailure` + `SessionStart` | 12 Jul R6 LIVE-VERIFIED 2.1.207 |
| I-24 | `acca status` tak tampil reset_at + liveness (AC-4) | 12 Jul |
| I-25 | Gate resume `every(<1)` terlalu ketat CC | 12 Jul R7 |
| I-26 | DACL named pipe Windows terbuka (ADR-015 keliru) | 17 Jul ADR-023 |
| I-27 | `genSessionId` tanpa retry-on-collision | 12 Jul |
| I-28 | Housekeeping audit (A-10..A-15) | 12 Jul |
| I-29 | `acca run <tool> -<flag>` mis-parse commander | 12 Jul |
| A-1 | Resume-by-id pakai id supervisor bukan `cli_session_id` | 11 Jul R2a |
| A-2 | Spawn-gagal resume-by-id = unhandled rejection → daemon crash | 11 Jul R1 |
| B-1 | Dispatch retry tanpa terminal (backoff 60m selamanya) | 12 Jul |
| B-2 | `formatResetCell` `HH:MM` tanpa hari (weekly menyesatkan) | 12 Jul |

**I-1..I-19 (M2–M4 era):**
| ID | Ringkas | Resolusi |
|---|---|---|
| I-8 | Monitor proaktif proximity dari usage-probe | 18 Jul (wiring I-17 + dedup rising-edge) |
| I-4 | reset-estimator clock-time wrap tak DST-aware | 11 Jul |
| I-5 | Jalur stale-socket unlink+retry POSIX belum teruji | 7 Jul |
| I-7 | Skema agy `GetUserStatus` direkonsiliasi ke respons LIVE | 5 Jul |
| I-10 | Cross-process gap wrapper-enqueue vs scheduler re-arm | 7 Jul |
| I-11 | Placeholder dispatch scheduler backoff-spin | M3d.5 |
| I-12 | Actuation seams M3d (inject-continue & resume-by-id) | 6 Jul |
| I-13 | Gating inject-continue foreground/idle | 7 Jul |
| I-14 | `runSession` di-import daemon (layer terbalik) | 7 Jul |
| I-16 | Probe agy buta window MINGGUAN → dispatch keliru-resume | 7 Jul LIVE-VERIFIED |
| I-17 | Loop probe usage PERIODIK saat RUNNING (wiring proximity) | 11 Jul |
| I-18 | `inject_skipped` tak ter-surface → sesi macet senyap | 11 Jul |
| I-19 | File `test/` tak ter-typecheck (TS6059) | 11 Jul |
| I-1 | `acca status` tampilkan orphan sebagai RUNNING | ✅ |
| I-2 | Wrapper tak kembali ke shell prompt setelah CLI keluar | ✅ |
| I-3 | Rekonsiliasi tulis-balik sesi orphan (RUNNING basi) | ✅ |
| I-6 | Adapter `setTimer` produksi wajib tangkap rejection `runDue` | M3d.2 |
