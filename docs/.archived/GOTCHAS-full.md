# GOTCHAS — arsip detail lengkap (s.d. 2026-07-18)

> Detail penuh + reasoning tiap gotcha. `docs/GOTCHAS.md` live hanya simpan indeks 1-baris. Greppable.

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
deteksi limit agy **jangan** dari stdout print-mode — pakai rendering TUI (pola `\bIndividual \bquota reached`, G-19) atau
probe LS (G-17). **Sumber:** FINDINGS F5/F6/F11, 4 Jul.
**⚠ Anotasi versi (agy 1.1.1, 11 Jul):** jebakan **(a)** & **(c)** ini **spesifik agy ≤1.0.16**. CHANGELOG 1.1.1: `agy -p`
**tak lagi baca stdin** bila prompt via flag → `child.stdin.end()` (a) tak lagi wajib (tetap harmless). Print-mode yang gagal
server-side kini **tulis error ke stderr + exit≠0** (bukan "stdout kosong exit 0") → **(c) tak berlaku di 1.1.1**. Positif,
tapi **tetap jangan** andalkan print-mode utk deteksi limit agy (server-fail vs quota-reached belum diverifikasi terpisah di
1.1.1) — jalur andal tetap TUI/LS. **Sumber:** delta-check versi 11 Jul (RESEARCH §4c).

### G-19 — Pesan limit agy TUI ASLI + agy tetap HIDUP (limit≠exit) + tak boleh sesi konkuren
**Jebakan/Fakta:** pesan limit agy interaktif (kuota 5-jam=0, credit off) =
`⚠ \bIndividual \bquota reached. Please upgrade your subscription to increase your limits. Resets in <Xm Ys>.` + baris `Error ID: <uuid>`.
Setelah pesan, agy **TETAP HIDUP** di prompt (footer `? for shortcuts` balik) — **limit≠exit** (seperti CC) → jalur
**inject-continue** ADR-014 viable untuk agy. Reset ditampilkan **relatif** ("Resets in 59m14s"), korelasi `resetTime`
absolut LS. **⚠ Update C-6 (17 Jul):** countdown relatif kompak ini (`Resets in Xh Ym Zs`, unit RAPAT tanpa spasi)
KINI di-parse `extractResetHint` → `relativeMinutes`/`relativeSeconds` (dulu sengaja tidak). Presedensi estimator
tetap: `isoTimestamp` LS-probe absolut **DI ATAS** relatif → LS menang saat ada; parse relatif hanya menggantikan
backoff sia-sia saat output = satu-satunya sinyal (mempersempit jendela false-positive G-37). **Juga:** agy **tak mendukung sesi print konkuren** (state `~/.gemini`/LS/token di-share → hang) → burner/probe wajib sekuensial.
**Dampak:** fixture detektor agy = pola `\bIndividual \bquota reached` (bukan tebakan); gating continue agy = alive-path.
**Cara benar:** korpus detektor agy pakai pesan ASLI ini; jangan spawn banyak sesi agy serentak. **Sumber:** FINDINGS F4/F10/F11, 4 Jul (`agy-REAL-limit-message.txt`).
**✅ Re-verified live 11 Jul (agy 1.1.1):** pesan **IDENTIK** (`⚠ \bIndividual \bquota reached. Please upgrade your
subscription to increase your limits. Resets in 4h31m7s.` + `Error ID: …`), **limit≠exit tetap berlaku** (agy hidup di
prompt `>` + footer `? for shortcuts`). `matchAgyLimit` + `antigravityAdapter.detect` **fire benar** atas output 1.1.1
nyata (`{kind:'limit',source:'output',evidence:'\bIndividual \bquota reached'}`) — detektor produksi live-validated (menutup
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
**Jebakan (a):** pesan limit Claude Code nyata = `You've \bhit your session limit · resets 7:30am (Asia/Jakarta)`
— ada kata **"session"** antara "your" dan "limit". Pola detektor kontigu `\bhit your limit` **tak match** →
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

### G-39 — Enqueue job untuk sesi HASIL-actuation kena FK `scheduled_jobs.session_id`→`sessions.id`; kegagalannya JANGAN flip dispatch ke retry
**Jebakan (RC-1, C-1, audit ketiga):** menjadwalkan job `resume` (continue-inject) untuk sesi BARU hasil resume-by-id
(`spawned.sessionId`) menulis ke `scheduled_jobs` — yang ber-FK ke `sessions` (`foreign_keys=ON`, G-30). Di **produksi**
default `runSession` **createSession dulu** sebelum mengembalikan id → FK terpenuhi. Tapi di **test** dgn `spawnResume`
STUB yang mengembalikan `sessionId` **tanpa** membuat baris → `jobs.enqueue` melempar `SQLITE_CONSTRAINT_FOREIGNKEY`.
**Dampak lebih dalam:** bila enqueue itu berada di dalam `try` dispatch tanpa guard, exception naik ke catch generik →
dispatch return `'retry'` → resume-by-id **di-spawn ULANG** tiap backoff → **loop spawn sesi baru** (padahal resume asli
SUDAH sukses `markResumed`). **Cara benar:** (a) continue-enqueue = **best-effort** di `try/catch` sendiri (audit senyap
`resume_continue_enqueue_failed`, tetap `'done'`) — kegagalan follow-up tak boleh membatalkan actuation yang sudah sukses
maupun memicu re-spawn; (b) test yang men-stub `spawnResume` dan mengandalkan continue-job **wajib** membuat baris sesi baru
(RUNNING+alive) dulu supaya FK terpenuhi (pola G-30 seed-parent). **Sumber:** RC-1 impl + tier-review 13 Jul, `src/daemon/supervisor.ts`.

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
`\bIndividual \bquota reached`, tapi probe ke LS sesi itu **tetap** lapor `3p-5h remainingFraction=0.0712544` (angka PERSIS
sama sepanjang hidup sesi), sementara **sesi baru** yang di-launch sedetik kemudian lapor `3p-5h=0`. Sekelas `/usage`
stale (RESEARCH §4b): nilai beku di launch-time.
**Dampak:** (a) **I-17 usage-monitor** yang probe periodik ke sesi RUNNING panjang akan membaca angka **basi**
(launch-snapshot) → proximity meleset. (b) **Deteksi limit agy TAK BOLEH mengandalkan probe sesi-hidup** — sinyal LIVE
andal = **output TUI** (`\bIndividual \bquota reached`, limit-watcher — terbukti fire benar 1.1.1, G-19) ATAU **probe FRESH**
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
Assist — BUKAN** limit **grup weekly+5h** yang agy tegakkan untuk `\bIndividual \bquota reached`. **Bukti divergensi (akun sama,
serentak 12 Jul):** OAuth `retrieveUserQuota` gemini = **1.0 (100%)** sementara LS `RetrieveUserQuotaSummary` (sesi hidup) =
**gemini-5h 0.079 (7.9%)** + gemini-weekly 0.688 + 3p-weekly 0.330 + 3p-5h 0.9996. `retrieveUserQuotaSummary` **via OAuth =
403 PERMISSION_DENIED** (client gemini-cli tak berhak atas quota-group Antigravity 2.0).
**Dampak:** probe standalone OAuth **TAK BISA** menggerbang resume agy — kalau agy limit (gemini-5h=0) ia tetap lapor gemini
100% → dispatch keliru "resume". **Premis ADR-018 (opsi #3) gugur** → di-supersede **ADR-019** (optimistic resume + detect;
`oauth2.googleapis.com`/`cloudcode-pa.googleapis.com` dihapus dari egress). **Cara benar:** limit grup agy HANYA terbaca via
**LS sesi-hidup** (`RetrieveUserQuotaSummary`, opsi #2) atau **output TUI** (`\bIndividual \bquota reached`, limit-watcher). Untuk
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
footer shortcuts. Marker `esc to cancel` = paling stabil (teks tetap, bukan spinner yang beranimasi).
**Sumber:** I-15 Sub-task B live 12 Jul (scratchpad `agy-idle-marker-capture.mjs` + `agy-raw-stream.log`).
**✅ idle-tracker-agy DIIMPLEMENTASI (12 Jul, sesi berikut):** `BUSY_MARKERS.antigravity = /esc to cancel/i` di
`shared/idle-tracker.ts` (HANYA `esc to cancel` — `Generating`/`Working` terbukti terselang spinner braille di tengah
kata `W⣻  Wor` di stream nyata → tak andal sbg regex, sengaja tak dipakai). Wiring inject sudah tool-generik (I-13,
`process-wrapper.ts:160`+`257` pakai `spec.tool`) → agy kini ter-gate otomatis (mid-turn `esc to cancel` → `proc_not_idle`
blokir; idle → lolos). **+7 test** (6 idle-tracker agy + 2 komposisi idle-tracker→inject; −1 stale "undefined"). **Sisa =
HANYA live-verify gating PTY nyata (I-15, butuh user + limit).** Catatan carry: marker dalam 64-char carry ikut ter-match
di feed berikutnya (harmless, errs-safe). **Sumber:** idle-tracker-agy slice 12 Jul.

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

### G-40 — Token inject-continue: kata "continue" TELANJANG tak me-resume agy (ditafsir pesan NL baru); butuh instruksi eksplisit
**Jebakan/Fakta (live-verify 16 Jul, agy 1.1.3 + CC 2.1.211, otorisasi user — ADR-020):** `CONTINUE_TOKEN='continue\r'`
(warisan meniru claude-auto-retry/CC) di-inject ke **agy** idle di prompt **TIDAK melanjutkan turn yang terhenti**. agy
memperlakukan "continue" sebagai **pesan natural-language baru**, ditafsir kontekstual: sesi tanpa pekerjaan-terputus →
*"I do not have context from a previous session, please explain the task"*; setelah turn SELESAI → *"more of the same"*
(mis. cuaca hari berikutnya). agy **tak punya primitif "resume turn terputus"** untuk kata itu (beda dari CC yang punya
semantik continue). **Bukti penentu (limit ASLI, owner, sesi sama):** saat kuota habis lalu reset, mengetik kalimat
**eksplisit** *"lanjutkan pekerjaan, tadi terhenti karena limit"* → **agy DAN Claude Code langsung melanjutkan pekerjaan
yang terhenti**. **Dampak:** auto-continue jalur alive-inject (ADR-014 §1) dengan token satu-kata = agy membakar turn untuk
hal salah (bukan resume). **Cara benar (ADR-020):** token = **instruksi NL eksplisit** —
`'continue the work that was interrupted by the usage limit\r'` (English, owner) — tetap **literal tetap hardcoded di
wrapper** (injection firewall utuh, kalimat lebih panjang tak mengubah properti; perintah IPC `inject` tetap tanpa payload);
satu token untuk agy + CC. **Catatan mekanisme:** inject **`injected:true`** live (keystroke sampai ke agy) — yang salah
token, bukan seam-nya. **Sinyal English (16 Jul):** inject token English → agy balas *"**Resuming Our Work**. I do not have
the context from your previous session…"* → **mengenali instruksi sebagai resume** (beda "continue" telanjang → "more of
same"). **Sisa (opportunistik):** end-to-end "token me-resume pekerjaan NYATA" = butuh **limit asli** (owner sudah buktikan
konsep dgn frasa Indonesia; English = variasi risiko-rendah, reversible). **Jebakan harness proxy Esc-cancel:** (1) readiness
WAJIB berbasis output (footer `? for shortcuts` + output mengendap), bukan `idleTracker.isIdle()` (default-true saat boot →
prompt terkirim saat agy "Signing in…"); (2) **bahkan setelah fix, prompt esai scripted TAK submit di TUI agy** (FASE-3 busy
timeout 2×) → proxy **tak andal menyediakan turn-terputus** → verifikasi resume-nyata = limit asli, bukan proxy. **Sumber:**
I-15 live-verify 16 Jul (scratchpad `inject-now.mjs` + `esc-cancel-test.mjs` + `esc-cancel.log`), ADR-020.

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
**⚠ RESIDUAL TERKONFIRMASI LIVE (16 Jul, limit CC ASLI, otorisasi user → I-31):** repaint memang **re-fire LIMIT_HIT
palsu**. Trace: inject-continue sukses (`status RUNNING reason:inject_continue`, un-latch) → **detik yang sama**
`LIMIT_HIT {source:"output", evidence:CC_LIMIT_PATTERNS[3]}` → probe dijadwalkan sia-sia. **Terbukti FALSE-POSITIVE:**
sesi CC (Terminal B) **jalan normal & menyelesaikan kerja** pasca-inject (owner + daemon log `Session resumed
(inject-continue)`) — banner limit LAMA yang di-repaint (ber-`\n`), bukan limit baru. Asumsi "TUI repaint in-place
tanpa `\n`" GUGUR untuk CC. **Dampak:** `unlatch()` reset-buffer TAK cukup; sesi ter-tandai LIMIT_HIT palsu + probe
+24 jam (via clock-wrap I-30). **Remedi → I-31** (grace-window pasca-unlatch / butuh baris output BARU non-banner /
korelasi probe-usage). **Sumber:** live-verify I-15 CC full-loop 16 Jul (`docs/audit/LIVE-VERIFY-I15-CC-2026-07-16.md`).
**✅ DITUTUP (16 Jul, I-31 — grace-window OUTPUT-CC):** `limit-watcher` mengabaikan sinyal limit dari OUTPUT untuk sesi CC
dalam `POST_UNLATCH_OUTPUT_GRACE_MS` (5s) pasca-`unlatch()` (audit `limit_suppressed`, tak melatch). CC-only + OUTPUT-only:
re-limit CC SAH via hook `feedSignal` (StopFailure PRIMER) tak disuppress; agy tak tersentuh (ADR-019 immediate detect utuh);
genuine cycle-2 CC via output selalu > window → fire. Clock di-inject (purity engine utuh). Clock-wrap penyerta = I-30
(guard estimator recent-past ≤2h → probe near-now, bukan +24 jam). Konfirmasi live sejati = opportunistik I-15.

## Keamanan / IPC (spec M5)

### G-41 — DACL named pipe Windows Node = TERBUKA by design + tak bisa di-set dari Node; "cek PID client" = mitigasi PALSU (spoofable)
**Jebakan/Fakta (verifikasi web 17 Jul, sumber primer, spec M5 — mengoreksi klaim ADR-015 "ACL default owner"):**
Named pipe yang dibuat Node.js/libuv (`net.createServer(path)`) di Windows memakai **DACL default Windows**, **BUKAN**
owner-only seperti anggapan chmod-0600. Konkret: **Everybody + Anonymous Logon** dapat generic read; user non-elevated
saat ini dapat read+write. Artinya **user lokal lain bisa connect+read** pipe daemon (`status` bocorkan cwd) + memicu
perintah whitelist. **Node TAK menyediakan API** untuk set permission named pipe — mengubah DACL **mustahil tanpa native
addon** (`CreateNamedPipe`+SDDL, bypass libuv). Isu terbuka bertahun: nodejs/node **#47086, #30823, #17743** (per 2026
belum ada API).
**Jebakan kedua (mitigasi palsu):** kandidat "verifikasi **PID client** same-session-user" (yang dulu dicatat I-26)
**TIDAK aman** — PID named pipe **bisa di-spoof** (Google Project Zero "Spoofing Named Pipe Client PID"; kelas CVE-2018-0749).
Microsoft sendiri menyarankan **jangan** pakai PID sbagai enforcement keamanan. Memakainya = **rasa aman palsu** tanpa
keamanan nyata.
**Dampak:** klaim keamanan ADR-015 keliru; verifikasi DACL "apakah terbuka" = tak perlu (sudah pasti terbuka).
**Cara benar (ADR-023):** TERIMA DACL terbuka sbg **residual risk terdokumentasi (R-5, THREAT-MODEL §8)** + **hardening
lapisan-aplikasi** yang bisa dikontrol: (a) minimalkan data sensitif lewat pipe (`status` tak dump cwd tak perlu);
(b) hanya daemon mutasi state (ADR-017); (c) **injection firewall struktural** — `inject` tanpa payload (token literal
wrapper, ADR-014/020) → connect-pipe tak bisa suntik teks arbitrer; (d) audit `events`. **JANGAN** native addon
(over-engineering solo-user) atau cek-PID (spoofable). Node headless multi-akun → mitigasi = akun OS khusus daemon.
**Sumber:** verifikasi web spec M5 17 Jul (nodejs/node #47086/#30823/#17743, Microsoft Learn named-pipe-security,
Google Project Zero PID-spoofing), ADR-023, I-26.

### G-42 — `acca status` (CLI) ≠ handler IPC `status` — CLI baca DB LANGSUNG, handler IPC nol konsumen produksi
**Jebakan (M5.3, 17 Jul):** ada DUA jalur "status" yang mudah dikira satu:
- **CLI `acca status`** (`cli/commands/status.ts`) membuka DB **langsung** (`openDb()` + `sessions.listActive()`), me-render tabel — **TIDAK** lewat IPC/daemon sama sekali (jalan walau daemon mati).
- **Handler IPC `status`** (`supervisor.ts`, `createIpcServer({status})`) = jalur TERPISAH; **tak ada pengirim `cmd:'status'` di `src/`** (nol konsumen produksi — kandidat untuk M-remote/health kelak).
**Dampak:** (a) mengubah satu **tak** otomatis mengubah lain — jangan asumsikan. (b) Sebelum M5.3, handler IPC me-return SELURUH kolom Session (`cli_session_id`, `cwd`) ke pipe DACL-terbuka (G-41) padahal tak ada yang butuh → data-minimize `toSessionStatusView` (T-L1) nol breakage justru karena nol konsumen. **Pelajaran:** saat menyentuh "status", pastikan jalur mana (CLI-direct-DB vs IPC-projected); data yang keluar pipe ≠ data yang dilihat CLI. **Sumber:** M5.3 T-L1 (Opus), THREAT-MODEL §8.4.

### G-43 — `sc.exe` TAK bisa host `node` (error 1053) · WinSW v2: exe wajib SENAMA config-nya + config dimuat SEBELUM parse perintah
**Jebakan 1 — "sc.exe = fallback nol-tool" itu ILUSI (verifikasi 17 Jul, mengoreksi ADR-021 → ADR-025):** `sc create`
akan **menerima** exe apa pun (perintahnya sukses!), tapi service-nya **tak akan start**: Windows SCM mewajibkan binary
memanggil `StartServiceCtrlDispatcher` + lapor `SERVICE_RUNNING` via `SetServiceStatus` dalam batas waktu. `node
dist\cli\index.js daemon` tak pernah melakukannya → **error 1053** "The service did not respond to the start or control
request in a timely fashion". **Registrasi sukses ≠ service jalan** — inilah yang menipu. Node **tak punya** binding SCM;
menambahkannya = native addon / FFI (`koffi`/`ffi-napi`) = justru **menambah** dep native prebuild dua-OS.
→ **Wrapper Windows WAJIB** (ADR-025 pin **WinSW v2.12.0**). *(node-windows justru membundel WinSW.)*
**Jebakan 2 — konvensi penamaan WinSW v2 (empiris, saat pin ADR-025):** WinSW mencari config **bernama sama dengan
exe-nya** di direktori yang sama → `acca-daemon.exe` **wajib** berpasangan `acca-daemon.xml`. Salah nama →
`FATAL Unhandled exception … FileNotFoundException: Unable to locate WinSW.NET461.[xml|yml] file within executable
directory`. **Perangkapnya:** WinSW v2 memuat config **SEBELUM** mem-parse perintah → bahkan `--version` gagal dgn
FATAL config-not-found, yang **menyesatkan** (terbaca seperti binary rusak/runtime hilang, padahal cuma salah nama).
Jadi: rename exe hasil unduh → `<service-id>.exe`, taruh `<service-id>.xml` di sebelahnya, baru jalankan apa pun.
**Fakta berguna (kontrak idempotensi installer):** `<svc>.exe status` atas service **belum terdaftar** → cetak
`NonExistent` + **exit 0** (bukan error) → aman dipakai skrip install untuk cek "sudah terpasang?" tanpa try/catch.
**Runtime:** varian `WinSW.NET461.exe` butuh .NET Framework 4.6.1+; Windows 11 membawa **4.8 inbox** (mesin owner:
4.8.09221 / Release 533509) → jalan. Host tanpa .NET Framework → pakai `WinSW-x64.exe` self-contained (DEPENDENCY-POLICY).
**Sumber:** verifikasi pin WinSW 17 Jul (web sumber primer error 1053 + eksekusi binary nyata di Win 11 owner), ADR-025.

### G-44 — Em-dash di `.ps1` = parse error PowerShell 5.1 (UTF-8-tanpa-BOM dibaca CP1252; U+201D = delimiter string)
**Jebakan (ditemukan 17 Jul saat M5.5 — dan sudah MEMAKAN korban di kode ter-commit):** file `.ps1` yang ditulis
UTF-8 **tanpa BOM** dibaca **PowerShell 5.1** (Windows PowerShell, default Windows 11) sebagai **CP1252**. Em-dash `—`
(U+2014 = byte `E2 80 94`) jadi 3 karakter, yang **terakhirnya `0x94` = U+201D** (right double quotation mark) — dan
**PowerShell MENERIMA U+201D sebagai delimiter string** (terbukti: `$x = ”halo”` dgn U+201D dieksekusi normal).
Akibat: em-dash **di dalam string** menutup string itu lebih awal → **parse error berantai** yang menunjuk baris yang
**sama sekali tak salah** (mis. "missing terminator" di baris 61, padahal biangnya baris 51).
**Korban nyata:** `deploy/backup/windows/register-backup-task.ps1` (ter-commit M5.2 `85be83c`, **lolos tier-review**)
**TIDAK bisa di-parse** PS 5.1 (`[Parser]::ParseFile()` → error baris 53: `-Description "acca — backup snapshot …"`)
→ **backup terjadwal Windows tak akan pernah jalan.** Lolos karena slice ditandai `[LIVE]` belum diverifikasi: reviewer
**membaca** skrip, tak ada yang **mengeksekusi parser** atasnya. Diperbaiki 17 Jul (em-dash → `-`, pure ASCII).
**Aturan:** file `.ps1` WAJIB **pure ASCII**, atau dibuka **UTF-8 BOM** (`EF BB BF`). **Pure ASCII lebih disukai**
(nol ketergantungan encoding). Dokumen/komentar `.md`/`.ts` bebas em-dash — **`.ps1` tidak**. Hati-hati juga smart quote
`“ ”` (PowerShell menerimanya sbg delimiter → sumber bug sekelas).
**Gate:** `test/ps1-encoding.test.ts` — tiap `*.ps1` di repo wajib pure-ASCII/ber-BOM. Sengaja menguji **root cause
(byte)**, bukan gejala (parse): memanggil parser PowerShell butuh Windows → test bakal **skip di Ubuntu** (mesin harian)
= gate bocor persis di tempat kerja paling sering. Cek byte = deterministik, lintas-OS, nol dep. **Negative control
terbukti** (satu em-dash dikembalikan → gate gagal + tunjuk baris tepat).
**Pelajaran proses (lebih penting dari fakta encoding-nya):** artefak yang **tak pernah dieksekusi** di gate mana pun
(`.ps1`, template unit, XML, **dan instruksi README**) = titik buta review. `npm run check` tak menyentuhnya; mata
reviewer tak menjalankan parser. Tiap artefak shippable butuh **minimal satu gate yang mengeksekusi/memvalidasinya**,
walau cuma cek byte.
**Instansi kedua kelas yang sama (17 Jul, sesi yang sama):** README menyuruh `npm install && npm run build` lalu
`acca run claude` — **dua-duanya gagal di Windows**: (a) `&&` **tak ada** di Windows PowerShell 5.1 (bawaan Win 11;
baru di PS 7 — mesin owner: 5.1.26100, `pwsh` tak terpasang); (b) **`acca` tak pernah ada di PATH** — `package.json`
mendeklarasikan `bin.acca`, tapi itu hanya jadi perintah setelah `npm link`/`npm i -g .`, dan README tak pernah
menyuruhnya. **Sudah diketahui sejak 16 Jul** (CONTEXT mencatat "`acca` tak di PATH") tapi tak pernah diperbaiki di
README → menggigit owner dua kali. Diperbaiki 17 Jul + **diverifikasi dengan benar-benar menjalankannya** (`npm link`
→ `acca --version` → `0.1.0` → `acca status` render nyata). **Pelajaran:** instruksi di README = kode yang dieksekusi
manusia; kalau tak pernah dijalankan sekali pun, ia tak lebih dipercaya dari kode tak-ter-test.
**Jebakan sampingan saat verifikasi:** `native.exe | Select-Object -First N` di PowerShell **memutus pipeline lebih
awal → native command dibunuh → exit code 255** walau perintahnya sukses. Jangan simpulkan "exit non-nol = bug" dari
perintah yang di-pipe ke `Select-Object -First`; cek exit code tanpa pipe (`acca status` langsung = exit 0).
**Sumber:** M5.5 17 Jul — parse error nyata di mesin owner + `[Parser]::ParseFile()` atas file ter-commit + verifikasi
byte `E2 80 94` → CP1252 → U+201D.

---

## Deteksi limit vs prosa (I-35/I-36)

### G-45 — Repo ini adalah korpus yang memicu detektornya sendiri; mengerjakan acca DI BAWAH acca = FP berulang

**Insiden live 17 Jul (sesi `z36i`, `acca run claude`): DUA LIMIT_HIT palsu dalam 8 menit**, keduanya siklus penuh
sampai inject. Yang memicu bukan hal eksotis:
1. **Query pencarian agent sendiri** yang memuat frasa kanonik CC mentah — tool call tercetak ke terminal → detector
   membacanya. (Agent me-Read `src/adapters/patterns.ts`, yang doc-comment-nya mengutip pesan asli verbatim untuk
   mendokumentasikan G-15. **Detektor mendeteksi komentar sumbernya sendiri.**)
2. **Teks notifikasi acca SENDIRI** (`notify/notifier.ts` — judul warn memuat frasa kanonik) yang di-paste owner ke
   agent untuk didiagnosis. Loop lengkapnya: limit → notif → user paste → FP.

**Skala terukur: 103 literal yang cocok pola detektor di 20 file** — termasuk **5 file yang `/session-start` WAJIBKAN
dibaca** (`GOTCHAS`/`RESEARCH`/`DECISIONS`/`CONTEXT`/`ISSUES` = 46 literal). **Ritual pembuka proyek ini adalah ranjau
ketika sesinya jalan di bawah acca.** Sesi 17 Jul lolos separuh hanya karena Read-nya ter-truncate — keberuntungan.

**Cara kerja aman (dipakai & terbukti 17 Jul):**
- **Jangan tulis frasa kanonik mentah** — di jawaban, di query pencarian, di dokumen. Rujuk **by-index**
  (`CC_LIMIT_PATTERNS[1]`) atau tulis **regex ter-escape**: prefiks `\b` mematahkan word-boundary → string itu **tak
  cocok dirinya sendiri**. Terverifikasi: menulis pola detektor dalam bentuk ter-escape aman, bentuk mentah tidak.
- **Redaksi pipeline** saat menjalankan test / membaca file yang memuat korpus. Tulis polanya **ter-escape** — bentuk itu
  aman **dan** tetap berfungsi (GNU sed `-E` paham `\b`), jadi contoh ini tak memicu dirinya sendiri:
  ```sh
  npm run test 2>&1 | sed -E 's/(\bhit your ([A-Za-z]+ )?limit\b|\busage limit reached\b|\bindividual \bquota reached\b)/«REDACTED»/gI'
  ```
  **Terbukti**: menangkap byte PTY nyata dari test integration I-31 yang men-spawn banner limit sungguhan lewat PTY.
- **Tahu file mana yang berbahaya untuk sesi mana:** literal di `limit-watcher.ts`/`supervisor.ts` semuanya frasa **agy**
  → aman dibaca dari sesi `tool='claude'` (adapter CC tak pernah menjalankan `AGY_LIMIT_PATTERNS`). Yang berbahaya untuk
  sesi CC hanya file ber-frasa **CC**: `patterns.ts`, `notifier.ts`, fixture `cc-*`, dan test detector.
- **Matikan daemon** sebelum kerja detector: tanpa daemon, deteksi palsu cuma menulis baris DB (inert) — tak ada inject.
  Wrapper TETAP mendeteksi & menulis (ADR-017), yang berhenti hanya actuation-nya. Bersihkan job pending **sebelum**
  daemon dinyalakan lagi (recovery-saat-`start()` akan mem-fire-nya — AC-7 bekerja melawan kita).

**Fix produk = I-35** (korroborasi thd snapshot usage; suppress bila window mengikat <0.85). **Higiene repo = I-36.**
G-45 ini = cara kerja untuk manusia/agent, bukan pengganti keduanya.
**Sumber:** insiden live 17 Jul, sesi `z36i`, events #43/#48 (bukti di ISSUES I-35).

### G-46 — Membangun gate I-36 (fix mekanis literal kanonik) hampir merusak regex produksi DUA cara berbeda
**Jebakan (a) — JS `'\b'` = backspace U+0008, BUKAN dua karakter `\`+`b`:** skrip fix pertama menyisip `'\b' + ev`
(string JS) untuk mematahkan word-boundary regex (konvensi ISSUES.md: "prefiks `\b`"). Backspace **JUGA** non-word
char → `\b`-metachar regex masih menemukan boundary di posisinya → fix **no-op SENYAP** (rescan pasca-fix melapor
hit **identik** — nyaris lolos tanpa terdeteksi kalau rescan tak dijalankan segera). **Cara benar:** literal dua
karakter — `'\\b' + ev` (backslash literal + huruf b), diverifikasi via rescan otomatis SETIAP kali skrip fix jalan
(jangan percaya "sudah jalan tanpa galat" — no-op tak melempar galat).
**Jebakan (b) — sisip `\b` ke BARIS DEFINISI regex-nya sendiri = mengubah regex PRODUKSI, bukan cuma dokumentasi:**
`AGY_LIMIT_PATTERNS` array literal (`patterns.ts`) — pattern[0]'s teks sumber `\bindividual \bquota reached` secara
independen memenuhi pattern[1] (`quota\s+(?:reached|...)`, didahului spasi dari "individual " → boundary alami
ADA). Scanner generik yang menyisip `\b` di titik match PERTAMA yang ditemukan akan mengedit BARIS REGEX ITU
SENDIRI (bukan komentar di atasnya) — mengubah semantik pola yang benar-benar dipakai deteksi produksi, bukan
sekadar teks tampilan. **Cara benar:** kenali baris yang MENDEFINISIKAN pattern (bukan mengutipnya) via marker
eksplisit `// gate:allow-canonical-literal` di akhir baris, dan SKIP baris itu di scanner/fixer — jangan andalkan
"kelihatannya cuma teks". Kelas serupa: string literal RUNTIME yang sengaja meniru bahasa kanonik untuk
kejelasan manusia (`notifier.ts` `title: '\bUsage limit reached'` — notifikasi USER-FACING, bukan komentar) —
gate mekanis yang menyisip `\b` ke sana mengubah **teks yang dilihat user**, bukan hygiene repo; butuh marker +
alasan tertulis yang sama, BUKAN otomatis "diperbaiki".
**Jebakan (c) — `matchLimit(line) ?? matchAgyLimit(line)` (satu evidence per baris) melewatkan match KEDUA:**
scan awal hanya mencatat SATU evidence per baris (cc jika ada, else agy) → baris yang memuat KEDUA pola independen
(mis. `DECISIONS.md:850`, satu baris memuat baik "\bhit your session limit" MAUPUN "\bIndividual \bquota reached") →
evidence kedua tak tercatat, residual bertahan pasca "fix". **Cara benar:** cek `matchLimit` DAN `matchAgyLimit`
independen per baris (dua `if`, bukan `??`), lalu — untuk robust penuh — LOOP re-scan per baris sampai bersih
(bukan percaya daftar evidence yang dihitung sekali di awal; kasus RESEARCH.md:120 punya evidence yang sama
muncul **2×** di baris yang sama, lolos dari fix satu-kali-per-evidence).
**Dampak gabungan:** ketiganya membuktikan pola umum — **gate/fixer mekanis untuk "teks yang mirip kode" wajib
di-verifikasi dengan rescan otomatis, tak boleh percaya "skrip jalan tanpa galat" sebagai bukti sukses.** Silent
no-op (a) dan silent-corruption (b) sama-sama TAK melempar exception.
**Cara benar (final, `test/no-canonical-limit-literals.test.ts`):** gate permanen re-derive match dari fungsi
produksi `matchLimit`/`matchAgyLimit` (bukan salinan regex) tiap kali dijalankan — tak ada state "evidence
list" yang bisa basi; marker `gate:allow-canonical-literal` untuk pengecualian struktural (regex definitions +
string user-facing yang sengaja meniru bahasa kanonik).
**Sumber:** membangun gate I-36, 17 Jul.

### G-55 — Callback yang menyala PER BARIS output → enqueue job berulang dalam satu episode (butuh dedup)
**Jebakan:** `onUsageContradiction` (I-35 suppress) menyala **sekali per baris limit** yang di-suppress — bukan sekali
per episode. `classifyLine` yang men-suppress **tidak melatch** (`latched` tetap false, by design: sinyal berikutnya
harus tetap dievaluasi) → baris limit berikutnya lewat lagi → callback nyala lagi. Menambahkan `jobs.enqueue({kind:'verify'})`
polos di callback → **N job verify dalam satu episode** justru pada skenario inti I-35/I-36: prosa **multi-literal** (Read
`patterns.ts`/docs yang dulu punya 61 baris literal → banyak match berturut). Latch men-dedup sisi habis (verify ke-2 dst
`skipped:verify_stale`) tapi FP → N probe redundan + spam log.
**Cara benar:** guard idempoten sebelum enqueue — `jobs.hasPendingKind(sessionId,'verify')` → satu verify per episode
(job pending yang ada sudah mem-probe realita yang sama). **Pelajaran umum (kelas G-54):** sinyal engine yang di-drive
sumber berulang (tick periodik ATAU baris-per-baris) butuh dedup di titik AKSI, bukan hanya di titik deteksi — dan test
wajib memberi **>1 pemicu** (di sini: 2 banner) untuk menyingkapnya. Negative control terbukti (bypass guard → 2 job).
**Sumber:** I-35 residual (job `verify`), sesi 18 Jul.

### G-56 — `git checkout <tracked-file>` untuk membuang edit NC sementara MENGHAPUS SEMUA perubahan uncommitted file itu
**Jebakan:** setelah menjalankan negative-control (edit sementara pada file untuk membuktikan test menangkapnya), kebiasaan
"`git checkout src/x.ts` untuk revert" **membuang seluruh perubahan uncommitted** file itu — bukan hanya baris NC. Bila file
itu memuat kerja sesi yang **belum di-commit** (di sini: `process-wrapper.ts` dengan const + enqueue baru), kerja itu lenyap
senyap; test lain lolos karena diff-nya di file LAIN. Beda dari G-51 (checkout tak revert file **untracked**) — ini kebalikan:
checkout **over-revert** file **tracked** yang punya kerja tak-tersimpan.
**Cara benar:** untuk NC, revert **hanya baris NC** (Edit balik string spesifik, bukan `git checkout`), ATAU commit/stash kerja
dulu sebelum NC. Bila terlanjur: re-apply dari konteks (di sini semua edit masih ada di transcript → di-apply ulang + verifikasi
marker `grep -c` + full check hijau). Verifikasi `git status` + `grep` marker setelah operasi git destruktif apa pun mid-sesi.
**Sumber:** NC dedup I-35, sesi 18 Jul (kerja `process-wrapper.ts` sempat hilang, di-re-apply penuh).

### G-57 — Transisi terminal tanpa guard status + test yang men-SEED status langsung = interaksi lifecycle tak pernah teruji (kelas D-1)
**Jebakan (audit keempat, 18 Jul):** `markExited` menulis `status='EXITED'` **tanpa guard** — beda dari saudara-saudaranya
(`markOrphanExited`/`markResumed`/`markBlocked`/`markRunningAfterInject` yang semua ber-guard). Sendirian ini "cuma"
inkonsistensi; ia jadi **P1 senyap** saat komponen LAIN menambah guard membaca status itu (guard `probe_stale_status`
I-35, 17 Jul): sesi `LIMIT_HIT` yang exit bersih ter-clobber `EXITED` → job probe di-skip → auto-resume mati **tanpa
satu test pun merah** — karena SEMUA test dispatch men-seed status akhir langsung (`createSession({status:'LIMIT_HIT'})`),
tak ada yang mencapai status lewat **urutan transisi nyata** (`markLimitHit → markExited → probe fire`). Dampak ekstra
agy: id resume agy hanya tertangkap di exit bersih (G-36) → jalur exited ADR-019 praktis dead-code, juga tanpa test gagal.
**Cara benar:** (a) setiap fungsi transisi state di repo **wajib guard status eksplisit** (default = preserve, bukan
clobber; kalau clobber memang diinginkan, tulis alasannya); (b) untuk tiap pasangan produsen-transisi × konsumen-guard,
sediakan minimal satu **test komposisi lifecycle** yang men-drive urutan transisi nyata, bukan seed status akhir —
pola: harness `beforeFire` menjalankan `markLimitHit`+`markExited` lalu fire dispatch (lihat
`supervisor-dispatch.test.ts` "D-1 komposisi"). (c) Saat menambah guard baru atas kolom status, audit SEMUA penulis
kolom itu (`grep "SET status"`), jangan hanya jalur yang sedang dipikirkan. **Sumber:** D-1/RD-1 audit keempat
(`docs/audit/AUDIT-2026-07-18-MENYELURUH.md` §2), fix 18 Jul.

---

## Deploy / systemd (M5.4)

### G-47 — `Restart=on-failure` TAK restart pada exit bersih (SIGTERM→exit 0); uji auto-restart WAJIB pakai SIGKILL
**Jebakan:** menguji "daemon auto-restart saat crash" dengan `kill -TERM <pid>` (atau `systemctl --user stop`) **tak
akan** memicu restart di unit `Restart=on-failure`. `daemon.ts` menangani SIGTERM/SIGINT → shutdown graceful →
`process.exit(0)`; dan systemd menganggap **exit 0 + sinyal "bersih"** (SIGTERM, SIGINT, SIGHUP, SIGPIPE) sebagai
terminasi **sukses** → `on-failure` diam. Mudah salah simpul "auto-restart tak jalan".
**Dampak:** verifikasi AC-M5-1 keliru dinyatakan gagal, atau (lebih buruk) `Restart=always` dipilih sbg "perbaikan"
padahal `always` akan me-restart bahkan saat owner sengaja `stop` (melawan kontrol manual).
**Cara benar:** simulasikan **crash** dengan `kill -9 <MainPID>` (SIGKILL) — systemd melihat `Result: signal` (non-clean)
→ `on-failure` fire → restart dalam `RestartSec` (5s). Ambil PID via `systemctl --user show -p MainPID --value
acca-daemon`; verifikasi `NRestarts` naik + PID baru. **Sumber:** M5.4 LIVE 17 Jul (Ubuntu, systemd 255).

### G-48 — `sed` substitusi placeholder juga menggarabl token yang sama di KOMENTAR prosa template
**Jebakan:** `install-linux.sh` mengganti `<NODE>`/`<ENTRYPOINT>` via `sed s|<NODE>|…|g` **global** — bila token
placeholder yang sama muncul di **komentar** template (mis. "placeholder `<NODE>`/`<ENTRYPOINT>` disubstitusi oleh…"),
sed mengubah komentar itu jadi teks garbled (`placeholder /path/node//path/index.js disubstitusi…`). Kosmetik (komentar,
tak mempengaruhi systemd) tapi menyesatkan.
**Dampak:** unit terpasang punya komentar rusak; gate render (`<…>` nol tersisa) tetap **hijau** karena semua tersubstitusi
→ tak ketahuan gate. **Cara benar:** token placeholder `<X>` HANYA di baris nilainya (`ExecStart=`), jangan pernah di
prosa komentar — rujuk deskriptif ("path node + entrypoint di [Service]"). **Sumber:** M5.4 render LIVE 17 Jul.

### G-49 — Task Scheduler `RestartOnFailure` TAK andal me-restart daemon yang di-kill; pakai watchdog repetisi + IgnoreNew
**Jebakan:** menyandarkan auto-restart-on-crash Windows pada Setting `RestartOnFailure` (`<Interval>`/`<Count>`) — analog
naif dari systemd `Restart=on-failure`. **LIVE 18 Jul membuktikan ia TAK jalan:** `taskkill /F` daemon (exit non-zero,
`LastTaskResult=1`, task->`Ready`) -> **nol restart dalam 100s** walau `RestartOnFailure Interval=PT1M Count=3` terpasang.
`RestartOnFailure` di Windows = supervisor proses yang lemah/tak konsisten (khususnya utk run on-demand & aksi
long-running) — sebab NSSM/WinSW ada.
**Dampak:** AC-M5-2 "auto-restart on-crash" GAGAL bila hanya andalkan `RestartOnFailure`; daemon mati diam sampai logon
berikutnya. Lolos review "template terlihat benar" — hanya ketahuan saat DIJALANKAN (kelas I-34).
**Cara benar:** watchdog via **repetisi trigger** — `LogonTrigger` ber-`<Repetition><Interval>PT1M</Interval>
<StopAtDurationEnd>false</StopAtDurationEnd></Repetition>` + `<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>`.
Tiap menit trigger re-fire; daemon hidup -> `IgnoreNew` abaikan (nol double-start), daemon mati -> di-start ulang.
Terverifikasi LIVE: kill -> restart **~61s** (floor Task Scheduler = PT1M, jadi <90s bukan <30s — AC diamandemen).
**Urutan schema:** `<Repetition>` WAJIB **sebelum** `<Enabled>` di dalam trigger, kalau tidak `Register-ScheduledTask`
menolak. **Sumber:** M5.5 LIVE 18 Jul (Win 11, Task Scheduler on-demand + repetition test).

### G-50 — XML comment tak boleh memuat `--`; naive tag-balance lolos, parser sungguhan menolak (task gagal register)
**Jebakan:** komentar `<!-- ... systemd --user ... -->` di template XML. Spec XML melarang `--` di DALAM komentar (selain
penutup `-->`). Gate `xmlTagBalance` buatan-sendiri (cocokkan buka/tutup tag) **lolos** karena komentar di-strip dulu ->
false-confidence "well-formed". Tapi `System.Xml`/`Register-ScheduledTask` (parser sungguhan) **menolak** -> task gagal
register. Ketahuan **hanya saat menjalankan parser di mesin Windows**, bukan dari gate lintas-OS.
**Dampak:** artefak lolos gate CI tapi gagal di titik pakai (I-34 persis: "membaca != menjalankan"). **Cara benar:**
(a) hindari `--` di komentar XML (mis. "systemd user-scope", bukan "systemd --user"); (b) gate diperkuat: cek `--` di
dalam tiap `<!-- -->` (pure-string, lintas-OS) — kini di `test/task-scheduler-xml.test.ts`. **Sumber:** M5.5 18 Jul.

### G-51 — `git checkout -- <file>` TAK bisa mengembalikan file baru/untracked (negative-control revert gagal senyap)
**Jebakan:** saat menjalankan negative-control gate pada artefak **baru** (belum di-commit), pola `sed -i <break> ->
run gate -> git checkout -- <file>` **gagal me-revert**: `git checkout` cuma tahu file ter-track -> `pathspec did not
match` -> break menumpuk, file rusak, bisa lolos tak-ketahuan bila tak dicek pasca-loop.
**Cara benar:** untuk revert file untracked, simpan **salinan backup** dulu (`cp f f.bak` -> break -> run -> `mv f.bak f`),
atau tulis-ulang isi benar setelahnya. **Sumber:** M5.5 negative-control 18 Jul.

### G-52 — `<Hidden>true>` Task Scheduler TAK cegah jendela konsol; node @logon dapat PseudoConsoleWindow terlihat -> pakai conhost headless
**Jebakan:** mengira `<Settings><Hidden>true</Hidden></Settings>` = run-hidden nol-jendela. **SALAH:** `Hidden` cuma
menyembunyikan **task** dari daftar default UI Task Scheduler — **bukan** jendela proses aksinya. **LIVE 18 Jul (logon
nyata, dikonfirmasi mata owner + detektor `EnumWindows`):** Task Scheduler @logon menjalankan `node.exe` langsung → node
dapat **`PseudoConsoleWindow` TERLIHAT** (ConPTY) di desktop, walau `Hidden=true`. Detektor `MainWindowHandle` naif LOLOS
(0) — jendela dimiliki ConPTY, bukan MainWindow node; deteksi benar = `EnumWindows` + class `PseudoConsoleWindow`/
`ConsoleWindowClass` + `GetWindowThreadProcessId` cocok pohon-proses daemon.
**Dampak:** AC-M5-2 "nol jendela konsol" gagal; jendela bisa ditutup owner tak sengaja → daemon mati.
**Cara benar:** jalankan node via **`conhost.exe --headless`** (bukan `node` langsung) — Action `Command=conhost.exe`,
`Arguments=--headless "<node>" "<entry>" daemon`. conhost headless = ConPTY tanpa jendela; ia tetap jadi **INDUK** node
selama daemon hidup → task instance "running" → **`IgnoreNew` (watchdog anti-double-start) tetap sah** + kill node → conhost
exit → repetisi restart. **Terverifikasi LIVE:** parent=conhost, `EnumWindows`→NONE, restart ~65s. **Reproduksi murah:**
`Start-ScheduledTask` on-demand **mereproduksi** jendela logon (bukan cuma trigger logon) → iterasi fix tanpa logout/login
berulang. **Alternatif ditolak:** VBScript+`wscript.exe` (GUI-subsystem, proven no-flash) — **VBScript deprecated** Win11 FoD;
conhost native + tak-deprecated dipilih. **Revisit bila** `--headless` hilang/berubah di Windows mendatang. **Sumber:** M5.5 LIVE 18 Jul.

## CLI dispatch / commander (M-web, banner ADR-027)

### G-58 — `program.action()` di root commander mematahkan `acca help` & subcommand ("too many arguments")
**Konteks:** slice banner ADR-027 memasang `program.action(() => splash+help)` di root utk mencetak splash saat
`acca` dijalankan tanpa argumen. **Jebakan:** dengan action terpasang di root + program tak mendeklarasikan argumen,
commander memperlakukan `acca help` (dan subcommand lain di sebagian jalur) sbg **argumen posisional BERLEBIH** ke root →
`error: too many arguments. Expected 0 arguments but got 1`. Bug lolos build+lint+test lama (tak ada test yang mem-parse
`help`) — tertangkap **owner saat pakai manual**. **Fix:** tangani kasus bare-`acca` (splash+`outputHelp()`) **SEBELUM**
`parse`, dengan cek `process.argv.slice(2).length === 0`, BUKAN via root-action. argv non-kosong diteruskan apa adanya ke
commander. **Guard regresi:** `buildProgram()` diekstrak ke `src/cli/program.ts` (bebas side-effect) + `test/cli-dispatch.test.ts`
pakai `exitOverride()` → assert `acca help`/`--help` menghasilkan kode help **bukan** `commander.excessArguments`, `--version`→
`commander.version`, unknown→`commander.unknownCommand`, semua subcommand terdaftar (`__hook` = nama internal tersembunyi I-23).
**Pelajaran:** entrypoint CLI = permukaan yang jarang ter-cover unit-test (side-effect + `process.exit`) → ekstrak konfigurasi
ke fungsi pure + uji jalur bawaan commander dgn `exitOverride`.

## Packaging / instalasi lintas-mesin (npm)

### G-59 — `npm install -g git+https://…` TAK ANDAL untuk paket dgn skrip `prepare` (`tsc: not found`)
**Konteks:** owner minta cara instal `acca` lintas-mesin tanpa `git clone` manual — kandidat jelas = shortcut
npm standar `npm install -g git+https://github.com/…/repo.git` (npm men-clone lalu, per dokumentasi resmi,
menjalankan `devDependencies`+`prepare` sebelum pack/install). **Jebakan:** diuji langsung 2× (isolated prefix,
`--prefix`) — **gagal konsisten** `sh: tsc: not found` walau (a) `package.json` sudah punya script
`"prepare": "npm run build"`, (b) `typescript` sudah dipindah dari `devDependencies` ke `dependencies` (yang
seharusnya SELALU terpasang apa pun jalur reify). Debug log (`npm error`/`~/.npm/_logs`) menunjukkan **`prepare`
dijalankan DUA KALI** oleh npm 11.14.1 untuk kombinasi git-dependency + install global: sekali oleh persiapan
git internal pacote (di situ deps lengkap, ini yang BERHASIL bila diuji manual via `git clone`+`npm install`
biasa — direproduksi sukses di `/tmp` terpisah), sekali lagi oleh **`arborist/rebuild.js`** saat menempatkan
paket final ke prefix target (`build:run:prepare:<tmp-git-clone-dir>`) — invokasi kedua ini `cwd`-nya balik ke
direktori clone temp **tanpa `node_modules/.bin` terisi** (baik `dependencies` maupun `devDependencies`), jadi
`tsc` tak ditemukan sama sekali. Ini murni bug/keterbatasan **npm sendiri** (bukan salah `package.json`) —
reproduksi bersih di dua percobaan berturut, dgn dan tanpa `typescript` di `dependencies`.
**Fix (bukan workaround — metode resmi):** JANGAN pakai shortcut `git+https://`. Pakai `git clone` manual +
`npm install` biasa di direktori proyek sendiri — jalur ini **selalu** memasang `dependencies` **dan**
`devDependencies` dgn urutan benar (raw top-level install, bukan git-dependency-untuk-paket-lain), lalu skrip
`prepare` (`npm run build`) jalan sekali dan sukses. **Teruji end-to-end** 2× dari clone segar `/tmp` (`tsc: OK`,
`dist/cli/index.js --version` jalan). Skrip `prepare` (ditambah utk kasus ini) tetap bernilai independen dari bug
di atas: `npm install` polos pasca-`git clone` kini auto-build `dist/` tanpa langkah `npm run build` terpisah.
**Pelajaran:** jangan percaya janji dokumentasi npm ("prepare + full deps utk git dependency") tanpa uji langsung
end-to-end dgn command PERSIS yang akan dipakai user (`-g`, `--prefix` terisolasi) — perilaku bisa beda dari
`npm install` biasa di direktori sendiri, dan devDependencies-availability bukan penjelasan lengkap (dependencies
biasa pun kena). **Sumber:** sesi 19 Jul, permintaan packaging lintas-mesin owner.

## Backup / Notifier (I-32 / I-8)

### G-53 — SQLite online backup API (`db.backup()`): koneksi sumber WAJIB tetap terbuka saat transfer + dir tujuan harus ada; race korupsi lama tak bisa jadi negative-control deterministik
**Konteks (I-32):** upgrade `backupDatabase` dari `wal_checkpoint(TRUNCATE)`+`copyFileSync` (rawan salinan half-written
saat daemon menulis konkuren) ke online backup API async `db.backup(dest)` (page-by-page, concurrency-safe).
**Jebakan mekanis better-sqlite3 12.x:** (a) `db.backup()` membaca dari **koneksi sumber yang harus TETAP TERBUKA** selama
`await`-nya berjalan — "optimasi" menutup sumber lebih awal mematahkan backup. Tutup sumber di `finally` **setelah** await
resolve. (b) `db.backup()` **melempar `TypeError`** bila direktori tujuan belum ada (`fsAccess(dirname)` gagal) → `mkdirSync`
target **sebelum** memanggil. (c) API-nya `async` → mengubah `backupDatabase` jadi Promise; caller ikut (`scripts/backup.js`
top-level await ESM; test `await expect(...).rejects.toThrow`).
**Jebakan verifikasi (jujur):** kegagalan yang di-fix (korupsi copy-vs-checkpoint) = **race nondeterministik** → **tak bisa
dibikin negative-control keras**. Uji empiris: dgn writer WAL idle, pendekatan LAMA pun menangkap semua baris (checkpoint
sempat flush; `log:0`). Jadi test concurrency (T5) = **scenario/kapabilitas** (bukti path baru jalan dgn koneksi WAL kedua
aktif + integrity ok), **bukan** bukti path lama gagal. Jangan klaim "negative-control terbukti" untuk fix race semacam ini.
**Sumber:** I-32, sesi 18 Jul.

### G-54 — Engine notifikasi STATELESS lolos unit-test (dipanggil 1×) tapi caller PERIODIK menyingkap spam (fire tiap tick)
**Jebakan:** `proximityNotifications` (pure, stateless) lolos semua unit-test karena tiap test memanggilnya **sekali**. Tapi
`usage-monitor` memanggilnya **tiap tick (~2 mnt)** selama sesi RUNNING → selama `usedFraction` bertahan di atas ambang,
notifikasi **identik ter-deliver tiap tick** (sesi 1 jam di 95% → ~30 notif). Test per-panggilan **tak pernah** melihat ini —
perilaku muncul hanya dari **wiring periodik**. **Fix:** gate STATEFUL `createProximityGate` (rising-edge dedup, state per
`(tool, kind)`): notif hanya saat window **BARU** melewati ambang; turun di bawah / reset / exhausted → clear key → crossing
berikutnya re-notify. Satu gate hidup lintas-tick di monitor. Clear di-scope **per-tool** (snapshot per-tool; jangan wipe
state tool lain). **Pelajaran umum:** engine murni yang di-drive loop periodik butuh test **multi-tick** — "pure + lolos
per-call" tak menjamin perilaku waktu-nyata. Negative control terbukti (bypass gate → deliver 3× di test multi-tick).
**Sumber:** I-8 wiring, sesi 18 Jul.

---

## Change Log

| Tanggal | Perubahan |
|---|---|
| 2026-07-18 (audit keempat, D-1/RD-1) | **G-57** baru (transisi terminal tanpa guard status [`markExited` clobber] + test yang men-seed status langsung = interaksi lifecycle tak teruji → D-1 P1 senyap: sesi LIMIT_HIT exit-bersih kehilangan auto-resume saat guard I-35 hadir, jalur agy-exited ADR-019 dead-code tanpa test merah. Aturan: transisi state wajib guard eksplisit [default preserve] + test komposisi lifecycle utk tiap pasangan transisi×guard + audit semua penulis kolom saat menambah guard). Dari audit keempat + fix RD-1 Opsi A (18 Jul). |
| 2026-07-18 (I-35, job `verify`) | **G-55** baru (callback `onUsageContradiction` menyala PER BARIS output → enqueue `verify` polos = N job/episode pada prosa multi-literal [skenario inti I-35/I-36]; fix = guard `hasPendingKind` idempoten, satu verify/episode; test wajib >1 pemicu; kelas G-54 = dedup di titik AKSI bukan deteksi). **G-56** baru (`git checkout <tracked-file>` untuk buang edit NC sementara MENGHAPUS semua perubahan uncommitted file itu — bukan cuma baris NC; beda G-51 [untracked tak ter-revert] = ini over-revert tracked; fix = Edit-balik baris NC saja / stash dulu; verifikasi `git status`+`grep` marker pasca-git destruktif). Dari penutupan residual I-35 (probe verifikasi eksplisit), 18 Jul. |
| 2026-07-18 (backlog, I-32/I-8) | **G-53** baru (SQLite online backup API `db.backup()`: koneksi sumber wajib tetap terbuka saat transfer, dir tujuan harus ada [else TypeError], API async → caller ikut; race korupsi copy-vs-checkpoint yang di-fix = nondeterministik → test concurrency = scenario/kapabilitas, BUKAN negative-control keras — jangan overclaim). **G-54** baru (engine notifikasi stateless `proximityNotifications` lolos unit-test [dipanggil 1×] tapi caller periodik usage-monitor menyingkap spam [fire tiap ~2mnt di atas ambang]; fix = gate stateful rising-edge `createProximityGate`, clear per-tool; pelajaran: engine yang di-drive loop periodik butuh test multi-tick). Dari backlog I-32 + wiring I-8 (18 Jul). |
| 2026-07-18 (M5.5 LIVE, no-flash) | **G-52** baru (`<Hidden>true>` Task Scheduler cuma sembunyikan task dari UI, BUKAN jendela proses; LIVE @logon nyata: `node` langsung dapat `PseudoConsoleWindow` TERLIHAT walau Hidden=true [mata owner + `EnumWindows`; `MainWindowHandle` naif lolos-palsu]. Fix: `conhost.exe --headless "<node>" "<entry>" daemon` → nol jendela + conhost=induk → IgnoreNew tetap sah + restart ~65s; `Start-ScheduledTask` on-demand mereproduksi jendela → iterasi murah tanpa logout berulang. VBScript+wscript ditolak [deprecated]). Dari M5.5 LIVE 18 Jul (logon nyata). |
| 2026-07-18 (M5.5 LIVE, Task Scheduler) | **G-49** baru (`RestartOnFailure` Task Scheduler TAK andal me-restart daemon di-kill — LIVE: `taskkill /F` → nol restart 100s walau `Interval=PT1M Count=3`; pakai **watchdog repetisi** `LogonTrigger`+`Repetition PT1M`+`IgnoreNew` → restart ~61s; `<Repetition>` WAJIB sebelum `<Enabled>`). **G-50** baru (XML comment tak boleh muat `--`; naive tag-balance lolos, `System.Xml`/`Register-ScheduledTask` menolak → task gagal register; gate diperkuat cek `--`-in-comment; ketahuan hanya saat jalankan parser sungguhan = I-34). **G-51** baru (`git checkout -- <file>` tak bisa revert file untracked → negative-control break menumpuk; pakai backup `.bak` atau tulis-ulang). Dari M5.5 LIVE 18 Jul (Win 11). |
| 2026-07-17 (M5.4 LIVE, systemd) | **G-47** baru (`Restart=on-failure` TAK restart pada exit bersih SIGTERM→exit 0; systemd anggap SIGTERM/SIGINT/SIGHUP/SIGPIPE + exit0 = sukses → uji auto-restart WAJIB SIGKILL, verifikasi `NRestarts`+PID baru; `Restart=always` bukan "fix" — melawan stop manual). **G-48** baru (`sed s\|<NODE>\|…\|g` global juga menggarabl token placeholder yang muncul di komentar prosa template → token `<X>` hanya di baris nilai, jangan di komentar; gate render tetap hijau krn tersubstitusi → tak ketahuan). Dari M5.4 LIVE 17 Jul (Ubuntu, systemd 255). |
| 2026-07-17 (I-35, insiden FP live) | **G-45** baru (repo ini = korpus yang memicu detektornya sendiri; **3 LIMIT_HIT palsu dalam satu sesi**, nol dari CC yang benar-benar limit: [1] agent me-Read `patterns.ts` yang doc-comment-nya mengutip pesan asli verbatim → **detektor mendeteksi komentar sumbernya sendiri**; [2] **teks notifikasi acca sendiri** yang di-paste owner untuk didiagnosis; [3] **perintah `sed` redaksi yang ditulis pakai literal MENTAH** — perkakas pembersihnya sendiri jadi peluru. Skala: **103 literal di 20 file**, 46 di antaranya di 5 file yang `/session-start` WAJIBKAN dibaca → **ritual pembuka proyek ini ranjau di bawah acca**. Cara kerja aman: bentuk regex **ter-escape** [prefiks `\b` mematahkan word-boundary → tak cocok dirinya sendiri, terverifikasi] · redaksi pipeline [terbukti menangkap byte PTY nyata test I-31] · peta file berbahaya per-tool [literal agy aman utk sesi CC] · matikan daemon dulu [wrapper tetap menulis, yang berhenti actuation-nya]. Fix produk = **I-35**, higiene repo = **I-36**). Dari insiden live sesi `z36i` 17 Jul. |
| 2026-07-17 (M5.5, gate encoding) | **G-44** baru (em-dash di `.ps1` UTF-8-tanpa-BOM → PS 5.1 baca CP1252 → U+201D yang **diterima PowerShell sbg delimiter string** → string tertutup lebih awal → parse error berantai menunjuk baris salah. **Korban nyata: `register-backup-task.ps1` ter-commit M5.2 `85be83c` TIDAK parse** → backup terjadwal Win tak pernah jalan; lolos karena `[LIVE]` belum diverifikasi = reviewer baca tapi tak eksekusi parser. Fix: pure ASCII + gate `test/ps1-encoding.test.ts` cek byte [lintas-OS, bukan parse yg skip di Ubuntu], negative-control terbukti. **Pelajaran proses:** artefak tak-pernah-dieksekusi = titik buta review; tiap artefak shippable butuh >=1 gate yang memvalidasinya). Dari slice M5.5. |
| 2026-07-17 (pin WinSW, ADR-025) | **G-43** baru (`sc.exe` **tak bisa host node** — `sc create` sukses tapi service tak start, error 1053 [SCM wajib `SERVICE_RUNNING`]; "registrasi sukses ≠ service jalan" → klausa fallback `sc.exe` ADR-021 VOID, wrapper wajib. + WinSW v2: exe **wajib senama** config-nya, dan config dimuat **sebelum** parse perintah → salah nama = FATAL menyesatkan yang terbaca seperti binary rusak. + `status` service tak-terdaftar = `NonExistent` exit 0 = kontrak idempotensi installer. + NET461 butuh .NET FW 4.6.1; Win 11 bawa 4.8 inbox — terverifikasi jalan). Dari verifikasi pin WinSW (web + eksekusi binary nyata di Win 11 owner). |
| 2026-07-17 (spec M5, verifikasi web) | **G-41** baru (DACL named pipe Windows Node = terbuka by design [Everybody+Anonymous read], Node tak punya API set-DACL — issues #47086/#30823/#17743; kandidat "cek PID client" gugur = spoofable, Project Zero/CVE-2018-0749; → ADR-023 terima residual R-5 + hardening lapisan-app, native addon ditolak). Mengoreksi klaim keamanan ADR-015. Dari verifikasi web sumber primer saat spec M5 (I-26).
| 2026-07-17 (sesi otonom, M5.3) | **G-42** baru (`acca status` CLI baca DB langsung `openDb()`, BUKAN lewat IPC; handler IPC `status` = jalur terpisah nol konsumen produksi → data-minimize `toSessionStatusView` T-L1 nol breakage; jangan asumsikan mengubah satu = mengubah lain). Dari slice M5.3 T-L1.

| Tanggal | Perubahan |
|---|---|
| 2026-07-16 (I-15 live-verify token, agy 1.1.3 + CC 2.1.211) | **G-40** baru (token inject-continue: kata "continue" telanjang TAK me-resume agy — ditafsir pesan NL baru "no context"/"more of same"; agy tak punya primitif resume-turn utk satu kata; instruksi eksplisit "lanjutkan pekerjaan yang terhenti" resume agy DAN CC di limit ASLI → ADR-020 ganti token; mekanisme inject `injected:true` benar; harness proxy butuh readiness-gate berbasis output bukan `isIdle()` default-true saat boot). **G-33 `esc to cancel` + G-36 resume-cmd `agy --conversation=` re-confirmed holds @agy 1.1.3.** Dari I-15 live-verify token 16 Jul (otorisasi user). |
| 2026-07-16 (sesi Windows, I-31) | **G-37 ✅ DITUTUP** (I-31): grace-window OUTPUT-CC di `limit-watcher` (5s pasca-unlatch, audit `limit_suppressed`, tak melatch) → repaint banner limit lama CC tak lagi re-fire LIMIT_HIT palsu; hook `feedSignal` + agy tak disuppress. Clock-wrap penyerta ditutup **I-30** (guard estimator recent-past ≤2h → probe near-now). Dari live-verify I-15 CC 16 Jul. |
| 2026-07-13 (sesi RC, audit ketiga) | **G-39** baru (enqueue continue-job utk sesi hasil-resume kena FK `scheduled_jobs.session_id`; produksi `runSession` createSession dulu → aman, tapi stub test wajib seed baris; kegagalan enqueue JANGAN flip dispatch ke `'retry'` = loop re-spawn → best-effort try/catch). Dari RC-1 (C-1). **16 Jul: guard spawn-loop pelengkap = F-1 (`resumed_from!=null && detected_at==null` → BLOCKED).** |
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
| 2026-07-04 (limit agy asli) | G-16 (`useG1Credits` CLI vs IDE `useAiCredits` + fallthrough credit senyap), G-17 (`remainingFraction` absent = exhausted, jangan crash), G-18 (agy `-p` stdin-EOF + print kosong saat limit + skip-permissions kontraproduktif), G-19 (pesan limit TUI agy ASLI `\bIndividual \bquota reached` + limit≠exit + tak konkuren). Dari eksperimen limit 5-jam agy ASLI (FINDINGS F4-F12). |
| 2026-07-04 (M2-fix) | G-15 (pesan limit CC nyata "hit your **session** limit" → pola kontigu false-negative, diperbaiki `hit your (?:\w+ )?limit`; warning proaktif 90/75 = UI-only, hitung proximity dari usage-probe). Dari limit 5-jam ASLI tertangkap di transcript sesi. |
| 2026-07-04 (M3a) | G-14 (unlink socket unix tanpa syarat sebelum listen = steal socket daemon hidup → dua daemon; fix connect-probe stale-vs-live). Dari tier-review M3a. |
| 2026-07-04 (M2) | G-13 (reset-estimator clock-time next-occurrence tambah `MS_PER_DAY` mentah → meleset ±1j di hari transisi DST; non-blocking, I-4/P3). Dari tier-review M2. |
| 2026-07-03 (sore) | File dibuat. G-1..G-3 (agy: token stale, log login palsu, PTY wajib), G-4..G-5 (CC: dua format reset, field `error` hook), G-6 (CRLF). Dari riset real-CLI + uji sebelumnya. |
| 2026-07-03 (malam) | G-7 (LS quota nil print-mode vs terisi interaktif-PTY tanpa prompt), G-8 (winpty passthrough vs ConPTY node-pty), G-9 (respons GetUserStatus memuat PII). Dari verifikasi terminal ADR-010 item (d). |
| 2026-07-03 (malam, M1) | G-10 (`tsc` tak menyalin migrasi SQL ke `dist/` — perlu `scripts/copy-migrations.js`), G-11 (npm `allow-scripts` memblokir postinstall native default, perlu `npm approve-scripts` + reinstall bersih; node-pty Windows fallback ke `prebuilds/`). Dari implementasi + verifikasi gate M1 foundation. |
| 2026-07-03 (malam, M1 smoke) | G-12 (node-pty Windows tak resolve PATH/PATHEXT — butuh path absolut; resolver `src/shared/which.ts`). Ditemukan saat smoke interaktif `acca run -- claude`. |
