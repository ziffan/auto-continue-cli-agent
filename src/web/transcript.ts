// Baca context window & model name dari transcript JSONL Claude Code.
// PURE: I/O di-inject via deps (default `fs.readFileSync`). Path dihitung dari
// cwd session + cli_session_id. Semua kegagalan → null (jangan throw).
//
// T-W1: modul ini HANYA dipanggil dari server-side (`cli/commands/web.ts`).
// Derived values (model, token count, pct) BOLEH masuk payload; path/cwd TIDAK.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Session } from '../shared/types.js';

export interface SessionContext {
  /** Model display name — "Opus 5", "Sonnet 5", dsb. null = tak bisa ditentukan. */
  model: string | null;
  /** Total token di context window (input + cache + output entry terbaru). */
  contextTokens: number;
  /** Ukuran context window maksimum model (default 200000). */
  contextWindowSize: number;
  /** Persentase context terpakai (0–100). */
  contextPct: number;
}

export interface ReadTranscriptDeps {
  /** Baca file transcript. Default = `fs.readFileSync` (utf-8). Injeksi untuk test. */
  readFile: (path: string) => string | null;
  /** Clock. Default = `Date.now`. Injeksi untuk determinisme test. */
  now: () => number;
}

/** Entry minimal dari transcript JSONL — hanya field yang kita butuhkan. */
interface TranscriptEntry {
  message?: {
    model?: unknown;
    usage?: {
      input_tokens?: unknown;
      cache_creation_input_tokens?: unknown;
      cache_read_input_tokens?: unknown;
      output_tokens?: unknown;
    };
  };
}

/** Default context window CC bila model tak bisa ditentukan. */
const DEFAULT_CONTEXT_WINDOW = 200_000;

/** Encode cwd = ganti non-alphanumeric dengan '-' (G-34). */
function encodeCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  return undefined;
}

function toString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.length > 0) return v;
  return undefined;
}

/**
 * Parse satu baris JSONL → extract context tokens + model.
 * Return null bila baris tak punya usage (bukan entry assistant).
 */
function parseEntry(line: string): { tokens: number; model: string | null } | null {
  let entry: TranscriptEntry;
  try {
    entry = JSON.parse(line) as TranscriptEntry;
  } catch {
    return null;
  }
  const usage = entry.message?.usage;
  if (!usage || typeof usage.input_tokens !== 'number') return null;

  const tokens =
    (toNumber(usage.input_tokens) ?? 0) +
    (toNumber(usage.cache_creation_input_tokens) ?? 0) +
    (toNumber(usage.cache_read_input_tokens) ?? 0) +
    (toNumber(usage.output_tokens) ?? 0);

  const model = toString(entry.message?.model) ?? null;
  return { tokens, model };
}

/**
 * Baca context window CC dari transcript JSONL.
 *
 * Strategi: scan dari baris TERAKHIR ke atas (entry terbaru = konteks saat ini).
 * Berhenti di entry pertama yang punya `message.usage` — itulah snapshot
 * context window terbaru.
 *
 * @param session - full Session row (butuh `tool`, `cwd`, `cli_session_id`)
 * @param deps   - opsional, injeksi `readFile` + `now` untuk test
 * @returns `SessionContext` atau null bila tak tersedia (bukan CC / file ga ada /
 *          transcript kosong / JSON rusak / tak ada usage entry)
 */
export function readCcTranscriptContext(
  session: Session,
  deps?: ReadTranscriptDeps,
): SessionContext | null {
  // Guard: hanya CC yang punya transcript.
  if (session.tool !== 'claude') return null;
  if (!session.cli_session_id || !session.cwd) return null;

  const readFile = deps?.readFile ?? ((p: string): string | null => {
    try {
      return readFileSync(p, 'utf-8');
    } catch {
      return null;
    }
  });

  const encodedCwd = encodeCwd(session.cwd);
  const transcriptPath = join(
    homedir(),
    '.claude',
    'projects',
    encodedCwd,
    `${session.cli_session_id}.jsonl`,
  );

  const content = readFile(transcriptPath);
  if (content === null) return null;

  const lines = content.split('\n');

  // Scan dari belakang — entry terbaru = context window terkini.
  let model: string | null = null;
  let contextTokens = 0;
  let found = false;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const parsed = parseEntry(line);
    if (parsed !== null) {
      contextTokens = parsed.tokens;
      if (model === null && parsed.model !== null) model = parsed.model;
      found = true;
      break;
    }
    // Track model walau dari entry non-usage (fallback).
    if (model === null) {
      try {
        const e = JSON.parse(line) as TranscriptEntry;
        const m = toString(e.message?.model);
        if (m) model = m;
      } catch {
        // lanjut
      }
    }
  }

  if (!found) return null;

  const contextWindowSize = DEFAULT_CONTEXT_WINDOW;
  const contextPct = Math.round((contextTokens / contextWindowSize) * 100);

  return {
    model,
    contextTokens,
    contextWindowSize,
    contextPct: Math.min(contextPct, 100),
  };
}
