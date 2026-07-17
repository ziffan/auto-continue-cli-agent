# DEPENDENCY-POLICY.md — kebijakan dependensi

> Bagaimana dependensi dipilih, di-pin, diverifikasi (khususnya native/prebuild lintas-OS). Ditulis M0
> sebagai fondasi M1. Turunan ADR-003/004/010/011; bukan me-relitigasi pilihan yang sudah locked.

---

## Prinsip
- **Minimalis.** Tambah dep hanya bila menghemat kerja nyata & populer/terawat (agent lancar). Cek: lisensi
  permisif (MIT/ISC/Apache-2.0), rilis terakhir < ~6 bulan, footprint dep transitif kecil.
  - **Pengecualian syarat "rilis < ~6 bulan" — HANYA untuk kelas artefak sempit ini** (ADR-025, 17 Jul): binary
    **vendored non-npm** yang (a) jalan **di luar proses kita** (OS yang meluncurkan; tak pernah di-`require()`/link),
    (b) **nol permukaan jaringan**, (c) **hash-pinned** (tak auto-update), (d) domain masalahnya **beku**, dan (e) punya
    eksposur adversarial besar. Rasional: syarat <6 bulan adalah **proxy** untuk "CVE tak ter-patch di kode yang jalan
    dalam proses kita + risiko ditinggalkan" — proxy itu **salah tembak** untuk kelas di atas. **Bukan** lisensi umum
    untuk dep npm/runtime basi: untuk `dependencies` npm, syarat <6 bulan tetap berlaku penuh, tanpa pengecualian.
    Tiap pemakaian pengecualian ini **wajib** punya ADR + entri di §"Binary vendored" + justifikasi (a)–(e) tertulis.
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

## Binary vendored (non-npm) — pin + verifikasi hash

> Binary yang **bukan** paket npm: tak masuk `node_modules`, tak pernah di-`require()`, tak jalan dalam proses kita.
> Aturan: **URL rilis resmi + versi + SHA256 di-pin di sini**; skrip install **wajib** verifikasi hash sebelum pakai
> (mismatch = abort, jangan lanjut). **Jangan commit binary ke repo** (unduh-saat-install; konsisten §"Egress build").

| Artefak | Versi | SHA256 | ADR |
|---|---|---|---|
| **WinSW** `WinSW.NET461.exe` (655.872 byte) — wrapper Windows Service, MIT | **v2.12.0** (28 Jan 2023) | `b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f` | ADR-021 + **ADR-025** |

**URL pin (WinSW):** `https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe`
**Fallback host tanpa .NET Framework** (belum dipakai; pin bila kasusnya muncul): `WinSW-x64.exe` self-contained 18 MB,
SHA256 `05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da` (dikonfirmasi bucket scoop Main).

**Status gate WinSW (17 Jul 2026 — LULUS dgn residual tercatat):**
1. **Syarat "rilis <6 bulan" DILANGGAR** (v2.12.0 = Jan 2023, 3,5 th) → **pengecualian §Prinsip dipakai**; justifikasi
   (a)–(e) lengkap di **ADR-025** (out-of-process; nol jaringan; hash-pinned; domain beku; 427.807 unduhan + lineage
   Jenkins/CloudBees). Repo **hidup** (commit Apr & Mei 2026, push 16 Jul 2026; 14.142 bintang; MIT; tak diarsipkan) —
   masalahnya **kadens rilis**, bukan proyek mati.
2. **Provenance (binary `NotSigned` — tak ada Authenticode → residual diterima):** ukuran cocok persis metadata aset
   GitHub API + binary menanam `ProductVersion 2.12.0+eef5bade…` yang tag `v2.12.0` tunjuk **persis commit itu** +
   **SHA256 dikonfirmasi ≥3 pihak-3 independen** di kode publik GitHub. Vendor **tak** menerbitkan hash resmi.
3. **Runtime terverifikasi empiris** di Windows 11 owner: .NET Framework **4.8.09221** (Release 533509) inbox → target
   4.6.1 jalan (binary dieksekusi, bukan asumsi).
4. **Egress:** unduh = **install-time** (diizinkan §"Egress build"). WinSW **runtime** tak menyentuh jaringan → tak
   menambah host ke whitelist egress NFR.
5. **⚠ Jebakan supply-chain:** ada repo mirip-nama **`WinSW-Windows/winsw-windows`** (0 bintang, dibuat Des 2024, bukan
   fork, tanpa deskripsi) — **BUKAN** WinSW asli. **Hanya** unduh dari URL pin di atas + verifikasi hash.
6. **Revisit trigger** (ADR-025): nabrak bug v2.12.0 (fix takkan ter-rilis — repo tak merilis sejak 2023) / proyek
   ditinggalkan / NET461 tak jalan → **servy = kandidat pertama** (ditolak sekarang: bus factor 1, umur 11 bulan).

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
