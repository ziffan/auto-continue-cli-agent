// Server Web UI monitor (ADR-028 / M-web) — read-only, bind 127.0.0.1 SAJA, zero-dep (http bawaan).
// Kontrak keamanan MENGIKAT (THREAT-MODEL §9):
//   • GET-only            → method lain 405 (T-W2: nol mutasi)
//   • Host-guard          → Host non-loopback 403 (T-W3: DNS-rebinding)
//   • bind loopback saja  → WEB_HOST hardcoded '127.0.0.1' (bukan configurable ke LAN di v1)
//   • data ter-firewall   → readStatus di-inject; server tak menyentuh store/data langsung
import { type Server, createServer } from 'node:http';
import type { StatusPayload } from './status-json.js';

export const WEB_HOST = '127.0.0.1';
export const DEFAULT_WEB_PORT = 4599;

// Hostname yang sah untuk akses loopback. Cocokkan hostname SAJA (port diabaikan) — cukup untuk
// menolak DNS-rebinding (Host penyerang = domainnya, mis. `evil.com`).
// IPv6 loopback dalam Host header WAJIB bracketed (`[::1]`); bentuk telanjang `::1` bukan Host valid.
const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** True bila header `Host` menunjuk loopback. Kosong/asing → false (→ 403). */
export function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (hostHeader === undefined || hostHeader === '') return false;
  // Ambil bagian hostname (buang :port). IPv6 literal `[::1]:port` → sisakan `[::1]`.
  const hostname = hostHeader.startsWith('[')
    ? hostHeader.slice(0, hostHeader.indexOf(']') + 1)
    : (hostHeader.split(':')[0] ?? '');
  return ALLOWED_HOSTNAMES.has(hostname.toLowerCase());
}

export interface WebServerDeps {
  /** Boundary impur: baca snapshot status ter-firewall (di-inject → server tetap read-only & testable). */
  readStatus: () => StatusPayload;
  /** HTML self-contained (nol aset eksternal). */
  renderPage: () => string;
}

/** Rakit `http.Server` read-only. Belum listen — pemanggil urus lifecycle (lihat `startWebServer`). */
export function createWebServer(deps: WebServerDeps): Server {
  return createServer((req, res) => {
    // 1) GET-only (T-W2).
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }
    // 2) Host-guard (T-W3: DNS-rebinding).
    if (!isLoopbackHost(req.headers.host)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(deps.renderPage());
      return;
    }
    if (path === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(deps.readStatus()));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  });
}

/** Listen di `WEB_HOST` (loopback saja) + `port`. Resolve saat siap; reject bila bind gagal
 *  (mis. port terpakai) — pemanggil cetak pesan jelas + exit. */
export function startWebServer(port: number, deps: WebServerDeps): Promise<Server> {
  const server = createWebServer(deps);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, WEB_HOST, () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}
