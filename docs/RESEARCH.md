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
   `GET https://api.anthropic.com/api/oauth/usage` →
   `{ "five_hour": { "utilization": 42.0, "resets_at": "..." }, "seven_day": { ... } }`.
   Butuh OAuth token dari kredensial mesin → **sensitif & tak terdokumentasi**; pakai dengan hati-hati,
   bisa berubah tanpa notice. Bagus untuk **monitor daemon standalone** yang tidak berada di dalam sesi.
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

Catatan: format berubah antar versi (varian lama pakai kalimat panjang + timezone eksplisit; varian
baru pakai `·` separator); waktu reset kadang tanpa timezone. **Status: kandidat** — TODO #2 (§6) tetap
terbuka sampai tertangkap dari terminal sendiri; jadikan tabel ini korpus awal fixture + test regresi.

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
**Belum diverifikasi untuk Antigravity** — perilaku TUI agy saat quota habis (tetap hidup vs exit) =
bagian TODO #2 varian agy (§6).

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
(fallback: tangkap perintah auto-printed saat exit). `probeUsage()` Antigravity — tiga opsi, urutan preferensi
belum di-lock (lihat DECISIONS.md Pending):
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

## 4c. Terpasang di mesin ini (snapshot 2 Jul 2026, re-cek 3 Jul 2026, Windows PC)

| Tool | Binary | Versi | Catatan |
|---|---|---|---|
| Claude Code | `C:\Users\ziffa\.local\bin\claude.exe` | **2.1.199** | ≥2.1.80 → `rate_limits` ada di statusLine JSON |
| Antigravity CLI | `C:\Users\ziffa\AppData\Local\agy\bin\agy.exe` | **1.0.16** | ≥1.0.4 → `--conversation <id>` resume |
| Gemini CLI | `...\npm\gemini.ps1` | 0.42.0 | terpisah; bukan target MVP |

> **Re-cek versi 3 Jul 2026** (dari 2.1.198→**2.1.199** & agy 1.0.15→**1.0.16**, keduanya patch bump):
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
   menemukannya di Windows/Linux tanpa `lsof`) **belum diverifikasi** → inti TODO #5 (§6).
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
> 4. (Opsi) Verifikasi endpoint OAuth usage `api/oauth/usage` secara langsung — **ditunda**: butuh baca token
>    dari kredensial (sensitif); statusLine JSON sudah cukup untuk MVP monitor.
> 5. **(Baru, 3 Jul 2026)** Probe usage Antigravity: uji 3 opsi §4b di mesin sendiri — (a) freshness snapshot
>    `/usage` saat fresh-launch, (b) probe language-server ala CodexBar **di Windows/Linux** (deteksi proses/port
>    tanpa `lsof` di Windows), (c) bentuk request/respons `v1internal:retrieveUserQuota`. Hasil → lock di ADR.
> 6. **(Baru, 3 Jul 2026)** Pantau Claude Code #13354 (auto-continue native) tiap sesi riset — kalau shipped,
>    revisit positioning (§5c) & scope MVP. *(Re-cek 3 Jul dini hari: masih open, belum ada sinyal implementasi;
>    CHANGELOG juga nihil auto-continue.)*
> 7. ~~Uji empiris hook `StopFailure` di mesin sendiri~~ ✅ **ditutup 3 Jul 2026** (v2.1.199, §2c): hook fire
>    (via `model_not_found` sbg proxy) + payload terkunci — **field tipe = `error` (bukan `error_type`)** +
>    bonus `last_assistant_message`; fire di print mode; `SessionStart` `source:"resume"` terkonfirmasi.
>    **Sisa:** observasi nilai `error:"rate_limit"` saat limit 5-jam **asli** habis (tak bisa dipaksa;
>    tangkap saat terjadi). Harness di scratchpad `hooktest/`.
