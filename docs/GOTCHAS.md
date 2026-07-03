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

## Change Log

| Tanggal | Perubahan |
|---|---|
| 2026-07-04 (M2) | G-13 (reset-estimator clock-time next-occurrence tambah `MS_PER_DAY` mentah → meleset ±1j di hari transisi DST; non-blocking, I-4/P3). Dari tier-review M2. |
| 2026-07-03 (sore) | File dibuat. G-1..G-3 (agy: token stale, log login palsu, PTY wajib), G-4..G-5 (CC: dua format reset, field `error` hook), G-6 (CRLF). Dari riset real-CLI + uji sebelumnya. |
| 2026-07-03 (malam) | G-7 (LS quota nil print-mode vs terisi interaktif-PTY tanpa prompt), G-8 (winpty passthrough vs ConPTY node-pty), G-9 (respons GetUserStatus memuat PII). Dari verifikasi terminal ADR-010 item (d). |
| 2026-07-03 (malam, M1) | G-10 (`tsc` tak menyalin migrasi SQL ke `dist/` — perlu `scripts/copy-migrations.js`), G-11 (npm `allow-scripts` memblokir postinstall native default, perlu `npm approve-scripts` + reinstall bersih; node-pty Windows fallback ke `prebuilds/`). Dari implementasi + verifikasi gate M1 foundation. |
| 2026-07-03 (malam, M1 smoke) | G-12 (node-pty Windows tak resolve PATH/PATHEXT — butuh path absolut; resolver `src/shared/which.ts`). Ditemukan saat smoke interaktif `acca run -- claude`. |
