import { Command } from 'commander';
import { registerDaemonCommand } from './commands/daemon.js';
import { registerHookCommand } from './commands/hook.js';
import { registerLogCommand } from './commands/log.js';
import { registerRunCommand } from './commands/run.js';
import { registerPruneCommand } from './commands/prune.js';
import { registerStatusCommand } from './commands/status.js';
import { registerWebCommand } from './commands/web.js';

/** Rakit program commander lengkap (semua subcommand terdaftar) TANPA efek samping parse/exit.
 *  Dipisah dari entrypoint supaya konfigurasi dispatch bisa di-uji (regresi: JANGAN pasang
 *  `program.action()` root — itu membuat `acca help` / subcommand lain di-parse sbg argumen berlebih
 *  → "too many arguments"). Impor modul ini aman (nol side-effect). */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name('acca')
    .description('Supervisor lokal — monitor usage & auto-continue sesi Claude Code / Antigravity CLI')
    .version('0.1.0')
    // Wajib agar `run.passThroughOptions()` bekerja: flag setelah `<tool>` diteruskan ke CLI target
    // (mis. `acca run claude -p "…"`) alih-alih di-parse sbg opsi subcommand (I-29). Opsi program
    // tetap harus mendahului nama subcommand (`acca --version`, `acca run …`) — pemakaian natural.
    .enablePositionalOptions();

  registerRunCommand(program);
  registerStatusCommand(program);
  registerDaemonCommand(program);
  registerLogCommand(program);
  registerHookCommand(program);
  registerWebCommand(program);
  registerPruneCommand(program);
  return program;
}
