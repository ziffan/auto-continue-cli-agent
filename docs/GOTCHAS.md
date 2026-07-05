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

### G-18 — `agy -p` (child_process) MENGGANTUNG bila stdin tak di-EOF; print-mode KOSONG saat limit; skip-permissions kontraproduktif
**Jebakan (a):** `cp.execFile('agy', ['-p', prompt, ...])` tanpa menutup stdin child → agy print-mode **blok baca stdin**
→ timeout (output 0). **(b)** `--dangerously-skip-permissions` di print-mode → agy coba pakai tool (agentic) → lambat/hang.
**(c)** saat kuota habis, `agy -p` = **stdout KOSONG, exit 0** — pesan limit **TIDAK** muncul di print-mode (hanya di rendering TUI interaktif).
**Dampak:** probe/burner agy print-mode hang atau salah-baca "sukses" saat justru limit.
**Cara benar:** `child.stdin.end()` segera setelah spawn; **jangan** skip-permissions (batasi "jawab teks, tanpa tool");
deteksi limit agy **jangan** dari stdout print-mode — pakai rendering TUI (pola `Individual quota reached`, G-19) atau
probe LS (G-17). **Sumber:** FINDINGS F5/F6/F11, 4 Jul.

### G-19 — Pesan limit agy TUI ASLI + agy tetap HIDUP (limit≠exit) + tak boleh sesi konkuren
**Jebakan/Fakta:** pesan limit agy interaktif (kuota 5-jam=0, credit off) =
`⚠ Individual quota reached. Please upgrade your subscription to increase your limits. Resets in <Xm Ys>.` + baris `Error ID: <uuid>`.
Setelah pesan, agy **TETAP HIDUP** di prompt (footer `? for shortcuts` balik) — **limit≠exit** (seperti CC) → jalur
**inject-continue** ADR-014 viable untuk agy. Reset ditampilkan **relatif** ("Resets in 59m14s"), korelasi `resetTime`
absolut LS. **Juga:** agy **tak mendukung sesi print konkuren** (state `~/.gemini`/LS/token di-share → hang) → burner/probe wajib sekuensial.
**Dampak:** fixture detektor agy = pola `Individual quota reached` (bukan tebakan); gating continue agy = alive-path.
**Cara benar:** korpus detektor agy pakai pesan ASLI ini; jangan spawn banyak sesi agy serentak. **Sumber:** FINDINGS F4/F10/F11, 4 Jul (`agy-REAL-limit-message.txt`).

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

### G-13 — `reset-estimator` clock-time "next occurrence" bisa meleset ±1 jam di hari transisi DST
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

---

## Change Log

| Tanggal | Perubahan |
|---|---|
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
