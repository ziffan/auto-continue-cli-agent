import DatabaseCtor from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BackupError, backupDatabase } from '../src/store/backup.js';
import { closeDb, openDb, type DatabaseInstance } from '../src/store/db.js';
import { createSessionsRepo } from '../src/store/repositories/sessions.js';

const tempDir = join(tmpdir(), `acca-test-${randomBytes(4).toString('hex')}`);
process.env.ACCA_DATA_DIR = tempDir;

let db: DatabaseInstance;

beforeAll(() => {
  db = openDb();
  const sessions = createSessionsRepo(db);
  for (let i = 0; i < 5; i += 1) {
    sessions.createSession({
      id: `sess-${i}`,
      tool: 'claude',
      cwd: `/tmp/project-${i}`,
      status: 'RUNNING',
      proc_state: 'alive',
    });
  }
});

afterAll(() => {
  closeDb(db);
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.ACCA_DATA_DIR;
  delete process.env.ACCA_BACKUP_DIR;
});

describe('backupDatabase', () => {
  it('T1: menghasilkan snapshot konsisten (integrity_check ok, data cocok, tanpa -wal sisa)', () => {
    const backupDirPath = join(tempDir, 'backups-t1');
    const dbFilePath = join(tempDir, 'acca.db');

    const result = backupDatabase({ dbPath: dbFilePath, backupDir: backupDirPath, retention: 7 });

    expect(existsSync(result.path)).toBe(true);
    expect(result.pruned).toEqual([]);

    const copy = new DatabaseCtor(result.path);
    try {
      const integrity = copy.pragma('integrity_check') as Array<{ integrity_check: string }>;
      expect(integrity[0]?.integrity_check).toBe('ok');

      const count = copy.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number };
      expect(count.n).toBe(5);
    } finally {
      copy.close();
    }

    // Tak ada sidecar -wal ikut tersalin (checkpoint TRUNCATE + copy hanya file utama).
    expect(existsSync(`${result.path}-wal`)).toBe(false);
  });

  it('T2: retensi memangkas ke N terbaru, file asing di backupDir tak tersentuh', () => {
    const backupDirPath = join(tempDir, 'backups-t2');
    const dbFilePath = join(tempDir, 'acca.db');
    mkdirSync(backupDirPath, { recursive: true });

    const foreignFile = join(backupDirPath, 'unrelated.txt');
    writeFileSync(foreignFile, 'jangan dihapus');

    let clockMs = 1000;
    const clock = () => clockMs;
    const retention = 2;

    // Setiap panggilan backupDatabase men-prune di akhir (bukan hanya panggilan terakhir) —
    // begitu jumlah snapshot lewat retensi, yang tertua langsung terpangkas panggilan itu juga.
    const paths: string[] = [];
    for (let i = 0; i < retention + 1; i += 1) {
      const r = backupDatabase({ dbPath: dbFilePath, backupDir: backupDirPath, retention, clock });
      paths.push(r.path);
      clockMs += 1000;
    }
    // Setelah retention+1 = 3 panggilan (epoch 1000,2000,3000), snapshot tertua (1000) sudah
    // terpangkas oleh panggilan ke-3 sendiri begitu jumlahnya melewati retensi=2.
    expect(existsSync(paths[0] as string)).toBe(false);

    // Backup ke-(N+2): memangkas snapshot tertua BERIKUTNYA yang masih tersisa (epoch 2000).
    const finalResult = backupDatabase({ dbPath: dbFilePath, backupDir: backupDirPath, retention, clock });

    expect(finalResult.pruned.length).toBeGreaterThan(0);
    expect(finalResult.pruned).toContain(paths[1]);
    expect(existsSync(paths[1] as string)).toBe(false);

    const remainingSnapshots = readdirSync(backupDirPath).filter((f) => /^acca-backup-\d+\.db$/.test(f));
    expect(remainingSnapshots.length).toBe(retention);

    // File asing tetap ada (no-hard-delete atas berkas di luar kendali engine).
    expect(existsSync(foreignFile)).toBe(true);
  });

  it('T3: dbPath tidak ada → BackupError', () => {
    const backupDirPath = join(tempDir, 'backups-t3');
    const missingDbPath = join(tempDir, 'tidak-ada.db');

    expect(() => backupDatabase({ dbPath: missingDbPath, backupDir: backupDirPath, retention: 3 })).toThrow(
      BackupError,
    );
  });

  it('T4: backupDir tak bisa ditulis (parent adalah file) → BackupError', () => {
    const dbFilePath = join(tempDir, 'acca.db');
    const blockerFile = join(tempDir, 'blocker-t4.txt');
    writeFileSync(blockerFile, 'aku file, bukan direktori');

    // mkdirSync recursive di bawah sebuah FILE mustahil (ENOTDIR) — jalan lintas-OS termasuk Windows.
    const unwritableBackupDir = join(blockerFile, 'sub', 'backups');

    expect(() =>
      backupDatabase({ dbPath: dbFilePath, backupDir: unwritableBackupDir, retention: 3 }),
    ).toThrow(BackupError);
  });

  it('validasi retention < 1 → BackupError', () => {
    const backupDirPath = join(tempDir, 'backups-invalid');
    const dbFilePath = join(tempDir, 'acca.db');

    expect(() => backupDatabase({ dbPath: dbFilePath, backupDir: backupDirPath, retention: 0 })).toThrow(
      BackupError,
    );
  });
});
