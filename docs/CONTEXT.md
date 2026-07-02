# CONTEXT.md — status proyek

> Update **tiap sesi**. Baca ini dulu sebelum kerja — jangan asumsikan status.

---

## Status saat ini

- **Fase:** M0 — Perencanaan (Doc-First). Belum ada kode fitur.
- **Terakhir diupdate:** 2026-07-02.

## Sudah dikerjakan

- Repo git di-init (`main`), `.gitignore` dibuat.
- `CLAUDE.md` sebagai satu sumber konteks; `AGENTS.md` = **symlink** ke `CLAUDE.md` (git mode 120000).
- `README.md`.
- `docs/`: PROJECT (6 artefak discovery), RESEARCH (usage-limit + resume, bersumber), ARCHITECTURE (C4 L1–L2 + stack),
  DECISIONS (ADR-001..009, semua Proposed), NFR, MILESTONES, CONTEXT (file ini).

## Keputusan kunci (ringkas — detail di DECISIONS.md)

- Arsitektur (ADR-001, **direvisi 2 Jul 2026**): pisah **monitor usage** (jalur resmi — statusLine JSON
  Claude Code v2.1.80+ / endpoint OAuth usage) dari **deteksi sesi mati + resume** (PTY wrapper + fallback transcript).
- Stack usulan: TypeScript + Node LTS + node-pty + SQLite (semua masih Proposed, belum di-lock).
- Batas otonomi: hanya resume/probe whitelist; output CLI = data, bukan perintah.

## Temuan riset via Chrome + mesin (2 Jul 2026)

- Rantai isu #33820 → #27915 → **#18121 (fixed v2.1.80)**: usage Claude Code **kini** ada di statusLine JSON.
  Mengoreksi premis awal → ADR-001 direvisi.
- **Skema `rate_limits` terkonfirmasi** (docs resmi): `rate_limits.{five_hour,seven_day}.{used_percentage, resets_at}`
  (`resets_at` = epoch detik). Hanya Pro/Max, muncul pasca API-call pertama.
- **Terpasang di mesin ini:** Claude Code **2.1.198**, agy **1.0.15**, gemini 0.42.0. (Detail path di RESEARCH §4c.)
- **Resume terverifikasi dari binary:** `claude --resume <id>` / `agy --conversation <id>`
  (`agy -c` = sesi terakhir saja; `--conversation <id>` = by-id). Antigravity **tak punya** subcommand quota.
- Endpoint OAuth usage `api/oauth/usage` (undocumented, butuh token → sensitif) = opsi cadangan, ditunda.
- **agy usage:** `/usage` = slash command **TUI-only** (dikonfirmasi user); `agy --print "/usage"` → kosong.
  Probe usage agy = drive-PTY (kirim `/usage`, parse) atau endpoint server pakai `~/.gemini/oauth_creds.json` (sensitif).
- **Storage agy** (`~/.gemini/`, di-inspeksi read-only): conversations = `<UUID>.pb` **protobuf** (UUID = conversation id);
  **tak ada** cache usage lokal; onboarding-state di `antigravity_state.pbtxt`. `oauth_creds.json` = kredensial (tak dibaca).
- **Prior art CodexBar** (`steipete/CodexBar`, disarankan user): monitor usage macOS 56+ provider, Swift, **monitor-only,
  tanpa resume** → memvalidasi jalur PTY/OAuth kita; diferensiasi kita = **auto-resume + cross-OS + fokus 2 CLI**.
  Isu #1178 (usage Antigravity) **masih terbuka** — temuan §4d kita orisinal. Detail di RESEARCH.md §4d & §5b.

## Belum & langkah berikutnya

1. **Lock ADR** (ubah Proposed → Accepted) — terutama stack (ADR-003/004) sebelum M1.
2. **Sisa verifikasi** (RESEARCH.md §6 TODO #2): format persis **pesan/exit saat kena limit** untuk fixture
   Detector — butuh observasi terminal saat benar-benar kena limit (belum bisa dipaksa sekarang).
3. Buat DATA-MODEL.md, MAP.md, CONVENTIONS.md, DEPENDENCY-POLICY.md sebelum/awal M1.
4. Isi angka retensi arsip (Pending decision di DECISIONS.md).

## Catatan lingkungan

- Cross-platform wajib: Ubuntu (daily) + Windows 11 (weekend). Node LTS di kedua OS.
- Auto-resume butuh host always-on (kandidat: VPS / node headless LAN — lihat DECISIONS ADR-007).
- Belum ada remote git. `git commit` menunggu perintah user.
