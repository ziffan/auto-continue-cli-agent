#!/usr/bin/env node
import { buildProgram } from './program.js';
import { renderSplash, resolveBannerCaps } from '../shared/banner.js';

const program = buildProgram();

// `acca` tanpa argumen = momen kenalan (ADR-027 §4): splash penuh lalu help default.
// Ditangani SEBELUM parse — bukan via `program.action()` root, yang membuat commander mem-parse
// `acca help`/subcommand lain sbg argumen berlebih ("too many arguments"). argv non-kosong (subcommand,
// `help`, `--help`, `--version`) diteruskan apa adanya ke commander.
if (process.argv.slice(2).length === 0) {
  const splash = renderSplash(resolveBannerCaps());
  if (splash) console.log(splash);
  program.outputHelp();
  process.exit(0);
}

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
