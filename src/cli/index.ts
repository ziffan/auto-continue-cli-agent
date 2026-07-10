#!/usr/bin/env node
import { Command } from 'commander';
import { registerDaemonCommand } from './commands/daemon.js';
import { registerLogCommand } from './commands/log.js';
import { registerRunCommand } from './commands/run.js';
import { registerStatusCommand } from './commands/status.js';

const program = new Command();

program
  .name('acca')
  .description('Supervisor lokal — monitor usage & auto-continue sesi Claude Code / Antigravity CLI')
  .version('0.1.0');

registerRunCommand(program);
registerStatusCommand(program);
registerDaemonCommand(program);
registerLogCommand(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
