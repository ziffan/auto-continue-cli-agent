import type { Tool } from '../shared/types.js';

/** Spesifikasi proses yang akan di-spawn oleh wrapper PTY. */
export interface SpawnSpec {
  file: string;
  args: string[];
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

/**
 * Kontrak per-tool. `buildSpawn` = bagaimana menjalankan tool (M1). `detect` = klasifikasi
 * limit/overload/none dari sebuah sinyal (M2) — murni, tak akses store/IPC.
 */
export interface Adapter {
  tool: Tool;
  buildSpawn(args: string[]): SpawnSpec;
  detect(signal: DetectSignal): DetectionResult;
}
