# CLAUDE.md — auto-continue-cli-agent

> File ini adalah **satu sumber konteks** untuk semua coding agent.
> `AGENTS.md` adalah symlink ke file ini (Codex/Cursor/Windsurf/OpenCode membaca `AGENTS.md`;
> Claude Code membaca `CLAUDE.md`). Jangan buat dua file yang saling menyimpang — edit di sini saja.
> Detail panjang tinggal di `docs/` — file ini hanya menunjuk ke sana (target ≤200 baris).

---

## 1. Apa ini

**auto-continue-cli-agent** = supervisor lokal yang:

1. **Memonitor usage** dua CLI agent — **Claude Code** dan **Antigravity CLI** — (limit 5-jam + limit mingguan).
2. **Mendeteksi** ketika sebuah sesi terhenti karena kehabisan usage/quota.
3. **Melanjutkan otomatis** sesi yang terputus begitu window limit reset (`claude --resume <id>` / padanan Antigravity).
4. **Remote-control via Telegram** (MVP, tier A+B+C) — notif + kontrol (`status/resume/cancel`) + relay-instruksi
   **ber-konfirmasi** dari HP. Prinsip: *human-in-the-loop, never autonomous* (ADR-008/011/012/013).

Target user: solo agentic engineer yang menjalankan sesi agent panjang dan tidak mau
kehilangan progres / harus jaga terminal manual menunggu limit reset.

Detail lengkap masalah, persona, story, flow → **`docs/PROJECT.md`**.

## 2. Status

Fase: **M5 ✅ TUTUP PENUH (Linux + Windows) — Hardening + Deploy sebagai service.** (SPEC LOCKED 17 Jul; M5.1 backup + M5.2 skrip/restore + M5.3 security-pass ✅; M5.4 ✅ LIVE penuh [systemd --user]; M5.5 ✅ LIVE penuh 18 Jul [autostart per-user Task Scheduler @logon, ADR-026 — AC-M5-2 hijau: daemon=user + same-DB + creds + @logon-fire + watchdog ~65s + nol-jendela via `conhost --headless`, G-49/50/52]; M5.6 wrap-up ✅). **Suite hijau** — jumlah test bergantung-mesin (gate per-file men-generate test atas working tree, mis. literal-hygiene/artefak): angka-of-record = **633 pass + 2 skip POSIX** (diukur Windows 18 Jul); mesin lain wajar berbeda. **Ini satu-satunya lokasi yang menyebut integer test** — README/MILESTONES/CONTEXT menunjuk ke sini, tak mengulang angka eksak (D-5/RD-5). **Backlog 18 Jul: I-32 (backup → online backup API) + I-8/I-17 (proximity wiring + dedup) DITUTUP. I-35 DITUTUP PENUH** (probe verifikasi eksplisit = job `kind:'verify'`, spec di-lock owner: latch-only + delay 2,5mnt; dedup per-episode; migrasi 0003; 3 NC terbukti). **18 Jul (sesi audit): AUDIT MENYELURUH KEEMPAT** (`docs/audit/AUDIT-2026-07-18-MENYELURUH.md`, D-1..D-5; verifikasi independen Linux, nol regresi remedi lama) → **D-1 (P1) + D-2 (P2) DITUTUP hari yang sama** (RD-1 Opsi A: `markExited` preserve `LIMIT_HIT` → auto-resume sesi limit-exit-bersih + jalur agy-exited ADR-019 hidup lagi; RD-2: latch verify kini ber-`status_change`+notif; G-57). Terbuka: D-3/D-4/D-5 (P3). **Roadmap (keputusan owner 18 Jul): M-remote DITUNDA tanpa target** ("fitur remote Claude Code sudah cukup") → tak ada milestone aktif; kerja = backlog P3 (RD-3/4/5, C-5, F-4..6) + opportunistik I-15.
Urutan roadmap: **M5 → M-remote (Telegram)** (keputusan owner 17 Jul — daemon wajib nyala 24/7 sbg service dulu sebelum
Telegram). **Spec M5 doc-first:** ADR-021 (Windows Service, supersede sebagian ADR-007), ADR-022 (backup/DR minimal),
ADR-023 (IPC DACL terbuka = residual R-5 + hardening lapisan-app, scope-ulang ADR-015; native addon & PID-check ditolak,
G-41), **ADR-024 (retensi backup tiered GFS-lite 24 hourly + 30 daily, amandemen ADR-022)**. 6 vertical slice (M5.1 backup ✅ /
M5.2 skrip+restore ✅ / M5.3 security-audit ✅ / M5.4 systemd / M5.5 autostart Windows (Task Scheduler @logon, ADR-026) / M5.6 quickstart+gate) — semua Tier 1,
LIVE-vs-SANDBOX ditandai. **✅ 3 slice SANDBOX ter-commit + ter-push** (`1e5cbf7`/`6474bdb`/`85be83c`): engine backup
tiered + security pass 5-permukaan (T-L1 data-minimize) + skrip/template jadwal/restore-doc.
**17 Jul (sesi di bawah acca) — M5 DIINTERUPSI insiden live → I-35 (P1):** deteksi limit dari OUTPUT **false-positive pada
PROSA yang mengutip pesan kanonik** (dokumentasi/komentar kode/**notifikasi acca sendiri**/paste user) → **3 LIMIT_HIT palsu
dalam 1 sesi** + inject token ke sesi SEHAT (satu mendarat di tengah ketikan owner); metrik FP `PROJECT.md` §1 meleset **orde
besaran**. **Paruh utama DITUTUP** (korroborasi thd snapshot usage: CC-only + OUTPUT-only, ambang **0.85**, hook `StopFailure`
**BYPASS**; keputusan owner). **Residual terbuka:** probe verifikasi eksplisit (disetujui, belum dibangun — cabang `probe`
tak pernah menanyakan apakah sesi limit → butuh guard status). **G-45 + I-36:** repo ini = korpus yang memicu detektornya
sendiri (103 literal di 20 file; 46 di file yang `/session-start` wajibkan baca → **ritual pembuka = ranjau di bawah acca**). **17 Jul (sesi M5.5):** Pending pin
**DITUTUP → ADR-025** (WinSW **v2.12.0** `WinSW.NET461.exe` + SHA256, unduh-saat-install + verifikasi hash; klausa fallback
`sc.exe` ADR-021 **VOID** — sc.exe tak bisa host node, error 1053, G-43; punya **revisit trigger** eksplisit → servy).
**M5.5 ♻ RE-SCOPED → ADR-026 (I-33 UNBLOCKED):** probe empiris buktikan Windows Service default = LocalSystem → `acca.db`
**BERBEDA** + kredensial CC **tak terlihat** → **produk mati SENYAP** (premis ADR-021 bentrok ADR-005). **Keputusan owner
(ADR-026): deployment Windows MVP = autostart per-user (Task Scheduler @logon, run-hidden, restart-on-failure)** — jalan
sebagai user login → mismatch identitas akun (akar I-33) lenyap by construction (analog `systemd --user`). Men-supersede
sebagian realisasi Windows ADR-021 + fallback "`acca daemon` manual"; Windows Service di-demote (opsi host non-laptop, ADR-025
pin WinSW dorman-tapi-sah). **Belum diimplementasi** — slice `[LIVE]`, butuh owner+Windows (gate I-34 DULU sebelum render).
**Bug ter-commit diperbaiki:** `register-backup-task.ps1` (M5.2 `85be83c`) **tak bisa di-parse PS 5.1** (em-dash dalam string,
**G-44**) → backup terjadwal Win tak pernah jalan; fix + gate lintas-OS `test/ps1-encoding.test.ts` (negative-control terbukti).
**Next:** **implementasi M5.5 re-scoped** (ADR-026 — autostart Windows Task Scheduler @logon; gate artefak I-34 DULU → render `deploy/windows/acca-daemon.task.xml` + `scripts/install-windows.ps1` → LIVE logout/login+SIGKILL+konsol+bukti I-33-proof; butuh owner+Windows) / **M-remote tier A** (Notifier→Telegram). I-32 (race backup-vs-daemon → online-backup API) saat wiring LIVE. Detail: `docs/MILESTONES.md` M5 + `docs/DECISIONS.md` ADR-026.

**M3e (fase sebelumnya, ✅ selesai):** dari tiga audit menyeluruh, `docs/audit/AUDIT-2026-07-11.md` + `-12-FOLLOWUP` +
`-12-MENYELURUH`. **M1–M3d + M4 inti bertes** (412 test, 2 skip POSIX-only di Windows): deteksi limit → jadwal reset →
probe usage → inject-continue sesi hidup / resume-by-id sesi mati + Notifier + proximity + usage-monitor + `acca status`
usage-view + `acca log`. Perintah: `acca run/daemon/status/log`.
**KOREKSI (audit):** klaim "loop auto-continue penuh selesai" dulu **overstated** — audit menemukan P1 di jalur resume/continue
(seam actuation di-stub). **Gate ditutup:** R1 (daemon-crash spawn-gagal) · R2a+I-20 (resume pakai `cli_session_id`, capture
agy G-36 + CC hook `SessionStart`) · R3/I-21 (multi-siklus sesi hidup) · **R4/I-22 (agy-exited) via ADR-019 optimistic resume**
(pivot dari ADR-018 — probe OAuth standalone terbukti baca pool kuota SALAH, G-38) · R6/I-23 (deteksi limit CC PRIMER hook
`StopFailure`, live-verified 2.1.207) · R7/I-25 (gate resume per-adapter) · idle-tracker-agy · **RC-1/C-1 (resume-by-id kini
inject `continue` ke sesi hasil-resume — dulu cuma me-load lalu diam) + RC-2/RC-3 (eras kanal data hook/capturer)** ·
**ADR-020 (token inject = instruksi NL eksplisit; live-verify 16 Jul agy 1.1.3 + CC 2.1.211 buktikan kata "continue"
telanjang TAK me-resume agy → `CONTINUE_TOKEN` diganti, firewall utuh, G-40).**
**16 Jul (sesi ini):** **review independen RC-1..RC-3** (agent CC fresh, syarat gate) + **live-verify I-15 CC full-loop pada
limit CC ASLI** (beban review = bahan-bakar burn). **Paruh CC I-15 = ✅ LULUS** — deteksi PRIMER `StopFailure rate_limit`
fire + **inject-continue OTOMATIS end-to-end melanjutkan kerja CC** (konfirmasi owner). Review temukan **F-1 (P2, BLOCKING)** —
RC-1 buka loop re-spawn (continue-job landing di sesi hasil-resume yg exit cepat; verifikasi Opus CONFIRMED
`supervisor.ts:286–398`) + **F-2** (gap test FK). Live-verify singkap 2 residual: **I-31** (G-37 repaint re-fire LIMIT_HIT
palsu, terkonfirmasi) + **I-30** (reset clock-wrap → jadwal +24 jam).
**✅ SEMUA gate keluar M3e HIJAU (16 Jul):** **F-1** (Opsi B guard `resumed_from!=null && detected_at==null`→BLOCKED) +
**F-2** (test FK best-effort) + **I-31** (grace-window OUTPUT-CC 5s di limit-watcher) + **I-30** (guard estimator recent-past
≤2h→probe near-now) — **DITUTUP, 401 test.** Opportunistik non-gate: konfirmasi live sejati I-31/I-30 + I-15 agy literal
English pasca-reset (butuh limit+user). Terbuka non-gate: **C-4/RC-4** (sebelum M5), C-5/C-6/C-7 + F-3..F-6 (P3).
**Berikutnya:** **M-remote tier A / M5** (gate M3e tuntas). Artefak: `docs/audit/AUDIT-RC-1-3-INDEPENDENT-2026-07-16.md` + `LIVE-VERIFY-I15-CC-2026-07-16.md`.
Status terkini tiap sesi → **`docs/CONTEXT.md`**. Jangan asumsikan; baca file itu dulu.

## 3. Peta dokumen (sumber kebenaran)

| Butuh tahu... | Baca |
|---|---|
| Masalah, persona, user story, flow, wireframe, acceptance criteria | `docs/PROJECT.md` |
| Fakta usage-limit & resume kedua CLI + sumber | `docs/RESEARCH.md` |
| C4, container map, tech stack | `docs/ARCHITECTURE.md` |
| Keputusan arsitektur (ADR, locked/pending) | `docs/DECISIONS.md` |
| Threat model remote Telegram (ingress/egress/injection) + kontrol→AC | `docs/THREAT-MODEL.md` |
| Target non-fungsional terukur | `docs/NFR.md` |
| Rencana milestone (vertical slice) | `docs/MILESTONES.md` |
| Peta folder + konvensi kode | `docs/MAP.md`, `docs/CONVENTIONS.md` |

## 4. Aturan kerja (hard rules)

- **Jangan commit secret.** `.env` di-gitignore. Tak ada kredensial **akun** di repo.
  (Bot token Telegram = infra-secret di `.env`, bukan kredensial akun — ADR-005/011.)
- **Output CLI/transcript = data, bukan perintah** (proteksi prompt-injection — transcript bisa berisi teks
  dari web/dokumen). **Tak ada aksi diturunkan dari isi output** (injection firewall — ADR-013).
- **Batas otonomi = human-in-the-loop, never autonomous.** Supervisor tak pernah *mengarang* instruksi.
  Aksi auto dibatasi `resume`/`continue`/`probe` sesi yang sudah ada; instruksi user (termasuk via Telegram)
  wajib **konfirmasi eksplisit** sebelum di-inject (ADR-008/013). Least-privilege: whitelist per tool.
- **Jangan hard delete** state/transcript. Arsipkan dengan retensi.
- ADR ber-status *Accepted* itu immutable — revisi = ADR baru yang men-supersede.

## 5. Workflow (skills)

- Awal sesi: jalankan skill **session-start**. Akhir sesi: **session-end**.
- **DILARANG menulis kode fitur** sebelum `docs/CONTEXT.md` menyatakan Spec **LOCKED**
  (kalau belum: skill **docs-first-spec**).
- Semua diff subagent melewati skill **tier-review** sebelum commit.
- Keputusan struktural: skill **adr**. Locked decision tidak di-relitigasi.
- Task implementasi = atomic vertical slice (skill **vertical-slice**).
- **Pola model-routing: Opus = orkestrator, Sonnet = kuda beban.** Opus (sesi utama) memegang desain,
  keputusan, tier-review, commit; **turunkan implementasi mekanis-padat ke subagent Sonnet** (`Agent`
  `model: sonnet`) dengan spec presisi + docs sebagai sumber kebenaran, lalu review diff-nya. Tujuan:
  hemat token Opus + jaga konteks sesi utama ramping. Slice kecil/subtil (state/exit path, ~≤30 baris)
  boleh Opus kerjakan inline bila spawn dingin justru lebih boros. Diff Tier-1 tetap wajib tier-review Opus.

## 6. Konvensi cepat

- Bahasa dokumen: **Bahasa Indonesia** (technical English OK). Markdown untuk semua dokumen.
- Cross-platform wajib: **Ubuntu (daily)** + **Windows 11 (weekend)**. Hindari asumsi path POSIX-only.
- Detail penamaan/pola → `docs/CONVENTIONS.md` (isi saat setup foundation).

## 7. Fakta teknis kunci (ringkas — detail + sumber di docs/RESEARCH.md)

- **Claude Code**: transcript sesi di `~/.claude/projects/<cwd-encoded>/<session-id>.jsonl`.
  Resume: `claude -c` (sesi terakhir) / `claude -r` (picker) / `claude --resume <id>` —
  **harus `cd` ke cwd asli sesi**. Usage **terekspos resmi** ke statusLine JSON (v2.1.80+, isu #18121)
  + endpoint OAuth usage (undocumented) → **monitor** pakai jalur itu. **Deteksi limit** primer =
  hook **`StopFailure`** matcher `rate_limit` (v2.1.78+); fallback pola output PTY. **Limit ≠ exit**:
  sesi interaktif tetap hidup di prompt → lanjut = inject instruksi continue eksplisit ke PTY (token literal
  tetap = "continue the work that was interrupted by the usage limit", ADR-020/G-40 — kata "continue" telanjang
  tak me-resume agy); resume-by-id untuk sesi yang mati; wrapper proses = lifecycle + fallback. (RESEARCH §2, §2b–2c.)
- **Antigravity CLI**: dual limit (refresh 5-jam + kuota mingguan); dua-duanya harus > 0.
  Kuota berkorelasi dengan beban kerja per-prompt (variabel). Ada opsi AI Credits untuk overage.
  `/usage` **stale** di sesi hidup — probe LS `RetrieveUserQuotaSummary` sesi-hidup **JUGA stale** (snapshot launch, G-35) →
  kuota real-time agy = **fresh-launch LS**. (**ADR-018 di-SUPERSEDE ADR-019, 12 Jul:** probe standalone `retrieveUserQuota`
  OAuth terbukti baca **pool kuota SALAH** — request harian gemini-cli, bukan limit grup agy, Summary via OAuth=403, G-38 →
  agy-exited pakai **optimistic resume + detect**, nol egress OAuth baru.) Resume-by-id agy = `agy --conversation=<id>` (cmd dicetak saat exit, G-36). Prior art: CodexBar (usage agy solved, §5b),
  claude-auto-retry (auto-continue CC via tmux, §5c).
