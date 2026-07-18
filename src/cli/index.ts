#!/usr/bin/env node
import { Command } from 'commander';
import { registerDaemonCommand } from './commands/daemon.js';
import { registerHookCommand } from './commands/hook.js';
import { registerLogCommand } from './commands/log.js';
import { registerRunCommand } from './commands/run.js';
import { registerStatusCommand } from './commands/status.js';
import { renderSplash, resolveBannerCaps } from '../shared/banner.js';

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

// `acca` tanpa subcommand = momen kenalan (ADR-027 §4): splash penuh lalu help. Root action hanya
// menyala saat tak ada subcommand cocok; `--help`/`--version` di-handle commander lebih dulu (exit).
program.action(() => {
  const splash = renderSplash(resolveBannerCaps());
  if (splash) console.log(splash);
  program.outputHelp();
});

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
