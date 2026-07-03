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
               ▲                                    ▼          └──────────────────┘
               │ notifikasi              ┌───────────────────────┐   spawn/monitor  ▲
               └─────────────────────────│  auto-continue-cli    │──────────────────┘
                                         │  -agent (supervisor)  │
                                         └───────────────────────┘
                                                   │ baca
                                                   ▼
                                    transcript JSONL + output CLI
```

Sistem = satu kotak (supervisor). External: user, dua CLI agent, filesystem transcript, channel notifikasi.

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
│   └── Notifier             — desktop/CLI (MVP); channel eksternal (Nice)
├── Adapters                 — abstraksi per-tool (claude-code, antigravity)
│   └── kontrak: detectLimit(), parseReset(), resumeCmd(cwd,id), probeUsage()
└── Store (SQLite)          — sesi, event log, timer terjadwal, arsip transcript ref
```

Protokol antar-kotak: CLI ↔ daemon via IPC lokal (socket/named pipe) atau invoke langsung; daemon ↔ CLI
target via PTY (stdio); daemon ↔ store via SQL lokal; daemon ↔ transcript via filesystem read-only.

## 3. Tech stack (usulan — di-lock di DECISIONS.md)

| Layer | Usulan | Alasan singkat |
|---|---|---|
| Bahasa/runtime | **TypeScript + Node.js LTS** | Kontrol proses/PTY matang, cross-platform (Ubuntu+Windows), sejalan ekosistem user |
| PTY | `node-pty` | Tangkap output interaktif CLI apa adanya |
| Usage source (Claude Code) | statusLine JSON `rate_limits.{five_hour,seven_day}` (v2.1.80+) / endpoint OAuth usage | Jalur resmi/semi-resmi, hindari scraping |
| Deteksi limit (Claude Code) | hook `StopFailure` matcher `rate_limit` (v2.1.78+) → pola output PTY → exit code (print-mode) | Event resmi ber-taxonomy (bedakan overload vs limit); scraping = fallback (RESEARCH §2c) |
| Usage source (Antigravity) | fresh-launch `/usage` snapshot / LSP probe `GetUserStatus` / `retrieveUserQuota` (pending — DECISIONS) | `/usage` sesi hidup stale; referensi implementasi: CodexBar (RESEARCH §5b) |
| Resume (Claude Code / Antigravity) | `claude --resume <id>` / `agy --conversation <id>` | Terverifikasi v2.1.199 / v1.0.16 |
| Store | **SQLite** (better-sqlite3/Drizzle) | Single-user, offline-first, tidak butuh server |
| CLI framework | commander/clipanion + Ink (TUI status) | `acca status` butuh render tabel/TUI |
| Scheduler | in-process timer + tabel `scheduled_jobs` persisten | Tahan restart daemon |
| Notifikasi | node-notifier (desktop) / stdout | MVP lokal; eksternal = Nice |
| Packaging | daemon via systemd (Linux) / Task Scheduler (Windows) | Always-on host (lihat NFR) |

Prinsip: pilih yang populer (agent lancar), sesederhana mungkin, adapter-pattern supaya tool ketiga (OpenCode)
bisa ditambah tanpa ubah core. **Pin versi eksak di DECISIONS.md saat lock.**

## 4. Data model (ringkas — detail menyusul di DATA-MODEL.md)

- `sessions` — id, tool, session_id, cwd, pid, status (`RUNNING|LIMIT_HIT|WAITING|RESUMED|EXITED|BLOCKED|FAILED`),
  **proc_state (`alive|exited`)** — LIMIT_HIT bisa terjadi dengan proses masih hidup di prompt (RESEARCH §2c;
  menentukan jalur lanjut: inject-PTY vs resume-by-id), detected_at, reset_at,
  reset_source (`exact|heuristic|backoff`), created_at, updated_at.
- `events` — id, session_id, type, payload(JSON), created_at (audit trail, append-only).
- `scheduled_jobs` — id, session_id, run_at, kind (`probe|resume`), attempts, next_backoff.

Tidak ada hard delete: sesi selesai diarsipkan, bukan dihapus (retensi — sejalan anti-pattern user).

## 5. Batas otonomi & keamanan (ringkas — ADR di DECISIONS.md)

- Supervisor **hanya** me-resume sesi yang sudah ada; tidak menyusun prompt baru otonom.
- Output CLI/transcript = **data**, bukan perintah (proteksi prompt-injection).
- Least-privilege: adapter hanya boleh perintah resume/probe yang whitelisted per tool.
- Tidak menyimpan kredensial; pakai sesi login mesin yang ada.
