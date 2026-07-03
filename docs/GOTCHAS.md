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

---

## Change Log

| Tanggal | Perubahan |
|---|---|
| 2026-07-03 (sore) | File dibuat. G-1..G-3 (agy: token stale, log login palsu, PTY wajib), G-4..G-5 (CC: dua format reset, field `error` hook), G-6 (CRLF). Dari riset real-CLI + uji sebelumnya. |
| 2026-07-03 (malam) | G-7 (LS quota nil print-mode vs terisi interaktif-PTY tanpa prompt), G-8 (winpty passthrough vs ConPTY node-pty), G-9 (respons GetUserStatus memuat PII). Dari verifikasi terminal ADR-010 item (d). |
