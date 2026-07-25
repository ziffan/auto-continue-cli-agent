// Unit test readCcTranscriptContext — parser JSONL CC (M-web enrichment).
import { describe, expect, it } from 'vitest';
import { readCcTranscriptContext } from '../src/web/transcript.js';
import type { Session } from '../src/shared/types.js';

function makeSession(over: Partial<Session> = {}): Session {
  return {
    id: 'a1b2',
    tool: 'claude',
    cli_session_id: 'cc-session-uuid-1234',
    cwd: '/home/user/my-project',
    pid: 12345,
    status: 'RUNNING',
    proc_state: 'alive',
    detected_at: null,
    detect_source: null,
    reset_at: null,
    reset_source: null,
    resumed_from: null,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    archived_at: null,
    ...over,
  };
}

describe('readCcTranscriptContext', () => {
  it('JSONL valid → return SessionContext (scan dari belakang)', () => {
    const jsonl = [
      JSON.stringify({ message: { model: 'claude-opus-5-20251001', usage: { input_tokens: 100, output_tokens: 50 } } }),
      '', // baris kosong → skip
      JSON.stringify({ message: { model: 'claude-sonnet-5-20251001', usage: { input_tokens: 1000, cache_creation_input_tokens: 200, cache_read_input_tokens: 300, output_tokens: 400 } } }),
    ].join('\n');

    const deps = { readFile: () => jsonl, now: () => 1_700_000_000_000 };
    const result = readCcTranscriptContext(makeSession(), deps);

    expect(result).not.toBeNull();
    // Ambil entry TERAKHIR (baris terakhir punya usage)
    expect(result!.contextTokens).toBe(1000 + 200 + 300 + 400); // 1900
    expect(result!.model).toBe('claude-sonnet-5-20251001');
    expect(result!.contextWindowSize).toBe(200_000);
    expect(result!.contextPct).toBe(Math.round((1900 / 200_000) * 100));
  });

  it('entry tanpa usage → skip, cari entry sebelumnya', () => {
    const jsonl = [
      JSON.stringify({ message: { model: 'claude-opus-5-20251001', usage: { input_tokens: 500, output_tokens: 200 } } }),
      JSON.stringify({ message: { role: 'user', content: 'hello' } }), // no usage
    ].join('\n');

    const deps = { readFile: () => jsonl, now: () => 1_700_000_000_000 };
    const result = readCcTranscriptContext(makeSession(), deps);

    expect(result).not.toBeNull();
    expect(result!.contextTokens).toBe(700); // entry pertama (dari belakang = yg terakhir punya usage)
    expect(result!.model).toBe('claude-opus-5-20251001');
  });

  it('JSONL kosong / tanpa entry usage → null', () => {
    const deps = { readFile: () => '', now: () => 1_700_000_000_000 };
    expect(readCcTranscriptContext(makeSession(), deps)).toBeNull();

    const noUsage = [{ message: { role: 'user' } }, { message: { content: 'hello' } }]
      .map((e) => JSON.stringify(e))
      .join('\n');
    const deps2 = { readFile: () => noUsage, now: () => 1_700_000_000_000 };
    expect(readCcTranscriptContext(makeSession(), deps2)).toBeNull();
  });

  it('file not found (readFile return null) → null', () => {
    const deps = { readFile: () => null, now: () => 1_700_000_000_000 };
    expect(readCcTranscriptContext(makeSession(), deps)).toBeNull();
  });

  it('JSON korup → skip baris itu, lanjut scan', () => {
    const jsonl = [
      'ini bukan json}}',
      JSON.stringify({ message: { usage: { input_tokens: 300, output_tokens: 100 } } }),
    ].join('\n');
    const deps = { readFile: () => jsonl, now: () => 1_700_000_000_000 };
    const result = readCcTranscriptContext(makeSession(), deps);
    expect(result).not.toBeNull();
    expect(result!.contextTokens).toBe(400);
  });

  it('model diambil dari entry non-usage sbg fallback', () => {
    // Entry terbaru = non-usage tapi punya model → model terisi dari sini.
    // Entry sebelumnya = usage tapi tanpa model → token dari sini, model dari fallback.
    const jsonl = [
      JSON.stringify({ message: { model: 'claude-haiku-4-5-20251001', usage: { input_tokens: 50, output_tokens: 20 } } }),
      JSON.stringify({ message: { model: 'claude-opus-5-20251001' } }), // non-usage, scanned first
    ].join('\n');
    const deps = { readFile: () => jsonl, now: () => 1_700_000_000_000 };
    const result = readCcTranscriptContext(makeSession(), deps);
    expect(result).not.toBeNull();
    // model dari fallback (entry non-usage yang model-nya terbaca duluan saat scan mundur)
    expect(result!.model).toBe('claude-opus-5-20251001');
    expect(result!.contextTokens).toBe(70);
  });

  it('contextPct di-clamp di 100%', () => {
    const jsonl = JSON.stringify({
      message: { usage: { input_tokens: 250_000, output_tokens: 10_000 } },
    });
    const deps = { readFile: () => jsonl, now: () => 1_700_000_000_000 };
    const result = readCcTranscriptContext(makeSession(), deps);
    expect(result).not.toBeNull();
    expect(result!.contextPct).toBe(100); // 260K / 200K = 130% → clamp 100
  });

  // ── Guard clauses ──────────────────────────────────────────────

  it('tool bukan claude → null', () => {
    const deps = { readFile: () => '{}', now: () => 1_700_000_000_000 };
    expect(readCcTranscriptContext(makeSession({ tool: 'antigravity' }), deps)).toBeNull();
  });

  it('cli_session_id null → null', () => {
    const deps = { readFile: () => '{}', now: () => 1_700_000_000_000 };
    expect(readCcTranscriptContext(makeSession({ cli_session_id: null }), deps)).toBeNull();
  });

  it('cwd kosong → null', () => {
    const deps = { readFile: () => '{}', now: () => 1_700_000_000_000 };
    expect(readCcTranscriptContext(makeSession({ cwd: '' }), deps)).toBeNull();
  });

  // ── Path encoding (G-34) ───────────────────────────────────────

  it('encode cwd Windows (G-34): non-alphanumeric → "-"', () => {
    // Verifikasi encoding cwd via guard + readFile arg. Guard lolos karena cwd ada.
    // readFile dipanggil dengan path yang mengandung encoded cwd.
    let capturedPath = '';
    const deps = {
      readFile: (p: string) => {
        capturedPath = p;
        return JSON.stringify({ message: { usage: { input_tokens: 100, output_tokens: 50 } } });
      },
      now: () => 1_700_000_000_000,
    };
    readCcTranscriptContext(makeSession({ cwd: 'D:\\PROYEK\\auto-continue-cli-agent' }), deps);
    // Harus mengandung encoded form: D--PROYEK-auto-continue-cli-agent (setiap non-alnum → '-')
    expect(capturedPath).toContain('D--PROYEK-auto-continue-cli-agent');
    // Harus mengandung cli_session_id
    expect(capturedPath).toContain('cc-session-uuid-1234');
    expect(capturedPath).toContain('.jsonl');
  });
});
