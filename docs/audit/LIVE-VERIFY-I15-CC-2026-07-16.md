# Live-Verify I-15 — CC limit ASLI full-loop (2026-07-16, Windows, otorisasi user)

> Momen opportunistik: limit 5-jam Claude Code owner mendekati habis (79%→100%, reset ~22:20). Beban
> **review independen RC-1..RC-3** (sesi `acca run claude` ter-wrap, jalur produksi) dipakai sebagai
> bahan-bakar burn → limit tembus mid-review → jalur deteksi + actuation produksi acca terekam pada
> **limit CC nyata** (yang selama ini "tak bisa dipaksa"). Ekstraksi read-only dari `acca.db`
> (`extract-events.mjs`, PII-firewalled). Daemon (`acca daemon`) + wrapper hidup sepanjang.

## Setup
- Terminal A: `acca daemon` (pid 13464) — dispatcher + usage-monitor.
- Terminal B: `acca run claude` di repo → sesi acca **`6eum`** (CC), diberi tugas review RC-1..RC-3.
- Delta versi: CC ~2.1.211 (dari sesi sebelumnya), agy tak terlibat.

## Trace event (DB `sessions`/`scheduled_jobs`/`events`, sesi `6eum`)

| Waktu | Event | Makna |
|---|---|---|
| 21:52:32 | `status_change RUNNING` | Sesi review start |
| 21:52:34 | `cli_session_id_captured {source: hook_sessionstart}` (id `6ab64fa3…`) | Capture id CC via hook (I-20/I-23) re-confirmed live |
| **22:06:08** | `status_change LIMIT_HIT {source:"stopfailure", evidence:"rate_limit"}` | **Limit 5-jam CC ASLI via hook `StopFailure rate_limit` = jalur PRIMER** |
| 22:06:08 | `probe_scheduled {resetSource:"backoff", jobId:1}` (run_at 22:11:08) | StopFailure tak bawa reset → estimator jatuh ke **backoff** |
| 22:11:09 | `job_dispatch_pending {action:"still_limited"}` | Probe fire, CC masih limit (reset asli 22:20 belum tiba) → reschedule |
| 22:16:09 | `job_dispatch_pending {action:"still_limited"}` | Probe fire lagi, masih limit |
| **22:31:10** | `job_dispatch_done {jobId:1, action:"usage_available_enqueue_resume"}` | Probe fresh: **usage available** (session usedFraction<1) → enqueue resume (job 2) |
| **22:31:10** | `status_change RUNNING {reason:"inject_continue"}` + `job_dispatch_done {jobId:2, action:"inject_continue"}` | **INJECT-CONTINUE SUKSES** — token literal ditulis ke PTY CC nyata (gating lulus), R3 `markRunningAfterInject` + `unlatch` |
| **22:31:10** | `status_change LIMIT_HIT {source:"output", evidence:CC_LIMIT_PATTERNS[3]}` | **Detik SAMA:** re-LIMIT_HIT via **output-scrape** langsung pasca-unlatch |
| 22:31:10 | `probe_scheduled {resetSource:"exact", jobId:3}` (run_at **2026-07-17 22:20:00**) | Reset di-parse dari "resets 10:20pm" **→ wrap ke BESOK** (10:20pm sudah lewat jam 22:31) |

`usage_snapshot_claude` (capturedAt 22:04): `session usedFraction=1, resetAt≈22:19:59` (= "10:20pm" **malam ini**),
`weekly_all 0.11`, `weekly_scoped(Fable) 0`.

## Temuan

### ✅ T-1 — Deteksi limit CC PRIMER pada limit ASLI = LULUS (gate item, tak-terpaksa)
`StopFailure` matcher `rate_limit` **fire end-to-end** pada limit 5-jam CC nyata → `LIMIT_HIT
{source:"stopfailure", evidence:"rate_limit"}`. Ini paruh I-15 yang RESEARCH/ISSUES tandai "tak bisa dipaksa"
(hanya `SessionStart` yang pernah terbukti transport-nya). **Bukan** fallback output-scrape. `proc_state=alive`
sepanjang = **limit≠exit** CC dikonfirmasi ulang. + `cli_session_id` via `hook_sessionstart` (I-20/I-23 re-live).

### ✅ T-2 — Actuation inject-continue FIRE pada sesi CC ter-limit nyata (seam produksi)
Jalur `probe → usage_available → enqueue resume → dispatch alive → requestInject → wrapper gating →
CONTINUE_TOKEN ke PTY` **jalan penuh** (`injected`, `status RUNNING reason:inject_continue`). Membuktikan seam
actuation ADR-014/ADR-020 pada limit ASLI (sebelumnya hanya via harness `inject-now.mjs`). Token literal ADR-020
di-inject; firewall utuh (IPC `inject` tanpa payload).

### ⚠ T-3 — G-37 TERKONFIRMASI LIVE (FALSE-POSITIVE): repaint pasca-inject re-fire LIMIT_HIT palsu
Detik yang sama dengan inject (`unlatch` R3) muncul `LIMIT_HIT {source:"output", evidence:CC_LIMIT_PATTERNS[3]}`.
**DIKONFIRMASI FALSE-POSITIVE (owner, Terminal B):** CC **jalan normal & MENYELESAIKAN kerja** (rencana
remedi) pasca-inject — daemon log `[acca info] Session #6eum resumed (inject-continue)`. Jadi yang re-fire =
**repaint baris banner limit LAMA** (ber-`\n`) mengalir lewat `onData` ke limit-watcher yang baru di-`unlatch`,
**bukan** limit baru. Ini residual **G-37 / R3-I-21** yang selama ini teoretis → **nyata**. Asumsi lama "TUI
repaint in-place tanpa `\n`" **gugur untuk CC**. **Dampak:** sesi ter-tandai LIMIT_HIT **palsu** + probe sia-sia
dijadwalkan (T-4). **Tracking → I-31.**

### ⚠ T-4 — Reset clock-wrap: output "resets 10:20pm" di-parse SETELAH lewat → jadwal +24 jam
Pasca T-3, `extractResetHint`/reset-estimator parse "resets 10:20pm" pada 22:31 (10:20pm sudah lewat) → "next
occurrence" = **BESOK 22:20** (`resetSource:"exact"`, G-13 class). Padahal **snapshot probe acca sendiri** tahu
reset benar = **22:20 malam ini** (`resetAt` 22:19:59). → auto-continue kini terjadwal 24 jam meleset.
**Pelajaran:** saat sumber probe (fresh OAuth `resetAt`, absolut, unambiguous) tersedia, ia harus **menang** atas
clock-time output-scrape yang ambigu-arah — apalagi clock-time yang sudah lewat tak boleh otomatis di-wrap ke besok
saat konteks (probe) menunjukkan reset tadi.

### ⚠ T-5 — reset hint hilang di jalur PRIMER (StopFailure) → probe sia-sia
`StopFailure` (primer) tak membawa waktu reset → `reset_at` awal jatuh ke **backoff** (22:11), sehingga probe 22:11
& 22:16 **sia-sia** (sebelum reset asli 22:20). TUI membawa "resets 10:20pm" tapi StopFailure men-latch duluan →
hint TUI tak terpakai. **Mitigasi:** saat `LIMIT_HIT`, pakai `resetAt` dari usage-snapshot/probe bila ada (acca
memilikinya) alih-alih backoff; atau gabung hint output walau deteksi via hook. (Berkaitan C-6.)

### ℹ T-6 — Beda % terminal vs claude.ai = lag interval probe (bukan bug)
Proximity acca = snapshot usage-monitor periodik (~2 mnt, I-17) → tertinggal dari claude.ai real-time; memanjat
`94→96→99→100%`, snapshot 22:04 sudah `usedFraction=1`. Caveat presisi proximity CC (sekelas G-35 tapi murni
interval, bukan stale-in-session).

## Status gate I-15 pasca-sesi
- **Deteksi CC (StopFailure primer) pada limit asli: ✅ LULUS** (T-1) — menutup paruh CC "tak bisa dipaksa".
- **Actuation inject fire pada limit asli: ✅ terbukti** (T-2).
- **Outcome "token OTOMATIS acca benar-benar melanjutkan KERJA CC": ✅ LULUS** (dikonfirmasi owner T-3) — CC
  melanjutkan turn yang terputus & menyelesaikan tugas (rencana remedi) via jalur produksi penuh (deteksi hook →
  jadwal → probe → inject). Melengkapi bukti owner-manual frasa Indonesia (ADR-020, 16 Jul) dengan **jalur otomatis
  end-to-end**. **Paruh CC I-15 = LULUS.**
- **Residual yang HARUS ditutup (cosmetic-jadi-korektness-state, bukan blok bukti actuation):** **I-31** (G-37 re-fire
  palsu → sesi ter-LIMIT_HIT palsu pasca-resume) + **I-30** (reset clock-wrap → probe salah dijadwalkan +24 jam).
  Keduanya mengotori STATE & JADWAL walau kerja CC nyata sudah lanjut. Tutup dulu sebelum M-remote.

## Artefak
- Ekstraksi: `scratchpad/extract-events.mjs` (read-only, PII-firewalled).
- Review independen (beban burn): `docs/audit/AUDIT-RC-1-3-INDEPENDENT-2026-07-16.md`.
