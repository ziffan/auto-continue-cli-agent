import DatabaseCtor from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BackupError, backupDatabase, pruneSnapshots } from '../src/store/backup.js';
import { closeDb, openDb, type DatabaseInstance } from '../src/store/db.js';
import { createSessionsRepo } from '../src/store/repositories/sessions.js';

const tempDir = join(tmpdir(), `acca-test-${randomBytes(4).toString('hex')}`);
process.env.ACCA_DATA_DIR = tempDir;
const SNAPSHOT_FILE_RE = /^acca-backup-\d+\.db$/;

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

    const result = backupDatabase({
      dbPath: dbFilePath,
      backupDir: backupDirPath,
      retention: { hourly: 24, daily: 30 },
    });

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
    const hourly = 2;
    const retention = { hourly, daily: 0 }; // daily:0 = rolling murni back-compat (tier daily kosong).

    // Setiap panggilan backupDatabase men-prune di akhir (bukan hanya panggilan terakhir) —
    // begitu jumlah snapshot lewat retensi, yang tertua langsung terpangkas panggilan itu juga.
    const paths: string[] = [];
    for (let i = 0; i < hourly + 1; i += 1) {
      const r = backupDatabase({ dbPath: dbFilePath, backupDir: backupDirPath, retention, clock });
      paths.push(r.path);
      clockMs += 1000;
    }
    // Setelah hourly+1 = 3 panggilan (epoch 1000,2000,3000), snapshot tertua (1000) sudah
    // terpangkas oleh panggilan ke-3 sendiri begitu jumlahnya melewati retensi hourly=2.
    expect(existsSync(paths[0] as string)).toBe(false);

    // Backup ke-(N+2): memangkas snapshot tertua BERIKUTNYA yang masih tersisa (epoch 2000).
    const finalResult = backupDatabase({ dbPath: dbFilePath, backupDir: backupDirPath, retention, clock });

    expect(finalResult.pruned.length).toBeGreaterThan(0);
    expect(finalResult.pruned).toContain(paths[1]);
    expect(existsSync(paths[1] as string)).toBe(false);

    const remainingSnapshots = readdirSync(backupDirPath).filter((f) => /^acca-backup-\d+\.db$/.test(f));
    expect(remainingSnapshots.length).toBe(hourly);

    // File asing tetap ada (no-hard-delete atas berkas di luar kendali engine).
    expect(existsSync(foreignFile)).toBe(true);
  });

  it('T3: dbPath tidak ada → BackupError', () => {
    const backupDirPath = join(tempDir, 'backups-t3');
    const missingDbPath = join(tempDir, 'tidak-ada.db');

    expect(() =>
      backupDatabase({ dbPath: missingDbPath, backupDir: backupDirPath, retention: { hourly: 3, daily: 0 } }),
    ).toThrow(BackupError);
  });

  it('T4: backupDir tak bisa ditulis (parent adalah file) → BackupError', () => {
    const dbFilePath = join(tempDir, 'acca.db');
    const blockerFile = join(tempDir, 'blocker-t4.txt');
    writeFileSync(blockerFile, 'aku file, bukan direktori');

    // mkdirSync recursive di bawah sebuah FILE mustahil (ENOTDIR) — jalan lintas-OS termasuk Windows.
    const unwritableBackupDir = join(blockerFile, 'sub', 'backups');

    expect(() =>
      backupDatabase({ dbPath: dbFilePath, backupDir: unwritableBackupDir, retention: { hourly: 3, daily: 0 } }),
    ).toThrow(BackupError);
  });

  it('validasi retention.hourly < 1 → BackupError', () => {
    const backupDirPath = join(tempDir, 'backups-invalid-hourly');
    const dbFilePath = join(tempDir, 'acca.db');

    expect(() =>
      backupDatabase({ dbPath: dbFilePath, backupDir: backupDirPath, retention: { hourly: 0, daily: 30 } }),
    ).toThrow(BackupError);
  });

  it('validasi retention.daily < 0 → BackupError', () => {
    const backupDirPath = join(tempDir, 'backups-invalid-daily');
    const dbFilePath = join(tempDir, 'acca.db');

    expect(() =>
      backupDatabase({ dbPath: dbFilePath, backupDir: backupDirPath, retention: { hourly: 1, daily: -1 } }),
    ).toThrow(BackupError);
  });
});

describe('pruneSnapshots (tiered GFS-lite, ADR-024)', () => {
  const utcDayKeyOf = (ms: number): string => String(Math.floor(ms / 86_400_000));
  const DAY = 86_400_000;

  function makeSnapshotDir(): string {
    const dir = join(tempDir, `prune-${randomBytes(4).toString('hex')}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  function touchSnapshot(dir: string, epochMs: number): string {
    const name = `acca-backup-${epochMs}.db`;
    writeFileSync(join(dir, name), '');
    return name;
  }

  it('rolling murni back-compat: {hourly:2,daily:0}, 4 snapshot hari-sama → keep 2 terbaru, prune 2', () => {
    const dir = makeSnapshotDir();
    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    const names = [base, base + 1000, base + 2000, base + 3000].map((ms) => touchSnapshot(dir, ms));

    const pruned = pruneSnapshots(dir, { hourly: 2, daily: 0 }, utcDayKeyOf);

    expect(pruned.sort()).toEqual([join(dir, names[0] as string), join(dir, names[1] as string)].sort());
    const remaining = readdirSync(dir).filter((f) => SNAPSHOT_FILE_RE.test(f));
    expect(remaining.sort()).toEqual([names[2], names[3]].sort());
  });

  it('tiered multi-hari: {hourly:2,daily:3} — hourly-top + representatif 3 hari terbaru kept, sisanya pruned', () => {
    const dir = makeSnapshotDir();
    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    // hari0: 2 snapshot, hari1: 2 snapshot, hari2: 1, hari3: 1, hari4: 1 (5 hari, epoch naik = hari makin baru).
    const day0a = touchSnapshot(dir, base);
    const day0b = touchSnapshot(dir, base + 1000); // hourly-top-2 (terbaru keseluruhan bukan ini)
    const day1a = touchSnapshot(dir, base + DAY);
    const day1b = touchSnapshot(dir, base + DAY + 1000);
    const day2 = touchSnapshot(dir, base + 2 * DAY);
    const day3 = touchSnapshot(dir, base + 3 * DAY);
    const day4 = touchSnapshot(dir, base + 4 * DAY); // terbaru keseluruhan

    const pruned = pruneSnapshots(dir, { hourly: 2, daily: 3 }, utcDayKeyOf);

    // hourly: 2 terbaru overall = day4, day3. daily: 3 hari terbaru berisi = hari4(day4),hari3(day3),hari2(day2)
    // representatif = epoch terbesar per hari → day4, day3, day2.
    // keep union = {day4, day3, day2}. Prune = day0a, day0b, day1a, day1b.
    const remaining = readdirSync(dir).filter((f) => SNAPSHOT_FILE_RE.test(f));
    expect(remaining.sort()).toEqual([day2, day3, day4].sort());
    expect(pruned.sort()).toEqual(
      [join(dir, day0a), join(dir, day0b), join(dir, day1a), join(dir, day1b)].sort(),
    );
  });

  it('gap hari: hari tanpa snapshot tak menghabiskan budget daily', () => {
    const dir = makeSnapshotDir();
    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    // hari0 dan hari0+5 hari (gap hari1-4 kosong) — daily:2 harus dapat representatif kedua hari BERISI.
    const day0 = touchSnapshot(dir, base);
    const day5 = touchSnapshot(dir, base + 5 * DAY);

    pruneSnapshots(dir, { hourly: 1, daily: 2 }, utcDayKeyOf);

    const remaining = readdirSync(dir).filter((f) => SNAPSHOT_FILE_RE.test(f));
    expect(remaining.sort()).toEqual([day0, day5].sort());
  });

  it('overlap: snapshot yang masuk hourly-top DAN representatif-hari dihitung sekali (tak error/dobel)', () => {
    const dir = makeSnapshotDir();
    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    const only = touchSnapshot(dir, base);

    expect(() => pruneSnapshots(dir, { hourly: 5, daily: 5 }, utcDayKeyOf)).not.toThrow();
    const remaining = readdirSync(dir).filter((f) => SNAPSHOT_FILE_RE.test(f));
    expect(remaining).toEqual([only]);
  });

  it('file asing di direktori snapshot tak tersentuh', () => {
    const dir = makeSnapshotDir();
    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    touchSnapshot(dir, base);
    touchSnapshot(dir, base + 1000);
    touchSnapshot(dir, base + 2000);
    const foreign = join(dir, 'unrelated.txt');
    writeFileSync(foreign, 'jangan dihapus');

    pruneSnapshots(dir, { hourly: 1, daily: 0 }, utcDayKeyOf);

    expect(existsSync(foreign)).toBe(true);
  });
});
