# ARCHITECTURE.md — auto-continue-cli-agent

> Bagian 2.2. C4 level 1–2 wajib. Keputusan ber-ADR ada di `DECISIONS.md` (dirujuk, tidak diduplikasi).

---

## 1. C4 — Level 1: System Context

```
        ┌─────────────┐         menjalankan / resume        ┌──────────────────┐
        │  Solo        │ ──────────────────────────────────▶│  Claude Code CLI │
        │  Orchestrator│                                      └──────────────────┘
        │  (user)      │ ── `acca run/status/log` ─┐          ┌──────────────────┐
        └─────────────┘                            │          │  Antigravity CLI │
          ▲    ▲                                    ▼          └──────────────────┘
   notif  │    │ notif+kontrol+       ┌───────────────────────┐   spawn/monitor  ▲
  lokal   │    │ relay (via Telegram) │  auto-continue-cli    │──────────────────┘
          └────┼──────────────────────│  -agent (supervisor)  │
               │                      └───────────────────────┘
               │ getUpdates/sendMessage   │ baca      │ egress probe
               ▼ (outbound-only)          ▼           ▼
        ┌──────────────────┐    transcript JSONL    api.anthropic.com /
        │  api.telegram.org │    + output CLI        cloudcode-pa.googleapis.com
        └──────────────────┘                         (usage probe, ADR-010)
```

Sistem = satu kotak (supervisor). External: user, dua CLI agent, filesystem transcript, channel notifikasi
lokal, **Telegram (`api.telegram.org`)** sebagai kanal remote (notif keluar + kontrol/relay masuk, long-polling
outbound-only — ADR-011), endpoint usage provider (probe, ADR-010). Trust boundary remote + ancaman: **THREAT-MODEL.md**.

## 2. C4 — Level 2: Container

```
auto-continue-cli-agent
├── CLI (acca)              — entrypoint user: run / status / log / resume-now / cancel
├── Supervisor daemon       — proses inti; koordinasi lifecycle sesi
│   ├── Process Wrapper      — spawn CLI via PTY, tangkap stdout/stderr/exit code
│   ├── Detector             — kenali LIMIT_HIT: CC = hook StopFailure (primer) | pola output |
│   │                          exit code (print-mode) | transcript JSONL; agy = pola output/exit
│   │                          (.pb tak di-parse). Limit ≠ exit: lacak proses hidup vs mati (RESEARCH §2c)
│   ├── Reset Estimator      — hitung reset_at (sinyal pasti → heuristik → backoff)
│   ├── Scheduler            — timer terjadwal, tahan restart, trigger probe+resume
│   ├── Usage Probe          — cek kuota tersedia (Claude Code: statusLine JSON / endpoint OAuth
│   │                          usage; Antigravity: fresh-launch /usage | LSP probe | retrieveUserQuota
│   │                          — pilihan pending, RESEARCH §4b) — per adapter
│   └── Notifier             — desktop/CLI (MVP); Telegram outbound (tier A, via Remote Gateway); eksternal lain (Nice)
├── Remote Gateway           — kanal Telegram (ADR-011/012/013; MVP tier A+B+C). Guardrail: THREAT-MODEL.md
│   ├── Notifier egress       — kirim notif transisi status ke `chat_id` sah (tier A); redaksi+size-cap utk output (tier C)
│   ├── Command listener       — long-polling `getUpdates` (outbound-only); parse perintah kontrol (tier B)
│   ├── Authz                  — allowlist `chat_id` default-deny, per-command, rate-limit per sender (ADR-012)
│   └── Confirm gate           — queue instruksi → echo → `/confirm <token>` → inject PTY (human-in-the-loop, ADR-013)
├── Adapters                 — abstraksi per-tool (claude-code, antigravity)
│   └── kontrak: detectLimit(), parseReset(), resumeCmd(cwd,id), probeUsage()
└── Store (SQLite)          — sesi, event log, timer terjadwal, arsip transcript ref
```

Protokol antar-kotak: CLI ↔ daemon via IPC lokal (socket/named pipe) atau invoke langsung; daemon ↔ CLI
target via PTY (stdio); daemon ↔ store via SQL lokal; daemon ↔ transcript via filesystem read-only.
**Remote Gateway ↔ Telegram** via HTTPS long-polling (outbound-only ke `api.telegram.org`, tak buka port
ingress — ADR-011); Remote Gateway ↔ supervisor lewat **IPC lokal yang sama** seperti CLI (otoritas identik,
tak ada yang baru — ADR-012). **Injection firewall:** jalur data (isi output) & jalur perintah terpisah; tak
ada aksi diturunkan dari isi output (ADR-013). Ingress/egress remote = trust boundary → **THREAT-MODEL.md**.

## 3. Tech stack (**di-lock 3 Jul 2026** — ADR-003/004/010/011 Accepted)

| Layer | Pilihan (status) | Alasan singkat |
|---|---|---|
| Bahasa/runtime | **TypeScript + Node.js 24 LTS** *(ADR-003, locked; pin v24.18.0)* | Kontrol proses/PTY matang, cross-platform (Ubuntu+Windows), sejalan ekosistem user |
| PTY | `node-pty` **1.1.0** *(ADR-003, locked)* | Tangkap output interaktif CLI apa adanya; **PTY wajib** (CC inject-continue & agy LS bind — §2c/§5b) |
| Usage source (Claude Code) | statusLine JSON `rate_limits.{five_hour,seven_day}` (v2.1.80+) / endpoint OAuth usage | Jalur resmi/semi-resmi, hindari scraping |
| Deteksi limit (Claude Code) | hook `StopFailure` matcher `rate_limit` (v2.1.78+) → pola output PTY → exit code (print-mode) | Event resmi ber-taxonomy (bedakan overload vs limit); scraping = fallback (RESEARCH §2c) |
| Usage source (Antigravity) | **hybrid (ADR-010):** LS `GetUserStatus` (sesi interaktif hidup, tanpa csrf) + OAuth `retrieveUserQuota` (pre-resume) | `/usage` stale & print-spawn quota nil (terbukti §5b); csrf tak diperlukan di localhost |
| Resume (Claude Code / Antigravity) | `claude --resume <id>` / `agy --conversation <id>` | Terverifikasi v2.1.199 / v1.0.16 |
| Store | **SQLite** via `better-sqlite3` **12.11.1** (opsional `drizzle-orm` 0.45.2) *(ADR-004, locked)* | Single-user, offline-first, tidak butuh server |
| CLI framework | **commander** (Accepted) + **plain ANSI render** utk `acca status` (11 Jul, TANPA TUI lib) | Monitor = snapshot sekali-cetak (tabel + bar `▓▓░` + ANSI); nol dep TUI (Ink/blessed ditolak); `watch` utk refresh |
| Scheduler | in-process timer + tabel `scheduled_jobs` persisten | Tahan restart daemon |
| Notifikasi | node-notifier (desktop) / stdout | MVP lokal; eksternal = Nice |
| Remote channel (Telegram) | **`grammy` 1.44.0** *(ADR-011, locked)* — long-polling `getUpdates` outbound-only | Notif+kontrol+relay dari HP; TS-first, 4 dep, tanpa server webhook |
| Redaksi egress (tier C) | **hybrid regex+entropy** *(ADR-013 §2, locked)* — modul in-repo | Redaksi rahasia best-effort lapis-1 (di belakang size-cap + opt-in) |
| Packaging | daemon via systemd (Linux) / Task Scheduler (Windows) | Always-on host (lihat NFR) |

Prinsip: pilih yang populer (agent lancar), sesederhana mungkin, adapter-pattern supaya tool ketiga (OpenCode)
bisa ditambah tanpa ubah core. **Pin versi eksak di DECISIONS.md saat lock.**

## 4. Data model (ringkas — detail menyusul di DATA-MODEL.md)

- `sessions` — id, tool, session_id, cwd, pid, status (`RUNNING|LIMIT_HIT|WAITING|RESUMED|EXITED|BLOCKED|FAILED`),
  **proc_state (`alive|exited`)** — LIMIT_HIT bisa terjadi dengan proses masih hidup di prompt (RESEARCH §2c;
  menentukan jalur lanjut: inject-PTY vs resume-by-id — **strategi & gating di ADR-014**), detected_at, reset_at,
  reset_source (`exact|heuristic|backoff`), created_at, updated_at.
- `events` — id, session_id, type, payload(JSON), created_at (audit trail, append-only).
- `scheduled_jobs` — id, session_id, run_at, kind (`probe|resume`), attempts, next_backoff.

Tidak ada hard delete: sesi selesai diarsipkan, bukan dihapus (retensi — sejalan anti-pattern user).

## 5. Batas otonomi & keamanan (ringkas — ADR di DECISIONS.md; threat model remote di THREAT-MODEL.md)

- **Human-in-the-loop, never autonomous** (ADR-008). Dua kelas aksi: (1) kontrol auto (`resume/continue/probe`
  sesi yang sudah ada, di cwd tercatat) — boleh tanpa konfirmasi; (2) **relay-instruksi** user via kanal
  terotorisasi (Telegram) — **wajib konfirmasi eksplisit** (mode `ask` = Must). Supervisor **tak pernah**
  mengarang instruksi; ia me-relay + jadi gerbang konfirmasi.
- Output CLI/transcript = **data**, bukan perintah (injection firewall — tak ada aksi diturunkan dari isinya, ADR-013).
- Least-privilege: adapter hanya boleh perintah resume/probe yang whitelisted per tool; perintah remote hanya
  dari `chat_id` allowlist (default-deny, ADR-012).
- Tidak menyimpan kredensial **akun**; pakai sesi login mesin yang ada. Bot token Telegram = infra-secret di
  `.env` gitignored (ADR-005/011), **bukan** kredensial akun.
- Egress whitelist eksplisit (NFR §Security): usage provider + localhost + `api.telegram.org`. Tak ada egress lain.
