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

> **Status roadmap (owner 18 Jul):** M-remote DITUNDA tanpa target. Modul **M-web** (Web UI monitor, ADR-028)
> **DITUTUP FORMAL 19 Jul** (W-1 gate LULUS). Tak ada milestone aktif. Sisa = P3 oportunistik.
> **20 Jul:** lisensi repo di-LOCK **Apache 2.0** (ADR-029) · **W-2 DITOLAK** owner (lihat di bawah).

### P-1 — Sisa langkah membuka repo ke publik [P2, aksi OWNER — bukan kerja agent]
Repo **masih private** (keputusan owner 20 Jul: "belum publik sampai benar-benar pas"). Fondasinya sudah siap
(ADR-029 Apache 2.0 + `LICENSE`/`NOTICE`, `SECURITY.md`, CI lintas-OS hijau, audit history nol secret/PII).
Tiga langkah tersisa, **semua di tangan owner**, urut:
1. **Flip visibility** ke publik (Settings → General → Danger Zone → Change repository visibility).
2. **SEGERA setelah itu: aktifkan GitHub private vulnerability reporting** (Settings → **Advanced Security**,
   UI lama: *Code security and analysis* → "Private vulnerability reporting" → Enable).
3. **Tag `v0.1.0`** dari commit ber-CI-hijau (paling awal: `b9983e0`) + GitHub Release. **Bukan `npm publish`**
   (`"private": true` disengaja; G-59 membuat npm bukan kanal distribusi yg sehat untuk repo ini).

> **KOREKSI urutan (20 Jul, diverifikasi):** versi awal item ini menaruh "aktifkan PVR" SEBELUM flip visibility —
> **itu tak mungkin**. PVR hanya tersedia untuk repo **publik**; selama private, `GET /repos/:o/:r/private-vulnerability-reporting`
> balas **404** dan `security_and_analysis` = `null` (dicek langsung via `gh api`, bukan diasumsikan). Konsekuensi
> yang diterima: ada **jeda singkat** pasca-flip di mana link "Report a vulnerability" di `SECURITY.md` masih 404 —
> perkecil dgn mengerjakan langkah 2 langsung setelah 1; kontak alternatif (kampusmerah.com) sudah ada di
> `SECURITY.md` sebagai jaring.
**Catatan:** `.claude/skills/*` sengaja ikut publik (README §Metodologi) — bila owner berubah pikiran, keluarkan
**sebelum** repo publik; setelah publik, history-nya sudah beredar.

### ~~W-2 — M-web.2 `acca daemon --web` co-host~~ [DITOLAK owner 20 Jul]
Rencana: mount server web yang sama di daemon (flag `--web`), nilai = satu proses. **Ditolak owner:** `acca web`
"tidak selalu dibutuhkan" → biarkan proses terpisah, dinyalakan saat perlu. Efek samping baik: isolasi **T-W6**
(crash server web ≠ ganggu daemon auto-resume) tak tererosi. Jangan relitigasi tanpa kebutuhan baru.

### W-3 — Polish halaman Web UI [P3, kosmetik — SEBAGIAN selesai 19 Jul]
- ✅ **Kolom `reset_at`/`updated_at` human-readable** (19 Jul, `page.ts` `fmtTs`): epoch-ms → `HH:MM` lokal,
  sisip nama hari bila >24 jam (anti-B-2). Browser-side, **nol field baru ke `/api/status`** (jaga T-W1). Diuji
  behavioral via `new Function(FMT_TS_JS)` + embed-guard + runtime `acca web` (5 test). Kolom `now` header sudah
  tampil via meta "diperbarui HH:MM:SS".
- ⏳ **Favicon inline DITUNDA** [P3]: butuh `<link href="data:…">` → memecah assertion T-W4 `web.test.ts` yang
  blanket `\b(src|href)\s*=`. Menambahkannya = longgarkan guard ketat itu (izinkan `data:` saja) demi kosmetik
  bernilai sangat rendah → ditahan. Kalau dikerjakan: sempitkan regex test ke URL non-`data:` eksternal, bukan
  blanket.

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

## Tertutup — indeks ringkas

> **Writeup lengkap + bukti (`<details>`) tiap ID di [`.archived/ISSUES-closed.md`](.archived/ISSUES-closed.md)** — grep `### <ID>`.
> Semua P1/P2 tertutup; audit ketiga (C-1..C-8) & keempat (D-1..D-5) TUNTAS. Grup:

- **Modul M-web:** W-1 (gate keamanan T-W1..T-W6 LULUS, 19 Jul → M-web ditutup formal)
- **Audit keempat (D-1..D-5):** semua ✅ 18 Jul (RD-1..RD-5)
- **M5-era + insiden live:** I-32 (race backup) · I-33 (Windows Service by-path ADR-026) · I-34 (gate artefak shippable) · I-35 (limit OUTPUT false-positive, DITUTUP PENUH) · I-36 (repo memicu detektor sendiri)
- **Review RC independen:** F-1/F-2/F-3 ✅ · residual live I-30/I-31 ✅
- **Audit ketiga (C-1..C-8) + gate M3e:** semua ✅ (I-20..I-29, A-1..A-15, B-1/B-2)
- **M2–M4 era (I-1..I-19):** semua ✅
