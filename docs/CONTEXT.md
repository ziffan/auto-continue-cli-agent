# CONTEXT.md — status proyek

> Update **tiap sesi**. Baca ini dulu sebelum kerja — jangan asumsikan status.

---

## Status saat ini

- **Fase:** M0 — Perencanaan (Doc-First). Belum ada kode fitur.
- **Terakhir diupdate:** 2026-07-03 (sesi interaktif: re-cek versi CLI terpasang + rapikan CONTEXT.
  Sebelumnya dini hari: audit + validasi ulang seluruh docs via web_fetch docs resmi + GitHub).

## Sudah dikerjakan

- Repo git di-init (`main`), remote `origin` = github.com/ziffan/auto-continue-cli-agent, `.gitignore`
  (+ `.claude/settings.local.json` diignore per 3 Jul).
- `CLAUDE.md` sebagai satu sumber konteks; `AGENTS.md` = **symlink** ke `CLAUDE.md` (git mode 120000).
- `README.md`.
- `docs/`: PROJECT (6 artefak discovery), RESEARCH (usage-limit + resume, bersumber), ARCHITECTURE
  (C4 L1–L2 + stack), DECISIONS (ADR-001..009, semua Proposed), NFR, MILESTONES, CONTEXT (file ini).
- **Validasi riset ulang 3 Jul 2026** (run terjadwal): 4 koreksi/temuan material — lihat bawah.
- **Audit + validasi sesi 3 Jul dini hari:** semua klaim 2–3 Jul dire-cek ke sumber → **lolos semua**;
  2 temuan material baru (hook `StopFailure`, "limit ≠ exit") di-propagasi ke RESEARCH/DECISIONS/
  ARCHITECTURE/PROJECT/MILESTONES/README/CLAUDE.md.

## Keputusan kunci (ringkas — detail di DECISIONS.md)

- Arsitektur (ADR-001, direvisi 2 & 3 Jul): pisah **monitor usage** (statusLine JSON v2.1.80+ /
  endpoint OAuth usage) dari **deteksi limit + auto-continue**. Deteksi limit CC primer = **hook
  `StopFailure`** matcher `rate_limit` (v2.1.78+), fallback pola output PTY; **limit-hit ≠ proses
  exit** → dua jalur lanjut: inject "continue" ke PTY hidup vs resume-by-id sesi mati (RESEARCH §2c).
- Stack usulan: TypeScript + Node LTS + node-pty + SQLite (semua masih Proposed, belum di-lock).
- Batas otonomi: hanya resume/continue/probe whitelist; output CLI = data, bukan perintah.
- Pending decisions bertabel owner + target di DECISIONS.md (baru: probe agy; strategi continue sesi hidup).

## Temuan riset 2 Jul 2026 (Chrome + mesin) — masih berlaku

- Isu #18121 (fixed v2.1.80): usage Claude Code ada di statusLine JSON; skema `rate_limits.
  {five_hour,seven_day}.{used_percentage, resets_at}` terkonfirmasi (Pro/Max, pasca API-call pertama;
  `used_percentage` bisa pecahan).
- Terpasang di mesin: Claude Code **2.1.199**, agy **1.0.16**, gemini 0.42.0 (RESEARCH §4c).
- Resume: `claude --resume <id>` / `agy --conversation <id>`; agy auto-print resume cmd saat exit.
- Storage agy `~/.gemini/`: conversations = `<UUID>.pb` protobuf; tak ada cache usage lokal.

## Temuan & koreksi riset 3 Jul 2026 (run terjadwal) — masih berlaku

1. **CodexBar kini support Antigravity** (isu #1178 ditutup via PR #1341) → referensi implementasi
   `probeUsage()` agy (LSP probe + `retrieveUserQuota`). (RESEARCH §5b)
2. **`/usage` agy stale** (snapshot saat launch) → 3 opsi probe di RESEARCH §4b, pilihan = pending (< M3).
3. **Kompetitor langsung `claude-auto-retry`** (tmux-based, CC-only, no native Windows); tabel pola
   pesannya = korpus kandidat fixture (RESEARCH §2b).
4. **Risiko:** auto-continue native diminta ramai di upstream CC (#13354 tracking utama). **Pantau tiap sesi riset.**
5. Repo resmi `google-antigravity/antigravity-cli` ada; Gemini CLI individu EOL 18 Jun 2026.

## Temuan sesi 3 Jul 2026 dini hari (audit interaktif — sumber: docs resmi + GitHub via web_fetch)

1. **BARU (material) — hook `StopFailure`** (CHANGELOG v2.1.78; docs hooks resmi): fire saat turn
   berakhir karena API error, **matcher tipe error** — `rate_limit`, `overloaded`, `server_error`, dst.
   → jalur deteksi limit CC **event-driven resmi tanpa scraping**; sekaligus taxonomy pembeda
   **overload vs usage-limit**. Bonus lifecycle: `SessionStart` matcher `resume`, `SessionEnd` matcher
   reason. Diadopsi ke ADR-001 + RESEARCH **§2c (baru)**. Perlu uji empiris payload (TODO #7).
2. **BARU (material) — limit-hit ≠ proses exit.** Sesi interaktif TETAP HIDUP idle di prompt saat
   limit (basis: mekanisme claude-auto-retry + premis #13354). Konsekuensi: Detector melacak kondisi
   proses (`alive|exited`); lanjut via inject-PTY (hidup, gating foreground+idle) vs resume-by-id (mati).
   Flow PROJECT §4 + data model ARCHITECTURE §4 disesuaikan.
3. **Re-validasi klaim run terjadwal — semua lolos:** CodexBar #1178 Closed via PR #1341 ✓;
   antigravity-cli #46 Open ✓; CC #13354 open & belum ada sinyal implementasi (CHANGELOG nihil
   auto-continue) ✓; skema statusLine `rate_limits` ✓ (docs resmi); tabel pola claude-auto-retry ✓
   (README asli, match persis §2b).
4. **Detail probe CodexBar diperkaya** (docs/antigravity.md mereka): pilih connect-port via probe
   `GetUnleashData`; fallback `GetCommandModelConfigs`; fallback HTTP di `--extension_server_port`;
   `resetTime` ISO-8601/epoch. **Caveat:** dokumen mereka menarget language server **IDE Antigravity
   (macOS)** — apakah `agy` CLI men-spawn LS serupa di Win/Linux **belum diverifikasi** (inti TODO #5).
5. claude-auto-retry ternyata juga punya mode event-driven (`install-hook` StopFailure) + jalur
   overload backoff terpisah — validasi arah desain kita (RESEARCH §5c diperbarui).

## Belum & langkah berikutnya

1. **Lock ADR** (Proposed → Accepted) — terutama stack (ADR-003/004) sebelum M1. (Keputusan Ziffan.)
2. ~~Uji hook `StopFailure`~~ ✅ **selesai 3 Jul** (payload + `SessionStart resume` terkonfirmasi; field = `error`).
   Sisa kecil: tangkap nilai `error:"rate_limit"` saat limit 5-jam **asli** habis (tak bisa dipaksa).
3. **Fixture Detector** (TODO #2): konfirmasi lokal korpus §2b saat kena limit sungguhan + varian agy
   (termasuk: TUI agy hidup atau exit saat quota habis?). Bobot turun untuk CC (hook = primer).
4. **Uji 3 opsi probe usage agy** (TODO #5) → lock pending decision sebelum M3.
5. Buat DATA-MODEL.md, MAP.md, CONVENTIONS.md, DEPENDENCY-POLICY.md sebelum/awal M1.
6. Isi angka retensi arsip (Pending di DECISIONS.md, owner Ziffan).

## Uji hook `StopFailure` 3 Jul 2026 (siang) — TODO #7 ditutup (RESEARCH §2c)

- Hook dipasang via `--settings <file>` (isolasi), dipicu deterministik dgn `--model` bogus (`model_not_found`).
  **Payload `StopFailure` nyata terkunci** (v2.1.199, Windows). **Koreksi material vs docs:**
  - Field tipe error = **`error`** (BUKAN `error_type` seperti docs) → Detector wajib baca `error`.
  - Bonus **`last_assistant_message`** (teks user-facing) → fixture/log langsung; plus `prompt_id`, `effort.level`.
  - **`StopFailure` fire di print mode `-p` juga**, tak cuma interaktif.
- `SessionStart` terverifikasi: `source:"startup"` (baru) & **`source:"resume"`** (`--resume`); resume jalan (exit 0).
- **Sisa:** nilai `error:"rate_limit"` asli belum diobservasi (butuh limit 5-jam habis; tangkap saat terjadi).
- Harness uji di scratchpad `hooktest/` (non-repo).

## Re-cek versi CLI 3 Jul 2026 (siang) — tak ada perubahan spek

- Versi terpasang naik patch: Claude Code **2.1.198→2.1.199**, agy **1.0.15→1.0.16** (gemini 0.42.0 tetap).
- Changelog keduanya diverifikasi (CC: cache lokal `changelog.md`; agy: GitHub releases). **Fakta spek-kritis
  tetap:** StopFailure hook (≥2.1.78), skema statusLine `rate_limits` (≥2.1.80), limit≠exit, resume
  (`--resume`/`--conversation`). **Auto-continue native belum ada** di CC → **risiko #4 belum terpicu.**
- Koroboratif (bukan perubahan spek): CC 2.1.199 kini auto-retry **429 transient non-usage-limit** →
  memperkuat taksonomi overload-vs-usage-limit (§2c); agy 1.0.16 juga menambah client-side retry transient.
  Konsekuensi desain: Detector hanya trigger resume pada usage-limit asli, **jangan** pada 429 transient.
- Angka versi disinkronkan ke RESEARCH §4c/§2/§6, ARCHITECTURE tabel resume, dan file ini.

## Catatan lingkungan

- Cross-platform wajib: Ubuntu (daily) + Windows 11 (weekend). Node LTS di kedua OS.
- Auto-resume butuh host always-on (kandidat: VPS / node headless LAN — lihat DECISIONS ADR-007).
- Remote git: `origin` = https://github.com/ziffan/auto-continue-cli-agent.git. Perubahan 3 Jul (run
  terjadwal + audit dini hari) **sudah di-commit** (`9c0c75e`). Perubahan sesi ini (re-cek versi + rapikan
  CONTEXT) **belum di-commit** — `git commit` menunggu perintah user.
