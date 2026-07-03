import DatabaseCtor from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbPath } from '../shared/paths.js';

export type DatabaseInstance = InstanceType<typeof DatabaseCtor>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

interface MigrationFile {
  version: number;
  file: string;
}

function currentSchemaVersion(db: DatabaseInstance): number {
  const tableExists = db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'",
    )
    .get();
  if (!tableExists) return 0;

  const row = db.prepare<[], { value: string }>("SELECT value FROM meta WHERE key = 'schema_version'").get();
  if (!row) return 0;

  const version = Number.parseInt(row.value, 10);
  return Number.isFinite(version) ? version : 0;
}

function migrationFiles(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+-.*\.sql$/.test(f))
    .map((f) => ({ version: Number.parseInt(f.split('-')[0] ?? '0', 10), file: f }))
    .sort((a, b) => a.version - b.version);
}

/** Jalankan migrasi forward-only yang belum diterapkan, tiap file dalam transaksi (idempotent). */
function runMigrations(db: DatabaseInstance): void {
  const current = currentSchemaVersion(db);
  const pending = migrationFiles().filter((m) => m.version > current);
  for (const migration of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, migration.file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
    })();
  }
}

/** Buka (atau buat) DB di `dbPath()`, aktifkan WAL + FK, jalankan migrasi tertunda. */
export function openDb(path: string = dbPath()): DatabaseInstance {
  const db = new DatabaseCtor(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/** Tutup koneksi DB (dipakai test untuk cleanup). */
export function closeDb(db: DatabaseInstance): void {
  db.close();
}
