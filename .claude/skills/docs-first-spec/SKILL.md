---
name: docs-first-spec
description: >-
  Jalankan fase perencanaan doc-first sampai spec lock: discovery (problem statement,
  persona, user stories, flow, wireframe), architecture decision (C4, ADR, NFR,
  integration contract), risk planning (capacity, failure modes, threat model,
  dependency policy), compliance Indonesia, lalu generate docs/ suite lengkap.
  Gunakan setiap kali memulai proyek atau modul baru, saat user minta PRD/TRD/spec/
  perencanaan ("buat spec", "rencanakan fitur X", "mulai proyek"), ATAU saat user
  minta implementasi fitur kompleks yang belum punya spec — tawarkan skill ini dulu,
  jangan langsung menulis kode.
argument-hint: "[nama proyek atau modul]"
---

# Docs-First Spec

Prinsip: **spec di-lock sebelum implementasi.** Agent fleet mengeksekusi spec secara
paralel — kesalahan spec dikalikan oleh jumlah subagent, bukan ditambahkan. Karena itu
DILARANG menulis kode aplikasi selama skill ini berjalan. Output skill ini adalah
dokumen di `docs/`, bukan kode.

Alokasi wajar: 2-4 jam perencanaan untuk proyek sederhana sebelum kode pertama.

## Step 0 — Mode & kondisi awal

1. Cek isi `docs/` yang sudah ada. Jangan overwrite — lakukan gap analysis, isi yang kosong,
   perbarui yang usang dengan Change Log.
2. Baca `DECISIONS.md` bila ada. Keputusan **Locked** adalah constraint kerja, bukan bahan
   diskusi ulang. Kalau spec baru bentrok dengan locked decision, berhenti dan pakai skill `adr`.
3. Tentukan mode:
   - **Proyek baru** → jalankan Step 1-7 penuh.
   - **Modul/fitur baru di proyek berjalan** → PRD+TRD modul: Step 1 dipersempit ke modul,
     Step 2 hanya delta arsitektur (+ ADR baru bila ada keputusan struktural), Step 5 update
     file terdampak saja, lalu Step 6-7.

## Step 1 — Discovery → `docs/PROJECT.md`

Enam artefak sequential. Interogasi user secara bertahap — maksimal 3-4 pertanyaan per giliran,
jangan borong 20 pertanyaan. Pakai jawaban user apa adanya; jangan mengarang angka.

| # | Artefak | Wajib memuat |
|---|---|---|
| 1 | Problem Statement | Untuk siapa (spesifik) · masalah + **biaya masalah dalam angka** (waktu/uang/frustrasi) · ukuran sukses (metrik) · batasan (yang TIDAK dikerjakan) |
| 2 | User Persona | Profil, kemampuan teknis, kebiasaan sekarang, frustrasi, job-to-be-done |
| 3 | User Stories | Format Connextra + acceptance criteria Given/When/Then. Klasifikasi Must (MVP) / Nice (v1) / Later (v2+) |
| 4 | User Flow | Numbered list dengan branching, atau Mermaid |
| 5 | Wireframe low-fi | ASCII/Markdown sketch per layar utama — ini "prompt visual" yang dibaca agent secara akurat |
| 6 | Acceptance Criteria | Melekat di tiap story; kelak jadi test checklist milestone |

Aturan keras: problem statement tanpa biaya masalah terukur = discovery belum selesai.
Angka kasar boleh, kosong tidak — tanpa angka tidak ada dasar pricing dan validasi.

## Step 2 — Architecture → `docs/ARCHITECTURE.md` + ADR + `docs/NFR.md`

1. **C4 level 1 dan 2** (Mermaid): System Context lalu Container (frontend/backend/DB/queue
   + protokol antar kotak). Level 3-4 hanya bila kompleksitas menuntut.
2. **Data Flow Diagram**: di mana data divalidasi, ditransformasi, di-encrypt; mana sync vs async.
3. **ADR ronde pertama** — delegasikan penulisannya ke skill `adr`. Minimal wajib:
   monolith vs services · stack utama (pin versi eksak saat lock — verifikasi versi terkini
   via web, jangan dari ingatan) · auth approach · multi-tenancy model · deployment ·
   data retention · **model routing policy** (model apa untuk task apa + budget/bulan) ·
   **batas otonomi agent** (apa yang boleh auto, apa yang wajib manual approval).
4. **NFR** — tidak terukur = tidak ada. Tabel target: performance (mis. API p95 < 200ms;
   LLM first token < 3s, streaming wajib), availability (99,5% realistis untuk solo ops),
   scalability (concurrent users, records, growth/tahun), security (auth, encrypted at rest,
   RLS aktif, audit log), compliance (UU PDP, PSE bila qualifies, sektor).
5. **Integration contract** bila sistem > 1 service atau ada konsumen eksternal: definisikan
   request/response SEBELUM coding (OpenAPI untuk REST; tRPC router type untuk internal).
   Kontrak inilah yang membuat subagent frontend dan backend bisa jalan paralel tanpa tabrakan.

Default arsitektur yang tidak dinegosiasikan tanpa ADR eksplisit: multi-tenancy + RLS dari
day 1 untuk app multi-user (retrofit RLS sangat sulit) · money = bigint sen + currency code ·
timestamp DB = timestamptz UTC · soft delete + audit trail untuk data hukum/uang ·
configuration over hardcoding untuk rules/rates/legal rules (versioned).

## Step 3 — Risk Planning

1. `docs/CAPACITY-PLAN.md` — CPU/RAM/VRAM/disk/network per service vs hardware tersedia;
   sebutkan target jalan di mesin mana.
2. `docs/FAILURE-MODES.md` — per komponen: failure mode → penyebab → dampak → deteksi →
   mitigasi → **milestone tempat mitigasi dikerjakan** (supaya tidak jadi wacana).
3. Threat model → `docs/SECURITY.md` — STRIDE untuk ancaman klasik, PLUS kelas agentic
   bila app memuat komponen LLM/agent:

| Ancaman | Mitigasi minimum |
|---|---|
| Prompt injection (via dokumen/data retrieved, metadata, nama file) | Konten retrieved = data, bukan perintah; instruction boundary; output filtering; payload injection masuk eval |
| Tool misuse / excessive agency | Least-privilege per tool; approval untuk aksi irreversible; scoping per tenant |
| Data exfiltration via agent | Egress allowlist; tak ada data sensitif di URL param; log semua tool call |
| Supply chain AI-era (slopsquatting, MCP/plugin jahat) | Verifikasi eksistensi + reputasi package sebelum install; vet MCP server seperti dependency |

4. `docs/DEPENDENCY-POLICY.md` — kriteria approve/reject; berlaku untuk npm package DAN
   MCP server/plugin/skill (permission yang diminta, data yang lewat, publisher).

## Step 4 — Compliance Indonesia (bila menyentuh data pribadi/finansial)

Wajib, bukan opsional, untuk app yang memproses data pribadi:

1. `docs/legal/DATA-INVENTORY.md` — data apa, tujuan, lokasi penyimpanan, retention.
2. Keputusan **lokasi data** masuk ADR. Posisi paling defensible untuk data sensitif
   Indonesia: simpan di Indonesia (cloud lokal / on-prem) selama standar adequacy belum ada.
3. Rencana pendaftaran **PSE Komdigi** saat launch publik — jangan tunda sampai "produk besar";
   enforcement aktif.
4. Hak subjek data → masukkan ke backlog fitur: privacy policy, consent granular + cabut,
   export data, delete account (real/anonymize), breach response plan 3×24 jam.
5. Sektor lebih ketat dari UU PDP (OJK/BI/Kemenkes/MA) — sektor menang. Rujuk sumber primer
   (peraturan.bpk.go.id, pse.komdigi.go.id, ojk.go.id), bukan blog hukum.

## Step 5 — Generate `docs/` suite

Baca `references/templates.md` untuk skeleton tiap file, lalu isi dari hasil Step 1-4.
Suite minimal MVP:

```
docs/
├── PROJECT.md          ├── NFR.md                ├── MILESTONES.md
├── ARCHITECTURE.md     ├── CAPACITY-PLAN.md      ├── MAP.md
├── DATA-MODEL.md       ├── FAILURE-MODES.md      ├── CONVENTIONS.md
├── DATA-FLOW.md        ├── SECURITY.md           ├── CONTEXT.md
├── DECISIONS.md        ├── DEPENDENCY-POLICY.md  ├── ISSUES.md / GOTCHAS.md
└── (legal/DATA-INVENTORY.md bila relevan; INTEGRATION-CONTRACTS.md bila >1 service)
```

Hierarki dependency (tulis dalam urutan ini): PROJECT → ARCHITECTURE (+DECISIONS) →
DATA-FLOW/MODEL/CONTRACTS → NFR/CAPACITY/FAILURE/SECURITY → MILESTONES → MAP + CONVENTIONS.

Aturan menulis — dokumen ini dikonsumsi agent, bukan hanya manusia:
satu ide per kalimat · kalimat ≤ 20 kata · paragraf ≤ 3 kalimat · constraint eksplisit
dengan HARUS/DILARANG · contoh input-output untuk hal ambigu · code block selalu berlabel bahasa.

## Step 6 — Milestone breakdown

Panggil skill `vertical-slice` untuk memecah scope MVP menjadi milestone berisi atomic
vertical slices di `docs/MILESTONES.md`. Jangan membuat task per-layer.

## Step 7 — Gate: SPEC LOCK

Spec dinyatakan LOCKED hanya bila semua tercentang:

```
□ Problem statement + biaya masalah dalam angka
□ ADR ronde pertama lengkap (termasuk model routing + batas otonomi agent)
□ NFR semua terukur
□ Threat model termasuk kelas agentic (bila ada komponen LLM)
□ docs/ suite terisi sesuai hierarki
□ MILESTONES.md berisi vertical slices dengan kriteria selesai testable
□ Bila data pribadi: DATA-INVENTORY + lokasi data di ADR + rencana PSE
□ Semua pending decision tercatat di DECISIONS.md + owner + deadline
```

Setelah lock, tulis di `docs/CONTEXT.md`: `Spec LOCKED per <tanggal>`. Konsekuensi lock:
ADR Accepted immutable (revisi = supersede via skill `adr`); PROJECT.md hanya berubah
dengan entri Change Log; implementasi boleh dimulai.

Ada item belum tercentang → laporkan sebagai gap + siapa yang harus memutuskan + deadline.
Jangan menyatakan lock sebagian.

## Output wajib ke user

1. Daftar file yang dibuat/diubah.
2. Daftar pending decisions (owner + deadline).
3. Status: LOCKED, atau daftar gap yang menghalangi lock.
