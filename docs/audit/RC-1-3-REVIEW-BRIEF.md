# Review Brief — Review Independen Tier-1 atas RC-1..RC-3 (commit `49de523`)

> Dokumen ini = **mandat review** untuk sesi Claude Code independen. Kamu (pembaca) adalah
> **reviewer independen**. Batch RC-1..RC-3 ditulis oleh sesi Opus utama **lalu di-self-review
> oleh sesi yang sama** — penulis sendiri menandai blind-spot *penulis = reviewer*. Tugasmu:
> **review Tier-1 (baris-per-baris) independen**, membentuk penilaianmu **sendiri** dari kode +
> docs proyek, **tanpa menelan bulat klaim commit message**. Review ini = **gate yang harus lulus
> sebelum milestone M3e dinyatakan hijau**.

---

## Step 0 — Konteks proyek (WAJIB dulu)

Jalankan skill **`session-start`** — **hanya Step 0–2** (sinkron `git fetch`, baca docs berurutan
PROJECT→ARCHITECTURE→DECISIONS→MAP→CONVENTIONS→GOTCHAS→CONTEXT→ISSUES, setor bukti pemahaman).
**LEWATI Step 3** (jangan usulkan rencana sesi / jangan tunggu approval) — langsung lanjut ke review
di bawah setelah bukti pemahaman.

## Step 1 — Ambil diff & baca kode penuh

```
git show 49de523
```

File tersentuh:
- **RC-1** → `src/daemon/supervisor.ts` (cabang resume)
- **RC-2** → `src/daemon/hook-relay.ts` + `src/shared/ids.ts`
- **RC-3** → `src/daemon/session-id-capture.ts`

Baca juga **versi penuh terkini** tiap file (diff bisa tak menampilkan konteks lengkap) + file test terkait
di `test/` (mis. `supervisor-dispatch.test.ts`, `hook-relay` / `ids` / `session-id-capture` tests).

## Apa yang tiap RC KLAIM lakukan — verifikasi tiap klaim ke kode (perlakukan sbg klaim, bukan fakta)

- **RC-1 (C-1):** resume-by-id dulu **MEMUAT** percakapan tapi tak **MELANJUTKANNYA**. Klaim fix: pasca
  `resume_spawned` sukses → enqueue job `resume` untuk sesi **BARU** (`run_at = now + RESUME_CONTINUE_DELAY_MS`)
  supaya dispatch jalur-alive meng-inject continue. Enqueue **best-effort** (try/catch + event
  `resume_continue_enqueue_failed`); kegagalan FK **TAK boleh** flip dispatch ke `'retry'` (kalau flip →
  loop re-spawn, lihat G-39).
- **RC-2 (C-2):** hook `SessionStart` `ccSessionId` dulu di-simpan dgn guard hanya `typeof string && length>0`
  → string arbitrer bisa jadi argv `claude --resume <val>`. Klaim fix: gate **`isCanonicalUuid`** (regex
  8-4-4-4-12) di `createHookHandler` **SEBELUM** capture **dan sebelum** latch → non-UUID = no-op senyap,
  UUID sah berikutnya tetap tertangkap.
- **RC-3 (C-3):** capturer id agy dulu **latch pada match PERTAMA** → isi transcript (tak tepercaya, ADR-013)
  bisa membajak `cli_session_id` sebelum resume-cmd sah yang agy cetak saat EXIT (G-36, kandidat TERAKHIR).
  Klaim fix: **last-match-wins** + emit-on-change → id exit-printed menang, event hanya saat berubah.

## Step 2 — Terapkan skill `tier-review` (Tier-1, baris-per-baris)

Area fokus (permukaan Tier-1 per review-tier proyek): **transisi state machine**, **injection firewall (ADR-013)**,
**keamanan FK/retry-loop (G-39)**, **kelengkapan validasi UUID** (ada bypass?), **resistensi pembajakan capturer**,
**idempotensi**, **error handling**, dan apakah **+test benar-benar menguji jalur yang diperbaiki** (bukan men-stub
seam yang justru sedang diuji — audit sebelumnya menemukan test yang meng-encode bug sbg ekspektasi).

Untuk **tiap** RC-1/RC-2/RC-3, jawab independen:
1. Apakah kode benar-benar melakukan yang diklaim?
2. Ada bug korektness / edge-case / celah firewall yang mungkin **terlewat oleh penulis (yang self-review)**?
3. Apakah test memadai & jujur?

Beri **verdict** per RC: **APPROVE / APPROVE-WITH-NITS / CHANGES-REQUESTED**, dengan temuan spesifik:
`file:line`, severity (P1/P2/P3), dan **skenario kegagalan konkret** (input/state → hasil salah/crash).

## Step 3 — Rekomendasi gate

Bisakah **gate keluar M3e** dinyatakan hijau atas batch ini, atau ada temuan **blocking (P1/P2)** yang harus
ditutup dulu? Nyatakan tegas.

**Opsional (lakukan — memperkuat review):** `npm run typecheck` lalu `npm run test`; catat hasilnya.

---

## Output

Tulis review lengkap ke **`docs/audit/AUDIT-RC-1-3-INDEPENDENT-2026-07-16.md`** (Bahasa Indonesia, technical
English OK, Markdown). **Tulis inkremental / simpan sambil jalan** supaya progres parsial selamat bila
terputus (mis. limit). **JANGAN ubah file sumber apa pun** — review-only.

**RC-4 TIDAK dalam scope** (belum diimplementasikan).
