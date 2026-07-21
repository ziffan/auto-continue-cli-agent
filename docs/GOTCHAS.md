# GOTCHAS.md — indeks jebakan (detail: .archived/GOTCHAS-full.md)

> Ringkasan 1-baris tiap gotcha = **peringatan**; **reasoning + bukti lengkap** di
> [`.archived/GOTCHAS-full.md`](.archived/GOTCHAS-full.md) (grep `G-NN`). Change Log juga di arsip.
> Tulis gotcha baru di arsip (detail) DAN tambah 1-baris di sini.

## Antigravity / agy
- **G-1** — Token on-disk `oauth_creds.json` bisa STALE meski agy jalan normal
- **G-2** — Baris log "not logged into Antigravity" BUKAN indikator gagal-login
- **G-3** — agy interaktif TANPA TTY tidak mem-bind language server
- **G-7** — LS `GetUserStatus` quota `nil` di print-mode, TERISI di interaktif ber-PTY (tanpa prompt)
- **G-8** — `winpty` degradasi ke passthrough saat stdin bukan tty → agy interaktif exit "stdin is not a tty"
- **G-9** — Respons LS `GetUserStatus` memuat PII (nama + email)
- **G-16** — Toggle credit CLI agy = `useG1Credits` (BEDA dari IDE `useAiCredits`) + fallthrough senyap
- **G-17** — Sinyal exhaustion 5-jam agy = field `remainingFraction` HILANG (absent), bukan 0
- **G-18** — `agy -p` (child_process) MENGGANTUNG bila stdin tak di-EOF; print-mode KOSONG saat limit; skip-permissions kontraproduktif
- **G-19** — Pesan limit agy TUI ASLI + agy tetap HIDUP (limit≠exit) + tak boleh sesi konkuren

## Claude Code
- **G-4** — Dua format `resets_at` berbeda per-sumber usage
- **G-5** — Payload hook `StopFailure`: field tipe error = `error`, BUKAN `error_type`
- **G-15** — Pesan limit CC nyata menyisipkan qualifier ("session"/"weekly") + warning proaktif UI-only
- **G-34** — Encoding path transcript CC = `cwd.replace(/[^a-zA-Z0-9]/g,'-')`; filename = id `--resume`
- **G-36** — agy cli_session_id (resume-by-id): sumber ANDAL = cmd yang agy CETAK saat exit; `.db` termuda = racy

## Lingkungan / repo
- **G-6** — Git CRLF pada docs (Windows)

## Build / M1 foundation
- **G-10** — `tsc` tak menyalin file non-`.ts` (migrasi SQL) ke `dist/`
- **G-11** — npm `allow-scripts` (lavamoat-style) memblokir postinstall native default
- **G-12** — node-pty (Windows) tak resolve PATH/PATHEXT — butuh path absolut executable

## Detector / Reset Estimator (M2)
- **G-13** — `reset-estimator` clock-time "next occurrence" bisa meleset ±1 jam di hari transisi DST ✅ TERATASI (I-4, 11 Jul)

## Daemon / IPC (M3)
- **G-14** — Unlink socket unix tanpa syarat SEBELUM `listen` men-"steal" socket daemon hidup
- **G-39** — Enqueue job untuk sesi HASIL-actuation kena FK `scheduled_jobs.session_id`→`sessions.id`; kegagalannya JANGAN flip dispatch ke retry

## Detector wiring / PTY (M3d)
- **G-20** — Output PTY (ConPTY/node-pty) menyisipkan escape ANSI/CSI walau baris "polos" → detector wajib strip
- **G-21** — `require()` di modul ESM = ReferenceError runtime (lolos `tsc`, mati saat dipanggil)
- **G-22** — Port→PID discovery Linux WAJIB korelasi inode; jangan grep `/proc/net/tcp` global

## Usage-Probe live (M3d.3/M3d.4) — verifikasi Ubuntu 5 Jul
- **G-23** — GetUserStatus agy = port **HTTPS(gRPC)** + Connect-JSON, dan butuh **retry ~2–4s** pasca port-bind
- **G-24** — Bentuk NYATA entri model GetUserStatus: `label` + `modelOrAlias.model`, **bukan** flat `model` (koreksi I-7)
- **G-25** — undici `fetch` (global Node) TAK bisa `rejectUnauthorized:false` tanpa dep `undici` → jalur loopback pakai `node:https`
- **G-31** — agy `GetUserStatus` = window 5-JAM saja; kuota MINGGUAN hanya di `RetrieveUserQuotaSummary`
- **G-35** — Probe usage agy via sesi LS HIDUP = snapshot saat launch, STALE dalam-sesi (bukan live)
- **G-38** — OAuth `retrieveUserQuota` (gemini-cli) = kuota HARIAN per-model, BUKAN limit grup weekly+5h yang agy tegakkan
- **G-33** — agy 1.1.0+ jadikan `request-review` sbg **mode default** → state prompt agy saat idle BEDA (jeda pre-write, bukan hanya prompt kosong)

## Actuation seams (M3d.6/M3d.7) — inject-continue & resume-by-id (6 Jul)
- **G-26** — Kanal inject-continue: injection firewall harus STRUKTURAL (bukan sekadar konvensi) + wrapper host socket = non-fatal + guard race listen/exit
- **G-27** — Resume-by-id: JANGAN re-spawn `acca run <tool> --resume …` (commander salah-parse opsi); pakai runSession in-process. ConPTY meng-echo `\r` inject → `\r\n`
- **G-40** — Token inject-continue: kata "continue" TELANJANG tak me-resume agy (ditafsir pesan NL baru); butuh instruksi eksplisit

## Gating inject-continue (M3d/I-13) — foreground & idle (7 Jul)
- **G-28** — Foreground "agent-bukan-shell" = `/proc/<pid>/stat` tpgid vs pgrp, BUKAN name-matching; proses piped → tpgid=-1
- **G-29** — Idle "bukan mid-turn" = jendela-sunyi penanda busy; regex penanda WAJIB non-global (`.test()` stateful bila `/g`)

## Store / migrasi (M3d/I-14)
- **G-30** — SQLite `ALTER TABLE ADD COLUMN` + FK butuh default NULL saat `foreign_keys=ON`; FK ditegakkan → test parent-link WAJIB seed parent dulu

## Notifier / Usage-monitor (M4)
- **G-32** — Timer engine baru yang di-wire ke supervisor WAJIB opt-in, else mengacaukan assertion timer test scheduler
- **G-37** — Auto-continue multi-siklus: sesi inject-continue kembali RUNNING (bukan RESUMED-terminal); un-latch watcher punya residual TUI-repaint

## Keamanan / IPC (spec M5)
- **G-41** — DACL named pipe Windows Node = TERBUKA by design + tak bisa di-set dari Node; "cek PID client" = mitigasi PALSU (spoofable)
- **G-42** — `acca status` (CLI) ≠ handler IPC `status` — CLI baca DB LANGSUNG, handler IPC nol konsumen produksi
- **G-43** — `sc.exe` TAK bisa host `node` (error 1053) · WinSW v2: exe wajib SENAMA config-nya + config dimuat SEBELUM parse perintah
- **G-44** — Em-dash di `.ps1` = parse error PowerShell 5.1 (UTF-8-tanpa-BOM dibaca CP1252; U+201D = delimiter string)

## Deteksi limit vs prosa (I-35/I-36)
- **G-45** — Repo ini adalah korpus yang memicu detektornya sendiri; mengerjakan acca DI BAWAH acca = FP berulang
- **G-46** — Membangun gate I-36 (fix mekanis literal kanonik) hampir merusak regex produksi DUA cara berbeda
- **G-55** — Callback yang menyala PER BARIS output → enqueue job berulang dalam satu episode (butuh dedup)
- **G-56** — `git checkout <tracked-file>` untuk membuang edit NC sementara MENGHAPUS SEMUA perubahan uncommitted file itu
- **G-57** — Transisi terminal tanpa guard status + test yang men-SEED status langsung = interaksi lifecycle tak pernah teruji (kelas D-1)
- **G-58** — `program.action()` di root commander (utk splash bare-`acca`) membuat `acca help`/subcommand di-parse sbg argumen berlebih ("too many arguments"); bare-argv tangani SEBELUM parse via `process.argv`, bukan root-action

## Packaging / instalasi lintas-mesin (npm)
- **G-59** — `npm install -g git+https://…` TAK ANDAL (bug npm: skrip `prepare` dijalankan dua kali, invokasi kedua tanpa `node_modules/.bin` → `tsc: not found`); pakai `git clone` manual + `npm install` biasa

## Deploy / systemd (M5.4)
- **G-47** — `Restart=on-failure` TAK restart pada exit bersih (SIGTERM→exit 0); uji auto-restart WAJIB pakai SIGKILL
- **G-48** — `sed` substitusi placeholder juga menggarabl token yang sama di KOMENTAR prosa template
- **G-49** — Task Scheduler `RestartOnFailure` TAK andal me-restart daemon yang di-kill; pakai watchdog repetisi + IgnoreNew
- **G-50** — XML comment tak boleh memuat `--`; naive tag-balance lolos, parser sungguhan menolak (task gagal register)
- **G-51** — `git checkout -- <file>` TAK bisa mengembalikan file baru/untracked (negative-control revert gagal senyap)
- **G-52** — `<Hidden>true>` Task Scheduler TAK cegah jendela konsol; node @logon dapat PseudoConsoleWindow terlihat -> pakai conhost headless
- **G-64** — `LastTaskResult=0x800710E0` ("operator/administrator refused") pada task `acca-daemon` = watchdog `IgnoreNew` menolak instance baru saat daemon hidup = **SEHAT**, bukan error; yang mencurigakan justru `0x0` berulang

## Repo publik / dokumen turunan
- **G-62** — Langkah owner-action (tag/Release, flip visibility) TAK bisa dari sesi agent: `git push <tag>` ditolak 403 oleh egress proxy (push di-scope ke branch designated; ref tag bukan branch) + GitHub MCP tak punya `create_release`/create-ref-tag (hanya `create_branch`=`refs/heads`). Verifikasi via API tetap bisa (read).
- **G-61** — Audit privasi yang memindai ISI file melewatkan **metadata commit** (author/committer email) — jalur PII yang tak tersentuh gate mana pun
- **G-63** — Remediasi G-61 di mesin kedua tak harus clone-ulang: `reset --hard` + `reflog expire` + `gc --prune=now` setara, tanpa mengorbankan file gitignored (`.internal/`) / `npm link` / path Task Scheduler
- **G-65** — `npm install --dry-run` TETAP menjalankan lifecycle `prepare` → `dist/` sungguh ditulis ulang (bukan no-op); pakai `--ignore-scripts` bila benar-benar butuh nol efek samping
- **G-60** — Dokumen keamanan tulisan subagent terbaca meyakinkan tapi bisa BERTENTANGAN dgn kode/ADR → verifikasi tiap klaim ke kode; gate baru wajib punya assertion anti-kosong (lolos-palsu)

## Backup / Notifier (I-32 / I-8)
- **G-53** — SQLite online backup API (`db.backup()`): koneksi sumber WAJIB tetap terbuka saat transfer + dir tujuan harus ada; race korupsi lama tak bisa jadi negative-control deterministik
- **G-54** — Engine notifikasi STATELESS lolos unit-test (dipanggil 1×) tapi caller PERIODIK menyingkap spam (fire tiap tick)
