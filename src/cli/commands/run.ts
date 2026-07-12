import type { Command } from 'commander';
import { resolveAdapter } from '../../adapters/index.js';
import { closeDb, openDb } from '../../store/db.js';
import { createEventsRepo } from '../../store/repositories/events.js';
import { createScheduledJobsRepo } from '../../store/repositories/scheduled-jobs.js';
import { createSessionsRepo } from '../../store/repositories/sessions.js';
import { withNotifications } from '../../notify/notifier.js';
import { runSession } from '../../daemon/process-wrapper.js';

/** Eksekutor sesi wrapper (dipisah dari wiring commander agar arg-parsing bisa diuji tanpa PTY). */
export type RunExecutor = (tool: string, args: string[]) => Promise<void>;

async function runExecutor(tool: string, args: string[]): Promise<void> {
  const adapter = resolveAdapter(tool);
  const spawnSpec = adapter.buildSpawn(args);
  const cwd = process.cwd();

  const db = openDb();
  try {
    const sessions = createSessionsRepo(db);
    // M4: bungkus events dgn Notifier — transisi LIMIT_HIT/FAILED sesi INI (jalur wrapper user)
    // ter-surface ke stderr (out-of-band, tak mengotori stdout TUI child).
    const events = withNotifications(createEventsRepo(db));
    const jobs = createScheduledJobsRepo(db);

    const { waitForExit } = runSession(
      { file: spawnSpec.file, args: spawnSpec.args, cwd, tool: adapter.tool },
      { sessions, events, jobs },
    );

    const exitCode = await waitForExit;
    closeDb(db);
    // Keluar eksplisit: handle ConPTY node-pty (Windows) bisa menahan event-loop walau
    // child sudah exit → tanpa ini wrapper tak balik ke shell prompt (ISSUES I-2).
    process.exit(exitCode);
  } catch (err) {
    closeDb(db);
    throw err; // jalur spawn-gagal → ditangani index.ts (exit 1); tak ada pty menggantung.
  }
}

/** `acca run <tool> [args...]` — spawn CLI target via PTY, catat sesi ke store.
 *  `passThroughOptions` (+ `enablePositionalOptions` di program, index.ts): flag SETELAH `<tool>`
 *  (mis. `-p`, `--model`) diteruskan apa adanya ke `args`, bukan dicoba di-parse sbg opsi `run` —
 *  menutup I-29 (tanpa ini `acca run claude -p …` → `error: unknown option '-p'`, butuh `--`). */
export function registerRunCommand(program: Command, execute: RunExecutor = runExecutor): void {
  program
    .command('run')
    .description('Jalankan CLI target (claude | antigravity/agy) di bawah wrapper acca')
    .argument('<tool>', 'nama tool: claude | antigravity | agy')
    .argument('[args...]', 'argumen diteruskan apa adanya ke CLI target')
    .passThroughOptions()
    .action((tool: string, args: string[]) => {
      // Back-compat: dgn passThroughOptions, commander TAK lagi menelan `--` pemisah → ia terbawa
      // literal. Buang satu `--` di depan (posisi pemisah) supaya `acca run claude -- -p x` (workaround
      // lama) tetap setara `acca run claude -p x` dan `--` tak keliru diteruskan ke CLI target.
      const passthrough = args[0] === '--' ? args.slice(1) : args;
      return execute(tool, passthrough);
    });
}
