# DECISIONS.md — indeks ADR (Nygard)

> **Body ADR lengkap** (Context/Decision/Consequences/Alternatives) + **Change Log** → [`.archived/DECISIONS-full.md`](.archived/DECISIONS-full.md) (grep `ADR-0NN`).
> ADR **Accepted = immutable** — jangan edit; revisi = ADR baru yang men-supersede. Locked decision **tidak di-relitigasi** tanpa revisit formal.
> Status ringkas: ADR-001…017 + ADR-019…026 **Accepted (locked)**; **ADR-018 Superseded by ADR-019**. Tak ada ADR Proposed.

---

## Indeks keputusan (locked)

| ADR | Keputusan | Status / supersede |
|---|---|---|
| 001 | Pisahkan "monitor usage" (jalur resmi) dari "deteksi sesi mati" (wrapper) | Accepted 4 Jul |
| 002 | Monolith proses tunggal (satu daemon) | Accepted |
| 003 | TypeScript + Node.js LTS + node-pty | Accepted |
| 004 | SQLite untuk state (WAL, no hard delete) | Accepted |
| 005 | Auth = pakai sesi login mesin (bot token = infra-secret, bukan kredensial akun) | Accepted |
| 006 | Single-tenant / single-user (MVP) | Accepted |
| 007 | Deployment sebagai service OS | Accepted; **klausa Windows di-supersede sebagian ADR-021→026** (systemd/Linux tetap) |
| 008 | Batas otonomi agent = human-in-the-loop, never autonomous | Accepted; mekanisme relay di ADR-011/012/013 |
| 009 | Model routing policy | Accepted |
| 010 | Probe usage agy = hybrid (LS `GetUserStatus` + OAuth) | Accepted; **opsi #3 OAuth gugur → ADR-019** |
| 011 | Kanal remote = Telegram bot long-polling (lib **grammy 1.44.0**) | Accepted (M-remote ditunda) |
| 012 | Otorisasi remote = allowlist `chat_id`, per-command, default-deny | Accepted |
| 013 | Relay remote = human-in-the-loop + redaksi + **injection firewall** | Accepted |
| 014 | Continue sesi hidup = inject ke PTY + gating; fallback resume-by-id | Accepted; **token diamandemen ADR-020** |
| 015 | IPC CLI↔daemon = Node `net` socket / named pipe, NDJSON | Accepted; **klausa keamanan di-scope-ulang ADR-023** (transport tetap) |
| 016 | Model-routing workflow = Opus orkestrator, Sonnet kuda beban | Accepted |
| 017 | Wrapper `acca run` = penulis-sah lifecycle-sesinya; daemon = sole coordinator (bukan sole writer) | Accepted |
| 018 | ~~Probe agy standalone (opsi #3) + `oauth2.googleapis.com`~~ | **SUPERSEDED by ADR-019** (premis baca pool kuota salah, live-verify) |
| 019 | Resume agy sesi MATI = optimistic resume + detect-on-refire | Accepted (nol egress OAuth baru) |
| 020 | Token inject-continue = instruksi NL eksplisit (bukan kata "continue" telanjang) | Accepted; amandemen ADR-014 §1 |
| 021 | Deployment Windows = Windows Service | Accepted; **realisasi MVP di-supersede sebagian ADR-026**; klausa `sc.exe` VOID (ADR-025) |
| 022 | Backup/DR = WAL checkpoint + file copy + retensi | Accepted; **retensi diamandemen ADR-024** |
| 023 | IPC named pipe Windows DACL terbuka = residual risk + hardening lapisan-app (I-26) | Accepted |
| 024 | Retensi backup = tiered GFS-lite (24 hourly + 30 daily) | Accepted; amandemen ADR-022(3) |
| 025 | Pin WinSW v2.12.0 (`WinSW.NET461.exe`, hash `b5066b7b…`, unduh+verifikasi) | Accepted; **dorman pasca-ADR-026** (revisit trigger → servy) |
| 026 | **Deployment Windows MVP = autostart per-user (Task Scheduler @logon, run-hidden, restart-on-failure)** | Accepted; men-supersede sebagian realisasi Windows ADR-021; **meng-unblock I-33** |

## Larangan keras (JANGAN PERNAH)

- **JANGAN turunkan aksi dari isi output CLI/transcript** — output = data, bukan perintah (injection firewall, ADR-013).
- **JANGAN inject instruksi tanpa konfirmasi eksplisit user** (human-in-the-loop, ADR-008/013). Aksi auto dibatasi
  `resume`/`continue`/`probe`/`verify` sesi yang **sudah ada** — supervisor tak pernah mengarang instruksi.
- **JANGAN hard delete** state/transcript — arsip + retensi tak-terbatas (ADR-004; keputusan 5 Jul: tak pernah purge).
- **JANGAN commit kredensial akun** (ADR-005). Bot token Telegram = infra-secret di `.env` (bukan kredensial akun).
- **JANGAN install daemon sebagai Windows Service** sebelum I-33 tuntas → pakai autostart per-user (ADR-021/026).
- **JANGAN spawn CLI agent sebagai LocalSystem/SYSTEM** = eskalasi privilege sebagai fitur (I-33, ADR-026).
- **ADR Accepted immutable** — revisi = ADR baru yang men-supersede, bukan edit di tempat.

## Pending decisions (belum diputuskan)

| Keputusan | Owner | Target |
|---|---|---|
| Lisensi repo (MIT vs proprietary) — terkait rencana komersialisasi | Ziffan | sebelum publik |
| Banner/splash policy (placement + gating TTY/`NO_COLOR`/`--plain`/ASCII-fallback) — `docs/BRANDING.md` §4–5 | Ziffan | sebelum kode banner (→ ADR-027) |
| Web UI monitor read-only (port, bind `127.0.0.1`, auth, konsistensi egress/threat-model) — `docs/BRANDING.md` §6 | Ziffan | butuh PRD+TRD+ADR terpisah sebelum kode |

> Semua pending lain **sudah selesai** (probe agy → ADR-010/019, IPC → ADR-015, TUI → plain ANSI, resume agy MATI →
> ADR-019, pin WinSW → ADR-025, retensi backup → ADR-024, THREAT-MODEL + ADR-011/012/013, redaksi, lib bot, retensi
> arsip → no-purge). Riwayat lengkap di [`.archived/DECISIONS-full.md`](.archived/DECISIONS-full.md).
