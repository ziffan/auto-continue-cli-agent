# BRANDING.md — identitas visual `acca`

> Design note untuk sentuhan visual di **README** dan **terminal** (`acca status` + splash).
> Status: **keputusan logo LOCKED** (18 Jul) · **banner-policy LOCKED → ADR-027** (18 Jul) · **web UI = pending, butuh PRD+TRD+ADR** sebelum kode.
> Ini dokumen desain, bukan spec implementasi. Gating banner (§5) kini di-lock ADR-027 → kode splash+inline-badge boleh dimulai (Tier-2).

---

## 1. Keputusan (ringkas)

| Hal | Keputusan | Status |
|---|---|---|
| Wordmark / brand (README, splash) | **Opsi 1 — "The Loop" (`cc` → ∞)** | LOCKED |
| Bahasa inline di `acca status` | **Opsi 3 — "The Gauge" (`▓░`)** | LOCKED |
| Kapan splash muncul | bukan tiap `status` — lihat §4 | **LOCKED → ADR-027** |
| Gating TTY / `NO_COLOR` / fallback | wajib, lihat §5 | **LOCKED → ADR-027** |
| Web UI monitor | read-only, localhost, opt-in — lihat §6 | pending → PRD+TRD+ADR |

Rasional: `∞` memikul **identitas** (auto-continue = kontinuitas), `▓░` memikul **data** (usage-view yang sudah ada). Keduanya tak bertabrakan — satu untuk brand, satu untuk baris data.

---

## 2. Anchor visual

Nama `a-c-c-a` punya **twin-c di tengah**. Itu ikon-nya. Semua turunan visual berangkat dari dua `c` itu.

Makna berlapis `cc`:

- **c**ontinue-**c**ontinue → auto-continue.
- **C**laude **C**ode (salah satu dari dua CLI yang dijaga).
- dua c saling-punggung = loop tak berujung = sesi tak pernah putus karena limit.

---

## 3. Logo — bentuk terpilih

### 3.1 Wordmark / splash (Opsi 1 — Loop ∞)

Splash penuh (sekali-muncul; lihat §4 untuk kapan):

```
  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
  ┃   a ( c∞c ) a   ·  acca     ┃
  ┃   auto-continue cli agent   ┃
  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

Varian ASCII-only (fallback Windows legacy / `NO_COLOR` / terminal tanpa glyph):

```
  +-----------------------------+
  |   a ( c<>c ) a   ·  acca     |
  |   auto-continue cli agent   |
  +-----------------------------+
```

Tagline resmi: **"never lose a session to a limit."**

### 3.2 Inline di README (badge teks)

Satu baris di header README, di atas judul:

```
a·c∞c·a  ·  acca — usage-aware auto-continue for Claude Code & Antigravity CLI
```

### 3.3 Inline di `acca status` (Opsi 3 — Gauge ▓)

Satu baris header, **TTY-only**, memakai ulang bahasa `▓░` yang sudah ada di usage-view:

```
acca ▓▓▓░░ — auto-continue on reset
```

Fallback ASCII: `acca [###..] — auto-continue on reset`.

Prinsip: di `status`, logo **melebur ke bahasa data**, bukan blok terpisah. Tak menambah baris multi-line yang merusak pipe/snapshot.

---

## 4. Kapan muncul (placement policy)

Splash besar cocok untuk momen "kenalan" yang jarang — **bukan** tiap kali cek status.

| Lokasi | Tampilkan | Alasan |
|---|---|---|
| `acca` (tanpa subcommand) / `--help` | Splash penuh (§3.1) | Momen kenalan, jarang |
| `acca --version` | Splash penuh | idem |
| `acca daemon` saat start | Splash penuh, **sekali** | Menandai daemon hidup |
| `acca status` (ada sesi) | **1 baris inline** (§3.3), **TTY-only** | Sering dipakai; jaga pipe-friendly |
| `acca status` (empty-state) | Boleh splash | Sudah jalur onboarding di kode |

### Alasan menolak "splash di tiap `acca status`"

1. `status` sering dipanggil & bisa di-`pipe`/`grep` → banner multi-baris = noise.
2. Output `status` **di-snapshot** (`test/status-usage.test.ts`) & bisa di-scrape → banner di jalur yang sama memaksa update snapshot + merusak parser hilir.
3. Least-astonishment: identitas dilihat sekali, data dilihat sering.

---

## 5. Gating (wajib — bukan opsional)

Aturan ini yang membedakan "sentuhan desain" dari "regresi UX". **Di-lock ADR-027 (18 Jul)** — implementasi wajib memenuhi semua poin di bawah.

- **TTY-only.** Warna/banner dicetak **hanya bila `process.stdout.isTTY`**. Di-redirect/pipe → plain, tanpa ANSI, tanpa banner.
- **Hormati `NO_COLOR`.** Env standar; bila set → nonaktifkan warna.
- **Flag escape.** Sediakan `--plain` / `--no-banner` untuk mematikan eksplisit.
- **ASCII fallback.** Glyph non-ASCII harus punya padanan: `∞`→`<>`, `▓░`→`#.`, box-drawing→`+-|`. Terminal Windows legacy / locale non-UTF8 tak boleh menampilkan mojibake.
- **Zero dependency baru.** Jangan tarik `chalk`/`kleur`. Cukup helper ANSI kecil (~20 baris) di `src/shared/` — sejalan pola `stripAnsi` yang sudah ada + `docs/DEPENDENCY-POLICY.md`.
- **Pure-function friendly.** Banner/inline-badge dibuat sebagai fungsi pure yang inject `isTTY`/`noColor` (mengikuti pola `formatDaemonLiveness(hb, now, isAlive)`), supaya unit-testable tanpa TTY nyata dan tak mengganggu snapshot data `status`.

---

## 6. Rencana web UI (nanti — sketsa, belum spec)

Arsitektur eksisting mendukung dashboard read-only murah: SQLite store, daemon long-running, `src/shared/http.ts`, dan formatter pure (`formatUsageLines`, `formatResetCell`, `formatDaemonLiveness`) yang tinggal di-serve sebagai JSON.

Arah yang disarankan (semua tunduk ADR sebelum kode):

- **Read-only dulu.** Konsisten dengan "human-in-the-loop, never autonomous" (ADR-008/013). Aksi kontrol (`resume/cancel`) menyusul **dengan konfirmasi eksplisit** — web tak boleh jadi jalan pintas yang melewati injection-firewall.
- **Bind `127.0.0.1` saja.** Data sensitif (transcript path, cwd). Bukan `0.0.0.0`. Akses LAN ⇒ wajib token + masuk `docs/THREAT-MODEL.md` sebagai ingress baru.
- **Zero-framework.** `http.createServer` serve satu `index.html` statis + `GET /api/status` (baca repo yang sama). Poll ~5s atau SSE. Tanpa React/build-step.
- **Opt-in.** `acca daemon --web` atau `acca web`, default mati. **Port configurable**, jangan hardcode.
- **Isi v1:** usage bar dua CLI + reset countdown, daemon liveness, tabel sesi, tail event-log. Mirror `status`, auto-refresh.
- **Visual header:** cocok pakai varian "Pulse ∿" (konsep Opsi 2 yang tak dipakai di CLI) — pulse-line yang datar saat idle, spike saat limit-hit/resume.

Modul baru ⇒ butuh **PRD+TRD + ADR** (port, bind, auth, konsistensi egress/threat-model). Catat sebagai **pending decision** di `docs/CONTEXT.md`, jangan dikerjakan sekarang.

---

## 7. Opsi yang tidak dipilih (arsip, jangan dihapus diam-diam)

Disimpan supaya keputusan bisa di-revisit dengan konteks penuh.

### Opsi 2 — "Pulse / Monitor" (∿)

```
   a c c a  ·  acca
   ╌╌╱╲╌╌╱╲╌╌╌╌  supervisor for long agent runs
```

Story: heartbeat/monitoring (nyambung ke `formatDaemonLiveness`). **Tak dipakai di CLI** karena makna "auto-continue" lebih lemah dari Opsi 1 — **dipindah jadi kandidat visual web UI** (§6).

### Opsi 3 sebagai splash (ditolak sebagai splash, dipakai sebagai inline)

`a ◖◗ a` + `[▓▓▓▓▓░░░]` — bagus sebagai bahasa data, terlalu generic sebagai wordmark. Karena itu perannya dibatasi ke baris inline `status` (§3.3), bukan brand utama.

---

## Change Log

| Tanggal | Perubahan |
|---|---|
| 2026-07-18 | Dokumen dibuat. Logo LOCKED: Opsi 1 wordmark + Opsi 3 inline. Banner-policy & web UI ditandai pending (butuh ADR). |
| 2026-07-18 | **Banner-policy (§4 placement + §5 gating) di-LOCK → ADR-027.** Kode splash+inline-badge boleh dimulai (Tier-2). Web UI (§6) tetap pending — butuh PRD+TRD+ADR terpisah. |
