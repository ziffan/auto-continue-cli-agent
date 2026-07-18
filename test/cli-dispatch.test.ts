import { describe, expect, it } from 'vitest';
import type { CommanderError } from 'commander';
import { buildProgram } from '../src/cli/program.js';

// Regresi: `program.action()` root pernah membuat `acca help` gagal dgn "too many arguments"
// (commander mem-parse `help` sbg argumen berlebih ke root). Guard: parse jalur bawaan commander
// tak boleh menghasilkan `commander.excessArguments`. Pakai exitOverride (lempar, bukan process.exit)
// + bungkam output.
function parseArgs(args: string[]): CommanderError | null {
  const program = buildProgram();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  try {
    program.parse(args, { from: 'user' });
    return null;
  } catch (err) {
    return err as CommanderError;
  }
}

describe('CLI dispatch (regresi root-action / help)', () => {
  it('`acca help` → tampilkan help, BUKAN "too many arguments"', () => {
    const err = parseArgs(['help']);
    expect(err).not.toBeNull();
    expect(err!.code).not.toBe('commander.excessArguments');
    expect(err!.code).toMatch(/help/);
  });

  it('`acca --help` → help, bukan excessArguments', () => {
    const err = parseArgs(['--help']);
    expect(err!.code).not.toBe('commander.excessArguments');
    expect(err!.code).toMatch(/help/);
  });

  it('`acca --version` → tampilkan versi', () => {
    const err = parseArgs(['--version']);
    expect(err!.code).toBe('commander.version');
  });

  it('subcommand tak dikenal → unknownCommand (bukan excessArguments)', () => {
    const err = parseArgs(['bogus-cmd']);
    expect(err!.code).toBe('commander.unknownCommand');
  });

  it('semua subcommand terdaftar (run/status/daemon/log/__hook/web)', () => {
    // `hook` terdaftar sbg perintah internal TERSEMBUNYI `__hook` (I-23).
    const names = buildProgram().commands.map((c) => c.name());
    for (const n of ['run', 'status', 'daemon', 'log', '__hook', 'web']) {
      expect(names).toContain(n);
    }
  });
});
