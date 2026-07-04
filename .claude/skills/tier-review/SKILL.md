---
name: tier-review
description: >-
  Klasifikasikan perubahan kode (diff/PR/output subagent) ke Review Tier 1-4 dan jalankan
  prosedur review yang sesuai — Tier 1 line-by-line wajib untuk auth/session, RLS policy,
  multi-tenancy boundary, money calculation, audit-log write path, state machine,
  migration SQL, kalkulator business-critical, endpoint security-sensitive. Gunakan
  SEBELUM promote/commit/merge hasil subagent atau AI lain, saat user minta "review diff",
  "review PR", "cek hasil agent", "boleh di-merge?", atau setelah eksekutor melaporkan
  selesai.
argument-hint: "[branch/PR/path yang di-review]"
---

# Tier Review — Kode AI-Generated

Prinsip: **yang wajib adalah review diff + bukti verifikasi, bukan siapa yang mengetik.**
Tidak ada kode masuk branch utama tanpa melewati tier yang tepat. Tidak ada tool
(/code-review, ultrareview, CI) yang menggantikan Tier 1 — semuanya pelengkap.

## Step 0 — Syarat reviewer

Tier 1 direview oleh agen berkapasitas ≥ eksekutor (Opus me-review diff Sonnet).
Kalau kamu adalah penulis kode ini di sesi yang sama dan diff-nya Tier 1 → nyatakan itu,
dan minta review oleh sesi/agen terpisah tanpa konteks penulisan. Penulis me-review
tulisannya sendiri mewarisi blind spot yang sama yang menghasilkan bug-nya.

## Step 1 — Kumpulkan diff + bukti

1. Diff lengkap: `git diff main...{branch}` atau staged changes.
2. Bukti verifikasi dari eksekutor: output test (bukan klaim "test pass"), log run,
   screenshot bila UI. **Tidak ada bukti = review belum bisa dimulai.** Minta bukti dulu.

## Step 2 — Klasifikasi per file/hunk

Ambil tier TERTINGGI yang menyentuh file tersebut:

| Tier | Cakupan | Treatment |
|---|---|---|
| **1 — Line-by-line wajib** | Auth/session · RLS policy · multi-tenancy boundary · money calculation · audit-log write path · state machine transitions · migration SQL · kalkulator business-critical (voting/pricing/tax) · endpoint security-sensitive | Review penuh baris-per-baris + checklist di bawah. Temuan diringkas untuk dibaca user. Tidak ada pengecualian. |
| **2 — Sample** | UI component · route non-sensitif · helper · test non-business-logic | Review 30-50% file berubah; fokus pola, bukan tiap baris. Frekuensi boleh turun bila pattern stabil. |
| **3 — Automated only** | Build, TS strict, lint, test pass, migration valid | CI menegakkan. Cukup konfirmasi CI hijau. |
| **4 — Persona khusus** | Security review pasca-foundation · legal/domain review kalkulator regulatif · UX review pasca primary flow · DevOps review pra-production | Terjadwal per milestone, bukan reaktif. Rekomendasikan bila milestone-nya tiba. |

Ragu antara dua tier → ambil yang lebih tinggi.

## Step 3 — Checklist Tier 1 per kategori

**Auth/session**: password hashing (argon2/bcrypt) · token expiry + rotation · session
fixation · logout membunuh session di server · rate limit di endpoint auth.

**RLS / multi-tenancy**: policy aktif per tabel tenant · `tenant_id` tidak bisa disuntik
dari client · query path yang bypass RLS (service role) diberi justifikasi · IDOR:
user A mengganti ID milik user B di URL/body → HARUS gagal.

**Money**: bigint sen + currency code, tidak pernah float · rounding eksplisit dan
konsisten · operasi tidak overflow · pembagian (split/prorate) menjaga total.

**Migration SQL**: reversible atau punya recovery path · operasi berisiko (DROP/RENAME/
ALTER TYPE) pakai expand-contract · tidak menghapus data ber-retensi · ada catatan
backup-sebelum-migrate.

**State machine**: transisi ilegal ditolak di server (bukan hanya disembunyikan di UI) ·
race pada transisi ganda · state persist konsisten dengan audit log.

**Audit log**: write path tidak bisa dilewati oleh jalur kode alternatif · tidak mencatat
PII mentah/secret · append-only.

**Authz umum** (paling sering bocor di kode AI): check eksplisit per endpoint — "tidak ada
UI ke sana" bukan proteksi · validasi input server-side (Zod) di tiap mutation.

## Step 4 — Red flags lintas tier

Install library tak diminta (cek eksistensi + reputasi — slopsquatting) · perubahan
arsitektur tanpa justifikasi · orphan code · `any` / `@ts-ignore` tanpa komentar ·
TODO/FIXME menumpuk · klaim sukses tanpa verifikasi dijalankan · kepatuhan semu pada spec
(yang mudah diukur dikerjakan, constraint sulit diukur dilewati) · hardcoded
secret/API key · hardcoded business/legal rules.

## Step 5 — Verdict

Format laporan:

```markdown
## Review {branch/PR} — {tanggal}
| File | Tier | Temuan |
|---|---|---|
**Temuan** (per item): [BLOCKER|MAJOR|MINOR] {file:baris} — {masalah} → {perbaikan}
**Bukti verifikasi diperiksa**: {test output/screenshot/log — atau "TIDAK ADA" = blocker}
**Verdict**: APPROVE | APPROVE-WITH-NITS | BLOCK (alasan)
```

BLOCK bila: ada temuan blocker · bukti verifikasi tidak disetor · diff Tier 1 tanpa test
untuk skenario kritisnya. Setelah fix, review ulang bagian yang berubah — bukan rubber-stamp.
