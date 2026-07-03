import type { Tool } from '../shared/types.js';

/** Spesifikasi proses yang akan di-spawn oleh wrapper PTY. */
export interface SpawnSpec {
  file: string;
  args: string[];
}

/**
 * Kontrak per-tool. M1 hanya butuh `buildSpawn` (bagaimana menjalankan tool).
 * Deteksi limit / parse reset / resume-cmd / probe-usage = pekerjaan M2/M3.
 */
export interface Adapter {
  tool: Tool;
  buildSpawn(args: string[]): SpawnSpec;
}
