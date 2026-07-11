# DEPENDENCY-POLICY.md — kebijakan dependensi

> Bagaimana dependensi dipilih, di-pin, diverifikasi (khususnya native/prebuild lintas-OS). Ditulis M0
> sebagai fondasi M1. Turunan ADR-003/004/010/011; bukan me-relitigasi pilihan yang sudah locked.

---

## Prinsip
- **Minimalis.** Tambah dep hanya bila menghemat kerja nyata & populer/terawat (agent lancar). Cek: lisensi
  permisif (MIT/ISC/Apache-2.0), rilis terakhir < ~6 bulan, footprint dep transitif kecil.
- **Pin eksak.** Versi ter-lock ditulis di ADR + `package.json` + **`package-lock.json` di-commit**. Update =
  sadar (PR + catatan), bukan drift `^`.
- **Lintas-OS wajib:** Ubuntu 24.04 + Windows 11 (NFR portability). Dep native harus punya **prebuild** untuk
  **Node 24** di kedua OS, atau di-drop.
- **Egress build:** install boleh tarik prebuild dari registry resmi; **runtime** tunduk egress whitelist NFR.

## Versi ter-pin (locked)
| Paket | Versi | ADR | Native? |
|---|---|---|---|
| Node.js | 24.18.0 (LTS "Krypton") | ADR-003 | runtime |
| TypeScript | 5.x | ADR-003 | no |
| `node-pty` | 1.1.0 | ADR-003 | **ya** (ConPTY/pty) |
| `better-sqlite3` | 12.11.1 | ADR-004 | **ya** (node-gyp/prebuild) |
| `commander` | 14.0.2 | (M1) | no (0 dep transitif) |
| `drizzle-orm` | 0.45.2 (opsional, belum dipasang) | ADR-004 | no |
| `grammy` | 1.44.0 (belum dipasang — M-remote) | ADR-011 | no (4 dep runtime) |

**CLI framework = `commander` 14.0.2** (dipilih & di-pin M1; 0 dep transitif). **TUI `acca status` = plain ANSI
tanpa lib** (keputusan Ziffan 11 Jul — Ink/blessed **ditolak**; render manual `▓/░` + pad kolom, lihat
ARCHITECTURE §3). **notifier desktop (node-notifier) = masih pending** gate DEPENDENCY-POLICY (dep baru = keputusan
user; M4 Notifier saat ini sink stderr, tanpa dep).

## Verifikasi prebuild native (gate M1)
Dep native **wajib** lolos ini di **Windows 11 & Ubuntu 24.04** sebelum dipakai di `src/`:
1. `npm ci` sukses **tanpa** memicu `node-gyp rebuild` dari sumber (prebuild ada) — atau, bila build sumber,
   toolchain terdokumentasi.
2. `require()` + operasi minimal jalan (mis. `pty.spawn` echo; `better-sqlite3` open+WAL+query).
3. Catat hasil di CONTEXT/GOTCHAS bila ada jebakan.

**Status node-pty (3 Jul 2026 — Windows):** ✅ `node-pty` 1.1.0 **load & `pty.spawn` via ConPTY** di
Node 24.18.0 Win **tanpa compiler** (prebuild bundled). Diverifikasi saat probe ADR-010 (GOTCHAS G-8).
**✅ Ubuntu 24.04 (5 Jul):** gate native LULUS — `node-pty` **compile-from-source** (prebuild hanya darwin/win32) +
`better-sqlite3` require+operasi nyata OK (bukan cuma exit 0, G-11); build+lint+test hijau di Linux. Native gate
lintas-OS **tuntas** untuk kedua dep.

## npm & lockfile
- `npm ci` di CI/dua OS (bukan `npm install` yang bisa ubah lock). `engines.node` = 24.x; `.nvmrc` = 24.18.0.
- **allow-scripts:** node-pty/better-sqlite3 punya install script (prebuild/postinstall). Aktifkan hanya untuk
  paket tepercaya yang butuh (jangan blanket-allow semua). Audit `npm audit` berkala.

## Undocumented / rapuh (guard wajib)
Endpoint tak resmi (CC `api/oauth/usage`, agy LS `GetUserStatus`, `retrieveUserQuota`, hook `StopFailure`
payload) bisa berubah antar versi (GOTCHAS G-1/4/5/7). Kebijakan: **guard + fallback + fixture regresi**;
re-cek versi CLI tiap sesi riset (CC/agy patch). Jangan bergantung pada satu jalur tanpa fallback.

## Menambah dependensi baru
PR/commit yang menambah dep sebut: alasan, lisensi, ukuran/dep transitif, apakah native (+bukti prebuild
dua-OS), dan apakah menyentuh egress. Native baru tanpa prebuild dua-OS = **ditolak** default.
