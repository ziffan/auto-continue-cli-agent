import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Path lintas-OS (NFR portability): node:path/os.homedir(), jangan hardcode `~`/`/` (CONVENTIONS.md).

/**
 * Direktori data supervisor. Prioritas: env `ACCA_DATA_DIR` (mis. untuk test) →
 * Windows `%LOCALAPPDATA%/acca` → `$XDG_DATA_HOME/acca` → `~/.local/share/acca`.
 * Dibuat otomatis bila belum ada.
 */
export function dataDir(): string {
  let dir: string;
  const override = process.env.ACCA_DATA_DIR;
  if (override) {
    dir = override;
  } else if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    dir = join(process.env.LOCALAPPDATA, 'acca');
  } else if (process.env.XDG_DATA_HOME) {
    dir = join(process.env.XDG_DATA_HOME, 'acca');
  } else {
    dir = join(homedir(), '.local', 'share', 'acca');
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Path file database SQLite di dalam `dataDir()`. */
export function dbPath(): string {
  return join(dataDir(), 'acca.db');
}

/**
 * Direktori snapshot backup (M5.1). Prioritas: env `ACCA_BACKUP_DIR` (mis. untuk test) →
 * `<dataDir()>/backups`. Dibuat otomatis bila belum ada.
 */
export function backupDir(): string {
  const override = process.env.ACCA_BACKUP_DIR;
  const dir = override ? override : join(dataDir(), 'backups');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Path socket IPC CLI↔daemon (ADR-015 — Node `net`: Unix domain socket / Windows named pipe,
 * bukan TCP). Prioritas: env `ACCA_SOCKET_PATH` (test) → Windows named pipe tetap →
 * `$XDG_RUNTIME_DIR/acca/daemon.sock` → fallback `~/.acca/daemon.sock`. Direktori dibuat
 * otomatis di jalur POSIX (named pipe Windows bukan path filesystem, tak perlu mkdir).
 */
export function runtimeSocketPath(): string {
  const override = process.env.ACCA_SOCKET_PATH;
  if (override) return override;

  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\acca-daemon';
  }

  if (process.env.XDG_RUNTIME_DIR) {
    const dir = join(process.env.XDG_RUNTIME_DIR, 'acca');
    mkdirSync(dir, { recursive: true });
    return join(dir, 'daemon.sock');
  }

  const dir = join(homedir(), '.acca');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'daemon.sock');
}

/**
 * Path socket kontrol PER-SESI (ADR-015 — Node `net`) yang di-HOST oleh wrapper `acca run` pemilik
 * PTY sesi itu; daemon me-connect ke sini sebagai klien untuk minta inject-continue (I-12 poin 1,
 * seam actuation ADR-014 §1). Deterministik dari `sessionId` → daemon & wrapper menurunkan path yang
 * SAMA tanpa handshake registrasi (bila wrapper tak mendengarkan, connect gagal → daemon perlakukan
 * sebagai "wrapper unreachable"). Diturunkan dari `dataDir()` (bukan runtime dir) supaya override
 * `ACCA_DATA_DIR` di test/lingkungan terisolasi ikut memindahkannya. Windows = named pipe (bukan path
 * filesystem, tak perlu mkdir); POSIX = file socket di `dataDir()`.
 */
export function sessionControlSocketPath(sessionId: string): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\acca-session-${sessionId}`;
  }
  return join(dataDir(), `session-${sessionId}.sock`);
}

/**
 * Path file settings.json sementara PER-SESI yang wrapper tulis untuk memasang hook supervisor CC
 * (I-23 — `claude --settings <path>`). File JSON biasa di `dataDir()` (bukan named pipe) lintas-OS;
 * berisi hook command forwarder (bukan secret) → aman, tetap di-unlink saat sesi keluar (best-effort).
 */
export function sessionHookSettingsPath(sessionId: string): string {
  return join(dataDir(), `session-${sessionId}-hooks.json`);
}
