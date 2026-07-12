# GOTCHAS.md — jebakan yang sudah dibayar

> Jebakan konkret yang ditemukan saat riset/uji, ditulis **saat ditemukan**. Tujuan: sesi berikutnya
> tidak membayar ulang pelajaran yang sama. Tiap entri → dampak + cara benar + pointer sumber.

---

## Antigravity / agy

### G-1 — Token on-disk `oauth_creds.json` bisa STALE meski agy jalan normal
**Jebakan:** `~/.gemini/oauth_creds.json` `access_token` bisa **kadaluarsa berminggu-minggu** (mis. expiry
12 Jun sementara hari ini 3 Jul) **padahal `agy -p "ping"` tetap balas `pong` exit 0.** agy me-refresh token
**secara internal** (via language server) dan **tidak menulis ulang** file di disk.
**Dampak:** probe standalone `retrieveUserQuota` (ADR-010 opsi #3) yang membaca token on-disk → **401
UNAUTHENTICATED**. Menjalankan `agy -p` **tidak** memperbaiki file.
**Cara benar:** untuk opsi #3, refresh token sendiri via `oauth2.googleapis.com` (egress tambahan di luar
whitelist NFR + butuh client-id Gemini CLI) **atau** ambil token dari LS sesi hidup (→ condong opsi #2 utk
sesi hidup). Jangan asumsikan token on-disk valid. **Sumber:** RESEARCH §5b (TODO #5c), DECISIONS ADR-010.

### G-2 — Baris log "not logged into Antigravity" BUKAN indikator gagal-login
**Jebakan:** saat LS boot, muncul *"error getting token source: You are not logged into Antigravity"*
sampai **26×** — race cache-refresh ~12 ms **sebelum** auth sukses, **bahkan di sesi sehat**.
**Dampak:** Detector/probe bisa salah menyimpulkan mesin belum login → false negative.
**Cara benar:** sinyal auth andal = **`server.go … Auth succeeded`** (atau kegagalan persisten tanpa pernah
mencapainya), bukan ada/tidaknya baris "not logged in". **Sumber:** RESEARCH §5b.

### G-3 — agy interaktif TANPA TTY tidak mem-bind language server
**Jebakan:** proses agy interaktif tanpa PTY nyata = hidup tapi **0 port LS** → probe `GetUserStatus` (opsi #2)
gagal (tak ada port). LS hanya naik di print-mode (sesaat) atau interaktif **ber-PTY**.
**Dampak:** probe LS untuk sesi hidup mustahil tanpa PTY; print-mode LS balas quota `nil`
(`GetCascadeModelConfigData() is nil`).
**Cara benar:** supervisor **wajib** bungkus agy via PTY nyata (node-pty) untuk pegang LS sesi hidup.
Discovery port di Windows: `Get-NetTCPConnection -OwningProcess <pid>` (port TIDAK di argv). **Sumber:**
RESEARCH §5b; dasar ADR-003 (PTY wajib).

### G-7 — LS `GetUserStatus` quota `nil` di print-mode, TERISI di interaktif ber-PTY (tanpa prompt)
**Jebakan:** `agy -p` (print-mode) mem-bind LS tapi `GetUserStatus` balas `GetCascadeModelConfigData() is nil`
(quota kosong) → mudah salah simpul "LS tak bisa kasih quota". Padahal di sesi **interaktif ber-PTY nyata**,
`cascadeModelConfigData` + `quotaInfo` **terisi penuh langsung saat init — tanpa perlu kirim prompt** (0 kuota).
**Dampak:** probe opsi #2 (ADR-010) tampak buntu jika hanya diuji lewat print-mode.
**Cara benar:** bungkus agy via **PTY nyata** (node-pty), tunggu `Auth succeeded`, baru `POST GetUserStatus`
(Connect-JSON, body `{}`, tanpa csrf) → 200 + `quotaInfo.{remainingFraction, resetTime}` **per model** (reset window
beda per-kelas-model — baca per model, bukan satu angka). **Sumber:** verifikasi 3 Jul malam; RESEARCH §6 TODO #5(d), ADR-010.

### G-8 — `winpty` degradasi ke passthrough saat stdin bukan tty → agy interaktif exit "stdin is not a tty"
**Jebakan:** menjalankan `winpty -- agy` dari proses non-interaktif (tool/background) → winpty **passthrough**
(bukan alokasi pty sungguhan) karena stdin-nya sendiri bukan tty → agy lihat non-tty → exit 1.
**Dampak:** gagal dapat sesi interaktif agy untuk probe LS via winpty.
**Cara benar:** pakai **ConPTY sejati** (node-pty `pty.spawn`) — bukan winpty passthrough — untuk sesi interaktif
yang butuh `isatty(stdin)==true`. node-pty 1.1.0 prebuild jalan di Node 24.18.0 Win (tanpa compiler). **Sumber:** 3 Jul malam.

### G-9 — Respons LS `GetUserStatus` memuat PII (nama + email)
**Jebakan:** payload `userStatus` berisi `name` + `email` user (di samping quota) → kalau di-log/di-echo mentah
(mis. ke Telegram tier C) = kebocoran PII.
**Dampak:** egress/log jalur probe bisa membocorkan identitas.
**Cara benar:** perlakukan output jalur ini **sensitif** — modul redaksi ADR-013 (hybrid regex+entropy) + jangan
tulis mentah ke repo/log. Saat dokumentasi, rekam **skema** (nama field) + angka quota, bukan PII. **Sumber:** 3 Jul malam; ADR-013.

### G-16 — Toggle credit CLI agy = `useG1Credits` (BEDA dari IDE `useAiCredits`) + fallthrough senyap
**Jebakan:** menonaktifkan AI Credits di `~/.gemini/config/config.json` (`useAiCredits:false`, dipakai IDE) **TIDAK**
mematikan pemakaian credit oleh **CLI** — `agy` CLI punya key sendiri **`useG1Credits`** di
`~/.gemini/antigravity-cli/settings.json`. Bila `true`, saat kuota 5-jam habis agy **diam-diam meluncur ke AI Credits**
(overage berbayar) **tanpa pesan limit, sesi tetap hidup** → "5-jam limit-hit" jadi **soft** (tak terlihat sbg stop).
**Dampak:** (a) biaya overage tak terduga; (b) supervisor **tak** akan melihat sesi-mati bersih untuk agy selama credit ada
→ deteksi limit agy tak boleh bergantung sesi-berhenti. **Cara benar:** untuk memaksa hard-stop, credit harus off; set
`useG1Credits:false` (catatan: agy **menghapus** key ini saat launch — kontrol andal kemungkinan via console/server
Antigravity, bukan file). Detektor agy: perlakukan limit sebagai **kombinasi** `remainingFraction` absent (G-17) **dan**
credit habis/off, bukan sesi-exit. **Sumber:** eksperimen limit agy ASLI 4 Jul (FINDINGS F9/F12); observasi −44 credit.

### G-17 — Sinyal exhaustion 5-jam agy = field `remainingFraction` HILANG (absent), bukan 0
**Jebakan:** saat pool 5-jam Gemini benar-benar habis, LS `GetUserStatus` **menghapus field `remainingFraction`** dari
`quotaInfo` semua varian Gemini (hanya `resetTime` tersisa) — **bukan** menyetelnya ke 0. Parser yang membaca
`m.remainingFraction` mentah → `undefined` → `undefined.toFixed()`/aritmetika **crash**.
**Dampak:** `parseAgyUserStatus` (M3c) & probe live (M3d.4) bisa crash tepat saat sinyal terpenting (exhaustion).
**Cara benar:** `remainingFraction` absent pada model target = **exhausted** (perlakukan 0/blokir), jangan crash.
Progresi teramati: `0.2565 → 0.117 → 0.0055 → [absent]`. **Sumber:** FINDINGS F8, 4 Jul.
**⚠ Diperluas (live-verify 11 Jul, agy 1.1.1):** exhaustion 5-jam bisa **`remainingFraction: 0` (present)** ATAU
**absent** — teramati `3p-5h` habis = `0` (present, bukan absent) di 1.1.1, sedangkan Gemini 4 Jul = absent. Parser
`parseAgyQuotaSummary`/`parseAgyUserStatus` BENAR untuk dua-duanya (`0`→`clamp01(1-0)=1`; absent→`1`). Jangan asumsi
hanya salah satu bentuk. **Sumber:** I-15 live-verify 11 Jul.

### G-18 — `agy -p` (child_process) MENGGANTUNG bila stdin tak di-EOF; print-mode KOSONG saat limit; skip-permissions kontraproduktif
**Jebakan (a):** `cp.execFile('agy', ['-p', prompt, ...])` tanpa menutup stdin child → agy print-mode **blok baca stdin**
→ timeout (output 0). **(b)** `--dangerously-skip-permissions` di print-mode → agy coba pakai tool (agentic) → lambat/hang.
**(c)** saat kuota habis, `agy -p` = **stdout KOSONG, exit 0** — pesan limit **TIDAK** muncul di print-mode (hanya di rendering TUI interaktif).
**Dampak:** probe/burner agy print-mode hang atau salah-baca "sukses" saat justru limit.
**Cara benar:** `child.stdin.end()` segera setelah spawn; **jangan** skip-permissions (batasi "jawab teks, tanpa tool");
deteksi limit agy **jangan** dari stdout print-mode — pakai rendering TUI (pola `Individual quota reached`, G-19) atau
probe LS (G-17). **Sumber:** FINDINGS F5/F6/F11, 4 Jul.
**⚠ Anotasi versi (agy 1.1.1, 11 Jul):** jebakan **(a)** & **(c)** ini **spesifik agy ≤1.0.16**. CHANGELOG 1.1.1: `agy -p`
**tak lagi baca stdin** bila prompt via flag → `child.stdin.end()` (a) tak lagi wajib (tetap harmless). Print-mode yang gagal
server-side kini **tulis error ke stderr + exit≠0** (bukan "stdout kosong exit 0") → **(c) tak berlaku di 1.1.1**. Positif,
tapi **tetap jangan** andalkan print-mode utk deteksi limit agy (server-fail vs quota-reached belum diverifikasi terpisah di
1.1.1) — jalur andal tetap TUI/LS. **Sumber:** delta-check versi 11 Jul (RESEARCH §4c).

### G-19 — Pesan limit agy TUI ASLI + agy tetap HIDUP (limit≠exit) + tak boleh sesi konkuren
**Jebakan/Fakta:** pesan limit agy interaktif (kuota 5-jam=0, credit off) =
`⚠ Individual quota reached. Please upgrade your subscription to increase your limits. Resets in <Xm Ys>.` + baris `Error ID: <uuid>`.
Setelah pesan, agy **TETAP HIDUP** di prompt (footer `? for shortcuts` balik) — **limit≠exit** (seperti CC) → jalur
**inject-continue** ADR-014 viable untuk agy. Reset ditampilkan **relatif** ("Resets in 59m14s"), korelasi `resetTime`
absolut LS. **Juga:** agy **tak mendukung sesi print konkuren** (state `~/.gemini`/LS/token di-share → hang) → burner/probe wajib sekuensial.
**Dampak:** fixture detektor agy = pola `Individual quota reached` (bukan tebakan); gating continue agy = alive-path.
**Cara benar:** korpus detektor agy pakai pesan ASLI ini; jangan spawn banyak sesi agy serentak. **Sumber:** FINDINGS F4/F10/F11, 4 Jul (`agy-REAL-limit-message.txt`).
**✅ Re-verified live 11 Jul (agy 1.1.1):** pesan **IDENTIK** (`⚠ Individual quota reached. Please upgrade your
subscription to increase your limits. Resets in 4h31m7s.` + `Error ID: …`), **limit≠exit tetap berlaku** (agy hidup di
prompt `>` + footer `? for shortcuts`). `matchAgyLimit` + `antigravityAdapter.detect` **fire benar** atas output 1.1.1
nyata (`{kind:'limit',source:'output',evidence:'Individual quota reached'}`) — detektor produksi live-validated (menutup
paruh DETEKSI I-15 untuk agy). **Sumber:** I-15 live-verify 11 Jul (`agy-burn-interactive.mjs`).

## Claude Code

### G-4 — Dua format `resets_at` berbeda per-sumber usage
**Jebakan:** statusLine JSON `rate_limits.*.resets_at` = **Unix epoch seconds**; endpoint `api/oauth/usage`
`*.resets_at` = **ISO-8601 string** (`2026-07-03T14:19:59.58+00:00`). Sama-sama "resets_at", tipe beda.
**Dampak:** adapter yang mengasumsikan satu format akan salah-parse salah satu sumber.
**Cara benar:** parse per-sumber (epoch vs ISO). `utilization`/`used_percentage` = **pecahan**, jangan
parse integer. `api/oauth/usage` juga punya array `limits[]` lebih kaya (severity/is_active/per-model).
**Sumber:** RESEARCH §2 (poin 1 & 2).

### G-5 — Payload hook `StopFailure`: field tipe error = `error`, BUKAN `error_type`
**Jebakan:** docs resmi menyebut `error_type`; payload nyata (v2.1.199/2.1.200) memakai **`error`**.
**Dampak:** Detector yang baca `error_type` → selalu undefined → gagal klasifikasi `rate_limit`.
**Cara benar:** baca field **`error`** (nilai matcher, mis. `rate_limit`). Bonus field
`last_assistant_message` (teks user-facing) berguna utk fixture. **Sumber:** RESEARCH §2c (TODO #7).

### G-15 — Pesan limit CC nyata menyisipkan qualifier ("session"/"weekly") + warning proaktif UI-only
**Jebakan (a):** pesan limit Claude Code nyata = `You've hit your session limit · resets 7:30am (Asia/Jakarta)`
— ada kata **"session"** antara "your" dan "limit". Pola detektor kontigu `hit your limit` **tak match** →
false-negative pada limit ASLI (korpus komunitas keliru mengira kontigu). **Jebakan (b):** banner peringatan
proaktif (~90% window 5-jam, ~75% mingguan) yang muncul di terminal **TIDAK di-persist** ke transcript JSONL
(UI-only, transien) — mencari-nya di transcript = nihil.
**Dampak:** (a) limit asli lolos deteksi output-scrape → sesi tak ter-resume; (b) sia-sia meng-scrape warning.
**Cara benar:** (a) pola izinkan satu qualifier opsional: `\bhit your (?:\w+ )?limit\b` (mencakup "session"/
"weekly"/"limit" polos). (b) JANGAN scrape warning — hitung proximity sendiri dari usage-probe
(`used_percentage`/`percent` → `usedFraction`, parser M3c), lebih andal + lintas-tool. Threshold Claude Code
sendiri = 90% (5-jam) / 75% (mingguan) → default US-13. **Sumber:** limit 5-jam asli tertangkap 4 Jul 2026
(transcript sesi, `isApiErrorMessage:true`); RESEARCH §2b, ISSUES I-8.

### G-34 — Encoding path transcript CC = `cwd.replace(/[^a-zA-Z0-9]/g,'-')`; filename = id `--resume`
**Fakta (verifikasi empiris 11 Jul, Windows, `~/.claude/projects/`):** transcript sesi Claude Code ada di
`~/.claude/projects/<cwd-encoded>/<uuid>.jsonl` di mana `<cwd-encoded>` = **setiap karakter non-alfanumerik cwd diganti
`-`** (`:`, `\`, `/`, `.`, spasi, dan `-` itu sendiri → semua jadi `-`). Contoh nyata: `D:\PROYEK\auto-continue-cli-agent`
→ `D--PROYEK-auto-continue-cli-agent`; `C:\Users\ziffa` → `C--Users-ziffa`. **`<uuid>`** (nama file minus `.jsonl`) =
persis id yang dipakai `claude --resume <uuid>` (terkonfirmasi: id sesi berjalan cocok dgn nama file jsonl-nya).
**Dampak/guna:** basis penangkapan `cli_session_id` untuk resume-by-id (I-20/A-1) tanpa hook. **Jebakan:** ada juga entri
**direktori** `<uuid>/` (tanpa `.jsonl`) di samping file — pilih **file** `.jsonl`. Dan korelasi "jsonl termuda pasca-spawn"
**racy** bila dua sesi start di cwd sama → jalur robust = hook `SessionStart` (I-23). **Sumber:** investigasi R2 (11 Jul).
**✅ JALUR ROBUST DITEMPUH + LIVE-VERIFIED (12 Jul, I-23, CC 2.1.207, otorisasi user):** capture id CC = payload hook
**`SessionStart`** (bukan scan direktori racy). Payload nyata: `{session_id, transcript_path, cwd,
hook_event_name:"SessionStart", source:"startup"}` — `session_id` = **PERSIS** nama `<uuid>.jsonl` transcript (dikonfirmasi
live: id `fd55a7d2-…` = filename jsonl) → id `--resume` sah. Hook dipasang `claude --settings <file>` (**diterima 2.1.207**,
merge additif, auth diwarisi — doc resmi tak mendokumentasikan `--settings` tapi empiris jalan, seperti klaim RESEARCH §2c).
Hook **exec-form** (`command`+`args[]`) → tak ada shell-quoting lintas-OS. **Sumber:** I-23 live-verify 12 Jul.

### G-36 — agy cli_session_id (resume-by-id): sumber ANDAL = cmd yang agy CETAK saat exit; `.db` termuda = racy
**Fakta (live-verify 11 Jul, agy 1.1.1 Windows, R2b/I-20):** analog G-34 untuk agy. Saat sesi agy interaktif ditutup
(Ctrl-C 2×), agy **MENCETAK** perintah resume eksplisit: `Resume with -c (or command below): agy --conversation=<uuid>`
— ini **sumber ANDAL** `cli_session_id` agy (bukan tebakan). Konversasi disimpan di
`~/.gemini/antigravity-cli/conversations/<uuid>.db`; filename `<uuid>` = id `--conversation`. **Jebakan:** heuristik
".db termuda pasca-spawn" **RACY** — satu sesi burn memunculkan **DUA** `.db` baru (`4f9a8638…` + `830255c2…`), hanya
yang PERTAMA (yang dicetak) = id resume benar. **Verifikasi resume-load:** `agy --conversation=4f9a8638…` **memuat
percakapan lama utuh** di sesi baru (isi turn sebelumnya tampil, agy hidup di prompt — paruh RESUME I-15 ✅). **Bentuk:**
agy cetak `--conversation=<id>` (dgn `=`); adapter kita `resumeCmd` pakai `['--conversation', id]` (spasi) — Go-flag
terima dua-duanya (bentuk `=` terverifikasi live; spasi = low-risk, verifikasi opportunistik). **Sumber:** I-15 live
11 Jul (`agy-burn-interactive.mjs` + `agy-resume-verify.mjs`).
**✅ CAPTURE END-TO-END LIVE-VERIFIED (12 Jul, I-20, agy 1.1.1, otorisasi user):** spawn agy nyata via node-pty →
1 turn (`hi`) → Ctrl-C 2× → agy cetak `agy --conversation=<uuid>` (bentuk `=`, `sawResumeHint:true`) → **kode capture
PRODUKSI** (`antigravityAdapter.captureSessionId` + `daemon/session-id-capture.ts`) menangkap uuid **persis** yang
dicetak (`0c384fd6…`). Regex `matchAgyResumeId` cocok dgn format nyata. Catatan: agy fresh yang langsung di-Ctrl-C
(nol turn) TAK mencetak resume-cmd (tak ada percakapan) → butuh ≥1 turn agar id tercetak.

## Lingkungan / repo

### G-6 — Git CRLF pada docs (Windows)
**Jebakan:** `git` memperingatkan "LF will be replaced by CRLF" saat menyentuh file docs di Windows.
**Dampak:** kosmetik (diff noise potensial lintas-OS Ubuntu↔Windows), belum jadi masalah nyata.
**Cara benar:** bila diff noise mengganggu nanti, pertimbangkan `.gitattributes` (`*.md text eol=lf`).
Untuk sekarang: aman diabaikan. **Sumber:** observasi session-end 3 Jul.

## Build / M1 foundation

### G-10 — `tsc` tak menyalin file non-`.ts` (migrasi SQL) ke `dist/`
**Jebakan:** `store/migrations/*.sql` dibaca via `fs.readdirSync`/`readFileSync` relatif ke posisi modul
saat runtime (`import.meta.url`). `tsc` **hanya** mengkompilasi `.ts` → `dist/store/migrations/` tak pernah
tercipta di build output, walau ada di `src/`.
**Dampak:** `acca` hasil build (`dist/cli/index.js`) crash `ENOENT: no such file or directory, scandir
'dist/store/migrations'` saat `openDb()` pertama kali dipanggil — lolos `tsc --noEmit`/type-check karena ini
bukan error tipe, hanya kentara saat smoke-run binary hasil build.
**Cara benar:** tambahkan langkah salin aset non-TS setelah `tsc` (`scripts/copy-migrations.js`, dipanggil dari
`npm run build`: `tsc && node scripts/copy-migrations.js`). Pola ini berlaku untuk aset non-`.ts` apa pun yang
dibaca via path relatif runtime (fixture, template, dll) — bukan cuma migrasi. **Sumber:** smoke-test M1, 3 Jul.

### G-11 — npm `allow-scripts` (lavamoat-style) memblokir postinstall native default
**Jebakan:** repo/environment ini punya `allow-scripts` aktif secara default (`npm warn allow-scripts ...
packages have install scripts not yet covered`) — `npm install` **tidak** otomatis menjalankan install/postinstall
script `better-sqlite3` & `node-pty` (dan `esbuild` punya postinstall juga). Native module ter-install tapi
belum tentu "siap pakai" tanpa langkah approve eksplisit.
**Dampak:** gate DEPENDENCY-POLICY ("`require()` + operasi minimal jalan") bisa false-negative-terlihat-OK
padahal script belum jalan — mesti diverifikasi manual (require+operasi), jangan asumsikan `npm install` sukses
= script jalan.
**Cara benar:** `npm approve-scripts <pkg1> <pkg2> ...` untuk paket native tepercaya yang dipakai (bukan
blanket-allow — CONVENTIONS/DEPENDENCY-POLICY), lalu **reinstall bersih** (`rm -rf node_modules && npm install`)
karena `npm install` yang "up to date" tidak me-retrigger script pada tree yang sudah ada. Hasil approve tersimpan
di `package.json` field `allowScripts` (ter-commit, jadi approve berikutnya deterministik). Setelah itu tetap
verifikasi eksplisit: `node-pty` di Windows memuat native `.node` dari **`prebuilds/<platform>-<arch>/`** sebagai
fallback bila `build/Release` kosong (postinstall `node-pty` hanya menyalin `conpty.dll`/`OpenConsole.exe`, bukan
`.node` files) — jadi `build/Release` boleh terlihat "kosong" dan itu **normal**, bukan tanda gagal; yang penting
`require('node-pty').spawn(...)` benar-benar jalan (diverifikasi lewat spawn+echo nyata). **Sumber:** verifikasi
gate M1, 3 Jul (Windows 11, Node 24.18.0).

### G-12 — node-pty (Windows) tak resolve PATH/PATHEXT — butuh path absolut executable
**Jebakan:** `pty.spawn('claude', …)` di Windows gagal dengan `File not found:` **walau** `where.exe claude`
menemukannya (di sini `C:\Users\ziffa\.local\bin\claude.exe`). node-pty/ConPTY **tidak** mencari `PATH` dan
**tidak** menerapkan `PATHEXT` (tak menambah `.exe`) seperti shell / `child_process({shell:true})`. `child_process`
resolusi PATH berbeda dari node-pty — jangan asumsikan sama.
**Dampak:** wrapper `acca run -- <cli>` tak bisa meluncurkan CLI target dengan nama telanjang; muncul sebagai
spawn-failure (di kita → sesi `FAILED`, bukan orphan — benar, tapi CLI tak jalan).
**Cara benar:** resolusi nama → path absolut sebelum `pty.spawn` (`src/shared/which.ts`: cari di `PATH`,
terapkan `PATHEXT` di Windows). Path yang sudah absolut/mengandung separator dilewati apa adanya. Catatan: bila
target berupa `.cmd`/`.bat` (bukan kasus `claude`/`agy` yang `.exe`), ConPTY tak bisa mengeksekusinya langsung —
perlu `cmd.exe /c` (belum diperlukan; PATHEXT memprioritaskan `.EXE`). **Sumber:** smoke M1 interaktif, 3 Jul (Windows 11).

## Detector / Reset Estimator (M2)

### G-13 — `reset-estimator` clock-time "next occurrence" bisa meleset ±1 jam di hari transisi DST ✅ TERATASI (I-4, 11 Jul)
> **Status:** diperbaiki 11 Jul (I-4 CLOSED). Cabang zona IANA kini hitung ulang wall-clock di tanggal besok
> (bukan `+MS_PER_DAY` mentah); +2 test wrap-lintas-DST (spring-forward/fall-back). Entri di bawah dipertahankan
> sebagai catatan sejarah + penjelasan teknik.

**Jebakan:** saat `resolveClockTime` harus wrap ke "besok" (jam target sudah lewat hari ini), ia menambah
**`MS_PER_DAY` (86.400.000 ms) ke instant UTC**, bukan menghitung ulang wall-clock+1-hari di zona target.
Di ~2 hari transisi DST/tahun, menambah tepat 24 jam ms bisa mendaratkan wall-clock di jam berbeda (23/25 jam),
padahal hasil tetap ditandai `source:'exact'`.
**Dampak:** minor — jalur ini (scrape "resets 3pm (America/New_York)" dari output) = **fallback-of-fallback**;
sumber `exact` yang andal = ISO-8601 dari `api/oauth/usage`/LS (tanpa ambiguitas zona). Edge hanya kena bila (a)
reset diparse dari clock-time output DAN (b) jam target sudah lewat hari-ini DAN (c) kebetulan hari transisi DST.
**Cara benar (bila kelak perlu presisi):** hitung ulang tanggal+1 di zona (`getDatePartsInZone` untuk besok) lalu
`resolveWallClockToUtc`, bukan tambah `MS_PER_DAY` mentah. Dilacak I-4 (P3). Untuk M2 diterima apa adanya.
**Sumber:** tier-review M2 (4 Jul), `src/daemon/reset-estimator.ts`.

---

## Daemon / IPC (M3)

### G-14 — Unlink socket unix tanpa syarat SEBELUM `listen` men-"steal" socket daemon hidup
**Jebakan:** pola umum "hapus file socket stale lalu `listen`" bila dijalankan **tanpa syarat** akan
meng-`unlink` socket yang **masih dipegang daemon hidup**, lalu `listen` di path sama **berhasil** →
**dua daemon diam-diam** melayani path yang sama (yang kedua men-hijack). `EADDRINUSE` **tak pernah**
terpicu di POSIX karena path keburu dibebaskan. Langgar single-instance (ADR-002) + sole-writer (ADR-015).
Windows named pipe tak kena (tak di-unlink; pipe hilang otomatis saat owner mati) → **bug ini lolos di
tes Windows tapi aktif di Linux daily-driver.**
**Dampak:** korupsi state (dua penulis `sessions`), single-instance gagal senyap di Ubuntu.
**Cara benar:** JANGAN unlink buta. Coba `listen`; bila `EADDRINUSE` di POSIX, **probe via `connect`**:
ada yang jawab (`connect` sukses) → daemon hidup → propagate (reject); tak ada yang jawab
(`ECONNREFUSED`) → socket stale → baru unlink + `listen` ulang **sekali** (guard `isRetry` cegah loop).
**Sumber:** tier-review M3a (4 Jul), `src/daemon/ipc-server.ts`.

---

## Detector wiring / PTY (M3d)

### G-20 — Output PTY (ConPTY/node-pty) menyisipkan escape ANSI/CSI walau baris "polos" → detector wajib strip
**Jebakan:** stream `onData` dari node-pty **bukan** teks bersih — ConPTY (Windows) menyisipkan sekuens kontrol
(mis. `\x1b[?25l` sembunyikan kursor, `\x1b[2J` clear, `\x1b[H` home, `\x1b[m` reset, judul window `\x1b]0;…`)
di sekitar/di dalam baris. Terbukti di smoke M3d.1: baris pesan limit datang sebagai `…[?25l[2J[m[H` diikuti
teksnya. Pola detektor (regex frasa limit) yang dijalankan atas teks **mentah** bisa **gagal match** bila kode
warna/kursor menyusup di tengah frasa (mis. `hit your \x1b[1msession\x1b[0m limit`).
**Dampak:** false-negative deteksi limit pada output TUI nyata (padahal fixture bersih lolos) → sesi tak ter-LIMIT_HIT.
**Cara benar:** strip ANSI/CSI **per baris lengkap** (setelah line-buffering, supaya escape tak terpotong antar-chunk)
sebelum `classify()`. `daemon/limit-watcher.ts` memakai `/\x1b\[[0-9;?]*[a-zA-Z]/g` (butuh
`eslint-disable no-control-regex`). Cakupan = CSI (warna/kursor); OSC (`\x1b]…\x07`) & charset (`\x1b(B`) belum
di-strip — perluas bila observasi live menunjukkan frasa terpotong olehnya. **Sumber:** smoke M3d.1 (4 Jul), `src/daemon/limit-watcher.ts`.

### G-21 — `require()` di modul ESM = ReferenceError runtime (lolos `tsc`, mati saat dipanggil)
**Jebakan:** proyek ini TS/ESM murni (`"type":"module"`, output ESM). Menulis `const x = require('node:fs')` di
kode sumber **lolos `tsc`** (karena `@types/node` mendeklarasikan `require` global untuk konteks CommonJS) tapi
`require` **tak terdefinisi** saat modul dijalankan sebagai ESM → `ReferenceError: require is not defined`. Lebih
berbahaya: bila pemanggilnya di jalur yang **belum pernah dieksekusi test** (mis. fungsi placeholder yang di-comment
di call-site), build + seluruh test hijau **menyembunyikan** bom waktu ini. (Ditemukan di kerja Haiku yang di-revert:
`injectToPty` pakai `require('node:fs').writeSync`.) **Cara benar:** SELALU `import { writeSync } from 'node:fs'` di
atas file. Tak pernah `require` di `src/`. **Sumber:** review M3d rebuild (4 Jul).

### G-22 — Port→PID discovery Linux WAJIB korelasi inode; jangan grep `/proc/net/tcp` global
**Jebakan:** untuk menemукan port yang di-listen sebuah PID (agy LS), `cat /proc/net/tcp | grep <pola>` **SALAH** —
tabel itu **global** (semua proses), tak terkorelasi PID; dan alamat lokal disimpan **little-endian hex** (127.0.0.1 =
`0100007F`, **bukan** `0A000000`/dll), state LISTEN = `0A`. (Kerja Haiku yang di-revert melakukan persis dua kesalahan
ini → mengembalikan sampah/nihil.) **Cara benar (korelasi inode):** (1) baca `/proc/<pid>/fd/*` → `readlink` → kumpul
inode dari `socket:[<inode>]`; (2) parse `/proc/net/tcp` **dan** `/proc/net/tcp6`, ambil baris `st==='0A'` (LISTEN)
yang `inode`-nya (kolom idx 9) ada di set inode PID; (3) port = `parseInt(localAddr.split(':')[1], 16)`. Dengan
korelasi inode+state ini **tak perlu** filter `127.0.0.1` sama sekali. Windows lebih mudah — `Get-NetTCPConnection
-OwningProcess <pid> -State Listen` sudah terkorelasi PID oleh OS. **Live-verify di Ubuntu belum dilakukan** (I-12).
**Sumber:** M3d.4 rebuild (4 Jul), `src/shared/port-discovery.ts`.

---

## Usage-Probe live (M3d.3/M3d.4) — verifikasi Ubuntu 5 Jul

### G-23 — GetUserStatus agy = port **HTTPS(gRPC)** + Connect-JSON, dan butuh **retry ~2–4s** pasca port-bind
**Jebakan/Fakta (live Ubuntu 24.04, agy 1.0.16, 5 Jul):** agy LS mem-bind **dua** port (log `server.go:517/525`:
`… listening on random port at <A> for HTTPS (gRPC)` + `… at <B> for HTTP`). Endpoint `GetUserStatus`
(Connect-JSON, body `{}`, tanpa csrf) **menjawab di port HTTPS(gRPC)** — pakai `https` + `rejectUnauthorized:false`.
Salah-protokol gagal senyap: mengirim **HTTP ke port HTTPS** → server balas `TLS handshake error … client sent an
HTTP request to an HTTPS server` dan klien Node dapat `ECONNRESET` (bukan respons); `https` ke port satunya (gRPC-h2)
→ `EPROTO`. **Timing:** tepat setelah bind, GetUserStatus balas Connect-error `{code,message}` (cascade/quota belum
terisi) selama **~2–4 detik** sampai refresh token internal selesai, **baru** `HTTP 200` dgn `userStatus`. Probe di
t+1s = false-empty. **Nuansa auth:** log `server.go:2424 Auth succeeded` = auth **lokal client↔LS**, BUKAN login
upstream Google — baris `Failed to get OAuth token … not logged into Antigravity` + `quota_manager … quotaRefreshLoop:
skipped (not logged in)` bisa muncul **setelah** `Auth succeeded` sebagai race boot (G-2), hilang dalam beberapa detik
saat token in-memory refresh (walau `oauth_creds.json` on-disk tetap kadaluarsa — G-1). **Cara benar (M3d.4):** probe
`https`(rejectUnauthorized:false) ke port hasil `discoverLocalPorts`, **retry sampai HTTP 200 ber-`userStatus`** (mis.
tiap 2s, cap ~10–15s), jangan simpulkan "tak ada kuota" dari attempt pertama. **Sumber:** live-verify 5 Jul (scratchpad
`live-agy-probe*.mjs`), `~/.gemini/antigravity-cli/log/cli-*.log`.

### G-24 — Bentuk NYATA entri model GetUserStatus: `label` + `modelOrAlias.model`, **bukan** flat `model` (koreksi I-7)
**Jebakan:** asumsi lama (ISSUES I-7, 4 Jul) bilang tiap `clientModelConfigs[]` punya field datar **`model`** = display
name, tanpa pembungkus. **Salah** (terkoreksi live 5 Jul): respons **dibungkus `userStatus`**, dan tiap entri = `{ label:
"Claude Opus 4.6 (Thinking)"  (display), modelOrAlias: { model: "MODEL_PLACEHOLDER_M26" }  (enum slug), isRecommended,
allowedTiers[], supportedMimeTypes{}, quotaInfo:{remainingFraction,resetTime} }`. Field `model` datar **tak ada**.
**Dampak:** parser yang baca `config.model` untuk label → `undefined` (identitas model hilang). **Cara benar:** identitas
= **`label`** (prioritas), fallback `modelOrAlias.model` (slug), baru posisi. `parseAgyUserStatus` sudah diperbaiki
(prioritas `label` + baca `modelOrAlias.model`) + fixture `test/fixtures/usage/agy-userstatus.json` diganti **capture
live redaksi** (name/email/userTier.id → `[REDACTED]`, G-9). Kuota per-model + credits di `userStatus.planStatus.{avail…}`
+ `userStatus.userTier.availableCredits[]`. **Reset window per-model beda** (teramati: 10:16:37Z vs 09:32:55Z) — baca
per-model (konsisten ADR-010). **G-17 juga direkonsiliasi ke consumer:** entri exhausted (`quotaInfo` ada, `remainingFraction`
absent) kini di-emit `usedFraction=1` (bukan di-skip) supaya supervisor `limits.every(usedFraction<1)` tak keliru resume
saat satu model masih habis. **Sumber:** live-verify 5 Jul; `src/adapters/usage.ts`, `test/usage-parsers.test.ts`.

### G-25 — undici `fetch` (global Node) TAK bisa `rejectUnauthorized:false` tanpa dep `undici` → jalur loopback pakai `node:https`
**Jebakan:** agy LS = HTTPS **self-signed** di 127.0.0.1 (G-23). Codebase mewajibkan semua egress lewat `safeFetch`
(undici global). Tapi undici `fetch` **tak menerima** `rejectUnauthorized` di `RequestInit` — satu-satunya cara resmi =
inject **`dispatcher`** (undici `Agent` dgn `connect.rejectUnauthorized:false`), yang butuh **import `undici`** sebagai
dependency (Node membundel undici hanya sbg global `fetch`, **bukan** modul importable) → tambah dep = gate
DEPENDENCY-POLICY. Set `NODE_TLS_REJECT_UNAUTHORIZED=0` = **proses-wide** (mematikan verifikasi cert utk SEMUA egress
termasuk api.anthropic.com) — tak boleh. **Cara benar:** helper khusus `loopbackHttpsPostJson` (`shared/http.ts`) pakai
**`node:https`** langsung dgn `rejectUnauthorized:false`, **dibatasi KETAT ke host loopback** (guard: `https:` + hostname ∈
{`127.0.0.1`,`localhost`,`[::1]`}, non-loopback → `EgressBlockedError`) + tetap lewat `guardEgress`. Insecure-TLS jadi
mustahil bocor ke host internet. `safeFetch` tetap jalur wajib utk host publik (CC/Telegram). **Sumber:** wiring M3d.4
probeUsage Windows 5 Jul; `src/shared/http.ts`, `test/http-egress.test.ts`.

### G-31 — agy `GetUserStatus` = window 5-JAM saja; kuota MINGGUAN hanya di `RetrieveUserQuotaSummary`
**Jebakan/Fakta (live-verify 7 Jul, agy 1.0.16 Windows, spike I-16):** `GetUserStatus` (LS Connect-JSON) balas
per-model `quotaInfo.{remainingFraction,resetTime}` yang **hanya** merepresentasikan window **refresh 5-jam** —
**tak ada window mingguan sama sekali** (body tak memuat kata "week"). Padahal agy = **dual-limit: tiap grup model
berbagi kuota MINGGUAN + kuota 5-jam, dua-duanya harus >0** ("Within each group, models share a weekly limit and a
5-hour limit"). Sinyal mingguan **hanya** muncul di endpoint lain: **`POST …/RetrieveUserQuotaSummary`** (body `{}`,
port + no-csrf sama seperti GetUserStatus) → `response.groups[].buckets[].{window:"weekly"|"5h", remainingFraction,
resetTime, description}`. (`RetrieveUserQuota` singular = 404 di LS — bukan itu.)
**Dampak:** probe yang cuma baca `GetUserStatus` (kita, sampai M3d.4-hardening) **buta terhadap exhaustion mingguan**
→ dispatch `every(usedFraction<1)` bisa **keliru resume** saat weekly habis tapi 5-jam sudah reset. Sekelas G-17.
**Cara benar:** probe agy pakai **`RetrieveUserQuotaSummary`**, normalisasi **tiap bucket** (weekly + 5h, semua grup)
ke `UsageLimit[]`; absent remainingFraction = exhausted (G-17). Redaksi displayName grup/plan (PII, G-9). **Sumber:**
spike I-16 (ISSUES), CodexBar `docs/antigravity.md` (mereka prioritas `RetrieveUserQuotaSummary`).

### G-35 — Probe usage agy via sesi LS HIDUP = snapshot saat launch, STALE dalam-sesi (bukan live)
**Jebakan/Fakta (live-verify 11 Jul, agy 1.1.1 Windows, I-15):** `RetrieveUserQuotaSummary` (dan `GetUserStatus`) yang
ditembak ke port LS milik **sesi agy yang sedang hidup** mengembalikan **snapshot kuota saat sesi itu LAUNCH** —
**tidak** ter-refresh saat sesi membakar kuota. Terbukti: satu sesi agy dibakar 3 turn Opus berat sampai TUI
`Individual quota reached`, tapi probe ke LS sesi itu **tetap** lapor `3p-5h remainingFraction=0.0712544` (angka PERSIS
sama sepanjang hidup sesi), sementara **sesi baru** yang di-launch sedetik kemudian lapor `3p-5h=0`. Sekelas `/usage`
stale (RESEARCH §4b): nilai beku di launch-time.
**Dampak:** (a) **I-17 usage-monitor** yang probe periodik ke sesi RUNNING panjang akan membaca angka **basi**
(launch-snapshot) → proximity meleset. (b) **Deteksi limit agy TAK BOLEH mengandalkan probe sesi-hidup** — sinyal LIVE
andal = **output TUI** (`Individual quota reached`, limit-watcher — terbukti fire benar 1.1.1, G-19) ATAU **probe FRESH**
(sesi baru / standalone OAuth ADR-018). Ini **memperkuat ADR-018** (probe pre-resume standalone = fresh, hindari cache
sesi). **Cara benar:** untuk kuota real-time launch sesi baru / standalone probe; jangan percaya angka dari LS sesi yang
sudah lama hidup. **Sumber:** I-15 live-verify 11 Jul (scratchpad `agy-burn-interactive.mjs`).
**⚠ DIKOREKSI (12 Jul, G-38):** kalimat "standalone OAuth ADR-018 = probe fresh" di atas **usang** — probe standalone OAuth
`retrieveUserQuota` ternyata membaca **pool kuota BEDA** (gemini-cli harian), bukan limit grup agy → ADR-018 di-supersede
ADR-019 (optimistic resume). "Probe FRESH yang benar" untuk limit agy = **fresh-launch LS**, bukan OAuth standalone. Lihat G-38.

### G-38 — OAuth `retrieveUserQuota` (gemini-cli) = kuota HARIAN per-model, BUKAN limit grup weekly+5h yang agy tegakkan
**Jebakan/Fakta (live-verify 12 Jul, Windows, agy 1.1.1, otorisasi user — R4 slice 2, membatalkan premis ADR-018):**
`~/.gemini/oauth_creds.json` = login **gemini-cli** (bukan client OAuth agy sendiri; dua client tertanam di `agy.exe` balas
`unauthorized_client` untuk refresh_token ini). Refresh token via **`oauth2.googleapis.com/token`** WAJIB pakai client
gemini-cli publik (`681255809395-…apps.googleusercontent.com` + secret `GOCSPX-…`, installed-app = tak rahasia) — **berhasil
HTTP 200**. Lalu `POST cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota` (Bearer, body `{}`) → **200**, bentuk:
`{ buckets[]: { modelId, tokenType:"REQUESTS", remainingFraction, resetTime(ISO-8601 Z) } }` — **per-MODEL gemini** (gemini-2.5-flash/
-flash-lite/-pro, gemini-3.1-flash-lite), reset **~24 jam (HARIAN)**, nol PII. **TAPI ini kuota request harian gemini-cli Code
Assist — BUKAN** limit **grup weekly+5h** yang agy tegakkan untuk `Individual quota reached`. **Bukti divergensi (akun sama,
serentak 12 Jul):** OAuth `retrieveUserQuota` gemini = **1.0 (100%)** sementara LS `RetrieveUserQuotaSummary` (sesi hidup) =
**gemini-5h 0.079 (7.9%)** + gemini-weekly 0.688 + 3p-weekly 0.330 + 3p-5h 0.9996. `retrieveUserQuotaSummary` **via OAuth =
403 PERMISSION_DENIED** (client gemini-cli tak berhak atas quota-group Antigravity 2.0).
**Dampak:** probe standalone OAuth **TAK BISA** menggerbang resume agy — kalau agy limit (gemini-5h=0) ia tetap lapor gemini
100% → dispatch keliru "resume". **Premis ADR-018 (opsi #3) gugur** → di-supersede **ADR-019** (optimistic resume + detect;
`oauth2.googleapis.com`/`cloudcode-pa.googleapis.com` dihapus dari egress). **Cara benar:** limit grup agy HANYA terbaca via
**LS sesi-hidup** (`RetrieveUserQuotaSummary`, opsi #2) atau **output TUI** (`Individual quota reached`, limit-watcher). Untuk
agy-exited (tak ada LS): jangan probe standalone — resume optimistik lalu deteksi ulang via LS sesi hasil-resume. **Sumber:**
R4 slice 2 live-verify 12 Jul (scratchpad `agy-oauth-probe-spike.mjs` + `agy-ls-compare.mjs`), DECISIONS ADR-019.

### G-33 — agy 1.1.0+ jadikan `request-review` sbg **mode default** → state prompt agy saat idle BEDA (jeda pre-write, bukan hanya prompt kosong)
**Jebakan/Fakta (CHANGELOG agy 1.1.0, delta-check 11 Jul — belum live-verify):** mulai agy **1.1.0**, mode eksekusi default =
**`request-review`**: agy **berhenti sebelum operasi tulis-file** untuk menampilkan diff preview line-level, menunggu `f`
(accept/reject per-perubahan). Ini **menggeser state "diam di prompt"** yang jadi asumsi gating inject-continue (ADR-014
poin iii, idle-tracker G-29) & actuation resume-by-id: agy yang "berhenti" mungkin bukan idle-at-prompt biasa, melainkan
**menunggu review** — penanda footer/idle bisa beda. **Dampak:** (a) gating idle agy (yang memang masih `undefined`/TBD sampai
I-15) makin perlu diverifikasi terhadap state review; (b) inject `continue`/Enter ke agy yang sedang menunggu `f` bisa
ber-efek tak diinginkan. **Cara benar:** saat live-verify agy (I-15), tentukan penanda idle/foreground **untuk 1.1.x** dan
pertimbangkan meluncurkan agy dgn **`--mode default`** (flag baru 1.1.0) agar perilaku dapat-diprediksi bila review-pause
mengganggu auto-continue. Bukan schema break (LS/quota tak berubah) — murni **perilaku TUI/eksekusi**. **Sumber:** delta-check
versi 11 Jul (RESEARCH §4c), CHANGELOG agy 1.1.0.
**⚠ DIKOREKSI (live-verify 11 Jul, agy 1.1.1):** dugaan "request-review = mode default → state idle beda" **TIDAK
terkonfirmasi**. `agy --help` 1.1.1: `--mode` = `accept-edits`/`plan` (bukan `request-review`/`default`). Sesi live +
pasca-limit: agy balik ke **input box normal** (`>` + footer `? for shortcuts`), **bukan** review-pause. Idle marker agy
= footer `? for shortcuts` (mid-turn busy marker belum ditangkap presisi — kandidat idle-tracker agy, sisa I-15).
`--mode default` yang entri ini usulkan **tak ada** di 1.1.1. **Sumber:** I-15 live-verify 11 Jul.
**✅ BUSY MARKER agy DITANGKAP (live-verify 12 Jul, agy 1.1.1, otorisasi user — capture node-pty terkontrol):** saat agy
**generate**, footer menampilkan **`esc to cancel`** — **analog persis `esc to interrupt` milik Claude** — bersama spinner
braille (`⣾⣷⣯⣟⡿⢿⣻⣽`) + teks status **`Generating...`** / **`Working...`** / task-spesifik (mis. `Considering Essay
Scope...`) + ringkasan `▸ Thought for Ns, N tokens`. Saat **idle di prompt**: footer `? for shortcuts` + `>`, **tanpa**
`esc to cancel`/spinner. **Guna:** `idle-tracker` agy (sekarang `undefined`) bisa dibuat dgn MENIRU logika Claude di
`shared/idle-tracker.ts` — busy = jendela-sunyi penanda `esc to cancel` (atau `Generating`/`Working`) hadir; idle = absen +
footer shortcuts. Marker `esc to cancel` = paling stabil (teks tetap, bukan spinner yang beranimasi). **Implementasi
idle-tracker-agy = follow-up I-15** (butuh live-verify gating inject bareng actuation pasca-reset — jangan ✅ tanpa smoke).
**Sumber:** I-15 Sub-task B live 12 Jul (scratchpad `agy-idle-marker-capture.mjs` + `agy-raw-stream.log`).

---

## Actuation seams (M3d.6/M3d.7) — inject-continue & resume-by-id (6 Jul)

### G-26 — Kanal inject-continue: injection firewall harus STRUKTURAL (bukan sekadar konvensi) + wrapper host socket = non-fatal + guard race listen/exit
**Jebakan/Fakta (I-12 poin 1):** actuation "inject continue ke sesi hidup" menyeberangi batas kepercayaan
(daemon → wrapper pemilik PTY). Godaan: kirim token yang mau di-inject **lewat IPC**. **Salah** — itu membuka
kanal untuk menyelundupkan keystroke (dari daemon, atau lebih buruk dari isi output yang di-relay). **Cara benar
(struktural):** token `CONTINUE_TOKEN='continue\r'` **di-hardcode di WRAPPER**; perintah IPC `inject` **tak
membawa payload sama sekali** (args diabaikan). Dengan begitu tak ada *kanal fisik* untuk konten mengalir ke
keystroke — injection firewall jadi properti tipe/struktur, bukan janji. Uji eksplisit: panggil handler dgn args
jahat → yang tertulis TETAP hanya literal. **Dua jebakan operasional wrapper host socket:** (a) meng-host
`createIpcServer` per-sesi **tak boleh fatal** — bila `listen` gagal (mis. pipe stale), sesi user (jalur utama)
harus tetap jalan; bungkus `.catch` → event `control_socket_error`, lanjut tanpa kemampuan auto-inject. (b) **race
listen-vs-exit:** `listen` async; bila proses child sudah exit sebelum listen selesai, server bisa menggantung
menahan event-loop (vitest tak exit). Guard: set flag `exited` di `onExit` + `void controlServer.close()`, DAN di
`.then()` listen cek `if (exited) close()`. Terverifikasi: `run.integration.test` tetap exit bersih. **Sumber:**
Sub-task 1 (6 Jul), `daemon/inject-continue.ts`, `cli/run-core.ts`.

### G-27 — Resume-by-id: JANGAN re-spawn `acca run <tool> --resume …` (commander salah-parse opsi); pakai runSession in-process. ConPTY meng-echo `\r` inject → `\r\n`
**Jebakan (a):** untuk actuation resume-by-id, tergoda men-spawn ulang wrapper via CLI: `acca run claude --resume <id>`.
**Salah** — `run` command commander punya `.argument('[args...]')` variadic, tapi commander tetap mencoba parse
`--resume` sebagai **opsi milik `run`** (bukan diteruskan) → error "unknown option" ATAU tertelan. **Cara benar:**
default `spawnResume` panggil **`runSession(spec, deps)` in-process** — spec dari `adapter.resumeCmd` diteruskan
langsung ke `pty.spawn` (which/G-12), tak ada lapisan parse-CLI kedua. Konsekuensi arsitektur (disengaja, dalam
ADR-002 monolith): daemon jadi **pemilik PTY sesi hasil-resume** (headless — output → log daemon; stdin raw di-skip
karena daemon non-TTY). `runSession` di-import daemon = layer terbalik fisik tapi engine-nya memang niatnya di
`daemon/process-wrapper.ts` (I-14). **Jebakan (b) minor:** saat inject `"continue\r"` ke PTY, ConPTY/terminal
meng-**echo** balik dgn terjemahan line-ending → child stdin menerima `"continue\r\n"` (bukan `\r` polos). Tak
masalah fungsional (agent tetap dapat "continue"+Enter), tapi **jangan assert byte-exact `\r`** pada sisi child —
assert `includes('continue')`. **Sumber:** Sub-task 2 + smoke live (6 Jul), `daemon/supervisor.ts`.

---

## Gating inject-continue (M3d/I-13) — foreground & idle (7 Jul)

### G-28 — Foreground "agent-bukan-shell" = `/proc/<pid>/stat` tpgid vs pgrp, BUKAN name-matching; proses piped → tpgid=-1
**Jebakan/Fakta:** untuk gating inject-continue poin (ii) ADR-014 ("foreground = agent, bukan shell"), godaan =
mencocokkan nama proses foreground ke daftar shell (`bash`/`zsh`/…). **Rapuh** (daftar tak lengkap, nama truncated
15-char, `node` ambigu). **Sinyal yang tepat & robust:** grup proses mana yang memegang **foreground terminal (pts)**.
node-pty (forkpty) menjadikan child **session+group leader** (`setsid`) → `pgrp == childPid`. `/proc/<childPid>/stat`
field **8 = tpgid** (foreground pgrp dari controlling tty) & field **5 = pgrp**. Bila agent foreground → `tpgid == pgrp`;
bila "drop ke shell" interaktif, subshell ambil job-control sendiri (grup baru + `tcsetpgrp`) → `tpgid != pgrp`. Maka
`tpgid==pgrp`→agent(true) · `!=`(>0)→grup lain(false, block) · **`<=0`→unknown (undefined, JANGAN artikan "bukan agent")**.
**Live Ubuntu:** child ber-PTY → `tpgid==pgrp`=8303 → true; **proses PIPED (non-tty, mis. proses tool/test sendiri) →
`tpgid=-1`** → undefined (bukan false!). **Parse:** `comm` (field 2) bisa memuat spasi/`)` → mulai split dari `)`
**TERAKHIR**. Windows/ConPTY tak punya tpgid sederhana → undefined (TBD). **Cara benar:** `foregroundIsAgent` never-throws,
semua kegagalan → undefined (tak memblokir; token-literal firewall tetap jaga keamanan). **Sumber:** I-13 (7 Jul),
`src/shared/foreground.ts`, live-verify /proc Ubuntu.

### G-29 — Idle "bukan mid-turn" = jendela-sunyi penanda busy; regex penanda WAJIB non-global (`.test()` stateful bila `/g`)
**Jebakan/Fakta:** gating poin (iii) ADR-014 ("idle, bukan mid-turn") dari stream output: footer generate Claude
(`esc to interrupt`) **di-repaint terus-menerus** (spinner sub-detik) selama turn → idle = **tak ada penanda busy
selama jendela sunyi** (default 1000ms), bukan "penanda hilang sekali". Melacak dari stream (bukan menebak isi —
hanya penanda footer tetap; ADR-008/013). **Footgun regex:** penanda dipakai via `RegExp.test()`. Bila regex diberi
flag **`/g`**, `.test()` menyimpan `lastIndex` → hasil **berselang-seling** true/false untuk input sama (bug diam).
Penanda WAJIB **non-global** (`/esc to interrupt/i`, tanpa `g`). **Chunk-split:** penanda bisa terbelah antar-chunk
`onData` → simpan carry ~64 char. **Batas diterima (ADR-014 risk band):** bila agent pause mid-turn >quietMs tanpa
repaint footer → false-"idle" → inject = **Enter-keystroke** (bukan perintah, low-harm). agy: penanda busy belum
diverifikasi → `undefined` (unknown, tak memblokir) sampai I-15. **Sumber:** I-13 (7 Jul), `src/shared/idle-tracker.ts`.

---

## Store / migrasi (M3d/I-14)

### G-30 — SQLite `ALTER TABLE ADD COLUMN` + FK butuh default NULL saat `foreign_keys=ON`; FK ditegakkan → test parent-link WAJIB seed parent dulu
**Jebakan/Fakta (migrasi `0002` I-14):** menambah kolom foreign-key ke tabel yang sudah ada — mis.
`ALTER TABLE sessions ADD COLUMN resumed_from TEXT NULL REFERENCES sessions(id)` — hanya sah bila kolom **nullable
default NULL**. Dengan `foreign_keys=ON` (kita aktifkan di `openDb`), SQLite **menolak** `ADD COLUMN` ber-REFERENCES
yang punya default non-NULL. Kolom nullable NULL = aman (teruji live upgrade v1→v2 pada DB **ber-isi**: ALTER sukses,
baris lama dapat `resumed_from=NULL`). **Konsekuensi kedua (mengejutkan di test):** FK itu **benar-benar ditegakkan** —
`createSession({resumed_from:'id-yg-tak-ada'})` → `SqliteError: FOREIGN KEY constraint failed`. Di produksi selalu
aman (parent = sesi lama yang PASTI ada + never-purge ADR-004 → parent tak pernah hilang), tapi **test yang menautkan
parent WAJIB meng-`createSession` parent-nya dulu** (bukan pakai id karangan). **Cara benar (migrasi baru apa pun):**
(a) kolom FK tambahan = `NULL` default NULL; (b) migrasi 1 file = ALTER + `UPDATE meta SET value='<n>'…` (bump
`schema_version`, dijalankan `db.exec` dalam satu transaksi — `runMigrations` di `store/db.ts`); (c) `SELECT *`
mengembalikan kolom baru **di posisi TERAKHIR** (ADD COLUMN append) — mapping better-sqlite3 by-name, jadi urutan
field di interface `Session` tak wajib sama tapi jaga tetap sinkron DATA-MODEL. **Sumber:** I-14 (7 Jul),
`src/store/migrations/0002-session-resumed-from.sql`, live smoke upgrade + FK reject.

---

## Notifier / Usage-monitor (M4)

### G-32 — Timer engine baru yang di-wire ke supervisor WAJIB opt-in, else mengacaukan assertion timer test scheduler
**Jebakan/Fakta (I-17 wiring, 11 Jul):** `usage-monitor` (I-17) memakai `setTimer`/`clearTimer` yang **sama**
(di-inject) seperti scheduler. Test supervisor pakai `createManualTimer` yang `fire()`-nya menyalakan **timer
terakhir yang di-arm** + assert `armedCount()`/`armedDelay()`. Kalau monitor ikut arm timer via `setTimer` yang
sama saat `supervisor.start()`, test lama **pecah**: `fire()` menembak tick monitor (bukan dispatch scheduler),
`armedCount` bertambah, test "tak ada job pending → scheduler disarmed (nol timer)" gagal. **Cara benar:** monitor
**opt-in via flag `startUsageMonitor`** (default **false**); hanya `acca daemon` (produksi) menyalakannya. Test
lama tak menyetelnya → monitor tak dibangun/di-start → nol timer ekstra. Slice baru apa pun yang menambah timer
ber-`setTimer`-bersama ke supervisor harus mengikuti pola gate ini (atau injeksi timer terpisah). Juga: probe pertama
baru jalan setelah `intervalMs` (bukan saat start) — `acca status` kosong ~interval awal (diterima; fast-first-probe
= kandidat follow-up). **Sumber:** wiring I-17, `src/daemon/supervisor.ts`, `test/usage-monitor-wiring.test.ts`.

### G-37 — Auto-continue multi-siklus: sesi inject-continue kembali RUNNING (bukan RESUMED-terminal); un-latch watcher punya residual TUI-repaint
**Jebakan/Fakta (R3/I-21, 12 Jul):** `RESUMED` punya DUA arti berbeda per jalur — untuk **resume-by-id** (proc
`exited`) ia terminal (sesi lama digantikan sesi baru); untuk **inject-continue** (proc `alive`, jalur primer
ADR-014 §1) proses yang SAMA berlanjut → menandainya `RESUMED`-terminal membekukan sesi: `markLimitHit` (guard
`status='RUNNING'`) menolak siklus limit berikutnya + `limit-watcher` `latched` permanen + usage-monitor
(`listRunning` filter `RUNNING`) berhenti memantau → **auto-continue cuma bekerja SEKALI per sesi hidup**
(persona sesi panjang kena limit >1× tak ter-rescue lagi). **Cara benar:** inject-continue sukses → sesi kembali
**RUNNING** (`sessions.markRunningAfterInject`, bersihkan field limit, `proc_state` tetap alive) + `watcher.unlatch()`
+ transisi/un-latch ditulis **WRAPPER** (pemilik PTY & penulis lifecycle sesinya, ADR-017), daemon hanya mencatat
audit; notifikasi "resumed" pindah dari `status_change RESUMED` ke event `job_dispatch_done action:inject_continue`
(paralel `resume_spawned`). Urutan WAJIB: set RUNNING **lalu** unlatch (biar `markLimitHit` guard-RUNNING siap saat
latch dibuka). **RESIDUAL (butuh live-verify I-15, belum):** bila TUI agy/CC me-**repaint** baris pesan limit LAMA
**dengan newline** selagi sesi sudah RUNNING (pasca-inject, sebelum limit asli berikutnya) → watcher bisa re-fire
**LIMIT_HIT palsu** → probe/inject spuriousi. Dimitigasi: `unlatch()` me-reset buffer (buang parsial lama) + TUI
umumnya repaint in-place tanpa `\n`. Sekelas residual idle-false-positive (G-29) — konfirmasi perilaku repaint
agy/CC saat limit asli. **Sumber:** R3/I-21, `src/daemon/{limit-watcher,process-wrapper,supervisor,inject-continue}.ts`,
`src/store/repositories/sessions.ts`, `src/notify/notifier.ts`.

---

## Change Log

| Tanggal | Perubahan |
|---|---|
| 2026-07-12 (autonomous-run, R3/I-21) | **G-37** baru (auto-continue multi-siklus: inject-continue → sesi kembali RUNNING bukan RESUMED-terminal, transisi+un-latch ditulis wrapper (ADR-017), notif "resumed" pindah ke `job_dispatch_done inject_continue`; RESIDUAL TUI-repaint bisa re-fire LIMIT_HIT palsu → live-verify I-15). Dari implementasi R3 (I-21 CLOSED). |
| 2026-07-12 (autonomous-run, I-28) | **G-20 watch DITUTUP** (A-15): `stripAnsi` diperluas dari CSI-saja ke +OSC (judul window `\x1b]0;..\x07`, term BEL/ST) +designasi charset → teks di sekitar sekuens tak salah lolos ke detektor limit/idle-tracker. **G-6 diatasi** (A-12): `.gitattributes` `* text=auto eol=lf` → repo & working tree LF lintas-OS, stop warning CRLF. Dari housekeeping audit I-28. |
| 2026-07-11 (I-15 live-verify, agy 1.1.1 Windows) | **G-35** (probe agy via sesi LS hidup = snapshot launch-time, STALE dalam-sesi → I-17 caveat + perkuat ADR-018 fresh-probe), **G-36** (cli_session_id agy = cmd resume yang agy CETAK saat exit `agy --conversation=<uuid>`; `.db` termuda racy; resume-load ✅). **G-17 diperluas** (exhaustion = `0` present ATAU absent), **G-19 re-verified** (pesan limit + detektor + limit≠exit ✅ di 1.1.1), **G-33 DIKOREKSI** (tak ada request-review mode; `--mode`=accept-edits/plan). Dari burn `3p-5h` ~11% ke limit (I-15, otorisasi user). |
| 2026-07-11 (M3e/R2, audit) | **G-34** baru (encoding path transcript CC = `cwd.replace(/[^a-zA-Z0-9]/g,'-')`, filename=id `--resume`; racy → hook `SessionStart` robust). Dari investigasi penangkapan `cli_session_id` (I-20/A-1). |
| 2026-07-11 (delta-check versi, Ubuntu) | **G-33** baru (agy 1.1.0+ jadikan `request-review` mode DEFAULT → state prompt agy saat "berhenti" bisa = menunggu review, bukan idle-at-prompt → relevan gating/actuation inject-continue; pertimbangkan `--mode default`; belum live-verify). **G-18 dianotasi** (jebakan (a)&(c) spesifik ≤1.0.16; 1.1.1 ubah print-mode: tak baca stdin w/ flag-prompt + server-fail→stderr+exit≠0). Dari delta-check CC 2.1.207 + agy 1.1.1 (RESEARCH §4c 11 Jul). |
| 2026-07-11 (autonomous-run, Windows) | G-32 (timer engine baru yang di-wire ke supervisor via `setTimer`-bersama wajib opt-in `startUsageMonitor`, else `fire()`/`armedCount` test scheduler pecah; probe pertama setelah intervalMs). Dari wiring I-17 usage-monitor. |
| 2026-07-11 (autonomous-run, Windows) | G-13 ditandai **TERATASI** (I-4): `resolveClockTime` cabang zona IANA hitung ulang wall-clock di tanggal besok (DST-correct), bukan `+MS_PER_DAY` mentah. |
| 2026-07-07 (Windows, I-16 live) | G-31 (agy `GetUserStatus` = window 5-jam saja; kuota MINGGUAN hanya di `RetrieveUserQuotaSummary` → probe GetUserStatus-only buta weekly → risiko keliru-resume). Dari verifikasi live cross-check CodexBar (I-16 CONFIRMED). |
| 2026-07-07 (Windows, I-14/I-10) | G-30 (SQLite `ALTER ADD COLUMN` FK butuh default NULL saat `foreign_keys=ON`; FK ditegakkan → test parent-link wajib seed parent; pola migrasi bump schema_version + ADD COLUMN append terakhir). Dari relokasi runSession + resume-chain (I-14). I-10 (daemon re-arm lintas-proses via IPC `rearm`) tak melahirkan gotcha baru — pakai primitif yang ada (`arm()` baca store segar, perintah IPC tanpa payload = G-26). |
| 2026-07-07 (Ubuntu, gating M3d/I-13) | G-28 (foreground = `/proc` tpgid vs pgrp, bukan name-match; piped→tpgid=-1=unknown bukan false; parse comm dari `)` terakhir; live-verify Ubuntu), G-29 (idle = jendela-sunyi penanda busy `esc to interrupt`; regex penanda WAJIB non-global — `/g` bikin `.test()` stateful; carry antar-chunk; risk band Enter-keystroke). Dari I-13. |
| 2026-07-06 (Windows, actuation M3d.6/7) | G-26 (inject-continue: injection firewall STRUKTURAL — token hardcoded wrapper + perintah IPC tanpa payload; wrapper host socket non-fatal; guard race listen/exit), G-27 (resume-by-id: jangan re-spawn `acca run … --resume` — commander salah-parse; pakai `runSession` in-process; ConPTY echo `\r`→`\r\n`). Dari wiring actuation seams I-12 poin 1&2 + 2 smoke live Windows. |
| 2026-07-05 (Windows, wiring M3d.4) | G-25 (undici `fetch` tak bisa `rejectUnauthorized:false` tanpa dep `undici` → jalur loopback pakai `node:https` `loopbackHttpsPostJson`, insecure-TLS dibatasi ketat ke host loopback + tetap `guardEgress`). Dari wiring `probeAgyUsage` per G-23 + live-verify Windows (Get-NetTCPConnection port-discovery ✅ + probe 8 model nyata dalam ~1s). |
| 2026-07-05 (live-verify Ubuntu) | G-23 (GetUserStatus agy = port HTTPS(gRPC) + Connect-JSON; retry ~2–4s pasca bind sampai HTTP 200; `Auth succeeded` = auth lokal LS bukan login upstream; salah-protokol gagal senyap ECONNRESET/EPROTO), G-24 (bentuk entri model NYATA = `label` + `modelOrAlias.model`, bukan flat `model` — koreksi I-7; parser + fixture direkonsiliasi ke capture live; G-17 exhausted di-emit usedFraction=1 bukan skip). Dari live-verify port-discovery + GetUserStatus di Ubuntu 24.04 (I-12 poin 3). |
| 2026-07-04 (M3d rebuild) | G-21 (`require()` di ESM = ReferenceError runtime, lolos tsc — selalu `import`), G-22 (port→PID Linux wajib korelasi inode `/proc/<pid>/fd`→`/proc/net/tcp{,6}` st=0A, jangan grep tabel global; hex localhost `0100007F`). Dari review + rebuild kerja Haiku yang di-revert. |
| 2026-07-04 (M3d.1 wiring) | G-20 (output PTY ConPTY sisipkan ANSI/CSI walau baris polos → detector wajib strip ANSI per-baris sebelum classify; cakupan CSI, OSC/charset belum). Dari smoke live M3d.1. |
| 2026-07-04 (limit agy asli) | G-16 (`useG1Credits` CLI vs IDE `useAiCredits` + fallthrough credit senyap), G-17 (`remainingFraction` absent = exhausted, jangan crash), G-18 (agy `-p` stdin-EOF + print kosong saat limit + skip-permissions kontraproduktif), G-19 (pesan limit TUI agy ASLI `Individual quota reached` + limit≠exit + tak konkuren). Dari eksperimen limit 5-jam agy ASLI (FINDINGS F4-F12). |
| 2026-07-04 (M2-fix) | G-15 (pesan limit CC nyata "hit your **session** limit" → pola kontigu false-negative, diperbaiki `hit your (?:\w+ )?limit`; warning proaktif 90/75 = UI-only, hitung proximity dari usage-probe). Dari limit 5-jam ASLI tertangkap di transcript sesi. |
| 2026-07-04 (M3a) | G-14 (unlink socket unix tanpa syarat sebelum listen = steal socket daemon hidup → dua daemon; fix connect-probe stale-vs-live). Dari tier-review M3a. |
| 2026-07-04 (M2) | G-13 (reset-estimator clock-time next-occurrence tambah `MS_PER_DAY` mentah → meleset ±1j di hari transisi DST; non-blocking, I-4/P3). Dari tier-review M2. |
| 2026-07-03 (sore) | File dibuat. G-1..G-3 (agy: token stale, log login palsu, PTY wajib), G-4..G-5 (CC: dua format reset, field `error` hook), G-6 (CRLF). Dari riset real-CLI + uji sebelumnya. |
| 2026-07-03 (malam) | G-7 (LS quota nil print-mode vs terisi interaktif-PTY tanpa prompt), G-8 (winpty passthrough vs ConPTY node-pty), G-9 (respons GetUserStatus memuat PII). Dari verifikasi terminal ADR-010 item (d). |
| 2026-07-03 (malam, M1) | G-10 (`tsc` tak menyalin migrasi SQL ke `dist/` — perlu `scripts/copy-migrations.js`), G-11 (npm `allow-scripts` memblokir postinstall native default, perlu `npm approve-scripts` + reinstall bersih; node-pty Windows fallback ke `prebuilds/`). Dari implementasi + verifikasi gate M1 foundation. |
| 2026-07-03 (malam, M1 smoke) | G-12 (node-pty Windows tak resolve PATH/PATHEXT — butuh path absolut; resolver `src/shared/which.ts`). Ditemukan saat smoke interaktif `acca run -- claude`. |
