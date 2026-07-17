# FAILURE-MODES.md — mode kegagalan per komponen

> Bagian 2.3 (risk planning). Per komponen: failure mode → penyebab → dampak → deteksi → mitigasi →
> **milestone tempat mitigasi dikerjakan** (supaya tak jadi wacana). Ditulis 2026-07-17 saat spec M5 —
> mencakup mode kegagalan yang relevan ke service-as-daemon + backup, plus mode inti yang sudah ada.
>
> Konvensi: 1 baris = 1 mode. Kolom **Milestone** = tempat mitigasi sudah/akan dikerjakan (✅ = sudah).

---

## 1. Service / daemon lifecycle (M5)

| Mode | Penyebab | Dampak | Deteksi | Mitigasi | Milestone |
|---|---|---|---|---|---|
| Daemon crash saat runtime | Bug, OOM, exception tak tertangkap | Auto-resume mati → sesi LIMIT_HIT nganggur | Service manager (systemd/WinSW) lihat proses exit | **Auto-restart on-failure** (`Restart=on-failure` / WinSW restart policy, ADR-021); recovery job saat `start()` | M5 |
| Daemon tak start saat boot | Service tak ter-enable / linger off (Linux) / registrasi salah (Windows) | Reboot → daemon mati → resume tak jalan (mode kegagalan yang produk cegah!) | `acca status` lapor daemon tak hidup; service status OS | Skrip install `enable --now` + `enable-linger` (Linux) / WinSW auto-start (Windows); quick-start dokumentasikan verifikasi pasca-boot | M5 |
| Daemon mati saat user logout | systemd user service tanpa linger (Linux) | Resume berhenti saat user logout | Service mati di `loginctl` | **`loginctl enable-linger`** WAJIB (ADR-021, verified web); Windows Service independen sesi | M5 |
| Job pending hilang saat daemon mati | Daemon crash setelah enqueue, sebelum fire | Sesi LIMIT_HIT tak ter-resume pasca-reset | Job ada di `scheduled_jobs` tapi tak fire | **Recovery-saat-`start()`** (AC-7) — scheduler re-arm job jatuh-tempo saat daemon hidup lagi | ✅ M3 (verifikasi end-to-end di M5) |
| Spawn CLI target gagal (binary hilang) | PATH/PATHEXT (Windows, G-12) / uninstall | Sesi tak jalan | `spawnFailed` sinkron | Resolusi path absolut (`shared/which.ts`, G-12); sesi → FAILED bukan orphan (R1) | ✅ M3 |
| Dua daemon jalan bersamaan | Stale socket di-unlink buta (POSIX, G-14) | Korupsi state (dua writer) | `EADDRINUSE` + probe connect | Single-instance guard (probe connect sebelum unlink, G-14) | ✅ M3a |

## 2. Store / state (M5 backup + inti)

| Mode | Penyebab | Dampak | Deteksi | Mitigasi | Milestone |
|---|---|---|---|---|---|
| `acca.db` korup | Crash saat write / disk error / power loss | Kehilangan riwayat sesi + job terjadwal → resume tak jalan | `openDb()` throw / integrity check gagal | **Backup minimal** (WAL checkpoint + file copy + retensi, ADR-022); restore terdokumentasi | M5 |
| Backup tak konsisten (setengah transaksi) | Salin `.db` tanpa checkpoint saat WAL aktif | Restore ke state korup/parsial | Integrity check pasca-restore gagal | `PRAGMA wal_checkpoint(TRUNCATE)` **sebelum** copy (ADR-022) | M5 |
| Migrasi SQL gagal separuh | Migrasi non-idempotent / interupsi | Schema inkonsisten | `schema_version` mismatch | Migrasi forward-only ber-nomor, idempotent bila mungkin (CONVENTIONS); transaksi | ✅ M1 |
| Aset non-TS (migrasi SQL) hilang di build | `tsc` tak salin `.sql` (G-10) | `openDb()` ENOENT di binary hasil build | Smoke-run binary | `scripts/copy-migrations.js` pasca-`tsc` (G-10) | ✅ M1 |
| Retensi hard-delete state | Job purge yang menghapus baris | Kehilangan audit (langgar no-hard-delete) | Review kode | No-hard-delete (arsip `archived_at`, `events` append-only, ADR-004); verifikasi di security pass M5 | ✅ / M5 verify |

## 3. IPC / keamanan lokal (M5 security pass)

| Mode | Penyebab | Dampak | Deteksi | Mitigasi | Milestone |
|---|---|---|---|---|---|
| Named pipe Windows di-connect user lokal lain | DACL terbuka by Node design (I-26, ADR-023) | `status` bocorkan cwd; perintah whitelist bisa dipicu | Manual/review (Node tak bisa set-DACL) | **Terima residual (R-5)** + hardening lapisan-app (minimalkan data lewat pipe; inject firewall; audit) — ADR-023 | M5 |
| Kredensial upstream bocor ke log/DB | Log mentah / echo payload probe | Kebocoran token (`oauth_creds.json`) | Grep log/DB | Kredensial hanya dibaca, tak disalin/di-log (ADR-005/010); redaksi jalur egress | M5 verify |
| Egress nyasar ke host non-allowlist | Bug / dependency jahat | Exfiltrasi data | `guardEgress` block + test | Whitelist egress `ALLOWED_HOSTS`; non-allowlist → `EgressBlockedError` | ✅ / M5 verify |
| Inject teks arbitrer via pipe | Payload di perintah `inject` | Eksekusi instruksi tak sah di PTY | Review firewall | `inject` **tanpa payload** (token literal wrapper, ADR-014/020) — firewall struktural | ✅ / M5 verify |

## 4. Deteksi / resume inti (referensi — sudah ditutup, konteks)

| Mode | Penyebab | Dampak | Deteksi | Mitigasi | Milestone |
|---|---|---|---|---|---|
| False LIMIT_HIT (repaint banner) | Repaint banner limit lama CC pasca-unlatch (G-37) | Sesi ter-LIMIT_HIT palsu + job bogus | PTY-integration test | Grace-window OUTPUT-CC 5s (I-31) | ✅ M3e |
| Resume di cwd salah | cwd asli hilang/berubah | Resume di tempat salah (hard-req = 0) | cwd tak ada saat resume | cwd hilang → **BLOCKED** (tak resume), notif | ✅ M3 |
| Resume-by-id load tapi tak lanjut | Nol inject continue ke sesi hasil-resume (C-1) | Sesi "resumed" tapi diam | Kontrak test | Enqueue continue-job ke sesi baru (RC-1) | ✅ M3e |
| Reset clock-wrap +24 jam | Output "resets Xpm" sudah lewat di-wrap besok (I-30) | Probe salah dijadwalkan | Live-verify | Guard estimator recent-past ≤2h → probe near-now | ✅ M3e |
| Probe agy sesi-hidup stale | LS snapshot beku launch-time (G-35) | Proximity meleset / gate basi | Live-verify | Deteksi limit agy = output TUI / fresh-launch, bukan probe sesi-lama; agy-exited = optimistic resume (ADR-019) | ✅ M3e (agy-alive residual = C-5) |

---

## Change Log

| Tanggal | Perubahan |
|---|---|
| 2026-07-17 | File dibuat (spec M5, docs-first Step 3). Fokus: service lifecycle (§1) + store/backup (§2) + IPC/keamanan lokal (§3, M5 security pass) + referensi mode inti yang sudah ditutup (§4). Mitigasi service/backup/DACL → milestone M5; sisanya ✅ referensi. Basis: ADR-021/022/023, THREAT-MODEL §8. |
