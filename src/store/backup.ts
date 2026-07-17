import DatabaseCtor from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, unlinkSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseInstance } from './db.js';
import { backupDir as defaultBackupDir, dbPath as defaultDbPath } from '../shared/paths.js';

/** Dilempar saat backup gagal di titik mana pun (DB sumber hilang, dir tujuan tak bisa ditulis,
 * checkpoint/copy gagal, atau integrity_check salinan tak 'ok'). Pesan selalu deskriptif —
 * korupsi/kehilangan backup adalah kelas kegagalan Tier-1 (CLAUDE.md), jadi TAK PERNAH silent. */
export class BackupError extends Error {
  constructor(reason: string, options?: { cause?: unknown }) {
    super(`Backup: ${reason}`, options);
    this.name = 'BackupError';
  }
}

export interface BackupConfig {
  /** Path DB sumber. Default: `dbPath()`. */
  dbPath: string;
  /** Direktori tujuan snapshot. Default: `backupDir()`. */
  backupDir: string;
  /** Jumlah snapshot yang DIPERTAHANKAN setelah prune (>=1). */
  retention: number;
  /** Interval penjadwalan — dibaca untuk scheduler M5.2. Engine M5.1 TIDAK memakainya sendiri. */
  intervalMs?: number;
  /** Sumber waktu epoch ms — injektable agar test deterministik. Default `Date.now`. */
  clock?: () => number;
}

export interface BackupResult {
  /** Path snapshot yang baru dibuat. */
  path: string;
  /** Path snapshot lama yang dipangkas (retensi) pada panggilan ini. */
  pruned: string[];
}

const SNAPSHOT_RE = /^acca-backup-(\d+)\.db$/;

function parseIntEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIntEnvOptional(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Bangun `BackupConfig` dari `overrides` + env + default (ADR-022 — config over hardcode).
 * Prioritas tiap field: `overrides` eksplisit → env (bila relevan) → default. */
export function resolveBackupConfig(overrides?: Partial<BackupConfig>): BackupConfig {
  return {
    dbPath: overrides?.dbPath ?? defaultDbPath(),
    backupDir: overrides?.backupDir ?? defaultBackupDir(),
    retention: overrides?.retention ?? parseIntEnv(process.env.ACCA_BACKUP_RETENTION, 7),
    intervalMs: overrides?.intervalMs ?? parseIntEnvOptional(process.env.ACCA_BACKUP_INTERVAL_MS),
    clock: overrides?.clock ?? Date.now,
  };
}

/** Checkpoint WAL DB sumber, salin ke snapshot ber-timestamp di `backupDir`, verifikasi
 * integritas salinan, lalu pangkas snapshot lama ke `retention` teratas.
 *
 * CATATAN reviewer: DB disalin lewat `wal_checkpoint(TRUNCATE)` + `copyFileSync` sinkron —
 * konsisten untuk koneksi tunggal (sandbox test / CLI one-shot). Untuk daemon LIVE dengan
 * writer konkuren, upgrade ke online backup API async (`db.backup()`) adalah langkah lanjut
 * di M5.2/hardening (API publik ini sengaja SINKRON, konsisten pola `better-sqlite3` sinkron
 * di repo — `db.backup()` mengembalikan Promise sehingga tak dipakai di sini).
 */
export function backupDatabase(cfg?: Partial<BackupConfig>): BackupResult {
  const resolved = resolveBackupConfig(cfg);
  const { dbPath, retention } = resolved;

  if (!Number.isInteger(retention) || retention < 1) {
    throw new BackupError(`retention harus bilangan bulat >= 1, dapat: ${String(retention)}`);
  }

  if (!existsSync(dbPath)) {
    throw new BackupError(`database tidak ditemukan: ${dbPath}`);
  }

  const targetDir = resolved.backupDir;
  try {
    mkdirSync(targetDir, { recursive: true });
  } catch (cause) {
    throw new BackupError(`direktori backup tak bisa ditulis: ${targetDir}`, { cause });
  }

  const clock = resolved.clock ?? Date.now;
  const destPath = join(targetDir, `acca-backup-${clock()}.db`);

  let sourceDb: DatabaseInstance | undefined;
  try {
    try {
      sourceDb = new DatabaseCtor(dbPath);
      sourceDb.pragma('wal_checkpoint(TRUNCATE)');
    } catch (cause) {
      throw new BackupError(`gagal checkpoint WAL database sumber: ${dbPath}`, { cause });
    } finally {
      // Tutup sebelum copy (tak wajib secara data — checkpoint sudah TRUNCATE — tapi menghindari
      // sharing-violation file lock di Windows saat copyFileSync membaca file yang masih terbuka).
      sourceDb?.close();
    }

    try {
      copyFileSync(dbPath, destPath);
    } catch (cause) {
      throw new BackupError(`gagal menyalin database ke snapshot: ${destPath}`, { cause });
    }

    let copyDb: DatabaseInstance | undefined;
    try {
      copyDb = new DatabaseCtor(destPath);
      const result = copyDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
      const status = result[0]?.integrity_check;
      if (status !== 'ok') {
        throw new BackupError(`integrity_check salinan gagal (status: ${String(status)}): ${destPath}`);
      }
    } catch (cause) {
      if (cause instanceof BackupError) throw cause;
      throw new BackupError(`gagal memverifikasi integritas salinan: ${destPath}`, { cause });
    } finally {
      copyDb?.close();
    }
  } catch (err) {
    throw err instanceof BackupError ? err : new BackupError('kegagalan tak terduga saat backup', { cause: err });
  }

  const pruned = pruneSnapshots(targetDir, retention);

  return { path: destPath, pruned };
}

/** Pangkas snapshot lama di `dir` ke `retention` terbaru (urut epoch dari nama file, DESC).
 * HANYA menyentuh file yang cocok pola `acca-backup-<epochMs>.db` — file asing di direktori
 * yang sama TAK PERNAH dihapus (no-hard-delete atas berkas di luar kendali engine ini). */
function pruneSnapshots(dir: string, retention: number): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (cause) {
    throw new BackupError(`gagal membaca direktori backup untuk prune: ${dir}`, { cause });
  }

  const snapshots = entries
    .map((name) => ({ name, match: SNAPSHOT_RE.exec(name) }))
    .filter((e): e is { name: string; match: RegExpExecArray } => e.match !== null)
    .map((e) => ({ name: e.name, epoch: Number.parseInt(e.match[1] ?? '0', 10) }))
    .sort((a, b) => b.epoch - a.epoch);

  const toPrune = snapshots.slice(retention);
  const pruned: string[] = [];
  for (const snap of toPrune) {
    const fullPath = join(dir, snap.name);
    try {
      unlinkSync(fullPath);
      pruned.push(fullPath);
    } catch (cause) {
      throw new BackupError(`gagal memangkas snapshot lama: ${fullPath}`, { cause });
    }
  }
  return pruned;
}
