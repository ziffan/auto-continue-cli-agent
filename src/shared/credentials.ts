// Baca kredensial OAuth Claude Code dari disk (dipakai jalur probe usage CC — M3d.3). Cross-platform
// via `os.homedir()` (bukan `process.env.HOME` — tak konsisten di Windows). TAK PERNAH melempar isi
// token ke pesan error (least-exposure — CONVENTIONS.md).

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Dilempar saat file kredensial tak ada / tak terbaca / bukan JSON valid / bentuknya tak dikenali.
 * Pesan sengaja generik — TIDAK menyertakan isi file (bisa berisi token). */
export class ClaudeCredentialsError extends Error {
  constructor(reason: string) {
    super(`ClaudeCredentials: ${reason}`);
    this.name = 'ClaudeCredentialsError';
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Path standar file kredensial Claude Code (v2.1.199+). */
export function claudeCredentialsPath(): string {
  return join(homedir(), '.claude', '.credentials.json');
}

/** Baca + parse file kredensial. `readFileImpl` = seam test (default `readFileSync` nyata). */
export function loadClaudeCredentials(readFileImpl: typeof readFileSync = readFileSync): unknown {
  let raw: string;
  try {
    raw = readFileImpl(claudeCredentialsPath(), 'utf-8');
  } catch {
    throw new ClaudeCredentialsError('file kredensial tak terbaca (tak ada / tak bisa diakses).');
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new ClaudeCredentialsError('isi file kredensial bukan JSON valid.');
  }
}

/** Navigasi defensif ke `claudeAiOauth.accessToken`. Melempar tanpa membocorkan nilai token apa pun. */
export function extractClaudeToken(cred: unknown): string {
  if (!isRecord(cred)) throw new ClaudeCredentialsError('bentuk kredensial tak dikenali (bukan objek).');
  const oauth = cred['claudeAiOauth'];
  if (!isRecord(oauth)) throw new ClaudeCredentialsError('field "claudeAiOauth" tak ditemukan.');
  const token = oauth['accessToken'];
  if (typeof token !== 'string' || token.length === 0) {
    throw new ClaudeCredentialsError('field "accessToken" absen atau bukan string.');
  }
  return token;
}
