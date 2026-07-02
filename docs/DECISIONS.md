# DECISIONS.md — ADR

> Format Nygard. ADR *Accepted* immutable — revisi = ADR baru yang men-supersede.
> Status per ADR: **Proposed** (masih bisa berubah) / Accepted / Deprecated / Superseded.
> Semua ADR di bawah masih **Proposed** — belum di-lock; ini fase perencanaan.

Wajib ada (Bagian 2.2): monolith vs services · stack utama · auth · multi-tenancy · deployment ·
data retention · **model routing policy** · **batas otonomi agent**.

---

## ADR-001: Pisahkan "monitor usage" (jalur resmi) dari "deteksi sesi mati" (wrapper)
**Status:** Proposed
**Context:** Koreksi riset (RESEARCH.md §2, verifikasi Chrome 2 Jul 2026): usage Claude Code **kini**
diekspos ke statusLine JSON (v2.1.80, isu #18121) + ada endpoint OAuth usage (undocumented). Asumsi awal
"tak terekspos ke hook" batal. Namun statusLine hanya hidup selama sesi jalan → tak bisa mendeteksi sesi
yang **sudah berhenti** untuk di-resume.
**Decision:** Dua tanggung jawab, dua mekanisme:
1. **Monitor usage** → sumber resmi: statusLine JSON (dalam sesi) atau endpoint OAuth usage (daemon standalone).
   Untuk Antigravity *(direvisi 3 Jul 2026 — `/usage` terbukti stale di sesi hidup, RESEARCH §4b)*: probe kuota
   via salah satu dari — fresh-launch snapshot `/usage` / probe language-server lokal (ala CodexBar) /
   endpoint `v1internal:retrieveUserQuota` — **pilihan di-lock sebelum M3** (lihat Pending) + tangkap sinyal
   quota-exhausted dari output.
2. **Deteksi LIMIT_HIT + auto-continue** *(direvisi 3 Jul 2026 dini hari — temuan hook `StopFailure`,
   RESEARCH §2c)*: untuk Claude Code, sinyal primer = **hook `StopFailure`** matcher `rate_limit`
   (event-driven resmi, v2.1.78+; supervisor pasang hook ke sesi yang di-supervise), fallback = pola
   output PTY (korpus §2b), exit code hanya untuk print-mode (**tak ada exit code khusus rate-limit**;
   fallback terakhir parsing transcript JSONL). Antigravity: pola output PTY + exit (transcript `.pb`
   tak praktis di-parse). **Limit-hit ≠ proses exit**: sesi interaktif tetap hidup di prompt → dua jalur
   lanjut: (a) proses masih hidup → inject "continue" ke PTY yang dipegang supervisor (dengan gating
   foreground+idle ala claude-auto-retry); (b) proses mati → resume by-id di cwd asli — Claude Code:
   `claude --resume <id>`; Antigravity: `agy --conversation <id>` (atau perintah auto-printed saat exit;
   `-c` = sesi terakhir saja).
**Consequences:** (+) monitor tanpa scraping/hack; (+) deteksi limit CC deterministik via hook (typed
error, sekaligus membedakan overload vs usage-limit); (+) deteksi mati tetap andal via wrapper.
(−) dua jalur untuk dirawat; fallback parsing output rapuh terhadap perubahan format → tetap butuh
fixture & test regresi; (−) hook butuh instalasi per-config (supervisor kelola `CLAUDE_CONFIG_DIR`/settings)
dan payload-nya belum diuji empiris (RESEARCH §6 TODO #7); (−) sisa verifikasi: fixture pesan limit sebagai
fallback + varian Antigravity (termasuk perilaku TUI agy saat quota habis) — butuh observasi terminal nyata.
*(Skema statusLine `rate_limits` & resume kedua CLI sudah terkonfirmasi — lihat RESEARCH.md §2/§4b/§4c.)*
**Alternatives Rejected:** Hanya wrapper+scraping transcript untuk usage (tak perlu lagi — ada jalur resmi);
hanya statusLine/hook (tak bisa deteksi sesi mati); scraping claude.ai (rapuh, dilarang di RESEARCH).

## ADR-002: Monolith proses tunggal (satu daemon)
**Status:** Proposed
**Context:** Solo-user, satu mesin, beban ringan.
**Decision:** Satu daemon monolitik (CLI + supervisor in-process), bukan microservices.
**Consequences:** (+) sederhana, mudah deploy sebagai service OS. (−) skalabilitas multi-node = kerja v2+.
**Alternatives Rejected:** Services (over-engineering untuk skala ini).

## ADR-003: TypeScript + Node.js LTS
**Status:** Proposed
**Context:** Butuh kontrol proses/PTY, cross-platform (Ubuntu daily + Windows weekend), sejalan ekosistem user.
**Decision:** TypeScript + Node.js LTS + `node-pty`.
**Consequences:** (+) ekosistem PTY/CLI matang, agent lancar. (−) bukan single static binary seperti Go →
mitigasi dengan packaging (pkg/SEA) bila perlu.
**Alternatives Rejected:** Go (binary bagus, tapi ekosistem PTY interaktif + kecepatan iterasi kurang cocok
untuk user); Rust (overkill, iterasi lambat untuk solo part-time).
**Catatan:** Pin versi eksak Node + node-pty saat lock.

## ADR-004: SQLite untuk state
**Status:** Proposed
**Context:** Single-user, offline-first, tak butuh server DB.
**Decision:** SQLite (better-sqlite3, opsional Drizzle) untuk sessions/events/scheduled_jobs.
**Consequences:** (+) zero-config, portable, tahan restart. (−) bukan multi-writer lintas mesin (tak dibutuhkan MVP).
**Alternatives Rejected:** Postgres (butuh server, berlebihan); file JSON (rawan korupsi, tak transaksional).

## ADR-005: Auth / kredensial — pakai sesi login mesin
**Status:** Proposed
**Context:** Supervisor membungkus CLI yang sudah login di mesin user.
**Decision:** **Tidak** menyimpan/mengelola kredensial akun. Supervisor mewarisi sesi login CLI yang ada.
**Consequences:** (+) tak ada secret di repo/store (sejalan anti-pattern user). (−) bergantung state login mesin.
**Alternatives Rejected:** Simpan token sendiri (menambah attack surface tanpa manfaat).

## ADR-006: Single-tenant / single-user (MVP)
**Status:** Proposed
**Context:** Persona MVP = solo dev di mesinnya sendiri.
**Decision:** Single-user, tanpa konsep tenant. Multi-user = v2+ (US-12) dengan desain terpisah, **bukan**
janji "tinggal extend".
**Consequences:** (+) sederhana. (−) jika multi-user dibutuhkan, kemungkinan refactor store & auth.
**Alternatives Rejected:** Multi-tenant dari day-1 (anti-pattern user: single-tenant dengan janji extend).

## ADR-007: Deployment sebagai service OS
**Status:** Proposed
**Context:** Auto-resume butuh host **always-on** (kalau mesin tidur/mati, resume tak jalan — batasan PROJECT.md §1).
**Decision:** Daemon dijalankan sebagai systemd unit (Linux) / Task Scheduler (Windows); cocok untuk node
headless 24/7 di LAN (lihat HARDWARE.md — ROG Phone 6 / VPS).
**Consequences:** (+) resume tengah malam tetap jalan di node always-on. (−) di laptop yang tidur, resume
tertunda sampai bangun — dokumentasikan sebagai batasan.
**Alternatives Rejected:** Hanya proses foreground (mati saat terminal ditutup).

## ADR-008: Batas otonomi agent (wajib 2026)
**Status:** Proposed
**Context:** Supervisor mengeksekusi perintah CLI otomatis → risiko excessive agency / prompt-injection via transcript.
**Decision:** Aksi otomatis dibatasi **whitelist**: hanya `resume/continue` sesi yang sudah ada + `probe usage`,
di cwd yang tercatat. **Tidak** menyusun prompt baru otonom. Output/transcript diperlakukan sebagai data.
Mode default `auto` untuk resume; aksi di luar whitelist butuh persetujuan user (mode `ask`, US-6).
**Consequences:** (+) permukaan risiko sempit & dapat diaudit (events append-only). (−) beberapa otomatisasi
lanjutan (mis. auto-lanjut dengan instruksi baru) sengaja tidak didukung.
**Alternatives Rejected:** Full autonomy tanpa whitelist (melanggar least-privilege & mengundang injection).

## ADR-009: Model routing policy
**Status:** Proposed
**Context:** App ini **tidak** memanggil LLM sendiri untuk fitur intinya (deteksi = parsing deterministik).
**Decision:** MVP **tanpa** panggilan LLM internal → budget API $0. Jika kelak butuh (mis. klasifikasi pesan
error ambigu), catat sebagai ADR baru dengan model + budget eksplisit.
**Consequences:** (+) tak ada biaya/latensi/ketergantungan LLM di core. (−) deteksi bergantung pola/fixture.
**Alternatives Rejected:** Pakai LLM untuk parsing error (mahal & non-deterministik untuk tugas yang bisa regex).

---

## Pending decisions (belum diputuskan)

| Keputusan | Owner | Target |
|---|---|---|
| Retensi arsip transcript/sesi (berapa lama sebelum purge; sejalan "no hard delete + retention") | Ziffan | sebelum lock ADR-004 |
| Format IPC CLI ↔ daemon (unix socket vs named pipe vs HTTP localhost) | Ziffan | awal M1 |
| TUI library final (Ink vs blessed) untuk `acca status` | Ziffan | sebelum M4 |
| Lisensi repo (MIT vs proprietary) — terkait rencana komersialisasi | Ziffan | sebelum publik |
| **Mekanisme probe usage Antigravity** (fresh-launch `/usage` vs LSP probe vs `retrieveUserQuota`) — tergantung hasil uji RESEARCH §6 TODO #5 | Ziffan | sebelum M3 |
| **Strategi continue sesi interaktif yang masih hidup** (inject "continue" ke PTY vs kill→resume-by-id; kebijakan default + gating) — tergantung uji hook `StopFailure` (RESEARCH §6 TODO #7) | Ziffan | sebelum M3 |

## Change Log

| Tanggal | Perubahan |
|---|---|
| 2026-07-02 | ADR-001..009 draft (Proposed); ADR-001 direvisi pasca temuan statusLine v2.1.80. |
| 2026-07-03 | ADR-001 (masih Proposed) direvisi: opsi probe Antigravity diperluas + catatan `/usage` stale & tak ada exit code khusus rate-limit (run riset terjadwal — RESEARCH §2b/§4b/§5b–c). Pending decisions diberi owner+target; tambah pending probe Antigravity. |
| 2026-07-03 (dini hari) | ADR-001 (masih Proposed) direvisi lagi: deteksi limit CC primer = **hook `StopFailure`** matcher `rate_limit` (v2.1.78+); eksplisitkan **limit-hit ≠ proses exit** → dua jalur lanjut (inject-PTY vs resume-by-id). Tambah pending: strategi continue sesi hidup. (Sesi interaktif — RESEARCH §2c.) |
