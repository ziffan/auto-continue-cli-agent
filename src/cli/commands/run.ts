import type { Command } from 'commander';
import { resolveAdapter } from '../../adapters/index.js';
import { closeDb, openDb } from '../../store/db.js';
import { createEventsRepo } from '../../store/repositories/events.js';
import { createSessionsRepo } from '../../store/repositories/sessions.js';
import { runSession } from '../run-core.js';

/** `acca run -- <tool> [args...]` — spawn CLI target via PTY, catat sesi ke store. */
export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description('Jalankan CLI target (claude | antigravity/agy) di bawah wrapper acca')
    .argument('<tool>', 'nama tool: claude | antigravity | agy')
    .argument('[args...]', 'argumen diteruskan apa adanya ke CLI target')
    .action(async (tool: string, args: string[]) => {
      const adapter = resolveAdapter(tool);
      const spawnSpec = adapter.buildSpawn(args);
      const cwd = process.cwd();

      const db = openDb();
      try {
        const sessions = createSessionsRepo(db);
        const events = createEventsRepo(db);

        const { waitForExit } = runSession(
          { file: spawnSpec.file, args: spawnSpec.args, cwd, tool: adapter.tool },
          { sessions, events },
        );

        const exitCode = await waitForExit;
        process.exitCode = exitCode;
      } finally {
        closeDb(db);
      }
    });
}
