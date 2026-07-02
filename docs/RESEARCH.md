# RESEARCH.md — Usage Limit & Resume: Claude Code + Antigravity CLI

> Riset pendukung problem statement & arsitektur. **Diverifikasi 2 Juli 2026** via WebSearch + browsing
> langsung (Chrome, isu GitHub) + **inspeksi binary & storage di mesin Windows ini**. Fakta usage/limit
> **cepat basi** — verifikasi ulang via sumber primer sebelum keputusan penting. `/usage` di dalam CLI
> adalah sumber kebenaran real-time untuk angka usermu.

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
   (code.claude.com/docs/en/statusline) + versi terpasang di mesin ini = **Claude Code 2.1.198**:

   ```json
   "rate_limits": {
     "five_hour": { "used_percentage": 42, "resets_at": 1738425600 },
     "seven_day": { "used_percentage": 67, "resets_at": 1738857600 }
   }
   ```

   - `rate_limits.five_hour.used_percentage` / `.seven_day.used_percentage` → 0–100.
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
- **Deteksi sesi yang sudah berhenti** (untuk auto-resume) tetap butuh **wrapper proses** (exit code) +
  fallback parsing transcript — statusLine hanya hidup selama sesi jalan, tak bisa mendeteksi sesi yang
  sudah mati. Jadi arsitektur wrapper tetap relevan, tapi **bukan lagi** karena "usage tak terekspos".

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

**Terkonfirmasi dari binary terpasang `agy` v1.0.15** (mengoreksi tutorial pihak ketiga):

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

**Implikasi desain:** adapter Antigravity `resumeCmd(id)` → `agy --conversation <id>` (fallback: tangkap
perintah auto-printed saat exit). `probeUsage()` Antigravity: karena `/usage` TUI-only → supervisor harus
**men-drive PTY** (kirim `/usage`, parse output render) **atau** panggil endpoint server dengan OAuth creds
(lihat §4d). Tidak ada jalur non-interaktif resmi yang bersih.

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
2. **Tidak ada cache usage/quota lokal** → usage murni server-side, hanya tampil via `/usage` TUI.
3. Conversation id mudah dipetakan: nama file `.pb` = id yang dipakai `--conversation`.

## 4c. Terpasang di mesin ini (snapshot 2 Jul 2026, Windows PC)

| Tool | Binary | Versi | Catatan |
|---|---|---|---|
| Claude Code | `C:\Users\ziffa\.local\bin\claude.exe` | **2.1.198** | ≥2.1.80 → `rate_limits` ada di statusLine JSON |
| Antigravity CLI | `C:\Users\ziffa\AppData\Local\agy\bin\agy.exe` | **1.0.15** | ≥1.0.4 → `--conversation <id>` resume |
| Gemini CLI | `...\npm\gemini.ps1` | 0.42.0 | terpisah; bukan target MVP |

Claude Code resume flags terverifikasi: `-c/--continue` (sesi terakhir di cwd), `-r/--resume [id]`
(picker/by-id), `--session-id <uuid>`, `--fork-session` (resume jadi id baru), `--from-pr`.

## 5. Kesimpulan yang membentuk arsitektur

| Temuan | Konsekuensi arsitektur |
|---|---|
| Usage Claude Code **kini** terekspos (statusLine JSON v2.1.80 + endpoint OAuth usage) | Monitor pakai jalur resmi; wrapper hanya untuk **deteksi sesi mati** + resume |
| Resume scoped ke cwd | Simpan cwd+session-id; resume di cwd persis; status BLOCKED bila cwd hilang |
| Angka limit volatil, `/usage` = sumber live | Baca usage live; tampilkan "perkiraan" saat sumbernya heuristik |
| Antigravity: mingguan bisa 0 meski 5-jam reset | Probe kuota sebelum resume; jadwal mingguan + backoff |
| Antigravity `/usage` TUI-only + transcript `.pb` protobuf | Probe usage via drive-PTY; deteksi limit andalkan exit-code/PTY output, bukan parse `.pb` |
| Reliabilitas sinyal reset bervariasi | Fallback backoff konservatif; jangan spam-resume |

## 5b. Prior art — CodexBar (`steipete/CodexBar`)

Referensi terdekat yang perlu diketahui (disarankan user). **CodexBar** = app **menu bar macOS** (Swift)
yang menampilkan usage real-time untuk **56+ provider** AI coding (Claude, Codex, Cursor, Copilot, Gemini,
Grok, dll). Mekanisme baca usage: **endpoint OAuth**, **parsing output CLI via PTY**, inspeksi config lokal
(`~/.claude`, `~/.codex`, `~/.config/codexbar/`), cookie browser, keychain, log JSONL untuk kalkulasi biaya.

**Yang memvalidasi arahan kita:** pendekatan PTY + endpoint OAuth + inspeksi config = persis jalur yang
kita rancang (ADR-001). Bukan jalan buntu.

**Diferensiasi kita (bukan duplikasi):**

| Aspek | CodexBar | auto-continue-cli-agent (kita) |
|---|---|---|
| Fokus | **Monitor** usage saja (pasif) | Monitor **+ auto-resume** sesi terputus (aktif) |
| Auto-continue | **Tidak ada** | **Fitur inti** |
| Platform | macOS menu bar | **Cross-OS** (Linux daily + Windows weekend), CLI/daemon |
| Cakupan | 56+ provider, luas & dangkal | 2 CLI (Claude Code + Antigravity), dalam |
| Antigravity | **Belum didukung** — isu #1178 *masih terbuka*, mereka belum tahu cara baca usage agy | Sudah dipetakan (§4b–4d) |

**Catatan penting:** isu CodexBar **#1178** (dukungan usage Antigravity CLI) **masih terbuka & belum
terpecahkan** — mereka belum menemukan cara agy mengekspos usage. Temuan kita di §4b–4d (`/usage` TUI-only,
storage `~/.gemini/`, tak ada cache usage lokal, `.pb` protobuf) = kontribusi orisinal yang bisa jadi
referensi (atau bahkan kita share balik ke isu itu nanti).

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
- CodexBar issue #1178 (dukungan usage Antigravity CLI — masih terbuka): https://github.com/steipete/CodexBar/issues/1178
- Google Antigravity Docs — Plans/quota: https://antigravity.google/docs/plans
- Antigravity forum — quota multi-day lockout vs 5-hour: https://discuss.ai.google.dev/t/google-ai-pro-antigravity-quota-shows-multi-day-lockouts-instead-of-5-hour-reset/130202
- Antigravity forum — quota problems & fix: https://sanj.dev/post/google-antigravity-quota-problems-fix/

> **Diverifikasi via Chrome (2 Jul 2026):** rantai isu #33820 → #27915 → #18121; #18121 fixed v2.1.80 →
> usage kini ada di statusLine JSON. Endpoint OAuth usage terkonfirmasi disebut komunitas (undocumented).
>
> **TODO verifikasi berikutnya:**
> 1. ~~Skema `rate_limits` statusLine JSON~~ ✅ **ditutup** (§2): `rate_limits.{five_hour,seven_day}.
>    {used_percentage, resets_at(epoch s)}`, Claude Code 2.1.198. Caveat: Pro/Max only, muncul pasca API-call pertama.
> 2. Konfirmasi format persis **pesan/exit** saat sesi Claude Code & Antigravity CLI berhenti karena limit
>    (untuk fixture Detector US-1) — **butuh observasi terminal saat benar-benar kena limit** (belum bisa dipaksa).
> 3. ~~Resume Antigravity CLI~~ ✅ **ditutup** (§4b): `agy --conversation <id>` (bukan `-c`) +
>    auto-printed resume cmd. Binary `agy` v1.0.15 terkonfirmasi.
> 4. (Opsi) Verifikasi endpoint OAuth usage `api/oauth/usage` secara langsung — **ditunda**: butuh baca token
>    dari kredensial (sensitif); statusLine JSON sudah cukup untuk MVP monitor.
