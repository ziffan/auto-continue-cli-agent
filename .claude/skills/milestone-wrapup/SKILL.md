---
name: milestone-wrapup
description: >-
  Tutup milestone dengan gate lengkap — test checklist penuh (fungsional, validasi, edge
  case, visual 375/768/1440px, a11y), security checklist per-milestone (input, data,
  network, authorization/IDOR/RLS), integration test, update docs + CHANGELOG. Gunakan
  saat user bilang "tutup milestone", "milestone selesai", "wrap up milestone", "lanjut
  milestone berikutnya", atau saat semua slice dalam satu milestone sudah selesai
  dan hijau.
argument-hint: "[nomor/nama milestone]"
---

# Milestone Wrap-up

Prinsip gate: **milestone tidak ditutup sebelum semua checklist tercentang dengan bukti.**
Checklist yang dicentang tanpa menjalankan verifikasinya lebih buruk daripada tidak
dicentang — ia mematikan alarm.

## Step 1 — Verifikasi slice

Buka `docs/MILESTONES.md`. Per slice: kriteria selesai terpenuhi + bukti verifikasi
tersimpan (test output, screenshot). Slice tanpa bukti → jalankan verifikasinya sekarang,
atau kembalikan ke status belum-selesai.

## Step 2 — Test checklist milestone

Jalankan dan setor bukti (paste output, bukan klaim):

```
□ Fungsional: semua acceptance criteria slice lulus
□ Validasi: input salah/kosong/terlalu panjang ditolak dengan pesan jelas
□ Edge case: data kosong · data banyak (ribuan record) · input aneh (emoji, HTML,
  karakter non-latin) · koneksi putus di tengah aksi
□ Visual: 375px · 768px · 1440px — layout tidak pecah
□ Loading / empty / error state di tiap layar baru (titik bocor paling umum kode AI)
□ A11y baseline: keyboard nav · label form · kontras · focus indicator
□ Integration test antar slice milestone ini
□ Regresi: test suite penuh hijau, bukan hanya test milestone ini
```

## Step 3 — Security checklist per-milestone

Untuk kode baru milestone ini:

```
□ Input: validasi server-side (Zod) di semua endpoint baru · parameterized query ·
  file upload (extension + MIME + size) bila ada
□ Data: tidak ada PII/secret masuk log · PII baru ter-encrypt at rest sesuai SECURITY.md
□ Network: rate limit endpoint baru · timeout external call · CORS tidak melebar
□ Authorization: authz check eksplisit per endpoint baru · IDOR test dijalankan
  (user A akses resource user B → gagal) · RLS policy untuk tabel baru · audit log
  untuk aksi sensitif baru
□ Dependency baru lolos DEPENDENCY-POLICY.md (termasuk MCP/plugin/skill)
```

Milestone yang menyentuh area Tier 1 → pastikan review `tier-review` sudah terjadi untuk
semua diff-nya, dan pertimbangkan Tier 4 sesuai fase: security review pasca-foundation,
legal/domain review untuk kalkulator regulatif, UX review pasca primary flow.

## Step 4 — Compliance spot-check (bila menyentuh data pribadi)

Data baru yang dikumpulkan milestone ini sudah masuk `docs/legal/DATA-INVENTORY.md`? ·
Ada basis pemrosesan + consent flow-nya? · Data minimization dihormati (tidak mengumpulkan
yang tidak dipakai)? · Fitur hak subjek data yang dijanjikan spec masih on-track?

## Step 5 — Update dokumen

1. `CHANGELOG.md` — entri milestone (Keep a Changelog: Added/Changed/Fixed).
2. `docs/MILESTONES.md` — status milestone: selesai + tanggal.
3. `docs/CONTEXT.md` — milestone aktif berikutnya + next step pertamanya.
4. `docs/MAP.md` — bila struktur repo berubah.
5. `docs/ISSUES.md` — issue yang sengaja ditunda ke milestone berikutnya tercatat eksplisit.

## Step 6 — Laporan penutupan

Ringkas ke user: checklist mana yang lulus (+ pointer bukti) · temuan yang diperbaiki
selama wrap-up · item yang ditunda + ke milestone mana + kenapa · rekomendasi review
Tier 4 bila fase-nya tiba.

**Ada item gagal → milestone TIDAK ditutup.** Catat sebagai issue P0/P1, perbaiki, ulangi
gate. Jangan menutup milestone "dengan catatan".
