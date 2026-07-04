---
name: adr
description: >-
  Buat, supersede, atau tinjau Architecture Decision Record (format Nygard) dan tegakkan
  decision discipline locked/pending/obsolete di DECISIONS.md. Gunakan saat ada keputusan
  struktural baru (stack, auth, multi-tenancy, deployment, data retention, model routing,
  batas otonomi agent), saat user atau agent lain mengusulkan mengubah keputusan yang sudah
  Locked (ingatkan dan minta justifikasi revisit formal), saat user tampak goyah terhadap
  keputusan lama, atau saat menemukan keputusan penting yang belum tercatat.
argument-hint: "[judul keputusan]"
---

# ADR & Decision Discipline

Kenapa ini penting: agent tidak ingat sesi sebelumnya, dan sesi makin banyak. Tanpa
DECISIONS.md yang ditegakkan, keputusan yang sama di-relitigasi berulang — dengan lawan
debat yang selalu segar dan persuasif. File ini adalah pertahanannya.

## Step 0 — Selalu cek DECISIONS.md dulu

Sebelum menulis apa pun, baca `docs/DECISIONS.md` (atau `docs/adr/`):

- Topik sudah ada dan **Locked** → JANGAN buat ADR baru diam-diam. Tunjukkan keputusan
  lama ke user, lalu tanya: ada alasan revisit formal? Tanpa justifikasi eksplisit
  (fakta baru, constraint berubah, insiden), pertahankan keputusan lama dan katakan itu.
- Topik ada dan **Pending** → lanjut proses memutuskan, tutup pending-nya.
- Topik baru → lanjut Step 1.

## Step 1 — Tulis ADR (format Nygard)

```markdown
# ADR-{NNN}: {Judul — kalimat keputusan, bukan topik}

## Status
Proposed | Accepted | Deprecated | Superseded by ADR-{XXX}

## Context
{Situasi, constraints, forces. Fakta — versi library diverifikasi via web saat lock,
bukan dari ingatan. Sebutkan angka bila ada (biaya, latensi, limit).}

## Decision
{Satu kalimat tegas, kalimat aktif: "Kami memakai X untuk Y."}

## Consequences
{Positif DAN negatif. Konsekuensi negatif yang jujur = tanda ADR matang.}

## Alternatives Rejected
{Tiap opsi + alasan spesifik ditolak — supaya tidak diusulkan ulang oleh sesi berikutnya.}
```

Aturan penulisan: satu ADR = satu keputusan. Nomor urut, tidak didaur ulang.
Simpan di `docs/adr/ADR-NNN-{slug}.md`, atau sebagai entri `D-NNN` di `docs/DECISIONS.md`
untuk proyek kecil — ikuti konvensi yang sudah ada di repo.

## Step 2 — Update DECISIONS.md

Tiga kategori, tegakkan tanpa kecuali:

| Kategori | Aturan |
|---|---|
| **Locked** | Accepted + disepakati user. Tidak di-revisit tanpa justifikasi formal. Immutable — revisi = ADR baru yang men-supersede. |
| **Pending** | Belum diputuskan. WAJIB punya owner + deadline. Tanpa keduanya, entri belum sah. |
| **Obsolete** | Di-supersede. JANGAN dihapus — pindah ke Change Log dengan alasan dan pointer ke penggantinya. |

## Step 3 — Cek kelengkapan set minimal

Setiap proyek minimal punya ADR untuk: monolith vs services · stack utama (+ pin versi) ·
auth approach · multi-tenancy model · deployment · data retention ·
**model routing policy** (model/effort per jenis task + budget API per bulan) ·
**batas otonomi agent** (aksi auto vs wajib manual approval).
Bila proyek menyentuh data pribadi: + **lokasi data** (Indonesia vs asing, dengan alasan).

Ada yang belum? Laporkan sebagai Pending + usulkan owner (biasanya user) + deadline.

## Alur supersede

1. Tulis ADR baru dengan Context yang menjelaskan kenapa keputusan lama tidak lagi tepat.
2. Status ADR lama → `Superseded by ADR-{baru}`. Isi lama TIDAK diedit.
3. Pindahkan entri lama di DECISIONS.md ke Obsolete/Change Log.
4. Cek dampak: file docs lain yang merujuk keputusan lama (ARCHITECTURE, CONVENTIONS,
   MILESTONES) → update + catat di Change Log masing-masing.

## Output wajib ke user

ADR lengkap + posisi barunya di DECISIONS.md + daftar dokumen lain yang ikut diubah.
Bila menolak revisit: kutip keputusan Locked + tanggalnya + alasan aslinya.
