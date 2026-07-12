import type { Tool, UsageSnapshot } from '../shared/types.js';

/** Spesifikasi proses yang akan di-spawn oleh wrapper PTY. `cwd` opsional — WAJIB diisi untuk
 * jalur resume-by-id (AC-8: proses dilanjutkan harus di direktori kerja sesi asli). */
export interface SpawnSpec {
  file: string;
  args: string[];
  cwd?: string;
}

/** Klasifikasi hasil deteksi. `overload` = transient (429/5xx) — bukan usage-limit (RESEARCH §2c). */
export type DetectKind = 'limit' | 'overload' | 'none';

/** Sumber sinyal yang menghasilkan klasifikasi (audit — kolom `sessions.detect_source`). */
export type DetectSource = 'stopfailure' | 'output' | 'exitcode' | 'transcript';

/** Hint waktu-reset yang terparse dari sebuah sinyal; diteruskan ke reset-estimator. */
export interface ResetHint {
  isoTimestamp?: string; // ISO-8601 (api/oauth/usage, LS) → exact
  epochSeconds?: number; // statusLine → exact
  clockTime?: string; // "3pm" / "2:30pm" dari output → exact (butuh resolusi tz)
  timezone?: string; // "UTC" | "America/New_York" | "Europe/Dublin" | ...
  relativeHours?: number; // "try again in 5 hours" → exact relatif
}

/**
 * Hasil klasifikasi Detector. Fungsi murni — TAK PERNAH menurunkan aksi dari isi output
 * (ADR-008/013). `evidence` = substring yang match saja, bukan seluruh transcript (bisa
 * dipersist lewat redaksi nanti).
 */
export interface DetectionResult {
  kind: DetectKind;
  source: DetectSource | null; // null saat kind==='none'
  evidence?: string;
  resetHint?: ResetHint; // hanya bila terparse dari sinyal yang sama
}

/** Sinyal dari hook `StopFailure` (v2.1.78+, RESEARCH §2c). Field `error`, BUKAN `error_type`. */
export interface StopFailureSignal {
  type: 'stopfailure';
  error: string;
  lastAssistantMessage?: string;
}

/** Satu baris/chunk output PTY. */
export interface OutputSignal {
  type: 'output';
  text: string;
}

/** Exit code proses (print-mode); `recentOutput` = konteks terakhir sebelum exit. */
export interface ExitCodeSignal {
  type: 'exitcode';
  code: number;
  recentOutput?: string;
}

export type DetectSignal = StopFailureSignal | OutputSignal | ExitCodeSignal;

/** I-23: perintah forwarder hook dalam **exec-form** (executable + argv terpisah) → TAK ada shell-quoting
 *  lintas-OS (menghindari kelas jebakan G-12/PATHEXT). CLI target (CC) menjalankan ini sbagai subproses
 *  hook; ia membaca payload JSON dari stdin lalu meneruskannya ke socket kontrol per-sesi wrapper. */
export interface HookForwarderSpec {
  command: string;
  args: string[];
}

/** Input untuk `Adapter.supervisorHooks` — apa yang wrapper ketahui tentang sesi yang akan di-spawn. */
export interface SupervisorHooksInput {
  sessionId: string;
  forwarder: HookForwarderSpec;
  /** Path file settings yang WRAPPER akan tulis (isi = `settingsContent`) lalu rujuk lewat `extraArgs`. */
  settingsPath: string;
}

/** Rencana pemasangan hook: isi file settings + arg yang disisipkan wrapper ke depan args spawn. */
export interface SupervisorHooksPlan {
  settingsContent: string;
  extraArgs: string[];
}

/**
 * Kontrak per-tool. `buildSpawn` = bagaimana menjalankan tool (M1). `detect` = klasifikasi
 * limit/overload/none dari sebuah sinyal (M2) — murni, tak akses store/IPC.
 */
export interface Adapter {
  tool: Tool;
  buildSpawn(args: string[]): SpawnSpec;
  detect(signal: DetectSignal): DetectionResult;
  /** Probe usage LIVE (M3d.3/M3d.4) — jaringan/kredensial nyata, di luar `detect` yang murni.
   * `context.sessionPid` dipakai agy (port-discovery lintas-PID); CC probe standalone (abaikan). */
  probeUsage?(context?: { sessionPid?: number }): Promise<UsageSnapshot>;
  /** I-25: keputusan "kuota tersedia untuk resume" dari snapshot, per-tool. Tak didefinisikan =
   *  default supervisor `limits.every(usedFraction<1)` (benar utk agy — dual-limit per grup, SEMUA
   *  bucket mengikat, G-31). CC override (`claudeUsageAvailable`): hanya window mengikat (global +
   *  scoped-aktif) supaya limit model-scoped yang tak dipakai tak memblokir resume selamanya. */
  isUsageAvailable?(snapshot: UsageSnapshot): boolean;
  /** Bangun spec spawn untuk melanjutkan sesi yang sudah exited (resume-by-id, M3d.6). `cwd` wajib
   * diisi di spec hasil — proses dilanjutkan harus di direktori kerja sesi asli (AC-8). */
  resumeCmd?(sessionId: string, cwd: string): SpawnSpec;
  /** I-20/R2b: ekstrak `cli_session_id` milik CLI dari SATU baris output (murni — tak akses store/IPC).
   *  agy = uuid dari resume-cmd yang agy cetak saat exit (`agy --conversation=<uuid>`, G-36). CC TIDAK
   *  memakai jalur ini — sumber id CC = payload hook `SessionStart` (I-23/G-34), bukan output → `undefined`.
   *  Wrapper memanggilnya per baris output; hasil pertama non-null → `sessions.setCliSessionId`. */
  captureSessionId?(text: string): string | null;
  /** I-23: pasang hook supervisor ke sesi yang di-spawn. CC = hook `StopFailure` (deteksi limit PRIMER,
   *  ADR-001/§7) + `SessionStart` (sumber `cli_session_id`, I-20/R2b/G-34) via `--settings <file>`
   *  (isolasi — tak mengotori `~/.claude/settings.json`; auth tetap diwarisi kredensial mesin, ADR-005 —
   *  `--settings` MERGE additif). Wrapper menulis `settingsContent` ke `settingsPath` lalu menyisipkan
   *  `extraArgs` ke depan args spawn. agy tak punya hook mekanisme → `undefined`. */
  supervisorHooks?(input: SupervisorHooksInput): SupervisorHooksPlan;
}
