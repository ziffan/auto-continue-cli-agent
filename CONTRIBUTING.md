# Contributing

> **English:** `acca` is a solo-maintained, non-commercial project published mainly as a
> **worked example** of a doc-first workflow (see [README §Metodologi](README.md#metodologi-doc-first-repo-ini-sebagai-demonstrasi)).
> It is not looking for routine external contributions. You are very welcome to **read, fork, and
> reuse it** under the [Apache 2.0 license](LICENSE). For **security issues**, use private reporting —
> see [`SECURITY.md`](SECURITY.md), not a public issue.

Terima kasih sudah menengok repo ini. Perlu jujur di depan soal apa yang repo ini *adalah* dan *bukan*,
supaya waktumu tak terbuang.

## Apa repo ini

`acca` di-maintain **solo**, **non-komersial**, dan dipublikasikan terutama sebagai **artefak
demonstrasi** dari metode kerja *doc-first* yang dibahas di [kampusmerah.com](https://kampusmerah.com).
Nilai utamanya buat pembaca luar bukan "alat siap-pakai untuk semua orang", tapi **jejak keputusan yang
bisa diperiksa apa adanya** — ADR, gotcha, threat model, dan ritual kerja yang ikut di-version-control.

## Kontribusi eksternal

Repo ini **tidak menerima pull request eksternal secara rutin.** Bukan karena tak menghargai — tapi
karena arah, scope, dan keputusan arsitekturnya sengaja dipegang satu orang sebagai bagian dari
eksperimen metode (setiap keputusan lewat ADR; lihat [`docs/DECISIONS.md`](docs/DECISIONS.md)). PR yang
tak diminta kemungkinan besar tidak di-merge.

Yang **dipersilakan** dan justru diharapkan:

- **Fork & pakai ulang.** Lisensi Apache 2.0 (+ patent grant) memang untuk itu — lihat [`NOTICE`](NOTICE)
  untuk atribusi yang wajib ikut terdistribusi (§4d).
- **Belajar dari metodenya.** Kalau kamu datang dari tulisan di kampusmerah.com, mulai dari
  [`README.md`](README.md) → [`docs/PROJECT.md`](docs/PROJECT.md) → [`docs/DECISIONS.md`](docs/DECISIONS.md).
- **Melaporkan kerentanan keamanan** — lewat jalur privat, **bukan** issue publik. Lihat
  [`SECURITY.md`](SECURITY.md).

## Kalau tetap ingin mengusulkan sesuatu

Buka **diskusi dulu** (bukan langsung PR besar) dan jaga harapan tetap rendah soal merge. Sertakan
konteks yang cukup: masalah apa, kenapa, dan bagaimana ia cocok/berbenturan dengan keputusan yang sudah
*Locked* di [`docs/DECISIONS.md`](docs/DECISIONS.md) (ADR ber-status *Accepted* itu immutable — perubahan =
ADR baru yang men-supersede, bukan edit di tempat).

## Tracker

Pelacakan kerja **internal** ada di [`docs/ISSUES.md`](docs/ISSUES.md) (ID `I-`/`W-`/`F-`) dan status
per-sesi di [`docs/CONTEXT.md`](docs/CONTEXT.md) — bukan di GitHub Issues. Ini bagian dari metode
doc-first: keputusan dan status hidup di dokumen ter-version-control, bukan di tracker eksternal.

## Lisensi kontribusi

Dengan mengirim materi apa pun ke repo ini, kamu setuju materi itu dilisensikan di bawah
[Apache License 2.0](LICENSE) yang sama dengan proyek ini.
