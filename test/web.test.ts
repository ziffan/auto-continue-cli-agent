import { type IncomingMessage, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  WEB_HOST,
  createWebServer,
  isLoopbackHost,
  startWebServer,
} from '../src/web/server.js';
import { buildStatusPayload } from '../src/web/status-json.js';
import { FMT_TS_JS, renderPage } from '../src/web/page.js';
import { toSessionStatusView } from '../src/store/repositories/sessions.js';
import type { Session } from '../src/shared/types.js';
import type { StoredEvent } from '../src/store/repositories/events.js';
import type { Server } from 'node:http';

// ── Host-guard unit (T-W3) ─────────────────────────────────────────────────────────────────────

describe('isLoopbackHost (guard DNS-rebinding, T-W3)', () => {
  it('loopback (dengan/ tanpa port, IPv6) → true', () => {
    for (const h of ['127.0.0.1', '127.0.0.1:4599', 'localhost', 'localhost:8080', '[::1]', '[::1]:1']) {
      expect(isLoopbackHost(h)).toBe(true);
    }
  });
  it('host asing / kosong / undefined → false', () => {
    for (const h of ['evil.com', 'evil.com:4599', 'attacker.localhost.evil.com', '', undefined]) {
      expect(isLoopbackHost(h)).toBe(false);
    }
  });
});

// ── Server integration (routing + method + host + bind) ─────────────────────────────────────────

const PAYLOAD = {
  now: 1_000,
  usage: { claude: ['CLAUDE CODE  (x)'], antigravity: ['ANTIGRAVITY CLI  (x)'] },
  daemon: 'daemon: HIDUP',
  sessions: [],
  events: ['e1'],
};
const PAGE = '<!doctype html><html><body>ok</body></html>';

let running: Server | undefined;
afterEach(() => {
  running?.close();
  running = undefined;
});

interface RawResp {
  status: number;
  headers: IncomingMessage['headers'];
  body: string;
}

function raw(port: number, method: string, path: string, host: string | undefined): Promise<RawResp> {
  return new Promise((resolve, reject) => {
    const req = request({ host: WEB_HOST, port, method, path, headers: host === undefined ? {} : { host } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function boot(): Promise<number> {
  running = await startWebServer(0, { readStatus: () => PAYLOAD, renderPage: () => PAGE });
  return (running.address() as AddressInfo).port;
}

describe('web server (ADR-028 / M-web)', () => {
  it('bind 127.0.0.1 SAJA (loopback)', async () => {
    await boot();
    expect((running!.address() as AddressInfo).address).toBe('127.0.0.1');
  });

  it('GET / (loopback) → 200 text/html = halaman', async () => {
    const port = await boot();
    const res = await raw(port, 'GET', '/', '127.0.0.1');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toBe(PAGE);
  });

  it('GET /api/status → 200 JSON = payload', async () => {
    const port = await boot();
    const res = await raw(port, 'GET', '/api/status', '127.0.0.1');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(JSON.parse(res.body)).toEqual(PAYLOAD);
  });

  it('POST / → 405 + Allow: GET (T-W2 nol mutasi)', async () => {
    const port = await boot();
    const res = await raw(port, 'POST', '/', '127.0.0.1');
    expect(res.status).toBe(405);
    expect(res.headers['allow']).toBe('GET');
  });

  it('Host non-loopback (evil.com) → 403 (T-W3)', async () => {
    const port = await boot();
    const res = await raw(port, 'GET', '/api/status', 'evil.com');
    expect(res.status).toBe(403);
    expect(res.body).not.toContain('CLAUDE'); // tak membocorkan payload
  });

  it('path tak dikenal → 404', async () => {
    const port = await boot();
    const res = await raw(port, 'GET', '/secret', '127.0.0.1');
    expect(res.status).toBe(404);
  });

  it('createWebServer belum listen (lifecycle diserahkan pemanggil)', () => {
    const s = createWebServer({ readStatus: () => PAYLOAD, renderPage: () => PAGE });
    expect(s.listening).toBe(false);
    s.close();
  });
});

// ── buildStatusPayload — DATA-MINIMIZE (T-W1: nol jalur data baru) ───────────────────────────────

const fullSession = (over: Partial<Session> = {}): Session => ({
  id: 'a1b2',
  tool: 'claude',
  cli_session_id: 'RESUME-CAP-SECRET-ID',
  cwd: '/home/user/proj/RAHASIA',
  pid: 1234,
  status: 'RUNNING',
  proc_state: 'alive',
  detected_at: null,
  detect_source: null,
  reset_at: null,
  reset_source: null,
  created_at: 1,
  updated_at: 2,
  archived_at: null,
  resumed_from: null,
  ...over,
});

const evt = (over: Partial<StoredEvent> = {}): StoredEvent => ({
  id: 1,
  session_id: 'a1b2',
  type: 'status_change',
  payload: JSON.stringify({ to: 'LIMIT_HIT', source: 'verify', evidence: 'LEAK-ME-secret-snippet' }),
  created_at: 1_700_000_000_000,
  ...over,
});

describe('buildStatusPayload — proyeksi ter-firewall (T-W1)', () => {
  const base = {
    usageClaudeRaw: undefined,
    usageAntigravityRaw: undefined,
    heartbeat: undefined,
    sessions: [],
    events: [],
    nowMs: 5_000,
    isAlive: () => true,
  };

  it('sesi: JSON kabel TAK memuat cli_session_id maupun cwd (data-minimize)', () => {
    const payload = buildStatusPayload({ ...base, sessions: [toSessionStatusView(fullSession())] });
    const wire = JSON.stringify(payload);
    expect(wire).not.toContain('RESUME-CAP-SECRET-ID');
    expect(wire).not.toContain('RAHASIA');
    expect(wire).not.toContain('cli_session_id');
    expect(wire).not.toContain('cwd');
    // field yang MEMANG boleh tampil tetap ada
    expect(payload.sessions[0]!.id).toBe('a1b2');
    expect(payload.sessions[0]!.status).toBe('RUNNING');
  });

  it('usage: field sensitif (scope model) tak pernah bocor (G-9 lewat formatUsageLines)', () => {
    const raw = JSON.stringify({
      tool: 'claude',
      capturedAt: 5_000,
      limits: [{ kind: 'weekly_scoped', usedFraction: 0.5, resetAt: null, scope: 'Opus-SECRET-model' }],
    });
    const payload = buildStatusPayload({ ...base, usageClaudeRaw: raw });
    expect(JSON.stringify(payload)).not.toContain('SECRET');
  });

  it('events: evidence mentah TAK bocor (formatEventLine SUMMARY_ALLOWLIST)', () => {
    const payload = buildStatusPayload({ ...base, events: [evt()] });
    const wire = JSON.stringify(payload);
    expect(wire).not.toContain('LEAK-ME');
    expect(payload.events[0]).toContain('to=LIMIT_HIT'); // field allowlist tetap tampil
  });

  it('daemon: string liveness dari formatDaemonLiveness', () => {
    const payload = buildStatusPayload({ ...base, heartbeat: { at: 4_000, pid: 9 }, isAlive: () => true });
    expect(payload.daemon).toContain('HIDUP');
  });
});

// ── Halaman self-contained (T-W4) + render-as-text (T-W5) ───────────────────────────────────────

describe('renderPage — self-contained (T-W4/T-W5)', () => {
  const page = renderPage();

  it('NOL URL eksternal (http(s)://) → nol egress baru', () => {
    expect(/https?:\/\//.test(page)).toBe(false);
  });

  it('NOL atribut src/href ke aset eksternal', () => {
    expect(/\b(src|href)\s*=/.test(page)).toBe(false);
  });

  it('render via textContent, BUKAN innerHTML (anti-XSS)', () => {
    expect(page).not.toContain('innerHTML');
    expect(page).toContain('textContent');
  });

  it('fetch hanya ke same-origin /api/status', () => {
    expect(page).toContain("fetch('/api/status'");
  });
});

// ── Formatter timestamp sisi-browser (W-3) ───────────────────────────────────────────────────────

describe('fmtTs — formatter reset_at/updated_at (W-3)', () => {
  // Evaluasi SUMBER JS yang PERSIS di-embed ke halaman (nol duplikasi, nol jsdom). String =
  // konstanta kita sendiri (bukan input), jadi implied-eval di sini aman & disengaja utk menguji
  // kode-terkirim yang sebenarnya.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
  const fmtTs = new Function(`${FMT_TS_JS}; return fmtTs;`)() as (
    ms: number | null | undefined,
    now: number,
  ) => string;
  const now = new Date('2026-07-19T10:00:00').getTime(); // waktu LOKAL (formatter pakai getHours lokal)

  it('null/undefined → "-"', () => {
    expect(fmtTs(null, now)).toBe('-');
    expect(fmtTs(undefined, now)).toBe('-');
  });

  it('sama-hari (≤24 jam) → HH:MM zero-padded, tanpa nama hari', () => {
    const t = new Date('2026-07-19T03:05:00').getTime();
    expect(fmtTs(t, now)).toBe('03:05');
  });

  it('>24 jam ke depan (window mingguan) → sisipkan nama hari (anti-B-2)', () => {
    const t = new Date('2026-07-22T14:30:00').getTime(); // Rabu
    expect(fmtTs(t, now)).toBe('Rab 14:30');
  });

  it('>24 jam ke belakang → juga bernama hari (updated_at basi)', () => {
    const t = new Date('2026-07-16T21:00:00').getTime(); // Kamis
    expect(fmtTs(t, now)).toBe('Kam 21:00');
  });

  it('halaman meng-embed FMT_TS_JS + memanggil fmtTs utk kolom waktu', () => {
    const page = renderPage();
    expect(page).toContain('function fmtTs(');
    expect(page).toContain('fmtTs(v, nowMs)');
    expect(page).toContain('reset_at:');
    expect(page).toContain('updated_at:');
  });
});
