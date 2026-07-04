---
name: session-start
description: >-
  Ritual buka sesi kerja — baca docs proyek dalam urutan wajib (PROJECT → ARCHITECTURE →
  DECISIONS → MAP → CONVENTIONS → GOTCHAS → CONTEXT → ISSUES), buktikan pemahaman secara
  eksplisit, lalu usulkan rencana sesi. Jalankan di AWAL setiap sesi pada proyek yang
  punya docs/, saat user bilang "mulai sesi", "lanjutkan proyek", "lanjut milestone",
  "kita di mana", atau saat sesi baru dibuka tanpa konteks pekerjaan sebelumnya.
---

# Session Start — Handover In

Kenapa ritual ini ada: semua konteks proyek hidup di file, bukan di ingatan agent.
Sesi yang langsung menyentuh kode tanpa membaca docs akan menciptakan konvensinya sendiri,
me-relitigasi keputusan lama, dan mengulang gotcha yang sudah dibayar mahal.

## Step 1 — Baca berurutan

Baca file berikut dalam urutan ini (lewati yang tidak ada, catat ketiadaannya):

1. `docs/PROJECT.md` — masalah & scope
2. `docs/ARCHITECTURE.md` — bentuk sistem
3. `docs/DECISIONS.md` — locked / pending / JANGAN PERNAH
4. `docs/MAP.md` — peta repo
5. `docs/CONVENTIONS.md` — pola wajib & terlarang
6. `docs/GOTCHAS.md` — jebakan yang sudah ditemukan
7. `docs/CONTEXT.md` — status terkini, milestone aktif, blocker
8. `docs/ISSUES.md` — issue open, prioritas
9. `HANDOFF_CONTEXT_v{n}.md` versi terbaru, bila ada

Baca untuk dipakai, bukan untuk diringkas panjang — jangan paste ulang isinya ke chat.

## Step 2 — Bukti pemahaman (wajib SEBELUM menyentuh tugas)

Setor ke user, ringkas:

1. Status proyek dalam maksimal 3 kalimat.
2. Stack + versi yang di-lock.
3. Dua gotcha paling relevan untuk pekerjaan hari ini.
4. Satu locked decision yang paling membatasi pekerjaan hari ini.
5. Blocker aktif + pending decision yang lewat deadline (bila ada — tagih ke owner-nya).

Tujuannya memaksa read-before-act. Kalau tidak bisa mengisi kelima poin, berarti bacaan
Step 1 belum cukup — ulangi, jangan menebak.

## Step 3 — Usulkan rencana sesi

- Ambil dari milestone aktif di `CONTEXT.md` + slice berikutnya di `MILESTONES.md`.
- Usulkan 1-2 sub-task (1-3 jam kerja per sub-task), sebutkan bukti verifikasi yang akan
  disetor di akhir tiap sub-task.
- Satu sesi = satu modul. Jangan multitask antar modul — context switch mahal untuk
  user dan untuk agent. Budget konteks sesi: ±300K token soft; rencanakan agar muat.
- Tunggu approval user sebelum mulai eksekusi.

## Kondisi khusus

- `docs/` tidak ada atau kosong → jangan lanjut; tawarkan skill `docs-first-spec`.
- `CONTEXT.md` basi (tidak cocok dengan git log terakhir) → laporkan selisihnya,
  rekonstruksi status dari git log + ISSUES.md, lalu minta konfirmasi user.
- Spec belum LOCKED tapi user minta implementasi → ingatkan, tawarkan menyelesaikan
  lock dulu via `docs-first-spec` Step 7.
