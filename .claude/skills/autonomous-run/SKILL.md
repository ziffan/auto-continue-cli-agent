---
name: autonomous-run
description: >-
  Jadwalkan sesi kerja OTONOM tanpa ditunggu — fire di waktu dinding (biasanya tepat setelah
  usage-limit reset), lalu lanjutkan milestone sendiri dengan pola Opus-orkestrator/Sonnet-kuda-beban
  + tier-review + commit, dan BERHENTI BERSIH di batas yang butuh manusia. Jalankan saat user bilang
  "jadwalkan lanjut jam X", "set schedule lanjut jam X", "lanjut mandiri saat aku tidur", "kerjakan
  milestone otonom sampai reset berikutnya", "lanjut otonom bertahap", atau minta melanjutkan kerja
  tanpa ditunggui setelah kuota reset. Juga rujuk skill ini saat kamu BANGUN dari jadwal itu.
---

# Autonomous Run — kerja terjadwal tanpa ditunggu

Kenapa skill ini ada: user menjalankan sesi agent panjang lalu tidur / pergi saat usage-limit-nya
belum reset. Skill ini menjadwalkan agent untuk **melanjutkan sendiri** begitu kuota pulih, dengan
disiplin yang sama seperti saat user menunggui — dan yang **terpenting**, tahu **kapan berhenti** dan
menyerahkan kembali ke manusia. Otonomi di sini = *melanjutkan pekerjaan yang sudah disepakati*, bukan
mengarang arah baru.

## Prinsip (jangan dilanggar)

- **Otonom ≠ tanpa batas.** Hanya kerjakan slice yang **autonomous-safe** (definisi di Step 2). Semua
  yang outward-facing / butuh limit-quota asli / butuh keputusan user / ADR belum di-lock → **HARD-STOP**,
  surface ke user, jangan kerjakan/karang sendiri.
- **Tier-review tak pernah dilewati** demi "hemat waktu". Tiap diff subagent → skill `tier-review` sebelum
  commit. Jalankan build/test/lint **sendiri** — jangan percaya klaim subagent.
- **Jangan relitigasi ADR Accepted.** Patuhi semua hard rule `CLAUDE.md §4`.
- **Jangan tinggalkan state setengah jadi.** Selalu tutup slice atomik + update docs sebelum tidur/reschedule.

## Step 1 — Pilih mekanisme jadwal yang benar

Untuk wake lokal di waktu dinding beberapa jam ke depan (mis. reset kuota 02:30), pakai **`CronCreate`
one-shot** (`recurring:false`). Bukan yang lain — dan tahu alasannya:

| Mekanisme | Kenapa BUKAN ini |
|---|---|
| **Cloud `schedule` skill** (RemoteTrigger) | Checkout fresh dari GitHub, **tak lihat branch/working-tree lokal**, billing terpisah, mulai dingin. Cocok untuk job cloud mandiri, **bukan** melanjutkan sesi lokal ini. |
| **`ScheduleWakeup`** | Di-clamp ke maks **1 jam** — tak bisa menjangkau target berjam-jam ke depan dalam satu lompatan; polling tiap <1j justru **membakar budget** yang sedang menipis. |
| **`CronCreate` one-shot** ✅ | Lokal, **session-only in-memory**, fire saat REPL idle, **tak makan budget di antaranya**. Fired prompt masuk ke **sesi ini** (konteks utuh). |

**Wajib diberitahu ke user:** cron ini **hilang kalau terminal/sesi Claude ditutup** (tak persist ke disk)
— terminal harus tetap nyala.

**Waktu:** konversi ke waktu lokal, konfirmasi ke user, dan **pilih beberapa menit SETELAH** reset yang
diharapkan. Hindari menit `:00`/`:30` (one-shot bisa fire **s/d 90 detik lebih awal** → mendarat sebelum
kuota reset → gagal). Pakai off-minute (mis. `:35`). Cron 5-field lokal: `M H DoM Mon *`, `recurring:false`.

## Step 2 — Tetapkan scope otonom (autonomous-safe vs hard-stop)

Sebelum menjadwalkan, tegaskan batas — ini inti keselamatan skill ini.

**Autonomous-safe (boleh dikerjakan sendiri):**
- Slice yang **pure / fixture / socket-testable** — hasilnya terbukti tanpa menyentuh dunia luar.
- Tak butuh limit/quota **asli** untuk verifikasi.
- Tak ada side-effect outward-facing baru (tak mengirim ke layanan eksternal, tak menyentuh sesi/proses
  milik user, tak menulis di luar repo).
- Tak butuh keputusan user; semua ADR terkait sudah **Accepted**.

**HARD-STOP (surface ke user, jangan kerjakan):**
- Outward-facing / sulit dibalik — inject ke sesi/proses nyata, egress jaringan cara baru, publish.
- Butuh limit/quota **asli** yang tak bisa dipaksa (mis. verifikasi perilaku saat kuota benar-benar habis).
- Butuh **keputusan user** atau **ADR belum di-lock** (jangan mengarang keputusan).
- Milestone ber-**security-gate** (mis. yang butuh review keamanan manusia).

Tulis pemetaan ini eksplisit ke user saat menjadwalkan, dan tanam ke prompt wake (Step 3).

## Step 3 — Buat cron one-shot dengan prompt wake self-contained

Prompt yang di-`CronCreate` akan mem-fire di sesi ini. Isinya harus lengkap (asumsikan konteks bisa
ter-compact). Kerangka wajib:

1. Penanda `[BANGUN OTONOM — <jam>, window usage seharusnya reset]`.
2. "Jika konteks ter-compact, jalankan skill `session-start` dulu (baca `docs/`)."
3. **Loop kerja:** (a) tangani hasil subagent yang sedang jalan → `tier-review` (jalankan gate sendiri);
   (b) kalau hijau → commit `M{n}: …` + update `docs/CONTEXT/ISSUES/GOTCHAS` + merge ke `main` (kamu =
   reviewer ≥ eksekutor, pola `milestone-wrapup`) + push; (c) lanjut ke slice autonomous-safe berikutnya
   (`vertical-slice`, spec presisi → Sonnet `model:sonnet` → tier-review → commit — pola ADR-016).
4. **Batas HARD-STOP** (dari Step 2) — daftar eksplisit apa yang TAK boleh dimulai; untuk itu surface ke user.
5. **Penjaga budget:** kalau usage mendekati limit lagi di tengah jalan → selesaikan slice atomik yang
   berjalan dengan bersih → `session-end` (update CONTEXT jujur + commit) → **`CronCreate` one-shot baru untuk
   reset berikutnya** (~siklus limit berikutnya) dengan instruksi yang sama → berhenti. Jangan tinggalkan WIP.
6. "Patuhi `CLAUDE.md §4`; jangan relitigasi ADR Accepted."

## Step 4 — Saat BANGUN (fired)

Eksekusi loop Step 3. Disiplin yang tak boleh kendor:
- **Verifikasi sendiri**, bukan klaim: `npm run build` / test / lint dari terminalmu, baca diff Tier-1
  baris-per-baris (state machine / migrasi / audit / keamanan). Temuan MAJOR → perbaiki (inline bila
  ~≤30 baris subtil, else re-delegate) lalu re-verifikasi.
- **Satu sesi = kemajuan bertahap**, satu slice atomik pada satu waktu; commit + docs tiap slice supaya
  state tak pernah hilang bila fire berikutnya mulai dari nol.

## Step 5 — Berhenti & lapor (checkpoint)

Saat mengenai HARD-STOP (bukan kehabisan budget): **jangan reschedule**. Tulis checkpoint ringkas ke user:
apa yang selesai + bukti (test hijau, commit), temuan penting yang ditangkap, **kenapa berhenti** (batas
mana yang kena), apa yang M-berikutnya butuh dari user (keputusan/verifikasi/limit asli), issue terbuka
yang dicatat, dan langkah pertama saat user kembali.

## Larangan

- Jangan reschedule melewati HARD-STOP asli — itu jatah manusia; reschedule **hanya** untuk budget habis
  di tengah kerja autonomous-safe.
- Jangan diam-diam melewati tier-review atau commit tanpa verifikasi dijalankan.
- Jangan tandai selesai sesuatu yang gate-nya tak kamu jalankan sendiri.
- Jangan pakai cloud `schedule`/`ScheduleWakeup` untuk kasus "lanjut sesi lokal ini" (lihat Step 1).
- Jangan lupa ingatkan: **terminal harus tetap nyala** (cron session-only).

## Kaitan skill lain

`session-start` (baca docs bila ter-compact) · `tier-review` (tiap diff subagent) · `vertical-slice`
(bentuk slice) · `milestone-wrapup` (tutup milestone) · `session-end` (sebelum reschedule) · `adr`
(jangan relitigasi locked). Pola model-routing = **ADR-016** (Opus orkestrator / Sonnet kuda beban).
