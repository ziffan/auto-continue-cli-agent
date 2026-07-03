# ISSUES.md — issue terbuka & tertutup

> Prioritas: P0 (blocker) · P1 (penting) · P2 (mengganggu) · P3 (nanti). Ditutup = tulis solusinya.

---

## Terbuka

### I-3 — Rekonsiliasi tulis-balik sesi orphan (RUNNING basi) [P2, target M3]
Bila proses wrapper mati keras (SIGKILL / terminal ditutup / crash) sebelum `markExited`, baris
`sessions` tetap `RUNNING/alive` selamanya. M1 memitigasi di **tampilan** (`status` menandai "(basi)"
via cek liveness PID — lihat I-1), tapi **tulis-balik** status (mis. → `EXITED`/`FAILED` dengan
`detect_source`) belum ada. Tempat yang benar = **daemon saat start** (ADR-015; daemon = penulis
tunggal `sessions`), bukan `status` (read-only). Rekonsiliasi: `SELECT proc_state='alive'` → cek PID →
mati → tandai + event `status_change`. Aktif saat daemon lahir di M3.

---

## Tertutup

### I-1 — `acca status` menampilkan sesi orphan sebagai `RUNNING` (menyesatkan) [P2] ✅
**Gejala:** setelah wrapper di-interrupt, `#pwy6 claude RUNNING alive pid 25584` bertahan padahal PID 25584
sudah mati (terverifikasi). `status` menampilkannya seolah sesi hidup.
**Solusi:** `status` kini cek liveness (`shared/proc.ts isProcessAlive` via `process.kill(pid,0)`); sesi
`proc_state='alive'` yang PID-nya mati ditandai `RUNNING (basi)` di tampilan. **Read-only** (tak menulis DB —
tulis-balik = I-3/M3). Ditemukan saat smoke interaktif M1 (3 Jul).

### I-2 — Wrapper tak kembali ke shell prompt setelah CLI target keluar [P2] ✅
**Gejala:** setelah `claude` keluar, `acca run` tak segera balik ke prompt terminal; user harus Ctrl-C.
Dugaan: handle ConPTY node-pty (Windows) menahan event-loop Node walau child sudah exit dan `markExited`
sudah jalan (sesi tetap tercatat `EXITED` — jalur benar, hanya proses wrapper menggantung).
**Solusi:** `cli/commands/run.ts` memanggil `process.exit(exitCode)` eksplisit setelah `closeDb` pada jalur
sukses (pola umum wrapper PTY), sehingga wrapper mengembalikan kontrol segera. Jalur spawn-gagal tetap lewat
`index.ts` catch → exit 1 (tak ada pty menggantung). Ditemukan saat smoke interaktif M1 (3 Jul).
