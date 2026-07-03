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
