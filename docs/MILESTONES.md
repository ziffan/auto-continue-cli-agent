# MILESTONES.md — auto-continue-cli-agent

> Milestone = **atomic vertical slice**, 2–5 hari kerja (≈1–2 minggu weekday atau 1 blok weekend).
> Kriteria selesai testable; integration test di akhir tiap milestone. Branch per milestone.

---

## M0 — Perencanaan (Doc-First) ← **fase sekarang**
**Selesai bila:** `docs/` suite terisi (PROJECT, RESEARCH, ARCHITECTURE, DECISIONS, NFR, MILESTONES, CONTEXT);
CLAUDE.md ≤200 baris + symlink AGENTS.md; repo + .gitignore.
**Status:** hampir selesai. **Stack di-lock 3 Jul (ADR-003/004 Accepted)**; ADR-010 (probe hybrid) Proposed.
Uji terminal 3 Jul: hook `StopFailure` (TODO #7) **selesai**, probe agy LS/RPC (TODO #5) **maju besar** (§5b).
Sisa verifikasi (butuh **terminal nyata**/limit asli): fixture pesan limit lokal + `quotaInfo` non-nil LS interaktif
+ req/resp `retrieveUserQuota` (RESEARCH §6 TODO #2/#5).

## M1 — Fondasi + Process Wrapper
**Slice:** `acca run -- <cli>` men-spawn CLI target via PTY, mencatat tool/session-id/cwd/pid ke SQLite,
dan menampilkan output apa adanya.
**Selesai bila:** bisa menjalankan Claude Code & Antigravity CLI di bawah wrapper; sesi tercatat di store;
`acca status` menampilkan sesi RUNNING (empty state bila kosong). Integration test: run → exit normal → status EXITED.

## M2 — Detector + Reset Estimator
**Slice:** kenali LIMIT_HIT — CC: hook `StopFailure` (primer) + pola output + exit code (print-mode) +
transcript; agy: pola output/exit — beserta kondisi proses (hidup|exit); isi reset_at (sinyal pasti →
heuristik → backoff, ditandai sumbernya).
**Selesai bila:** AC-1, AC-2 lulus dari fixture + hook event; false positive < 1/100 pada korpus uji;
overload (429/5xx/529) TIDAK terklasifikasi sebagai usage-limit.
**Dependensi:** fixture pesan limit + hasil uji hook (RESEARCH §6 TODO #2/#7).

## M3 — Scheduler + Usage Probe + Auto-continue
**Slice:** jadwalkan lanjut; pada reset_at → probe kuota → lanjut sesuai kondisi proses (inject "continue"
ke PTY hidup dengan gating foreground+idle, ATAU resume-by-id di cwd asli); backoff bila kosong;
state tahan restart daemon.
**Selesai bila:** AC-3, AC-6, AC-7, AC-8 lulus. Integration test end-to-end: simulasi LIMIT_HIT → tunggu →
probe → resume di cwd benar (uji juga kasus cwd hilang → BLOCKED).

## M4 — Notifikasi + Monitor UX
**Slice:** notifikasi desktop/CLI pada transisi LIMIT_HIT/RESUMED/FAILED; `acca status` TUI lengkap
(usage best-effort + indikator "perkiraan" + loading/empty/error state); `acca log`.
**Selesai bila:** AC-4, AC-5 lulus; UX states eksplisit teruji.

## M5 — Hardening + Deploy sebagai service
**Slice:** jalankan daemon sebagai systemd (Linux) / Task Scheduler (Windows); security pass
(least-privilege whitelist, audit events); dokumentasi user + install.
**Selesai bila:** daemon survive reboot host; security review lolos; README/quick-start user siap.

---

## Backlog (post-MVP, dari user stories)

- v1 (Nice): mode `ask` konfirmasi resume (US-6), backoff cerdas (US-7), riwayat kaya (US-8), notifikasi eksternal opt-in (US-9).
- v2+ (Later): dashboard web (US-10), adapter OpenCode & lain (US-11), multi-user/tim (US-12), prediksi proaktif (US-13).

## Urutan dependency dokumen (Bagian 2.6)

PROJECT → ARCHITECTURE (+DECISIONS) → DATA-MODEL/CONTRACTS → NFR/CAPACITY/FAILURE/SECURITY → MILESTONES → MAP+CONVENTIONS.
File yang **belum** dibuat (menyusul saat dibutuhkan): DATA-MODEL.md, FAILURE-MODES.md, SECURITY.md,
DEPENDENCY-POLICY.md, MAP.md, CONVENTIONS.md.
