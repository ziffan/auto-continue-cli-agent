# RESEARCH.md — Usage Limit & Resume: Claude Code + Antigravity CLI

> Riset pendukung problem statement & arsitektur. **Diverifikasi 2 Juli 2026** via WebSearch + browsing
> langsung (Chrome, isu GitHub) + **inspeksi binary & storage di mesin Windows ini**.
> **Update 3 Juli 2026** (run terjadwal; Chrome MCP tak tersambung → WebSearch/web_fetch): koreksi §4b
> (/usage agy stale), §5b (CodexBar kini support Antigravity), tambah §2b (kandidat fixture) & §5c
> (claude-auto-retry + tracking auto-continue native).
> **Update 3 Juli 2026 dini hari** (sesi interaktif; Chrome MCP down → web_fetch docs resmi + GitHub):
> re-validasi klaim 2–3 Jul — **semua lolos** (#1178 closed/PR #1341, #46 open, #13354 open, skema
> statusLine, pola claude-auto-retry). Temuan baru material: **§2c hook `StopFailure`** (deteksi limit
> event-driven resmi, v2.1.78+) + nuansa **"limit-hit ≠ proses exit"** untuk sesi interaktif; detail
> probe CodexBar diperkaya (§5b). Fakta usage/limit **cepat basi** — verifikasi ulang via sumber primer
> sebelum keputusan penting.

---

## 1. Claude Code — usage limit

- **Dua limit berlapis:** window **rolling 5-jam** (counter mulai dari prompt pertama, bukan jam tetap) +
  **cap mingguan** (reset pada waktu tetap per akun, **bukan** selalu Senin).
- **Sumber kebenaran usage:** `/usage` atau `/status` di dalam Claude Code; atau Settings → Usage di claude.ai.
- **Volatilitas:** angka limit sering diubah Anthropic (mis. penggandaan limit 5-jam Mei 2026, kenaikan
  mingguan sementara). Jangan hardcode angka; baca live.

**Implikasi desain:** app harus memperlakukan angka limit sebagai data eksternal yang berubah, dan
tidak mengandalkan konstanta.

## 2. Claude Code — sinyal usage/rate-limit (monitor & deteksi)

**⚠️ Update penting (verifikasi via GitHub, 2 Jul 2026 — mengoreksi asumsi awal):**
Data usage/rate-limit **SUDAH diekspos ke statusLine JSON** sejak Claude Code **v2.1.80**
(isu #18121 *fixed*; #27915 & #33820 ditutup sebagai duplikat). Jadi asumsi lama "belum terekspos ke hook"
**tidak lagi berlaku** — kita **punya jalur resmi** untuk memonitor usage.

Tiga sumber usage untuk Claude Code, dari paling resmi:

1. **statusLine JSON (resmi, sejak v2.1.80).** **Skema persis terkonfirmasi** dari docs resmi
   (code.claude.com/docs/en/statusline) + versi terpasang di mesin ini = **Claude Code 2.1.199**:

   ```json
   "rate_limits": {
     "five_hour": { "used_percentage": 42, "resets_at": 1738425600 },
     "seven_day": { "used_percentage": 67, "resets_at": 1738857600 }
   }
   ```

   - `rate_limits.five_hour.used_percentage` / `.seven_day.used_percentage` → 0–100
     (**bisa pecahan** — contoh di docs: `23.5`; jangan parse sebagai integer).
   - `rate_limits.five_hour.resets_at` / `.seven_day.resets_at` → **Unix epoch seconds** (bukan ISO string).
   - Penamaan `five_hour`/`seven_day` **sama** dengan endpoint OAuth usage → konsisten.
   - **Caveat penting:** `rate_limits` hanya muncul untuk **subscriber Claude.ai (Pro/Max)** dan
     **setelah API response pertama** di sesi itu; tiap window bisa absen independen
     (`jq -r '.rate_limits.five_hour.used_percentage // empty'`). → tak berguna sebelum sesi memanggil API,
     dan tak bisa untuk sesi yang sudah mati (perkuat pemisahan ADR-001).
   - Field terkait lain: `exceeds_200k_tokens` (konteks, bukan rate limit).
2. **Endpoint OAuth usage (tak terdokumentasi, community-discovered #13585):**
   `GET https://api.anthropic.com/api/oauth/usage`. Butuh OAuth token dari kredензial mesin → **sensitif &
   tak terdokumentasi**; pakai dengan hati-hati, bisa berubah tanpa notice. Bagus untuk **monitor daemon
   standalone** yang tidak berada di dalam sesi. **✅ VERIFIKASI LIVE (3 Jul 2026, akun Pro, mesin ini —
   TODO #4 ditutup):** `GET` dengan header `Authorization: Bearer <accessToken>` (dibaca dari
   `~/.claude/.credentials.json` → `claudeAiOauth.accessToken`) + `anthropic-beta: oauth-2025-04-20`
   → **200 OK**, `content-type: application/json`. **Skema NYATA lebih kaya dari asumsi lama** (dan **beda
   dari statusLine**):
   ```jsonc
   {
     "five_hour":  { "utilization": 52.0, "resets_at": "2026-07-03T14:19:59.58+00:00",
                     "limit_dollars": null, "used_dollars": null, "remaining_dollars": null },
     "seven_day":  { "utilization": 55.0, "resets_at": "2026-07-05T04:59:59.58+00:00", ... },
     "seven_day_opus": null, "seven_day_sonnet": null, "seven_day_cowork": null, /* + bucket per-model null lain */
     "extra_usage": { "is_enabled": false, "monthly_limit": null, ... },
     "limits": [
       { "kind": "session",       "group": "session", "percent": 52, "severity": "normal", "is_active": false, "resets_at": "…", "scope": null },
       { "kind": "weekly_all",    "group": "weekly",  "percent": 55, "severity": "normal", "is_active": false, "resets_at": "…", "scope": null },
       { "kind": "weekly_scoped", "group": "weekly",  "percent": 62, "severity": "normal", "is_active": true,  "resets_at": "…",
         "scope": { "model": { "display_name": "Fable" } } }
     ],
     "spend": { "used": { "amount_minor": 0, "currency": "USD", "exponent": 2 }, "enabled": false, ... }
   }
   ```
   **Koreksi/temuan material vs §2 poin 1 (statusLine):**
   - **`resets_at` = ISO-8601 string dengan offset** (BUKAN Unix epoch seperti statusLine). Adapter harus
     parse dua format berbeda per-sumber.
   - **`utilization` = pecahan** (52.0), 0–100 (konsisten dgn statusLine `used_percentage`).
   - **Array `limits[]`** = sinyal jauh lebih kaya: `kind` (`session|weekly_all|weekly_scoped`), **`severity`**
     (`normal|…` — kandidat sinyal proximity/proaktif US-13), **`is_active`** (window mana yang sedang mengikat),
     dan **`scope.model`** (cap **per-model** mingguan — mis. Fable 62%). Tak ada di statusLine.
   - `spend.used.amount_minor` = **integer minor-unit** (uang **bukan float** — sejalan ADR-004).
   - **Implikasi ADR-001:** jalur **monitor daemon-standalone TERBUKTI** (tak perlu sesi hidup) & memberi
     sinyal lebih kaya dari statusLine → kandidat sumber utama Usage Probe CC. Caveat: undocumented, bisa berubah
     → guard + fallback ke statusLine. `amount_minor`/currency siap dipakai bila kelak tampilkan spend.
3. **API response headers (429 saat benar-benar kena limit):** `error.type = "rate_limit_error"` +
   `retry-after` (detik); header `anthropic-ratelimit-unified-status`, `-reset`, `-*-remaining`,
   `-unified-representative-claim` (window otoritatif). Ini muncul di titik limit tercapai.

Tooling komunitas sebagai referensi implementasi: `nsanden/claude-rate-monitor`, modul `claude_usage`
di Starship, dan berbagai limit-tracker.

**Implikasi desain (revisi):**
- **Monitor usage** (bagian "monitor" produk) → pakai **statusLine JSON** (di dalam sesi) atau
  **endpoint OAuth usage** (untuk daemon standalone). Tidak perlu scraping/hack.
- **Deteksi LIMIT_HIT Claude Code** *(revisi 3 Jul dini hari — lihat §2c)*, urutan prioritas:
  1. **Hook `StopFailure`** matcher `rate_limit` (resmi, event-driven, deterministik — §2c);
  2. **Pola output PTY** (korpus §2b) — fallback bila hook tak terpasang;
  3. **Exit code non-nol** — hanya bermakna untuk print-mode (`-p`) / abnormal exit; **tidak ada
     exit code khusus rate-limit** (usulan exit 75 + `--wait-on-limit` di #36320 ditutup duplikat).
- **Wrapper PTY tetap wajib**, tapi perannya kini: pegang lifecycle proses (deteksi sesi yang mati
  karena sebab apa pun), kanal fallback output-scraping, dan kanal inject "continue" ke sesi hidup
  (§2c) — bukan lagi satu-satunya jalur deteksi limit.
- **"Deteksi limit" ≠ "deteksi sesi mati"** — limit-hit di sesi interaktif TIDAK men-exit proses
  (§2c); dua sinyal ini harus dimodelkan terpisah di Detector.

## 2b. Kandidat fixture pesan limit Claude Code *(dari komunitas, 3 Jul 2026 — BELUM dikonfirmasi lokal)*

Pola real-world yang dideteksi `claude-auto-retry` (README-nya, MIT — dipakai produksi oleh usernya)
+ isu GitHub (#9236, #5977, #35744):

| Pola | Contoh |
|---|---|
| N-hour limit reached | `5-hour limit reached - resets 3pm (UTC)` |
| Usage limit | `Claude usage limit reached. Resets at 2pm` / `Claude usage limit reached. Your limit will reset at 3pm (America/New_York)` |
| Out of extra usage | `You're out of extra usage · resets 3pm` |
| Try again | `Please try again in 5 hours` |
| Hit your limit | `You've hit your limit · resets 3pm (Europe/Dublin)` |
| Rate limit | `Rate limit hit. Resets at 4pm` |
| **Session limit (NYATA)** | `You've hit your session limit · resets 7:30am (Asia/Jakarta)` |

**✅ TERKONFIRMASI LOKAL (4 Jul 2026, limit 5-jam ASLI — TODO #2 sebagian tertutup untuk CC).** Saat limit
5-jam benar-benar habis (~07:18–07:20 WIB), transcript sesi (`~/.claude/projects/<enc>/<id>.jsonl`) menyimpan
pesan sebagai **synthetic assistant message** — entri `isApiErrorMessage:true`, `model:"<synthetic>"`,
`stop_reason:"stop_sequence"`, content = teks limit persis. Format nyata: **`You've hit your session limit ·
resets 7:30am (Asia/Jakarta)`**. **Koreksi material vs korpus komunitas:** pesan nyata menyisipkan qualifier
**"session"** (dan kemungkinan "weekly") antara "your" dan "limit" → pola detektor kontigu `hit your limit`
**LOLOS** (false-negative); pola diperbaiki jadi `hit your (?:\w+ )?limit` (GOTCHAS G-15). **`limit ≠ exit`
terverifikasi di limit nyata:** proses interaktif tetap hidup, lanjut sendiri setelah reset 7:30 (validasi
premis auto-continue §2c). **Belum tertangkap:** nilai hook `error:"rate_limit"` (transcript hanya simpan
pesan render, bukan objek API error mentah — butuh hook `StopFailure` terpasang; jalur M3d). **Warning proaktif
90%/75%** yang muncul di terminal = **UI-only, TIDAK di-persist** ke transcript → jangan di-scrape; sinyalnya
sudah tersedia via usage-probe (`used_percentage`/`percent`, parser M3c) → hitung proximity sendiri. Threshold
**90% (5-jam) & 75% (mingguan)** = default Claude Code sendiri, kandidat default US-13 (lihat ISSUES I-8).
Catatan: format tetap bisa berubah antar versi (varian `·` separator, waktu kadang tanpa tz) → tabel ini +
fixture asli = korpus regresi.

**✅ TERKONFIRMASI LOKAL (4 Jul 2026, limit 5-jam Gemini ASLI — TODO #2 varian Antigravity DITUTUP).** Kuota
5-jam agy (pool Gemini) dihabiskan via burn terkontrol (probe LS memantau `remainingFraction`: `0.2565→0.117→
0.0055→[absent]`). Fakta terkunci: **(1) Pesan limit TUI agy ASLI (interaktif, credit off):**
`⚠ Individual quota reached. Please upgrade your subscription to increase your limits. Resets in <Xm Ys>.` +
baris `Error ID: <uuid>` (reset **relatif** di pesan ↔ absolut `resetTime` LS). **(2) `limit ≠ exit` utk agy juga:**
setelah pesan, agy **TETAP HIDUP** di prompt (footer `? for shortcuts` balik) — validasi jalur inject-continue
ADR-014 utk agy. **(3) Sinyal exhaustion LS:** field `remainingFraction` **HILANG/absent** (bukan 0) saat habis
(GOTCHAS G-17). **(4) Limit agy = SOFT bila credit ada:** saat 5-jam=0 dgn `useG1Credits:true`, agy **fallthrough
senyap ke AI Credits** (−44 teramati) tanpa pesan, sesi jalan terus → hard-stop hanya saat credit off (G-16). **(5)
Print-mode `agy -p` saat limit = stdout KOSONG exit 0** (pesan hanya di TUI interaktif — G-18/G-19). Fixture ASLI
→ korpus detektor agy (ganti 4 fixture provisional). **Sumber:** eksperimen 4 Jul; scratchpad `FINDINGS.md` F4-F12.

## 2c. Hook `StopFailure` + perilaku proses saat limit *(temuan baru, 3 Jul 2026 dini hari — docs resmi hooks + CHANGELOG)*

**Hook `StopFailure` (sejak v2.1.78, per CHANGELOG resmi)** — jalur deteksi limit **event-driven resmi**
yang belum tercatat di dokumen ini sebelumnya:

- Fire "when the turn ends due to an API error"; **matcher = tipe error**, nilai persis dari docs:
  `rate_limit`, `overloaded`, `authentication_failed`, `oauth_org_not_allowed`, `billing_error`,
  `invalid_request`, `model_not_found`, `server_error`, `max_output_tokens`, `unknown`.
- Sifat: **side-effect only** (output & exit code hook diabaikan; tanpa decision control) → pas untuk
  menulis marker/event ke supervisor (file marker atau IPC), persis pola `install-hook`-nya
  claude-auto-retry (§5c).
- Matcher `StopFailure` (dan `FileChanged`) pakai exact-match set sempit (huruf/digit/`_`/`|`) —
  `rate_limit|overloaded` valid; koma/hyphen membuatnya dievaluasi sebagai regex.
- Bonus lifecycle untuk supervisor: **`SessionStart`** matcher `startup|resume|clear|compact`
  (konfirmasi RESUMED benar-benar terjadi) dan **`SessionEnd`** matcher
  `clear|resume|logout|prompt_input_exit|bypass_permissions_disabled|other` (sinyal sesi berakhir).
- Konsekuensi: supervisor bisa **menginstal hook ke sesi yang di-supervise** (via `CLAUDE_CONFIG_DIR`
  / settings project) → deteksi `rate_limit` **tanpa scraping**, dengan taxonomy error yang sekaligus
  membedakan **overload sementara (429/5xx/529 — CC punya internal retry sendiri) vs usage limit** —
  dua kasus yang wajib ditangani berbeda (overload = backoff pendek, bukan tunggu window reset).

**✅ Verifikasi empiris (3 Jul 2026, mesin sendiri, Claude Code v2.1.199, Windows — TODO #7 ditutup).**
Hook dipasang via `--settings <file>` (isolasi, tak mengotori config global) memanggil skrip node yang
mencatat stdin. `StopFailure` dipicu deterministik dengan `--model` bogus (error `model_not_found` — biaya ~nol;
`rate_limit` asli belum bisa dipaksa, lihat caveat). Payload stdin **nyata** yang diterima hook `StopFailure`:

```json
{ "session_id": "...", "transcript_path": "...\\<id>.jsonl", "cwd": "...",
  "prompt_id": "fd5eb115-...", "effort": { "level": "high" },
  "hook_event_name": "StopFailure",
  "error": "model_not_found",
  "last_assistant_message": "There's an issue with the selected model (...)." }
```

**Koreksi material vs docs resmi (docs kurang tepat untuk versi ini):**
1. **Field tipe error = `error`, BUKAN `error_type`.** Detector wajib baca `error` (nilai matcher, mis. `rate_limit`).
2. **Bonus field `last_assistant_message`** = teks error user-facing → langsung berguna sebagai fixture/log
   & pembeda tambahan (bukan hanya taxonomy `error`).
3. Ada field `prompt_id` (UUID prompt) + `effort.level` — tak ada `error_type`/subtype.
4. **`StopFailure` fire di print mode** (`-p`) juga, bukan cuma interaktif — memperluas cakupan detektor.

`SessionStart` **terverifikasi**: `source:"startup"` di sesi baru; **`source:"resume"` saat `claude --resume <id>`**
(payload: `session_id, transcript_path, cwd, hook_event_name, source` — tanpa `prompt_id`). Resume jalan
(`pong`, exit 0, `session_id` sama) → konfirmasi jalur RESUMED. Matcher exact-match `a|b|c` bekerja: nilai
`model_not_found` cocok dengan pola gabungan.

**Caveat tersisa:** nilai `error:"rate_limit"` **belum** diobservasi langsung (butuh limit 5-jam asli habis) —
tapi mekanisme + nama field + shape payload sudah terkunci; tinggal konfirmasi nilai string saat limit nyata.
Harness uji tersimpan di scratchpad (`hooktest/`, non-repo).

**Perilaku proses saat usage-limit (nuansa penting yang mengoreksi asumsi implisit dokumen lama):**

| Mode sesi | Saat limit habis | Sinyal deteksi | Cara lanjut |
|---|---|---|---|
| Interaktif (TUI) | **Proses TETAP HIDUP**, idle di prompt dengan pesan limit | Hook `StopFailure` / pola output | Inject "continue" ke **PTY yang kita pegang sendiri** (tak butuh tmux — beda dari claude-auto-retry) setelah reset; verifikasi dulu proses masih hidup & idle |
| Print mode (`-p`) | Proses **exit** non-nol | Exit code + pesan di output | Re-exec / `claude -p --resume <id>` |
| Mati di luar limit (reboot/tutup terminal/crash) | Proses tidak ada | Wrapper lifecycle | `claude --resume <id>` di cwd asli |

Basis: mekanisme inti claude-auto-retry (kirim "continue" ke pane hidup — hanya mungkin karena proses
tak exit saat limit; §5c), premis #13354, dan semantik `StopFailure` ("turn ends", bukan "process exits").
**✅ Diverifikasi untuk Antigravity (4 Jul 2026):** saat quota 5-jam habis (credit off), agy **TETAP HIDUP** di
prompt setelah pesan `Individual quota reached` (limit≠exit, seperti CC) → jalur inject-continue viable (§2b, G-19).
Bila credit ada, agy fallthrough senyap ke credit (tak stop) — G-16.

## 3. Claude Code — resume sesi

- Transcript disimpan JSONL di **`~/.claude/projects/<cwd-encoded>/<session-id>.jsonl`**, di mana
  `<cwd-encoded>` = path working directory dengan karakter non-alfanumerik diganti `-`.
- Tiap baris = satu objek JSON (message / tool use / metadata).
- Resume:
  - `claude -c` / `claude --continue` → sesi terakhir.
  - `claude -r` / `claude --resume` → picker daftar sesi.
  - `claude --resume <session-id>` → sesi spesifik.
- **Scoping penting:** sesi terikat ke direktori tempat ia dibuat — **harus `cd` ke folder itu** sebelum resume.

**Implikasi desain:** supervisor wajib menyimpan `cwd` + `session-id` tiap sesi, dan resume di cwd yang persis.
Encoding `<cwd-encoded>` bisa dipakai untuk memetakan transcript ↔ folder tanpa menebak.

## 4. Antigravity CLI (Google) — usage limit

- **Dual limit:** refresh **5-jam** + **kuota mingguan**; **dua-duanya harus > 0** untuk bisa jalan.
  Kalau kuota mingguan habis di hari-1, menunggu 5-jam tidak menolong — terkunci sampai reset mingguan.
- Kuota **berkorelasi dengan beban kerja per-prompt** (bukan sekadar hitung jumlah prompt) → variabel.
- **AI Credits** (toggle di Settings → Models, sejak ~v1.20.5 pertengahan Maret 2026): opsi sistem berbasis
  kredit untuk overage di atas baseline (Pro/Ultra).
- Banyak laporan komunitas soal lockout multi-hari & kebingungan reset — reliabilitas sinyal reset rendah.

**Implikasi desain:** untuk Antigravity, jangan asumsikan "reset 5-jam = bisa lanjut". Wajib **probe kuota
aktual** sebelum resume, dan sediakan penjadwalan reset mingguan + backoff. Estimasi reset kemungkinan
"perkiraan", bukan pasti.

## 4b. Antigravity CLI (AGY CLI) — resume sesi *(diverifikasi via `agy --help` di mesin, 2 Jul 2026)*

**Terkonfirmasi dari binary terpasang `agy` v1.0.16** (mengoreksi tutorial pihak ketiga):

- **`-c` / `--continue`** — Continue the **most recent** conversation. (Bukan resume-by-id!)
- **`--conversation <ID>`** — Resume a previous conversation **by ID**. **Ini jalur scriptable supervisor**
  (tidak ada short-alias; catatan: tutorial Medium keliru menyebut `-c` sebagai resume-by-id).
- **`/resume`** (alias `/switch`) — slash command interaktif, buka picker (TUI).
- **Auto-Save Resume:** saat CLI ditutup, ia **otomatis mencetak perintah resume persis** →
  sumber `resume_cmd` paling andal (tangkap string dari output saat exit).
- Flag terkait: `-p/--print` (non-interaktif), `-i/--prompt-interactive` (prompt awal lalu lanjut),
  `--project <ID>` (agy punya konsep *project*), `--new-project`.
- **Usage: ada `/usage`** — slash command **interaktif di TUI** (dikonfirmasi user melihatnya di terminal),
  **bukan** subcommand CLI. Subcommand non-interaktif `agy` hanya: `changelog`, `models`, `update`,
  `plugin`, `install`. **Diuji:** `agy --print "/usage"` → **output kosong** (slash command tidak dirender
  di print mode; TUI-only).

**⚠️ Koreksi penting (3 Jul 2026):** `/usage` agy **bukan data live** — nilainya snapshot yang diambil
**saat launch** dan tidak ter-update selama sesi berjalan (terkonfirmasi forum Google AI Dev, 20 Mei 2026:
user kehabisan kuota saat `/usage` masih menunjukkan 100%; angka baru benar setelah `/quit` + relaunch).
Isu `/stats`/usage visibility juga masih dikeluhkan di repo resmi (antigravity-cli#46, open).

**Implikasi desain (revisi 3 Jul 2026):** adapter Antigravity `resumeCmd(id)` → `agy --conversation <id>`
(fallback: tangkap perintah auto-printed saat exit). `probeUsage()` Antigravity — **diputuskan hybrid di
ADR-010 (Accepted 3 Jul malam): #2 LS `GetUserStatus` untuk sesi interaktif hidup + #3 `retrieveUserQuota` untuk
pre-resume** (dasar uji §5b; #2 terbukti end-to-end — quotaInfo non-nil, TODO #5d ditutup). Tiga opsi kandidat aslinya:
1. **Fresh-launch probe:** spawn proses agy baru sesaat sebelum resume, baca snapshot `/usage` saat launch
   (satu-satunya momen snapshot di-refresh), lalu exit. Jangan kirim `/usage` ke sesi yang sudah lama hidup —
   datanya basi.
2. **Probe language-server lokal** (cara CodexBar, §5b): baca `csrf_token` + port dari argumen proses
   language server, `POST /exa.language_server_pb.LanguageServerService/GetUserStatus` →
   `quotaInfo.{remainingFraction,resetTime}` per model. Butuh proses Antigravity/agy hidup; protokol internal.
3. **Endpoint OAuth Google:** `POST https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota`
   dengan kredensial `~/.gemini/oauth_creds.json` (sensitif; undocumented; dipakai CodexBar di produksi).

## 4d. Antigravity/agy — penyimpanan lokal *(diinspeksi di mesin, 2 Jul 2026 — read-only)*

`agy` **berbagi direktori dengan Gemini CLI**: `~/.gemini/` (bukan `~/.agy`; `%LOCALAPPDATA%\agy` hanya berisi binary).

| Path (`~/.gemini/…`) | Isi | Relevansi |
|---|---|---|
| `antigravity/conversations/<UUID>.pb` | Log percakapan **protobuf** (`.pb`) | `<UUID>` = **conversation id** untuk `agy --conversation <id>` |
| `antigravity/context_state/` | State konteks per percakapan | — |
| `antigravity/antigravity_state.pbtxt` | State onboarding + `installation_uuid` (protobuf-text) | **Tidak** ada data usage/quota |
| `oauth_creds.json` | Kredensial OAuth | **SENSITIF — tidak dibaca.** Dibutuhkan bila mau panggil endpoint usage server |
| `google_accounts.json`, `projects.json`, `settings.json`, `state.json` | Akun/proyek/UI state | `state.json` = UI saja, **tak ada usage** |
| `antigravity-backup/` | Cadangan `conversations/` + config | Berguna untuk recovery |

**Temuan kunci:**
1. **Transcript Antigravity = protobuf (`.pb`), bukan JSONL** → parsing untuk deteksi limit **lebih sulit**
   daripada Claude Code (butuh skema protobuf; kemungkinan besar andalkan exit-code/PTY output, bukan parse `.pb`).
2. **Tidak ada cache usage/quota lokal** → usage murni server-side, hanya tampil via `/usage` TUI
   (dan itu pun snapshot saat launch — lihat §4b) atau via language-server/endpoint (§5b).
3. Conversation id mudah dipetakan: nama file `.pb` = id yang dipakai `--conversation`.

**Konteks ekosistem (3 Jul 2026):**
- Ada **repo resmi** `google-antigravity/antigravity-cli` di GitHub (issue tracker aktif; CHANGELOG.md
  di repo hanya stub "1.0.0", tanpa releases) → rilis di-track via `agy update`/`agy changelog`, bukan GitHub.
- **Gemini CLI untuk individu di-EOL 18 Juni 2026** — Google mengarahkan user individual ke Antigravity CLI
  (pengumuman developers.googleblog; diskusi gemini-cli#27274). Binary `gemini` 0.42.0 di mesin ini praktis
  legacy → fokus MVP ke agy makin tervalidasi.

## 4c. Terpasang di mesin ini (snapshot 2 Jul 2026, re-cek 3–4 Jul Windows, **re-cek 11 Jul Ubuntu**)

| Tool | Binary | Versi | Catatan |
|---|---|---|---|
| Claude Code | `~/.local/bin/claude` (Ubuntu) / `…\.local\bin\claude.exe` (Win) | **2.1.207** (11 Jul; sebelumnya 2.1.200/201 Win) | ≥2.1.80 → `rate_limits` ada di statusLine JSON; `api/oauth/usage` 200 OK (§2). 2.1.202–207 nol perubahan spek-kritis (blockquote 11 Jul) |
| Antigravity CLI | `~/.local/bin/agy` (Ubuntu) / `…\agy\bin\agy.exe` (Win) | **1.1.1** (11 Jul; sebelumnya 1.0.16 — naik **minor**) | ≥1.0.4 → `--conversation <id>` resume (tetap). 1.1.0→1.1.1 nol perubahan schema/endpoint; 3 delta perilaku (blockquote 11 Jul) |
| Gemini CLI | `...\npm\gemini.ps1` | 0.42.0 | terpisah; bukan target MVP |
| Node.js | — | **24.14.1** (Ubuntu sesi ini) | tetap 24.x LTS (ADR-003; mesin-lock v24.18.0) |

> **Re-cek versi 11 Jul 2026 (Ubuntu, mesin sesi ini):** CC **2.1.201→2.1.207**, agy **1.0.16→1.1.1** (naik **minor**),
> Node 24.18.0(Win-lock)→**24.14.1** (tetap 24.x). Delta diverifikasi dari CHANGELOG resmi kedua CLI:
> - **CC 2.1.202–2.1.207 = NOL dampak spek-kritis** — StopFailure hook, skema `rate_limits`/statusLine, `api/oauth/usage`,
>   resume (`--resume`/`-c`/`--conversation`), limit≠exit **semua tetap**; **auto-continue native belum ada** →
>   **risiko #4 tetap belum terpicu** (namun demand naik: #13354 41+ upvote + gelombang duplikat baru
>   #35744/#26775/#38263/#36320/#47276 — **pantau tiap sesi**). Bonus positif (bukan spek): **2.1.206 memperbaiki**
>   `claude --resume`/`--continue` tak responsif keyboard saat startup + input terabaikan sebelum `--resume` di Windows
>   → menyehatkan actuation resume-by-id (relevan I-15).
> - **agy 1.0.16→1.1.1 = NOL perubahan schema/endpoint** yang kita andalkan (quota/usage, LS `GetUserStatus`/
>   `RetrieveUserQuotaSummary`, port-discovery, OAuth, `--conversation` **semua tak tersentuh** di changelog) → parser &
>   probe (G-24/G-31/G-23/G-17) tetap valid; fixture detektor `Individual quota reached` (G-19) tak berubah (nol entri
>   quota/limit-message). **TIGA delta PERILAKU (bukan schema) dicatat:** (a) **1.1.1 print-mode** `agy -p` tak lagi baca
>   stdin bila prompt via flag (workaround G-18a tak wajib lagi); (b) **1.1.1 print-mode** server-fail kini **stderr +
>   exit≠0** (bukan "silent empty exit 0" — **G-18c berubah**) — positif, detektor agy tak bergantung print-mode; (c)
>   **1.1.0 jadikan `request-review` mode DEFAULT** (jeda sebelum tulis-file, `f` accept/reject) → **behavioral, relevan
>   ke gating/actuation inject-continue** (state prompt agy beda; bisa di-neutralize `--mode default`) → **G-33** + catatan
>   I-15. **Live re-verify LS schema di 1.1.1 = opportunistik (I-15)**, tak wajib (changelog nol LS-change).
>
> **Re-cek versi 4 Jul 2026:** release CC terbaru = **2.1.201** (delta dari 2.1.200 = **satu baris**: "Sonnet 5
> sessions no longer use the mid-conversation system role for harness reminders" — perubahan harness-prompt Sonnet 5,
> **tak menyentuh** StopFailure/`rate_limits`/`api/oauth/usage`/resume/limit≠exit). **Risiko #4 tetap belum terpicu**
> (nol menyinggung auto-continue/resume-on-limit). Catatan: binary on-disk `claude.exe` masih **2.1.200** (yang
> akan dibungkus supervisor), runtime sesi = 2.1.201. Bonus (validasi desain, bukan spek): changelog **2.1.200**
> penuh fix daemon background-agent yang paralel dengan M3a — *stale `daemon.lock` + PID di-reuse OS* (≈ G-14),
> *orphan cleanup rusak*, *socket auth token stripped saat restart* → upstream mengonfirmasi single-instance +
> stale-socket + orphan-cleanup memang jebakan nyata (tak butuh aksi kita).
> **Re-cek versi 3 Jul 2026 (sore):** CC **2.1.199→2.1.200** (agy tetap 1.0.16). Changelog 2.1.200 belum
> terbit di raw GitHub (patch sangat baru); entri 2.1.199 hanya retry 429 transient (sudah tercatat). **Tak ada
> perubahan spek-kritis:** StopFailure hook, skema `rate_limits`, `api/oauth/usage` (justru **diverifikasi 200 OK
> di 2.1.200 ini**, §2), resume, limit≠exit **tetap**; **auto-continue native belum ada** → risiko #4 belum terpicu.
> **Re-cek versi 3 Jul 2026 (siang)** (dari 2.1.198→**2.1.199** & agy 1.0.15→**1.0.16**, keduanya patch bump):
> changelog kedua-nya diverifikasi **tak mengubah fakta spek-kritis** — StopFailure hook (≥2.1.78),
> skema statusLine `rate_limits` (≥2.1.80), limit≠exit, dan resume (`--resume`/`--conversation`) **tetap**;
> **auto-continue native belum ada** di CC (risiko #4 belum terpicu). Catatan koroboratif (bukan perubahan spek):
> CC 2.1.199 kini **auto-retry 429 transient yang tak terkait usage-limit** → memperkuat taksonomi
> overload-vs-usage-limit (§2c): Detector hanya boleh trigger resume pada usage-limit asli, bukan 429 transient.
> agy 1.0.16 juga menambah client-side retry transient (bukan perubahan `/usage`/quota/resume).

Claude Code resume flags terverifikasi: `-c/--continue` (sesi terakhir di cwd), `-r/--resume [id]`
(picker/by-id), `--session-id <uuid>`, `--fork-session` (resume jadi id baru), `--from-pr`.

## 5. Kesimpulan yang membentuk arsitektur

| Temuan | Konsekuensi arsitektur |
|---|---|
| Usage Claude Code **kini** terekspos (statusLine JSON v2.1.80 + endpoint OAuth usage) | Monitor pakai jalur resmi; wrapper untuk lifecycle proses + fallback + inject |
| **Hook `StopFailure` matcher `rate_limit`** (v2.1.78+, §2c) | Deteksi limit CC primer = hook event (deterministik); scraping §2b = fallback |
| **Limit-hit ≠ proses exit** di sesi interaktif (§2c) | Detector pisahkan sinyal "limit" vs "sesi mati"; lanjut via inject-PTY (hidup) atau resume-by-id (mati) |
| Resume scoped ke cwd | Simpan cwd+session-id; resume di cwd persis; status BLOCKED bila cwd hilang |
| Angka limit volatil, `/usage` = sumber live | Baca usage live; tampilkan "perkiraan" saat sumbernya heuristik |
| Antigravity: mingguan bisa 0 meski 5-jam reset | Probe kuota sebelum resume; jadwal mingguan + backoff |
| Antigravity `/usage` TUI-only + transcript `.pb` protobuf | Probe usage via drive-PTY; deteksi limit andalkan exit-code/PTY output, bukan parse `.pb` |
| Reliabilitas sinyal reset bervariasi | Fallback backoff konservatif; jangan spam-resume |

## 5b. Prior art — CodexBar (`steipete/CodexBar`) *(dikoreksi 3 Jul 2026)*

Referensi terdekat yang perlu diketahui (disarankan user). **CodexBar** = app **menu bar macOS** (Swift)
yang menampilkan usage real-time untuk **56+ provider** AI coding (Claude, Codex, Cursor, Copilot, Gemini,
Grok, dll). Mekanisme baca usage: **endpoint OAuth**, **parsing output CLI via PTY**, inspeksi config lokal
(`~/.claude`, `~/.codex`, `~/.config/codexbar/`), cookie browser, keychain, log JSONL untuk kalkulasi biaya.

**⚠️ Koreksi (3 Jul 2026) — CodexBar KINI mendukung Antigravity.** Isu #1178 **sudah ditutup** (via
PR #1341); klaim sebelumnya di dokumen ini ("masih terbuka, mereka belum tahu caranya") **obsolete**.
Mekanisme mereka terdokumentasi di `docs/antigravity.md` (repo CodexBar) — dua jalur:

1. **Probe language-server lokal** *(detail diverifikasi dari docs/antigravity.md mereka, 3 Jul dini hari)*:
   temukan proses via `ps` — match nama `language_server_macos` + marker Antigravity (`--app_data_dir
   antigravity` atau path mengandung `/antigravity/`); ekstrak flag `--csrf_token` (wajib) +
   `--extension_server_port` (fallback HTTP); enumerasi port listening via `lsof`; **pilih connect-port**
   dengan probe `GetUnleashData` (respons 200 pertama menang); lalu quota fetch
   `https://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/GetUserStatus`
   (header `X-Codeium-Csrf-Token` + `Connect-Protocol-Version: 1`; fallback `GetCommandModelConfigs`;
   HTTPS self-signed → insecure allow; bila HTTPS gagal → retry HTTP di extension_server_port).
   Data: `userStatus.cascadeModelConfigData.clientModelConfigs[].quotaInfo.{remainingFraction, resetTime}`
   per model (Claude / Gemini Pro / Gemini Flash) — `resetTime` ISO-8601, fallback epoch seconds —
   plus `accountEmail`, `planName`.
   **⚠️ Caveat kunci untuk kita:** dokumen CodexBar menarget language server **IDE Antigravity**
   (`Antigravity.app`, macOS). Apakah **`agy` CLI** men-spawn language server serupa (dan bagaimana
   menemukannya di Windows/Linux tanpa `lsof`) — **✅ TERVERIFIKASI di mesin, 3 Jul 2026 (Windows,
   agy v1.0.16):**
   - **YA, `agy` CLI meng-embed language server sendiri saat launch.** Bukti log
     `~/.gemini/antigravity-cli/log/cli-*.log` (`server.go`): *"Language server listening on random port
     at `<P1>` for HTTPS (gRPC)"* + *"…`<P2>` for HTTP"* — **dua port random per launch** (gRPC + HTTP).
     Jadi mekanisme LSP-probe **berlaku lintas OS**, bukan cuma IDE macOS.
   - **Discovery port di Windows** (tanpa `lsof`, dan **port TIDAK ada di argv** proses agy — beda dari
     macOS): `Get-NetTCPConnection -State Listen -OwningProcess <agy-pid>` → dua LocalPort milik agy;
     alternatif parse baris `server.go` di log. **Terbukti bekerja.**
   - **Beda model auth (penting):** `--csrf_token` **tidak** ada di argv agy Windows (asumsi CodexBar
     batal di sini). Auth LS→upstream pakai **OAuth token source** dari `~/.gemini/oauth_creds.json`
     (file **ada**, 1.8 KB). Jalur auth klien-lokal→LS (csrf) **belum terpecahkan** (tak di argv; mungkin
     tak wajib untuk localhost / via handshake) — sisa TODO #5.
   - **✅ Reproduksi fresh-launch (Claude jalankan sendiri, 3 Jul siang):** `agy -p "…" --log-file <path>`
     (PID 19528) → LS **in-process** (`server.go:1322] Starting language server process with pid 19528`;
     `Language server version: 1.0.16`), dua port random (gRPC 55031 / HTTP 55032), **`server.go:2424]
     Auth succeeded`**, output `pong` exit 0 → **login mesin NORMAL**; opsi #2 (LS lokal) **viable saat agy
     login**. Flag berguna: `--log-file <path>` (pin lokasi log utk discovery port/auth bersih),
     `--print-timeout` (default 5m).
   - **⚠️ Nuansa deteksi auth (penting utk Detector):** baris *"error getting token source: You are not
     logged into Antigravity"* **BUKAN** indikator gagal-login — muncul **26×** saat LS boot (race
     cache-refresh, ~12 ms **sebelum** `Auth succeeded`) **bahkan di sesi sehat**. **Sinyal auth andal =
     `server.go … Auth succeeded`** (atau kegagalan persisten tanpa pernah mencapainya), bukan ada/tidaknya
     baris "not logged in".
   - Surface RPC internal terkonfirmasi di log: `fetchAdminControls`, `availableModels`, `userInfo`,
     `ListExperiments`, `load code assist response` — konsisten dgn adanya `GetUserStatus`/quota di LS yang sama.
   - **✅ Probe RPC live `GetUserStatus` (Claude, 3 Jul siang) — MEKANISME TERBUKTI, quota nil di print mode:**
     `POST /exa.language_server_pb.LanguageServerService/GetUserStatus` (header `Content-Type: application/json`
     + `Connect-Protocol-Version: 1`, body `{}`) ke **kedua** port (HTTP polos & HTTPS/gRPC self-signed `-k`)
     → **respons Connect-JSON terstruktur** (bukan 404 → endpoint & routing benar). **Kesimpulan kunci:**
     1. **csrf token TIDAK diperlukan** di localhost — POST tanpa `X-Codeium-Csrf-Token` **diterima** (bukan 401).
        Ini **membatalkan penghalang csrf** yang dikhawatirkan untuk opsi #2 di Windows.
     2. **Tapi di print-mode LS, data quota `nil`:** respons `{"code":"unknown","message":"GetCascadeModelConfigData()
        is nil"}` (HTTP 500). Subtree `cascadeModelConfigData` (tempat `quotaInfo.{remainingFraction,resetTime}`)
        **belum ter-populate** saat LS di-spawn untuk satu panggilan `-p` → **spawn print sesaat TIDAK cukup**
        untuk baca quota via GetUserStatus. (Butuh LS sesi interaktif ter-inisialisasi penuh — ber-PTY.)
     3. Kedua port melayani endpoint Connect sama; HTTPS self-signed (perlu `-k`).
   - **Implikasi desain (refinement pilihan probe):** opsi #2 (LS lokal) **viable tanpa csrf**, TAPI butuh
     **agy interaktif hidup ber-PTY** (bukan print-spawn) agar model-config/quota terisi. Karena supervisor
     memang membungkus agy interaktif via PTY, ia bisa probe **LS milik sesi itu** (temukan port via
     `Get-NetTCPConnection -OwningProcess <pid>`, panggil GetUserStatus — murah, tanpa csrf). Untuk cek quota
     **saat tak ada sesi hidup** (sebelum memutuskan resume), #2 gagal → pakai **opsi #3 `retrieveUserQuota`
     (OAuth langsung)** atau #1 fresh-launch. **Arah desain: hybrid — #2 utk monitor sesi interaktif hidup,
     #3 utk cek pre-resume standalone.**
   - **Implikasi pilihan probe:** opsi #2 (LS lokal) viable di Windows untuk *discovery port*, tapi
     terblokir (a) csrf/local-auth belum jelas + (b) butuh agy login. **Opsi #3 (`retrieveUserQuota`
     langsung dgn `oauth_creds.json`) melewati LS** & pakai kredensial yang sama → kandidat lebih robust
     lintas-OS. Condong ke #3 (atau #1 fresh-launch) di atas #2 untuk lock ADR.
2. **Endpoint OAuth remote:** `POST cloudcode-pa.googleapis.com/v1internal:{loadCodeAssist, onboardUser,
   fetchAvailableModels, retrieveUserQuota}` dengan kredensial OAuth Google milik Antigravity.

Konsekuensi untuk kita: (a) klaim "temuan §4b–4d orisinal" diturunkan — yang tetap khas kita: pemetaan
**CLI** (`agy --conversation`, auto-printed resume cmd, storage `.pb`, /usage stale); (b) kita dapat
**referensi implementasi konkret** untuk `probeUsage()` agy (§4b opsi 2–3); (c) caveat mereka berlaku juga
untuk kita: protokol internal yang bisa berubah, butuh proses hidup untuk jalur lokal, deteksi proses/port
per-OS (`ps`/`lsof` = macOS/Linux; Windows perlu padanan — belum ada referensi).

**Diferensiasi kita (tetap berlaku, direvisi):**

| Aspek | CodexBar | auto-continue-cli-agent (kita) |
|---|---|---|
| Fokus | **Monitor** usage saja (pasif) | Monitor **+ auto-resume** sesi terputus (aktif) |
| Auto-continue | **Tidak ada** | **Fitur inti** |
| Platform | macOS menu bar | **Cross-OS** (Linux daily + Windows weekend), CLI/daemon |
| Cakupan | 56+ provider, luas & dangkal | 2 CLI (Claude Code + Antigravity), dalam |
| Antigravity | Didukung (usage via LSP/OAuth) — macOS | Usage **+ resume by-id + deteksi limit** lintas OS |

## 5c. Prior art — auto-continue Claude Code (kompetitor langsung + risiko native)

**`cheapestinference/claude-auto-retry`** (npm, MIT, ±145 stars, Node ≥18, zero-dep) — tool yang
menyelesaikan sebagian masalah kita **khusus Claude Code**: shell function membungkus `claude` dalam tmux,
monitor `tmux capture-pane` tiap 5 detik, deteksi pesan limit (tabel pola §2b), parse waktu reset
(timezone-aware + DST), tunggu reset + margin 60 detik, lalu `tmux send-keys "continue"`. Support
`--print` mode (buffer + re-exec). Batasan yang mereka akui sendiri: **butuh tmux** (auto-install via
package manager), **tanpa native Windows** (WSL saja), retry message = teks polos ke TUI hidup.

**Detail tambahan (README diverifikasi penuh, 3 Jul dini hari):**
- Mereka juga menyediakan **mode event-driven**: `claude-auto-retry install-hook` memasang hook
  **`StopFailure`** (matcher `overloaded|server_error|rate_limit`) yang menulis marker per-pane —
  scraping dimatikan begitu marker pertama datang. Validasi langsung untuk arah §2c kita.
- **Jalur overload terpisah** dari usage-limit: deteksi `API Error: <code>` terminal (429/500/502/503/
  504/529, `overloaded_error`) → exponential backoff + jitter + cap kumulatif; **tidak** menunggu window
  reset. Mereka hanya bereaksi pada error *terminal* (bentuk `API Error: <code>`), bukan retry internal
  CC yang masih berjalan (bentuk `(… Retrying …)`). Taxonomy ini harus kita tiru di Detector.
- **Gating alive-at-prompt:** kirim retry hanya bila foreground process = claude/node **dan** sesi idle
  (footer "esc to interrupt" absen); kalau proses keburu exit ke shell → **jangan ketik apa pun**
  (log & surface, auto-relaunch off by default). Praktik aman yang wajib ditiru PTY driver kita.

**Posisi kita vs claude-auto-retry:**

| Aspek | claude-auto-retry | Kita |
|---|---|---|
| CLI didukung | Claude Code saja | Claude Code + Antigravity |
| Mekanisme lanjut | Kirim "continue" ke **pane tmux yang masih hidup** | Inject ke **PTY sendiri** (sesi hidup, tanpa tmux) **+ resume by-id** sesi yang sudah mati, di cwd asli |
| Sesi mati / host reboot | Hilang (monitor per-pane) | State SQLite + scheduler tahan restart |
| Windows | WSL only | Native (node-pty + Task Scheduler) |
| Monitor usage terpusat | Tidak ada | `acca status` dual-CLI |

Nilai yang bisa dipetik: tabel pola pesan mereka = korpus fixture awal (§2b); pendekatan
"verifikasi foreground process sebelum inject" = praktik aman yang patut ditiru di PTY driver kita.
Proyek terkait lain yang mereka rujuk: `claude-code-queue` (antrian task dengan rate-limit handling),
`opencode-claude-quota` (monitor kuota, display-only).

**Risiko produk — auto-continue native:** permintaan fitur ini ramai di upstream Claude Code:
**#13354** (tracking utama, 41+ upvote per referensi #35744), #35744 (open), #36320 & #26789 & #18980
(ditutup duplikat). Belum ada sinyal implementasi (belum ada exit code khusus / flag `--wait-on-limit`).
Kalau Anthropic mengimplementasikan native, nilai kita untuk Claude Code menyempit ke: dual-CLI,
resume lintas reboot/host always-on, monitor terpusat, notifikasi. **Mitigasi:** jangan bangun MVP yang
nilainya 100% bergantung pada celah "Claude Code tak bisa lanjut sendiri"; pantau #13354 tiap sesi riset.

## 6. Sumber (verifikasi 2 Juli 2026)

Utamakan **sumber primer** (docs resmi) di atas blog pihak ketiga — tanggal cepat basi.

- Claude Help — usage & length limits: https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work
- Claude Help — usage limit best practices: https://support.claude.com/en/articles/9797557-usage-limit-best-practices
- Claude Code Docs — Manage sessions: https://code.claude.com/docs/en/sessions
- Claude Platform Docs — Rate limits (429, retry-after, anthropic-ratelimit-* headers): https://platform.claude.com/docs/en/api/rate-limits
- Claude Code issue #18121 — expose rate-limit/usage ke statusLine (**Closed, fixed v2.1.80**): https://github.com/anthropics/claude-code/issues/18121
- Claude Code issue #27915 — consolidated req (ditutup, duplikat #18121; komentar bot "fixed as of v2.1.80"): https://github.com/anthropics/claude-code/issues/27915
- Claude Code issue #33820 — expose headers ke hooks/statusline (ditutup, duplikat #27915): https://github.com/anthropics/claude-code/issues/33820
- Claude Code issue #13585 — quota access CLI (endpoint OAuth `api/oauth/usage` didiskusikan di sini): https://github.com/anthropics/claude-code/issues/13585
- Tooling komunitas: https://github.com/nsanden/claude-rate-monitor
- Prior art CodexBar (monitor usage macOS, 56+ provider): https://github.com/steipete/CodexBar
- CodexBar issue #1178 (usage Antigravity CLI — **ditutup via PR #1341**, 3 Jul 2026): https://github.com/steipete/CodexBar/issues/1178
- CodexBar docs — mekanisme provider Antigravity (LSP probe + retrieveUserQuota): https://github.com/steipete/CodexBar/blob/main/docs/antigravity.md
- Repo resmi Antigravity CLI (issue tracker; CHANGELOG stub): https://github.com/google-antigravity/antigravity-cli
- antigravity-cli issue #46 — usage/quota tak terlihat di AGY (open): https://github.com/google-antigravity/antigravity-cli/issues/46
- Forum Google AI Dev — `/usage` agy hanya update saat launch (20 Mei 2026): https://discuss.ai.google.dev/t/gemini-cli-antigravity-cli-day-1-impressions-only-updates-usage-after-quit-and-reload/146374
- Transisi Gemini CLI → Antigravity CLI (EOL individu 18 Jun 2026): https://github.com/google-gemini/gemini-cli/discussions/27274
- claude-auto-retry (kompetitor auto-continue Claude Code, tmux-based): https://github.com/cheapestinference/claude-auto-retry
- Claude Code issue #35744 — FEATURE auto-continue (rujuk #13354 sebagai tracking utama): https://github.com/anthropics/claude-code/issues/35744
- Claude Code issue #36320 — auto-resume + usulan exit 75 / `--wait-on-limit` (ditutup duplikat): https://github.com/anthropics/claude-code/issues/36320
- Claude Code Docs — Hooks reference (**event `StopFailure`**, matcher error type `rate_limit` dkk;
  `SessionStart`/`SessionEnd` matcher — diverifikasi 3 Jul 2026): https://code.claude.com/docs/en/hooks
- Claude Code CHANGELOG (StopFailure ditambahkan **v2.1.78**; tak ada fitur auto-continue native s/d
  entri teratas per 3 Jul 2026): https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- Google Antigravity Docs — Plans/quota: https://antigravity.google/docs/plans
- Antigravity forum — quota multi-day lockout vs 5-hour: https://discuss.ai.google.dev/t/google-ai-pro-antigravity-quota-shows-multi-day-lockouts-instead-of-5-hour-reset/130202
- Antigravity forum — quota problems & fix: https://sanj.dev/post/google-antigravity-quota-problems-fix/

> **Diverifikasi via Chrome (2 Jul 2026):** rantai isu #33820 → #27915 → #18121; #18121 fixed v2.1.80 →
> usage kini ada di statusLine JSON. Endpoint OAuth usage terkonfirmasi disebut komunitas (undocumented).
>
> **TODO verifikasi berikutnya:**
> 1. ~~Skema `rate_limits` statusLine JSON~~ ✅ **ditutup** (§2): `rate_limits.{five_hour,seven_day}.
>    {used_percentage, resets_at(epoch s)}`, Claude Code 2.1.199. Caveat: Pro/Max only, muncul pasca API-call pertama.
> 2. Konfirmasi format persis **pesan/perilaku** saat sesi Claude Code & Antigravity CLI kena limit
>    (untuk fixture Detector US-1) — **maju (3 Jul 2026):** korpus kandidat terkumpul di §2b dari komunitas;
>    **masih perlu** tangkapan terminal sendiri untuk lock + varian Antigravity (belum ada korpus publiknya;
>    sekalian catat: TUI agy tetap hidup atau exit saat quota habis? — §2c). Bobot TODO ini **turun** untuk
>    Claude Code karena jalur deteksi primer kini hook `StopFailure` (§2c); fixture = fallback + agy.
> 3. ~~Resume Antigravity CLI~~ ✅ **ditutup** (§4b): `agy --conversation <id>` (bukan `-c`) +
>    auto-printed resume cmd. Binary `agy` v1.0.16 terkonfirmasi.
> 4. ~~(Opsi) Verifikasi endpoint OAuth usage `api/oauth/usage` secara langsung~~ ✅ **DITUTUP (3 Jul 2026,
>    CC 2.1.200):** **200 OK** dgn Bearer token dari `~/.claude/.credentials.json` + `anthropic-beta:
>    oauth-2025-04-20`; skema nyata **lebih kaya dari statusLine** (array `limits[]` dgn `kind`/`severity`/
>    `is_active`/`scope.model`; `resets_at` = **ISO-8601**, bukan epoch; `spend.amount_minor` integer) — detail §2
>    poin 2. **Jalur monitor daemon-standalone CC terbukti** (perkuat ADR-001). Token redaksi, tak di-log.
> 5. **(Baru, 3 Jul 2026)** Probe usage Antigravity — **maju besar (3 Jul siang, §5b):** (b) LS embedded
>    **terkonfirmasi** (dua port random gRPC+HTTP; port via `Get-NetTCPConnection -OwningProcess <pid>`, tanpa
>    `lsof`/argv); **RPC `GetUserStatus` live TERBUKTI jalan — csrf TIDAK diperlukan** di localhost; **tapi
>    quota `nil` di print-mode LS** (`cascadeModelConfigData` belum terisi → butuh LS sesi interaktif ber-PTY).
>    **Arah: hybrid — #2 (LS GetUserStatus) utk sesi interaktif hidup + #3 (`retrieveUserQuota` OAuth) utk cek
>    pre-resume.** **Maju (3 Jul 2026):** (c) endpoint `POST cloudcode-pa.googleapis.com/v1internal:
>    retrieveUserQuota` **reachable** (bukan 404 → routing benar; Bearer + JSON body diterima), **TAPI** token
>    on-disk `~/.gemini/oauth_creds.json` **stale → 401 UNAUTHENTICATED**. **Temuan operasional material:** `agy -p`
>    berhasil (`pong`) namun **TIDAK menulis ulang** `oauth_creds.json` (expiry on-disk tetap 12 Jun) → **agy
>    refresh token INTERNAL**. Konsekuensi opsi #3: probe standalone **wajib token segar** — butuh (i) refresh
>    sendiri via `oauth2.googleapis.com` (→ **egress tambahan di luar whitelist NFR saat ini** + butuh client-id
>    Gemini CLI) ATAU (ii) ambil token dari LS sesi hidup (→ malah condong ke opsi #2 utk sesi hidup). **Bentuk
>    respons sukses `retrieveUserQuota`** ✅ **TERTANGKAP 12 Jul** (R4 slice 2, client gemini-cli publik `681255809395-…`):
>    `{buckets[]:{modelId,tokenType:"REQUESTS",remainingFraction,resetTime}}` per-model gemini reset HARIAN — **TAPI ini kuota
>    request harian gemini-cli, BUKAN limit grup weekly+5h agy** (Summary via OAuth=403) → opsi #3 tak viable utk gerbang resume
>    agy (G-38, ADR-018→**ADR-019** optimistic resume). Masih perlu: (a) freshness
>    snapshot `/usage` (#1), (c) **respons sukses** retrieveUserQuota (**ditunda ke M3 atas keputusan user 3 Jul** —
>    butuh refresh token via `oauth2.googleapis.com`; ditangkap nanti saat wrapper pegang token sesi hidup),
>    ~~(d) `quotaInfo` non-nil dari LS sesi interaktif ber-PTY nyata~~ ✅ **DITUTUP (3 Jul malam):** agy interaktif
>    dibungkus **PTY nyata (node-pty 1.1.0, Node 24.18.0 Win** — winpty passthrough gagal, stdin non-tty) → LS
>    `GetUserStatus` **200 OK, `cascadeModelConfigData` terisi, `quotaInfo` NON-NIL per model, tanpa csrf, TANPA
>    prompt (0 kuota)**. Skema: `clientModelConfigs[].quotaInfo.{remainingFraction float 0..1, resetTime ISO-8601 Z}`
>    **per model** (reset window per-kelas-model: Gemini-fast frac≈0.37 reset 17:15Z vs premium Claude/GPT frac≈0.20
>    reset 14:55Z) + `planInfo.{monthlyPromptCredits, monthlyFlowCredits}` + `availablePromptCredits/FlowCredits` +
>    `userTier`/`availableCredits`. Respons memuat **PII (nama+email)** → feed redaksi ADR-013. **→ opsi #2 terbukti
>    end-to-end; ADR-010 di-LOCK (Accepted).** node-pty prebuild Node 24 Win terverifikasi (de-risk ADR-003 M1).
>    Residual (a/#1 freshness + c/#3 body-sukses) = impl-tuning M3, non-blocking.
> 6. **(Baru, 3 Jul 2026)** Pantau Claude Code #13354 (auto-continue native) tiap sesi riset — kalau shipped,
>    revisit positioning (§5c) & scope MVP. *(Re-cek 3 Jul dini hari: masih open, belum ada sinyal implementasi;
>    CHANGELOG juga nihil auto-continue.)*
> 7. ~~Uji empiris hook `StopFailure` di mesin sendiri~~ ✅ **ditutup 3 Jul 2026** (v2.1.199, §2c): hook fire
>    (via `model_not_found` sbg proxy) + payload terkunci — **field tipe = `error` (bukan `error_type`)** +
>    bonus `last_assistant_message`; fire di print mode; `SessionStart` `source:"resume"` terkonfirmasi.
>    **Sisa:** observasi nilai `error:"rate_limit"` saat limit 5-jam **asli** habis (tak bisa dipaksa;
>    tangkap saat terjadi). Harness di scratchpad `hooktest/`.
