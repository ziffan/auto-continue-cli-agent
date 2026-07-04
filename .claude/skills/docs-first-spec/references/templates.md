# Template docs/ Suite

Skeleton per file. Isi dari hasil discovery/architecture/risk — jangan biarkan placeholder
kosong masuk commit. Bagian yang tidak relevan untuk proyek boleh dihapus dengan catatan.

---

## PROJECT.md

```markdown
# {Nama Proyek}

## Problem Statement
- Untuk siapa: {segmen spesifik}
- Masalah: {deskripsi}
- Biaya masalah: {angka — jam/bulan, Rp/bulan, atau frustrasi terukur}
- Ukuran sukses: {metrik konkret}
- Batasan (TIDAK dikerjakan): {daftar}

## User Persona
{profil, kemampuan teknis, kebiasaan sekarang, frustrasi, job-to-be-done}

## User Stories
### US-01: {judul} [Must|Nice|Later]
Sebagai {persona}, saya ingin {aksi}, supaya {manfaat}.
- Given {kondisi} When {aksi} Then {hasil}

## User Flow
1. {langkah} → 2. {langkah; cabang bila gagal: ...}

## Wireframe
{ASCII sketch per layar utama — wajib loading / empty / error state}

## Change Log
- {tanggal}: {perubahan + alasan}
```

## ARCHITECTURE.md

```markdown
# Arsitektur

## C4 Level 1 — System Context
{Mermaid: user + external systems + sistem sebagai 1 kotak}

## C4 Level 2 — Container
{Mermaid: frontend/backend/DB/queue + protokol antar kotak}

## Tech Stack
| Layer | Pilihan | Versi (pin) | ADR |
|---|---|---|---|

## Service/Port Map
{app 3000, PG 5432, dst — konsisten lintas mesin}
```

## DATA-MODEL.md

```markdown
# Data Model
{ERD Mermaid atau daftar tabel}
Aturan baku: money = bigint sen + currency_code · timestamptz UTC ·
soft delete (deleted_at) untuk data hukum/uang · tenant_id + RLS policy per tabel multi-tenant.
```

## DATA-FLOW.md

```markdown
# Data Flow
{per flow utama: sumber → validasi (di mana) → transformasi → penyimpanan → keluaran}
Tandai: titik enkripsi · sync vs async · data pribadi (rujuk legal/DATA-INVENTORY.md)
```

## NFR.md

```markdown
# Non-Functional Requirements
| Kategori | Target terukur | Cara verifikasi |
|---|---|---|
| Performance | API p95 < 200ms | load test milestone akhir |
| Availability | 99,5%/bulan | uptime monitor |
| Scalability | {N concurrent, N records} | seed test |
| Security | RLS aktif; audit log; encrypted at rest | checklist 5.1 + pentest self-service |
| Compliance | {UU PDP / PSE / sektor} | review pra-release |
```

## CAPACITY-PLAN.md

```markdown
# Capacity Plan
| Service | CPU | RAM | VRAM | Disk | Jalan di mesin |
|---|---|---|---|---|---|
Kesimpulan: {muat/tidak di target deploy; batas kapan harus pindah}
```

## FAILURE-MODES.md

```markdown
# Failure Modes
| Komponen | Failure mode | Penyebab | Dampak | Deteksi | Mitigasi | Milestone |
|---|---|---|---|---|---|---|
```

## SECURITY.md

```markdown
# Security & Threat Model

## Aset & threat actor
{data apa yang berharga; siapa penyerangnya}

## STRIDE
| Ancaman | Vektor | Mitigasi | Status |
|---|---|---|---|

## Agentic threats (bila ada komponen LLM)
{prompt injection · tool misuse · exfiltration · supply chain — mitigasi + cara test}

## Batas otonomi agent produk
{aksi yang boleh otomatis vs wajib approval}
```

## DEPENDENCY-POLICY.md

```markdown
# Dependency Policy
Kriteria (npm DAN MCP server/plugin/skill): perlu? maintained? populer? jumlah sub-deps?
vuln (`pnpm audit`)? license? Untuk MCP: permission diminta, data yang lewat, publisher.

## Approved
| Nama | Versi | Alasan | Tanggal |
## Rejected
| Nama | Alasan |
```

## DECISIONS.md

```markdown
# Decisions

## Locked
### D-001: {judul}
**Status**: Locked ({tanggal})
**Context**: {situasi + constraints}
**Decision**: {satu kalimat tegas}
**Consequences**: {positif + negatif}
**Alternatives rejected**: {opsi + alasan}

## Pending
| ID | Keputusan | Owner | Deadline |
|---|---|---|---|

## Obsolete / Change Log
| ID | Keputusan lama | Digantikan oleh | Alasan | Tanggal |
|---|---|---|---|---|

## JANGAN PERNAH
- {larangan keras proyek — hard deny untuk agent}
```

## MILESTONES.md

Lihat skill `vertical-slice` — format slice + test checklist per milestone.

## MAP.md

```markdown
# Peta Repo
{tree folder + fungsi tiap folder + file kunci + pola arsitektur yang dipakai}
```

## CONVENTIONS.md

```markdown
# Konvensi

## Penamaan
{file, komponen, tabel, branch (milestone-N-nama), commit (prefix milestone)}

## Pola DIWAJIBKAN
- Money = bigint sen + currency code. Tidak pernah float.
- Timestamp DB = timestamptz (server UTC). "Hari kalender" = date + companion timestamptz.
- Setiap mutation: validasi input server-side (Zod).
- Error operasional: custom Error class ber-code, bukan throw string.
- Soft delete + audit trail untuk data yang menyentuh kewajiban hukum/uang.
- Authz check eksplisit per endpoint. RLS di DB level.
- Semua teks user-facing via i18n (locales/), tidak hardcoded.

## Pola DILARANG
- `any` di TypeScript (kecuali third-party tanpa type, dengan komentar).
- Hardcode business/legal rules (harus configurable + versioned).
- Akses DB langsung dari UI.
- `@ts-ignore` tanpa penjelasan.
- Hard delete data ber-kewajiban retensi.
```

## CONTEXT.md

```markdown
# Context — {tanggal update terakhir}
**Spec**: {LOCKED per tanggal / draft}
**Milestone aktif**: {M-n nama} — {progress}
**Sesi terakhir**: {apa yang dikerjakan + hasil}
**Blocker**: {daftar atau "-"}
**Next**: {1-3 langkah berikutnya}
```

## ISSUES.md

```markdown
# Issues
### I-001: {judul}
Status: Open|In-progress|Resolved · Tipe: bug|tech-debt|question · Prioritas: P0-P3 · Milestone: {M-n}
Reproduksi: {langkah} · Expected vs actual: {…}
Solusi (saat resolve): {…} · Related: {…}
```

## GOTCHAS.md

```markdown
# Gotchas
### {tanggal}: {judul jebakan}
Gejala: {…} · Akar masalah: {…} · Solusi: {…} · Pencegahan: {…}
```

## legal/DATA-INVENTORY.md

```markdown
# Data Inventory
| Data | Kategori (pribadi/sensitif) | Tujuan | Dasar pemrosesan | Lokasi simpan | Retention | Akses |
|---|---|---|---|---|---|---|
Breach response: deteksi → containment → notifikasi ≤ 3×24 jam (otoritas + subjek data) → postmortem.
```

## INTEGRATION-CONTRACTS.md

```markdown
# Integration Contracts
{per pasangan service/konsumen: endpoint, request/response schema, error shape, idempotency,
versioning. REST → OpenAPI; internal → tRPC router type sebagai kontrak.}
```
