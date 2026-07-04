---
name: session-end
description: >-
  Ritual tutup sesi — update CONTEXT.md, ISSUES.md, GOTCHAS.md, CHANGELOG, evaluasi
  perlu-tidaknya naik versi HANDOFF_CONTEXT_v{n}.md, lalu commit dengan hygiene yang benar.
  Jalankan di AKHIR setiap sesi kerja bermakna, saat user bilang "tutup sesi", "selesai
  dulu", "sampai sini dulu", "buat handoff", "update context", atau saat konteks sesi
  mendekati batas (±300K token) dan kerja akan dilanjutkan di sesi baru.
---

# Session End — Handover Out

Kenapa ritual ini ada: sesi berikutnya (atau agent lain) hanya tahu apa yang tertulis.
Sesi yang ditutup tanpa update docs mewariskan status palsu — CONTEXT.md yang bohong
lebih berbahaya daripada yang kosong.

## Step 1 — Update dokumen status

1. `docs/CONTEXT.md` — timpa dengan status jujur hari ini:
   apa yang dikerjakan + hasilnya · milestone aktif + progress · blocker ·
   next step konkret (1-3 langkah yang bisa langsung dieksekusi sesi berikutnya).
2. `docs/ISSUES.md` — tutup issue yang selesai (tulis solusinya), buka issue baru yang
   ditemukan tapi tidak dikerjakan hari ini (dengan prioritas P0-P3).
3. `docs/GOTCHAS.md` — jebakan yang ditemukan hari ini ditulis HARI INI. Pelajaran yang
   tidak ditulis akan dibayar ulang oleh sesi berikutnya.
4. `docs/DECISIONS.md` — keputusan yang dibuat di sesi ini tercatat? Pending baru punya
   owner + deadline? Keputusan yang dibatalkan masuk Change Log, bukan dihapus.
5. `CHANGELOG.md` — hanya bila ada perubahan user-facing atau milestone selesai
   (format Keep a Changelog).

## Step 2 — Evaluasi handoff versioning

Naikkan `HANDOFF_CONTEXT_v{n}.md` → `v{n+1}` HANYA bila scope atau keputusan fundamental
berubah di sesi ini (ganti arah arsitektur, scope MVP berubah, stack di-supersede).
Progress normal cukup di CONTEXT.md. Versi lama TIDAK dihapus.

Isi handoff baru: status ringkas · keputusan fundamental yang berubah + alasan ·
pending decisions (owner + deadline) · pointer ke ADR/dokumen terkait · apa yang TIDAK
berubah (supaya sesi berikutnya tidak curiga semuanya baru).

## Step 3 — Commit hygiene

1. `git status` + `git diff --stat` — pastikan tidak ada file liar ikut (`.env`, dump DB,
   artefak build, data DDS).
2. Pesan commit berprefix milestone: `M{n}: {ringkasan perubahan}`.
3. DILARANG: commit secret · force push ke main · merge ke main tanpa CI hijau.
4. Kerja belum layak commit → simpan di branch/worktree-nya, catat statusnya di
   CONTEXT.md secara eksplisit ("WIP di branch X, belum di-commit karena Y").

## Step 4 — Laporan penutupan ke user

Maksimal 6 baris: apa yang selesai (+ bukti verifikasi) · apa yang tidak selesai +
kenapa · blocker untuk sesi berikutnya · file docs yang di-update · commit yang dibuat ·
next step pertama untuk sesi berikutnya.

## Larangan

- Jangan menandai selesai sesuatu yang verifikasinya tidak dijalankan.
- Jangan menulis CONTEXT.md yang lebih optimis daripada kenyataan.
- Jangan menunda GOTCHAS — "nanti didokumentasikan" = tidak pernah.
