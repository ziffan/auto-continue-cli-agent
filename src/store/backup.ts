import DatabaseCtor from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
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

/** Retensi tiered GFS-lite (ADR-024): `hourly` snapshot terbaru + 1 representatif per
 * hari-kalender lokal untuk `daily` hari terakhir yang punya snapshot. */
export interface BackupRetention {
  /** Jumlah snapshot terbaru yang DIPERTAHANKAN tanpa syarat (>=1 — selalu simpan snapshot terbaru). */
  hourly: number;
  /** Jumlah hari-kalender lokal terakhir yang dipertahankan 1 representatif (snapshot terbaru hari itu, >=0). */
  daily: number;
}

export interface BackupConfig {
  /** Path DB sumber. Default: `dbPath()`. */
  dbPath: string;
  /** Direktori tujuan snapshot. Default: `backupDir()`. */
  backupDir: string;
  /** Retensi tiered (ADR-024) — union hourly-terbaru + representatif-per-hari. */
  retention: BackupRetention;
  /** Interval penjadwalan — dibaca untuk scheduler M5.2. Engine M5.1 TIDAK memakainya sendiri. */
  intervalMs?: number;
  /** Sumber waktu epoch ms — injektable agar test deterministik. Default `Date.now`. */
  clock?: () => number;
  /** Fungsi hari-kalender dari epoch ms — injektable agar test deterministik. Default = hari
   * LOKAL host (konsisten `status.ts`), lihat `defaultDayKeyOf`. */
  dayKeyOf?: (epochMs: number) => string;
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

/** Hari-kalender LOKAL host dari epoch ms (default `dayKeyOf` — konsisten `status.ts` yang
 * render waktu lokal). Bukan hari-UTC — lihat ADR-024 Consequences soal DST. */
function defaultDayKeyOf(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Bangun `BackupConfig` dari `overrides` + env + default (ADR-022/024 — config over hardcode).
 * Prioritas tiap field: `overrides` eksplisit → env (bila relevan) → default. */
export function resolveBackupConfig(overrides?: Partial<BackupConfig>): BackupConfig {
  return {
    dbPath: overrides?.dbPath ?? defaultDbPath(),
    backupDir: overrides?.backupDir ?? defaultBackupDir(),
    retention: overrides?.retention ?? {
      hourly: parseIntEnv(process.env.ACCA_BACKUP_RETENTION_HOURLY, 24),
      daily: parseIntEnv(process.env.ACCA_BACKUP_RETENTION_DAILY, 30),
    },
    intervalMs: overrides?.intervalMs ?? parseIntEnvOptional(process.env.ACCA_BACKUP_INTERVAL_MS),
    clock: overrides?.clock ?? Date.now,
    dayKeyOf: overrides?.dayKeyOf ?? defaultDayKeyOf,
  };
}

/** Salin DB sumber ke snapshot ber-timestamp di `backupDir` lewat **SQLite Online Backup API**
 * (`db.backup()`), verifikasi integritas salinan, lalu pangkas snapshot lama ke `retention` teratas.
 *
 * CATATAN reviewer (I-32): salinan pakai online backup API async — page-by-page dengan lock benar,
 * **concurrency-safe by design**. Ini menggantikan pendekatan lama `wal_checkpoint(TRUNCATE)` +
 * `copyFileSync` sinkron yang, saat daemon LIVE memegang koneksi WAL-nya sendiri & menulis konkuren,
 * bisa menghasilkan salinan **half-written/korup** (checkpoint daemon menulis file utama SAAT copy
 * membaca). API online membaca snapshot konsisten melintasi WAL tanpa race — jadi `backupDatabase`
 * kini `async` (`db.backup()` mengembalikan Promise). Koneksi sumber sengaja tetap TERBUKA selama
 * transfer (backup membaca darinya); ditutup di `finally`. Fail-safe `integrity_check` dipertahankan.
 */
export async function backupDatabase(cfg?: Partial<BackupConfig>): Promise<BackupResult> {
  const resolved = resolveBackupConfig(cfg);
  const { dbPath, retention } = resolved;

  if (!Number.isInteger(retention.hourly) || retention.hourly < 1) {
    throw new BackupError(`retention.hourly harus bilangan bulat >= 1, dapat: ${String(retention.hourly)}`);
  }
  if (!Number.isInteger(retention.daily) || retention.daily < 0) {
    throw new BackupError(`retention.daily harus bilangan bulat >= 0, dapat: ${String(retention.daily)}`);
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
      // Online Backup API (I-32): salinan konsisten page-by-page — aman saat writer konkuren
      // (daemon) memegang koneksi WAL. Menggantikan wal_checkpoint+copyFileSync (rawan half-write).
      await sourceDb.backup(destPath);
    } catch (cause) {
      throw new BackupError(`gagal membuat online-backup database sumber: ${dbPath}`, { cause });
    } finally {
      sourceDb?.close();
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

  const pruned = pruneSnapshots(targetDir, retention, resolved.dayKeyOf ?? defaultDayKeyOf);

  return { path: destPath, pruned };
}

/** Pangkas snapshot lama di `dir` ke retensi **tiered GFS-lite** (ADR-024): union dari
 * (a) `retention.hourly` snapshot terbaru, dan (b) 1 representatif (epoch terbesar) per
 * hari-kalender (`dayKeyOf`) untuk `retention.daily` hari terakhir yang punya snapshot.
 * HANYA menyentuh file yang cocok pola `acca-backup-<epochMs>.db` — file asing di direktori
 * yang sama TAK PERNAH dihapus (no-hard-delete atas berkas di luar kendali engine ini). */
export function pruneSnapshots(
  dir: string,
  retention: BackupRetention,
  dayKeyOf: (epochMs: number) => string,
): string[] {
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

  const keep = new Set<string>();

  // Tier hourly: N snapshot terbaru (union — mungkin overlap dengan representatif harian).
  for (const snap of snapshots.slice(0, retention.hourly)) {
    keep.add(snap.name);
  }

  // Tier daily: 1 representatif (terbaru) per hari-kalender, untuk `daily` hari terakhir
  // yang punya snapshot (gap hari tanpa snapshot tak menghabiskan budget).
  const seenDays = new Map<string, string>();
  for (const snap of snapshots) {
    const key = dayKeyOf(snap.epoch);
    if (!seenDays.has(key)) {
      seenDays.set(key, snap.name);
    }
  }
  for (const name of [...seenDays.values()].slice(0, retention.daily)) {
    keep.add(name);
  }

  const pruned: string[] = [];
  for (const snap of snapshots) {
    if (keep.has(snap.name)) continue;
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
