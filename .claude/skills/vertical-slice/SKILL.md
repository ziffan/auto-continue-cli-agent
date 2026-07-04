---
name: vertical-slice
description: >-
  Pecah spec atau milestone menjadi atomic vertical slices — 1 task = 1 fitur end-to-end
  testable (UI + API + DB sekaligus), bukan per layer — lalu tulis ke docs/MILESTONES.md
  dengan kriteria selesai dan bukti verifikasi. Gunakan saat menyusun MILESTONES.md,
  membuat task list / breakdown implementasi, menyiapkan prompt untuk subagent eksekutor,
  ATAU saat melihat rencana task per-layer (1 task UI + 1 task API + 1 task DB) — itu
  anti-pattern, perbaiki dengan skill ini.
argument-hint: "[milestone atau scope yang mau dipecah]"
---

# Vertical Slice Breakdown

Kenapa vertical, bukan horizontal: slice end-to-end bisa di-test dan di-review sebagai
satu unit fungsional. Task per-layer baru bisa diverifikasi setelah semua layer selesai —
artinya review menumpuk di akhir dan integrasi jadi tempat semua bug bertemu. Di model
fleet, slice juga unit partisi kerja subagent: satu slice = satu subagent = satu set file.

## Step 1 — Baca sumber

`docs/PROJECT.md` (stories Must/Nice/Later), `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`
(locked constraints), `docs/CONVENTIONS.md`. Scope milestone diambil dari user stories
Must terlebih dahulu.

## Step 2 — Bentuk milestone

- Ukuran milestone: **2-5 hari kerja penuh**. Kalibrasi solo 15-20 jam/minggu:
  itu 1-2 minggu kalender weekday, atau satu blok weekend. Lebih besar → pecah.
- Tiap milestone ditutup integration test + wrap-up (skill `milestone-wrapup`).
- Urutkan berdasarkan dependency teknis + nilai user; fondasi (auth, tenancy, data model)
  duluan karena semua slice lain menumpanginya.

## Step 3 — Pecah jadi slices

Definisi atomic vertical slice: perilaku yang bisa didemo ke user, menembus semua layer
yang dibutuhkannya, selesai dalam 1-3 jam kerja agent + review.

Format per slice di `docs/MILESTONES.md`:

```markdown
### M{n}.{i} — {nama fitur}
**Slice**: {satu kalimat perilaku end-to-end yang bisa didemo}
**Scope file**: {folder/file yang boleh disentuh}
**Di luar scope**: {file yang DILARANG disentuh — batas partisi paralel}
**Kriteria selesai (testable)**:
- {Given/When/Then dari acceptance criteria story terkait}
- Loading / empty / error state tertangani (paling sering bocor di kode AI-generated)
**Bukti verifikasi yang wajib disetor**:
- Output test hijau (paste, bukan klaim) · screenshot bila UI · log run migration bila ada
**Tier review**: {1|2|3 — rujuk skill tier-review; sebut alasan bila Tier 1}
```

## Step 4 — Validasi anti-pattern

Tolak dan susun ulang bila menemukan:

- Task berjudul layer: "buat semua endpoint", "buat semua UI", "setup database untuk
  semua fitur" → pecah per perilaku.
- Slice tanpa kriteria testable ("perbaiki UX", "refactor") → tulis kondisi selesai
  yang bisa diverifikasi, atau keluarkan dari milestone.
- Dua slice paralel dengan scope file tumpang-tindih → gabung, atau serialkan, atau
  geser batas file. Tumpang-tindih = konflik merge yang pasti terjadi.
- Slice > 3 jam → pecah; slice < 30 menit → gabungkan dengan tetangganya.

## Step 5 — Siapkan kontrak subagent (bila dieksekusi fleet)

Prompt eksekutor per slice memuat: konteks (pointer ke docs, bukan salinan) · slice +
kriteria selesai · scope file + larangan file · konvensi wajib (pointer CONVENTIONS.md) ·
bukti verifikasi yang diminta · perintah "tulis test-nya juga". Untuk slice Tier 1,
skenario test ditentukan orkestrator/user, bukan si penulis kode — penulis yang menguji
asumsinya sendiri hanya membuktikan asumsinya sendiri.

Aturan paralel: file tidak tumpang-tindih · hanya satu pemegang build/emulator pada satu
waktu · worktree terpisah untuk stream besar.

## Output wajib ke user

`docs/MILESTONES.md` terisi + ringkasan: jumlah milestone, jumlah slice, slice mana Tier 1,
dependency antar milestone, estimasi kalender (estimasi instingtif × 1,5).
