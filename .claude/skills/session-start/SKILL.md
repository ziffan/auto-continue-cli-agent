---
name: session-start
description: >-
  Ritual buka sesi kerja — baca docs status/aturan wajib (DECISIONS → MAP → CONVENTIONS →
  GOTCHAS → CONTEXT → ISSUES; PROJECT/ARCHITECTURE = referensi on-demand), buktikan pemahaman
  eksplisit, lalu usulkan rencana sesi. Jalankan di AWAL setiap sesi pada proyek yang
  punya docs/, saat user bilang "mulai sesi", "lanjutkan proyek", "lanjut milestone",
  "kita di mana", atau saat sesi baru dibuka tanpa konteks pekerjaan sebelumnya.
---

# Session Start — Handover In

Kenapa ritual ini ada: semua konteks proyek hidup di file, bukan di ingatan agent.
Sesi yang langsung menyentuh kode tanpa membaca docs akan menciptakan konvensinya sendiri,
me-relitigasi keputusan lama, dan mengulang gotcha yang sudah dibayar mahal.

## Step 0 — Sinkron dengan remote (WAJIB, SEBELUM baca docs)

Proyek ini lintas-mesin (Ubuntu daily + Windows weekend) — mesin/sesi lain bisa sudah push
ke `origin`. Memulai kerja di basis yang **basi** → commit di atas base lama → konflik push +
kolisi nomor (ADR/G-/I-), rebase menyakitkan. Cegah di awal:

1. `git fetch origin` (jangan asumsikan lokal terkini).
2. Cek divergensi: `git rev-list --left-right --count HEAD...origin/main` (atau `git status`).
   - **Lokal di belakang / diverge** → **integrasikan DULU** (`git pull --rebase` bila lokal bersih;
     bila ada commit lokal, rebase ke `origin/main`) **sebelum** menyentuh tugas. Baca commit baru
     origin (mungkin ada audit/keputusan/renumber yang mengubah rencana).
   - **Sinkron / lokal di depan bersih** → lanjut.
3. Bila working tree kotor saat fetch menunjukkan divergensi → laporkan ke user, jangan paksa.

Jangan lewati langkah ini walau "cuma mau baca" — status di `CONTEXT.md` lokal bisa ketinggalan
dari kebenaran di `origin`.

## Step 1 — Baca berurutan

**Wajib baca penuh** (status + aturan yang berubah tiap sesi — inti "di mana kita"):

1. `docs/DECISIONS.md` — locked / pending / JANGAN PERNAH
2. `docs/MAP.md` — peta repo
3. `docs/CONVENTIONS.md` — pola wajib & terlarang
4. `docs/GOTCHAS.md` — jebakan yang sudah ditemukan (indeks 1-baris)
5. `docs/CONTEXT.md` — status terkini, milestone aktif, blocker (entri teratas = di mana kita)
6. `docs/ISSUES.md` — issue open, prioritas (fokus bagian **Terbuka**)
7. `HANDOFF_CONTEXT_v{n}.md` versi terbaru, bila ada

**Referensi on-demand** (spec/bentuk-sistem STABIL — jangan baca penuh tiap sesi; proyek matang
tanpa milestone aktif per 19 Jul). Skim header untuk orientasi; **deep-read HANYA saat task hari
ini menyentuhnya** (fitur baru, ubah arsitektur, sengketa scope):

- `docs/PROJECT.md` — masalah, persona, user story, AC. Flow + wireframe sudah diarsip
  (`.archived/PROJECT-design.md`) — baca dari sana bila perlu.
- `docs/ARCHITECTURE.md` — C4, container map, tech stack.

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
