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
│   │   ├── scheduler.ts     #   timer persisten dari scheduled_jobs (M3)
│   │   ├── continue.ts      #   inject-PTY (gating) vs resume-by-id (ADR-014) (M3)
│   │   └── ipc-server.ts    #   Node `net` socket/pipe, NDJSON (ADR-015)
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
│   └── shared/              # tipe umum, waktu (epoch-ms), path lintas-OS, logger terstruktur
├── test/                    # unit + integration (fixtures deteksi limit di test/fixtures/)
├── docs/                    # spec (file ini)
├── scripts/                 # tooling dev (verifikasi prebuild, dll)
└── package.json / tsconfig.json / .nvmrc
```

## Kontrak antar-modul (siapa panggil siapa)
- `cli/` **tak** akses store langsung untuk mutasi → lewat `daemon/ipc-server` (ADR-015). Read-only `status`
  boleh `store/` langsung (baca `meta.daemon_heartbeat_at` untuk liveness).
- `daemon/` satu-satunya penulis `sessions`/`scheduled_jobs`; `events` append-only dari mana pun via repo.
  **Pengecualian bootstrap M1** (daemon/IPC belum ada — ADR-015 baru dibangun M3): proses `acca run` **adalah**
  wrapper pemilik sesinya sendiri, jadi ia menulis `sessions` (RUNNING→EXITED/FAILED) **dan** `scheduled_jobs`
  (enqueue `probe` saat LIMIT_HIT) langsung via repo. Sejak M3d, engine wrapper (`runSession`) tinggal di
  **`daemon/process-wrapper.ts`** (I-14) — dipanggil `cli/commands/run.ts` (jalur user) **dan** `daemon/supervisor.ts`
  (actuation resume-by-id). Saat wrapper menulis job baru, ia mengirim IPC `rearm` best-effort ke daemon hidup
  (I-10) supaya scheduler re-arm tanpa restart. Aturan "penulis tunggal = daemon" **belum** penuh: konsolidasi
  sole-writer `scheduled_jobs` (daemon ambil-alih kepemilikan lifecycle sesi) = residual I-10, refactor menyusul.
- `adapters/` = satu-satunya tempat perintah tool-spesifik (resume/probe). Core **tak** hardcode `claude`/`agy`.
- `remote/` masuk supervisor lewat **IPC lokal yang sama** seperti CLI (otoritas identik — ADR-012);
  `remote/redact.ts` wajib di jalur egress output (ADR-013).

## Aturan lokasi
- Kode lintas-OS di `shared/` (path, waktu). **Jangan** hardcode `~`/separator POSIX (NFR portability).
- Migrasi SQL **hanya** di `store/migrations/`, forward-only, ber-nomor.
- Fixture deteksi limit (korpus RESEARCH §2b) di `test/fixtures/` — data, bukan kode.
- Spike/harness eksplorasi = **scratchpad non-repo** (preseden: `hooktest/`, `agy010/`), tak masuk `src/`.
