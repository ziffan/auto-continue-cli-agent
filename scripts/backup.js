// Skrip backup one-shot (ADR-022/024) — jalankan via scheduler OS (deploy/backup/**).
// Wrapper tipis atas engine `src/store/backup.ts`; import dari `dist/` (bukan `src/`) karena
// scheduled task menjalankan `node` atas hasil build, bukan TypeScript sumber langsung.
//
// Pakai:
//   npm run build          # wajib dulu — skrip ini butuh dist/store/backup.js
//   node scripts/backup.js
//
// Config (env, ADR-022/024 — config over hardcode; lihat resolveBackupConfig di src/store/backup.ts):
//   ACCA_DATA_DIR                  direktori data (override lokasi acca.db)
//   ACCA_BACKUP_DIR                direktori tujuan snapshot (default <dataDir>/backups)
//   ACCA_BACKUP_RETENTION_HOURLY   snapshot terbaru yang dipertahankan (default 24)
//   ACCA_BACKUP_RETENTION_DAILY    representatif harian yang dipertahankan (default 30)
import { backupDatabase } from '../dist/store/backup.js';

try {
  const result = backupDatabase();
  console.log(`acca backup ok: ${result.path} (pruned ${result.pruned.length})`);
} catch (err) {
  console.error(`acca backup GAGAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
