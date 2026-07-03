// Salin file migrasi SQL (bukan .ts, jadi tak ikut dikompilasi tsc) ke dist/ setelah build.
// Dipanggil dari script "build" (package.json).
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'src', 'store', 'migrations');
const dest = join(root, 'dist', 'store', 'migrations');

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });

console.log(`Migrasi disalin: ${src} -> ${dest}`);
