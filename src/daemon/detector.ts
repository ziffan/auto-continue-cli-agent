// Seam Detector — orkestrasi tipis di atas adapter per-tool. M2 = pure engine (tak ada akses
// store/IPC di sini); M3 memanggil `classify()` lalu menulis hasilnya ke `sessions`/`events`.

import { adapters } from '../adapters/index.js';
import type { DetectionResult, DetectSignal } from '../adapters/types.js';
import type { Tool } from '../shared/types.js';

/** Dilempar bila `tool` tak dikenal di record `adapters` (defensif — bisa terjadi jika nilai `Tool`
 * datang dari sumber tak tervalidasi kompilasi, mis. deserialize IPC/store, bukan dari resolveAdapter). */
export class DetectorError extends Error {
  constructor(public readonly tool: string) {
    super(`Detector: tool tidak dikenal "${tool}".`);
    this.name = 'DetectorError';
  }
}

/**
 * Klasifikasi satu sinyal via adapter tool yang bersangkutan.
 *
 * INVARIAN: fungsi ini hanya mendelegasikan ke `adapters[tool].detect()` — tak menambah logika
 * klasifikasi sendiri. Hasil `overload`/`none` dari adapter TIDAK PERNAH "di-upgrade" jadi `limit`
 * di lapisan ini; satu-satunya sumber kebenaran taxonomy limit-vs-overload adalah adapter
 * (ADR-008/013 — tak ada aksi/klasifikasi ganda yang bisa saling tak sinkron).
 */
export function classify(tool: Tool, signal: DetectSignal): DetectionResult {
  const adapter = adapters[tool];
  if (!adapter) throw new DetectorError(tool);
  return adapter.detect(signal);
}
