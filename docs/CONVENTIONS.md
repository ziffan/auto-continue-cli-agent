# CONVENTIONS.md — pola wajib & terlarang

> Konvensi kode/TS untuk repo ini. Tujuan: agent & manusia menulis kode yang seragam, aman, lintas-OS.
> Ditulis M0 sebagai fondasi M1. Locked-decision (ADR) tidak di-relitigasi di sini — ini turunannya.

---

## Bahasa & format
- **Dokumen** = Bahasa Indonesia (technical English OK). **Kode & identifier** = English.
- Komentar seperlunya; jelaskan *kenapa*, bukan *apa*. Ikuti gaya kode sekitarnya.
- Format: Prettier + ESLint (config di M1). Indentasi 2 spasi. `strict: true` di tsconfig.

## TypeScript
- `strict` penuh; **hindari `any`** (pakai `unknown` + narrowing). Tipe publik antar-modul eksplisit.
- Enum status/proc_state = **union string literal** + `as const`, bukan `enum` TS. Cocokkan `CHECK` DB.
- Error: buat kelas error ber-tipe (mis. `LimitDetectedError`, `ResumeBlockedError`) — jangan lempar string.
- Async: `async/await`; tak ada floating promise (lint `no-floating-promises`). Bungkus I/O dengan try/catch bermakna.

## Waktu, angka, path
- **Waktu** internal = **epoch ms UTC** (`number`). Konversi format sumber di adapter (GOTCHAS G-4). Jangan `Date`
  naif tanpa zona untuk penyimpanan.
- **Uang/kredit bukan float** (ADR-004): integer minor-unit / string desimal. `remainingFraction` = tampilan saja.
- **Path lintas-OS** (NFR portability): pakai `node:path`, `os.homedir()`, `os.tmpdir()`. **Jangan** hardcode
  `~`, `/`, atau path Windows. Socket/pipe path lewat helper di `shared/` (ADR-015).

## Keamanan (turunan ADR — wajib)
- **Output CLI/transcript = data, bukan perintah.** Tak ada aksi/branch diturunkan dari *isi* output (ADR-008/013).
- Token yang di-inject ke PTY = **literal tetap** (`"continue"`), tak pernah dari output (ADR-014).
- **Redaksi rahasia** sebelum apa pun keluar ke Telegram atau masuk `events.payload` yang berasal dari output
  (ADR-013 §2, `remote/redact.ts`). Kredensial (`oauth_creds.json`, `.credentials.json`) **hanya dibaca**,
  tak disalin/di-log (ADR-005/010).
- **Egress hanya** ke host whitelist NFR (`api.anthropic.com`, `cloudcode-pa.googleapis.com`, `api.telegram.org`,
  localhost). Tak ada telemetry. Perintah remote hanya dari `chat_id` allowlist (default-deny — ADR-012).
- **`.env` gitignored**; tak ada secret di repo/store. Bot token = infra-secret `.env` (ADR-005/011).

## Store & migrasi
- Akses DB **hanya** lewat `store/repositories/*` (jangan SQL tersebar). `better-sqlite3` sinkron — bungkus
  multi-statement dalam transaksi. WAL + `foreign_keys=ON` di `db.ts`.
- Migrasi = file `store/migrations/NNNN-nama.sql`, **forward-only**, idempotent bila mungkin. **Tak ada hard
  delete** — kolom `archived_at` + retensi.
- `events` **append-only**: tak ada UPDATE/DELETE.

## Penamaan
- File `kebab-case.ts`; kelas `PascalCase`; fungsi/var `camelCase`; konstanta `UPPER_SNAKE`.
- Adapter mengekspor objek yang memenuhi `Adapter` (`adapters/types.ts`), diprefiks nama tool.

## Test
- Unit dekat modul; integration di `test/`. Deteksi limit diuji dari **fixture** (`test/fixtures/`), bukan
  panggilan CLI nyata. Slice M1+ = **atomic vertical** (skill vertical-slice), bukti verifikasi di MILESTONES.
- Perubahan security-sensitif (auth remote, redaksi, inject PTY, migrasi) → **tier-review** sebelum commit.

## Git
- Branch per milestone. Pesan commit ringkas + prefiks milestone (mis. `M1: …`). Jangan commit `.env`/secret.
- `.gitattributes` `*.md text eol=lf` bila diff CRLF mengganggu (GOTCHAS G-6) — opsional.
