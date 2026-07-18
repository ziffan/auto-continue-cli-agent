# MAP.md — peta repo & tempat kode

> Di mana kode tinggal + kontrak antar-modul. Selaras container map ARCHITECTURE §2. Ditulis di M0 sebagai
> fondasi M1; struktur diisi bertahap per milestone (jangan buat folder kosong sebelum ada isinya).

---

## Layout target (TypeScript + Node 24 — ADR-003)

```
auto-continue-cli-agent/
├── src/
│   ├── cli/                 # entrypoint `acca` — parse arg, kirim IPC / baca store (ADR-015)
│   │   └── commands/        #   run / status / log / resume-now / cancel  (satu file per command)
│   ├── daemon/              # Supervisor daemon (proses inti, monolith — ADR-002)
│   │   ├── supervisor.ts    #   koordinasi lifecycle sesi
│   │   ├── process-wrapper.ts #  spawn CLI via node-pty, tangkap stdout/exit (M1)
│   │   ├── detector.ts      #   LIMIT_HIT (hook StopFailure / pola output / exit / transcript) (M2)
│   │   ├── reset-estimator.ts #  reset_at: exact→heuristic→backoff (M2)
│   │   ├── scheduler.ts     #   timer persisten dari scheduled_jobs (M3b); usage-monitor.ts = probe periodik saat RUNNING (I-17)
│   │   ├── limit-watcher.ts #   seam detector→PTY sesi live; latch + unlatch multi-siklus (R3/I-21) (M3d)
│   │   ├── inject-continue.ts # inject 'continue' ke PTY sesi HIDUP (ADR-014 §1); resume-by-id = dispatch supervisor (M3d)
│   │   └── ipc-server.ts    #   Node `net` socket/pipe, NDJSON (ADR-015; +ipc-client/ipc-protocol/reconcile/schedule-reset)
│   ├── adapters/            # per-tool: kontrak detectLimit/parseReset/resumeCmd/probeUsage
│   │   ├── types.ts         #   interface Adapter
│   │   ├── claude.ts        #   nama file = nilai enum `tool` ('claude'), bukan 'claude-code'
│   │   └── antigravity.ts   #   LS GetUserStatus + retrieveUserQuota (ADR-010)
│   ├── remote/              # Remote Gateway Telegram (grammy — ADR-011/012/013) (M-remote)
│   │   ├── bot.ts           #   long-polling getUpdates (outbound-only)
│   │   ├── authz.ts         #   allowlist chat_id default-deny (ADR-012)
│   │   ├── confirm-gate.ts  #   queue→echo→/confirm→inject (ADR-013)
│   │   └── redact.ts        #   hybrid regex+entropy (ADR-013 §2)
│   ├── store/               # SQLite (better-sqlite3 — ADR-004)
│   │   ├── db.ts            #   koneksi, WAL, foreign_keys
│   │   ├── migrations/      #   NNNN-nama.sql (ber-nomor, forward-only)
│   │   └── repositories/    #   sessions / events / scheduled_jobs / meta
│   ├── notify/              # Notifier lokal (node-notifier/stdout) + hook ke remote (M4)
│   ├── web/                 # Web UI monitor read-only (ADR-028, M-web) — opt-in `acca web`
│   │   ├── server.ts        #   http.createServer bind 127.0.0.1; GET /(HTML) + /api/status(JSON); Host-guard; GET-only
│   │   ├── status-json.ts   #   PURE: rakit /api/status dari proyeksi ter-firewall (toSessionStatusView/formatEventLine/usage) — nol jalur data baru
│   │   └── page.ts          #   HTML self-contained (CSS+JS inline, nol aset eksternal; render textContent anti-XSS)
│   └── shared/              # tipe umum, waktu (epoch-ms), path lintas-OS, logger terstruktur
├── test/                    # unit + integration (fixtures deteksi limit di test/fixtures/); gate artefak: systemd-unit / shell-script / ps1-encoding (I-34)
├── deploy/                  # template service+backup (non-TS, dirender/di-substitusi saat install — bukan dibuild ke dist/)
│   ├── linux/               #   acca-daemon.service (systemd --user, M5.4)
│   └── backup/              #   systemd/ (.service+.timer) + windows/ (.ps1) — M5.2
├── docs/                    # spec (file ini)
├── scripts/                 # tooling dev + install-linux.sh (M5.4) + backup.js / copy-migrations.js
└── package.json / tsconfig.json / .nvmrc
```

## Kontrak antar-modul (siapa panggil siapa)
- `cli/` **tak** akses store langsung untuk mutasi → lewat `daemon/ipc-server` (ADR-015). Read-only `status`
  boleh `store/` langsung (baca `meta.daemon_heartbeat_at` untuk liveness).
- **Kepemilikan penulis state = ADR-017 (by-design, LOCKED 11 Jul).** Daemon = sole **coordinator/dispatcher +
  reconciler**, **bukan** sole *writer*. `events` append-only dari mana pun via repo. **Wrapper `acca run` = penulis
  SAH** (bukan pengecualian tertunda) untuk lifecycle sesinya sendiri (`sessions`: RUNNING→EXITED/FAILED/LIMIT_HIT/
  RESUMED) **dan** enqueue `scheduled_jobs` (`probe` saat LIMIT_HIT) langsung via repo — karena wrapper-lah pemegang
  PTY + sumber deteksi limit. Sejak M3d, engine wrapper (`runSession`) tinggal di **`daemon/process-wrapper.ts`**
  (I-14) — dipanggil `cli/commands/run.ts` (jalur user) **dan** `daemon/supervisor.ts` (actuation resume-by-id, di situ
  daemon = pemilik PTY sesi baru). Saat wrapper menulis job, ia kirim IPC `rearm` best-effort ke daemon hidup (I-10)
  → scheduler re-arm tanpa restart; daemon mati saat enqueue → recovery-saat-`start()` jamin job tak hilang (AC-7).
  Konsistensi lintas-proses = pembagian baris tegas + WAL (ADR-004) + rearm/recovery; **tak ada write-race**. Konsolidasi
  sole-writer penuh **DITOLAK** (ADR-017) — residual I-10 = **RESOLVED by-design**, bukan refactor menunggu.
- `adapters/` = satu-satunya tempat perintah tool-spesifik (resume/probe). Core **tak** hardcode `claude`/`agy`.
- `web/` (ADR-028) = **read-only**, baca `store/` langsung (seperti `acca status`), bind `127.0.0.1` saja.
  `/api/status` WAJIB memakai proyeksi ter-firewall yang SUDAH ADA (`toSessionStatusView`, `formatEventLine`,
  `formatUsageLines`) — **DILARANG** menambah jalur data baru atau menyingkap `cli_session_id`/`cwd`/rahasia
  (loopback terjangkau proses lokal lain, T-W1). **Nol mutasi** (tak panggil IPC/daemon; tak ada resume/cancel).
- `remote/` masuk supervisor lewat **IPC lokal yang sama** seperti CLI (otoritas identik — ADR-012);
  `remote/redact.ts` wajib di jalur egress output (ADR-013).

## Aturan lokasi
- Kode lintas-OS di `shared/` (path, waktu). **Jangan** hardcode `~`/separator POSIX (NFR portability).
- Migrasi SQL **hanya** di `store/migrations/`, forward-only, ber-nomor.
- Fixture deteksi limit (korpus RESEARCH §2b) di `test/fixtures/` — data, bukan kode.
- Spike/harness eksplorasi = **scratchpad non-repo** (preseden: `hooktest/`, `agy010/`), tak masuk `src/`.
