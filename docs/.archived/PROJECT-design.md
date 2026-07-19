# PROJECT — arsip §4 User Flow + §5 Wireframe (dipindah 2026-07-19)

> Dipindah dari `docs/PROJECT.md` saat pelangsingan 19 Jul (nol hard-delete). Alur happy-path
> auto-continue + resume-by-id + sub-flow remote Telegram (ditunda) + wireframe low-fi CLI/web.
> Fitur sudah dibangun (CLI/web) atau ditunda (Telegram). Greppable, di luar jalur session-start.

## 4. User Flow

Alur utama (happy path) auto-continue:

```
1. User menjalankan sesi agent di bawah supervisor:  `acca run -- claude`  (atau `acca run -- antigravity`)
2. Supervisor spawn CLI (via PTY wrapper), catat: tool, session-id, cwd, PID.
3. Sesi berjalan normal → user kerja seperti biasa.
4. CLI kehabisan limit:
   ├─ Sinyal terdeteksi (hook StopFailure [CC] / pesan output / exit code [print-mode] / transcript)
   └─ Supervisor set status = LIMIT_HIT, catat waktu + sumber sinyal + kondisi proses (hidup|exit).
      (Sesi interaktif biasanya TETAP HIDUP idle di prompt — RESEARCH §2c.)
5. Tentukan reset_at:
   ├─ Ada sinyal pasti (retry-after / header)?  → pakai itu.
   └─ Tidak ada?  → heuristik window 5-jam + fallback backoff, tandai "perkiraan".
6. Supervisor kirim notifikasi: "Sesi X kena limit. Rencana resume ~ reset_at."
7. Tunggu sampai reset_at (timer terjadwal; tahan lintas restart supervisor).
8. Pada reset_at → probe usage (kuota tersedia?).
   ├─ Ya  → lanjut ke 9.
   └─ Tidak (mis. kuota mingguan habis) → jadwal ulang dengan backoff, notifikasi, kembali ke 7.
9. Auto-continue, sesuai kondisi proses:
   ├─ Proses masih hidup di prompt → inject "continue" ke PTY (gating: foreground benar + idle).
   └─ Proses sudah mati → cd ke cwd asli → jalankan perintah resume yang benar untuk tool itu.
10. Status = RESUMED, kirim notifikasi sukses. Kembali ke 3.
```

Cabang error:
- **PTY/proses mati bukan karena limit** → status `EXITED` (bukan `LIMIT_HIT`); tidak auto-resume, notifikasi.
- **Resume gagal N kali** → status `FAILED`, stop auto-retry, notifikasi minta intervensi manual.
- **Working directory asli hilang/berubah** → jangan resume di tempat salah; status `BLOCKED`, notifikasi.
- **Supervisor sendiri restart** → recover state terjadwal dari store, lanjutkan timer yang belum jatuh tempo.

### Alur remote-control Telegram (MVP tier A+B+C — ADR-011/012/013; threat model: THREAT-MODEL.md)

Berbagi satu bot Telegram (long-polling, outbound-only ke `api.telegram.org`). Prinsip:
**human-in-the-loop, never autonomous.**

```
A. NOTIF KELUAR (tier A):
   transisi status (LIMIT_HIT/RESUMED/FAILED) → Notifier kirim pesan ke chat_id terotorisasi.

B. KONTROL MASUK (tier B):
   getUpdates → pesan masuk
   ├─ chat_id DI allowlist?  ── tidak ─▶ DROP + audit (events). Selesai.
   └─ ya → perintah ∈ whitelist {status, resume-now <id>, cancel <id>}?
           ├─ ya  → eksekusi via IPC yang sama seperti CLI lokal → balas hasil. Audit.
           └─ tidak → tolak ("perintah tak dikenal"). Audit.

C. RELAY-INSTRUKSI (tier C — wajib gerbang konfirmasi):
   instruksi dari chat_id terotorisasi
   → QUEUE + echo balik ke user ("akan inject: «…», balas /confirm <token>")
   → user balas /confirm <token>?
     ├─ ya  → inject ke PTY sesi (gating foreground+idle). Audit tiap langkah.
     └─ tidak / timeout → BUANG dari queue, tak ada inject. Audit.
   * Tanpa konfirmasi TAK ADA inject. Isi output agent = data, tak pernah jadi perintah (injection firewall).

D. LIHAT OUTPUT (tier C — egress sensitif, opt-in):
   sesi di-opt-in stream? ── tidak ─▶ tolak (default tak stream).
   └─ ya → ambil cuplikan → REDAKSI rahasia + SIZE-CAP → label "data tak tepercaya" → kirim.
```

Cabang error remote:
- **Sender tak terotorisasi** → drop + audit; tak pernah eksekusi (default-deny, ADR-012).
- **Token konfirmasi kadaluarsa/salah** → instruksi tetap di queue/dibuang; tak ada inject (ADR-013).
- **Egress non-Telegram terdeteksi** → blokir (whitelist egress, NFR §Security).

---

## 5. Wireframe low-fi (CLI)

`acca status` — tampilan monitor:

```
┌─ auto-continue-cli-agent ───────────────────────────── 02 Jul 2026 23:10 WIB ─┐
│                                                                                │
│  CLAUDE CODE                                    ANTIGRAVITY CLI                 │
│  5h window : ▓▓▓▓▓▓▓░░  ~78%                     5h window : ▓▓▓░░░░░░  ~31%      │
│  weekly    : ▓▓▓▓▓░░░░  ~54%                     weekly    : ▓▓▓▓▓▓▓▓░  ~86%      │
│                                                                                │
│  SESI                                                                          │
│  ● run   #a1b2  claude       ~/proj/lexharmoni     RUNNING                      │
│  ⏸ wait  #c3d4  claude       ~/proj/chunklab       LIMIT_HIT → resume 03:15 WIB │
│  ⏸ wait  #e5f6  antigravity  ~/proj/acca           LIMIT_HIT → resume ~Sen (wk) │
│  ✓ done  #g7h8  claude       ~/proj/tmp            RESUMED 22:40 (auto)         │
│                                                                                │
│  [q] quit   [l] log   [r] resume-now <id>   [k] cancel <id>                     │
└────────────────────────────────────────────────────────────────────────────┘
```

Catatan: angka usage adalah **best-effort** (lihat RESEARCH.md — header tidak selalu tersedia);
tampilkan indikator "perkiraan" bila sumbernya heuristik, bukan data pasti. Loading/empty/error state
wajib eksplisit (mis. "belum ada sesi termonitor", "gagal baca usage — tampilkan terakhir diketahui").

Web UI monitor (browser lokal `http://127.0.0.1:<port>`, opt-in `acca web` — read-only, ADR-028):

```
┌─ acca ▓▓▓░░ · auto-continue on reset ──────────── 127.0.0.1:4599 · ⟳ 5s ─┐
│                                                                          │
│  CLAUDE CODE               diperbarui 12s lalu   daemon: ● HIDUP (pid …) │
│    session     ▓▓▓▓▓▓▓░░░  74%                                           │
│    weekly_all  ▓▓▓▓▓░░░░░  54%                                           │
│  ANTIGRAVITY CLI           diperbarui 12s lalu                           │
│    5h          ▓▓▓░░░░░░░  31%      weekly  ▓▓▓▓▓▓▓▓░░  86%               │
│                                                                          │
│  SESI                                                                    │
│  #a1b2  claude       RUNNING     alive  pid 1234   reset —               │
│  #c3d4  claude       LIMIT_HIT   exited pid —      reset 03:15           │
│  #e5f6  antigravity  LIMIT_HIT   exited pid —      reset Sen 09:00 (wk)  │
│                                                                          │
│  EVENT LOG (tail)                                                        │
│  23:10:04  #c3d4  status_change  to=LIMIT_HIT source=verify              │
│  23:10:41  #c3d4  resume_spawned  jobId=… newSessionId=…                 │
└──────────────────────────────────────────────────────────────────────────┘
```

Catatan: tabel sesi web **TIDAK** menampilkan `cwd` maupun `cli_session_id` (proyeksi ter-firewall
`toSessionStatusView` — endpoint loopback bisa dijangkau proses lokal lain, T-W1). Event log = `formatEventLine`
(allowlist field terkontrol, nol payload mentah). Nol tombol aksi (read-only v1).

Interaksi Telegram (mobile) — tier A notif + tier B/C kontrol (ADR-011/012/013):

```
┌─ acca-bot ───────────────── 03:15 ─┐   ┌─ acca-bot ───────────────── 03:16 ─┐
│                                    │   │                                    │
│  🤖  #c3d4 claude ~/proj/chunklab  │   │  🧑  resume-now c3d4               │   ← tier B (whitelist)
│      LIMIT_HIT → resume ~03:15 WIB │   │                                    │
│                          (tier A)  │   │  🤖  ✓ #c3d4 RESUMED 03:16 (auto)  │
│                                    │   │                                    │
│  🤖  ✓ #c3d4 RESUMED 03:16 (auto)  │   │  🧑  send c3d4: "jalankan test"    │   ← tier C (relay)
│                                    │   │  🤖  ⚠ Akan inject ke #c3d4:        │
│  ────────────────────────────────  │   │      «jalankan test»               │
│  [ status ]  [ resume-now ]        │   │      Balas /confirm 7f3a utk lanjut │   ← gerbang konfirmasi
│  [ cancel ]                        │   │  🧑  /confirm 7f3a                  │
│                                    │   │  🤖  ↪ ter-inject. (audit: events) │
│  ┌──────────────────────────────┐  │   │                                    │
│  │ ketik perintah…              │  │   │  🚫 pengirim tak dikenal → di-drop │   ← default-deny
│  └──────────────────────────────┘  │   │     + audit (tak terlihat user)    │
└────────────────────────────────────┘   └────────────────────────────────────┘
```

Catatan Telegram: **tanpa `/confirm` tak ada inject** (human-in-the-loop). Cuplikan output (tier C) hanya
tampil bila sesi di-**opt-in**, sudah **diredaksi** + **size-capped**, diberi label "data tak tepercaya".
Pesan dari `chat_id` tak terotorisasi **tak pernah** membuahkan aksi (di-drop + di-audit, senyap).

