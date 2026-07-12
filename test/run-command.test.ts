// I-29: flag setelah `<tool>` harus diteruskan apa adanya ke `args` (bukan di-parse sbg opsi `run`).
// Wiring commander = enablePositionalOptions (program) + passThroughOptions (run). Eksekutor di-inject
// sbg spy supaya arg-parsing teruji tanpa spawn PTY / sentuh store.

import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { registerRunCommand } from '../src/cli/commands/run.js';

/** Bangun program uji dgn konfigurasi identik entrypoint (index.ts) + eksekutor spy. */
function buildProgram(execute: (tool: string, args: string[]) => Promise<void>) {
  const program = new Command();
  program.exitOverride(); // lempar alih-alih process.exit saat parse-error → bisa di-assert
  program.enablePositionalOptions();
  registerRunCommand(program, execute);
  return program;
}

describe('acca run — passthrough options (I-29)', () => {
  it('passes a leading short flag after <tool> straight through to args (no `--` needed)', async () => {
    const execute = vi.fn(async () => {});
    await buildProgram(execute).parseAsync(['node', 'acca', 'run', 'claude', '-p', 'hello']);

    expect(execute).toHaveBeenCalledWith('claude', ['-p', 'hello']);
  });

  it('passes multiple flags (incl. long options) through untouched', async () => {
    const execute = vi.fn(async () => {});
    await buildProgram(execute).parseAsync([
      'node', 'acca', 'run', 'agy', '--model', 'gpt', '-p', 'x',
    ]);

    expect(execute).toHaveBeenCalledWith('agy', ['--model', 'gpt', '-p', 'x']);
  });

  it('still passes through when the caller uses the explicit `--` separator (back-compat)', async () => {
    const execute = vi.fn(async () => {});
    await buildProgram(execute).parseAsync(['node', 'acca', 'run', 'claude', '--', '-p', 'hi']);

    expect(execute).toHaveBeenCalledWith('claude', ['-p', 'hi']);
  });

  it('runs with no extra args (bare `acca run <tool>`)', async () => {
    const execute = vi.fn(async () => {});
    await buildProgram(execute).parseAsync(['node', 'acca', 'run', 'claude']);

    expect(execute).toHaveBeenCalledWith('claude', []);
  });

  it('errors when <tool> is missing (required operand still enforced)', async () => {
    const execute = vi.fn(async () => {});
    await expect(
      buildProgram(execute).parseAsync(['node', 'acca', 'run']),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});
