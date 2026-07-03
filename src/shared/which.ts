import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

// node-pty di Windows tidak mencari PATH / menerapkan PATHEXT (GOTCHAS G-12) — ia butuh
// path absolut executable. Resolver ini meniru pencarian shell lintas-OS.

/**
 * Cari path absolut executable `cmd` di `PATH`. Di Windows menerapkan `PATHEXT`
 * (mis. `claude` → `claude.exe`); di POSIX memeriksa bit executable. `null` bila tak ada.
 */
export function which(cmd: string): string | null {
  const isWin = process.platform === 'win32';
  // Windows: cek keberadaan file (X_OK tak andal via ACL). POSIX: cek bit executable.
  const mode = isWin ? constants.F_OK : constants.X_OK;
  const exts = isWin
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
        .split(';')
        .map((e) => e.trim())
        .filter(Boolean)
    : [''];
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, cmd + ext);
      try {
        accessSync(candidate, mode);
        return candidate;
      } catch {
        // lanjut ke kandidat berikutnya
      }
    }
  }
  return null;
}
