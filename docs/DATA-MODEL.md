# DATA-MODEL.md — skema store (SQLite)

> Store = SQLite via `better-sqlite3` (ADR-004). **WAL mode**, `foreign_keys=ON`. Ringkas dari ARCHITECTURE §4;
> ini sumber kebenaran skema untuk M1+. Migrasi = file ber-nomor (lihat CONVENTIONS). **Tak ada hard delete**
> (arsip + retensi — ADR-004; angka retensi = pending, owner Ziffan, sebelum M2).

---

## Prinsip tipe

- **Waktu:** simpan **INTEGER Unix epoch milidetik (UTC)**. Normalisasi di adapter saat baca sumber
  (statusLine = epoch detik; `api/oauth/usage` & LS `resetTime` = ISO-8601 — GOTCHAS G-4). Jangan simpan
  waktu lokal/naif.
- **Uang / kredit:** **bukan float** (ADR-004). Simpan integer minor-unit (mis. `amount_minor`) atau string
  desimal. `remainingFraction` (0..1) dari probe = nilai tampilan; **jangan** dipakai untuk aritmetika uang.
- **Enum** disimpan sebagai TEXT dengan `CHECK`. **JSON** (payload event) sebagai TEXT (validasi di aplikasi).
- **ID sesi supervisor** (`sessions.id`) = milik kita (pendek, mis. 4-char base32 untuk tampilan `#a1b2`),
  **beda** dari `cli_session_id` (id milik CLI untuk resume).

## Tabel

### `sessions`
| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | TEXT PK | id supervisor (tampilan `#a1b2`) |
| `tool` | TEXT CHECK(`claude`\|`antigravity`) | adapter |
| `cli_session_id` | TEXT NULL | id sesi milik CLI → `claude --resume <id>` / `agy --conversation <id>` |
| `cwd` | TEXT | working dir **asli** (wajib untuk resume — NFR: resume salah-dir = 0) |
| `pid` | INTEGER NULL | PID proses CLI yang dibungkus |
| `status` | TEXT CHECK | `RUNNING\|LIMIT_HIT\|WAITING\|RESUMED\|EXITED\|BLOCKED\|FAILED` |
| `proc_state` | TEXT CHECK(`alive`\|`exited`) | limit-hit ≠ exit (RESEARCH §2c) → menentukan inject-PTY vs resume-by-id (ADR-014) |
| `detected_at` | INTEGER NULL | epoch ms saat LIMIT_HIT terdeteksi |
| `detect_source` | TEXT NULL | `stopfailure\|output\|exitcode\|transcript` (audit sumber sinyal) |
| `reset_at` | INTEGER NULL | epoch ms perkiraan reset |
| `reset_source` | TEXT NULL CHECK(`exact`\|`heuristic`\|`backoff`) | tandai "perkiraan" bila bukan `exact` |
| `created_at` | INTEGER | epoch ms |
| `updated_at` | INTEGER | epoch ms |
| `archived_at` | INTEGER NULL | arsip (bukan delete) |
| `resumed_from` | TEXT NULL FK→sessions.id | id sesi ASAL bila baris ini hasil resume-by-id (rantai resume, I-14); null utk sesi biasa. Ditambah migrasi `0002` (`schema_version`=2). |

Index: `idx_sessions_status(status)`, `idx_sessions_updated(updated_at)`.

### `events` (append-only, audit trail)
| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `session_id` | TEXT NULL FK→sessions.id | NULL utk event global (mis. drop pesan Telegram tak sah) |
| `type` | TEXT | mis. `status_change`, `resume_attempt`, `remote_cmd`, `remote_drop`, `confirm`, `inject` |
| `payload` | TEXT (JSON) | detail terstruktur; **redaksi rahasia** sebelum tulis bila dari output (ADR-013) |
| `created_at` | INTEGER | epoch ms |

Index: `idx_events_session(session_id, created_at)`. **Tak pernah UPDATE/DELETE** (append-only).

### `scheduled_jobs` (tahan restart daemon — NFR reliability)
| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `session_id` | TEXT FK→sessions.id | |
| `run_at` | INTEGER | epoch ms jadwal jalan |
| `kind` | TEXT CHECK(`probe`\|`resume`) | |
| `attempts` | INTEGER DEFAULT 0 | |
| `next_backoff_ms` | INTEGER NULL | backoff berjenjang (NFR: 5m→15m→1j→cap) |
| `created_at` | INTEGER | |

Index: `idx_jobs_runat(run_at)`. Scheduler recover = `SELECT … WHERE run_at pending` saat start.

### `meta` (heartbeat + skema)
`key TEXT PK, value TEXT`. Isi: `schema_version`, `daemon_heartbeat_at` (epoch ms — `acca status` baca ini
untuk liveness tanpa IPC, ADR-015), `daemon_pid`.

## Catatan lintas-milestone
- **M1** memakai: `sessions` (tulis RUNNING/EXITED), `meta` (heartbeat), `events` (status_change).
- `scheduled_jobs` + kolom reset_* aktif di **M2/M3**.
- Kolom Telegram/redaksi tak menambah tabel baru (audit lewat `events`).
