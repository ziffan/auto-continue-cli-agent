// Egress guard (NFR §Security / ADR-013): satu-satunya jalur keluar jaringan yang diizinkan.
// Semua panggilan HTTP di codebase ini WAJIB lewat `safeFetch` (host publik) atau
// `loopbackHttpsPostJson` (agy Language Server lokal, TLS self-signed) — tak ada `fetch`/`https`
// telanjang. Allowlist sengaja sempit: hanya host yang benar-benar dipakai probe usage (CC/agy) +
// Telegram + loopback. Host lain → `EgressBlockedError`, bukan silently proceed.

import { request as httpsRequest, type RequestOptions } from 'node:https';

const ALLOWED_HOSTS = new Set([
  'api.anthropic.com',
  'cloudcode-pa.googleapis.com',
  'api.telegram.org',
  'localhost',
  '127.0.0.1',
  '[::1]',
]);

/** Dilempar saat host tujuan tak ada di allowlist (atau URL tak valid). */
export class EgressBlockedError extends Error {
  constructor(target: string) {
    super(`Egress diblokir: "${target}" tak ada di allowlist host.`);
    this.name = 'EgressBlockedError';
  }
}

/** Validasi host tujuan sebelum permintaan jaringan apa pun dibuat. URL tak valid dianggap
 * diblokir juga (tak ada jalan lolos lewat parsing yang gagal). */
export function guardEgress(urlString: string): void {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new EgressBlockedError(urlString);
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new EgressBlockedError(url.hostname);
  }
}

/** Satu-satunya jalur fetch yang boleh dipakai di codebase ini. `fetchImpl` = seam test (default
 * `fetch` global nyata) — tak pernah dipanggil untuk host yang diblokir karena `guardEgress`
 * melempar duluan. */
export async function safeFetch(
  url: string | URL,
  init?: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const urlStr = url instanceof URL ? url.toString() : url;
  guardEgress(urlStr);
  return fetchImpl(url, init);
}

// --- Loopback HTTPS (agy Language Server, TLS self-signed — G-23) -----------------------------
// agy LS mem-bind endpoint HTTPS di 127.0.0.1 dengan sertifikat self-signed. undici `fetch` (global
// Node) tak bisa menonaktifkan verifikasi cert tanpa menambah dependency `undici` Agent — jadi jalur
// ini pakai `node:https` langsung dengan `rejectUnauthorized:false`. Insecure-TLS itu DIBATASI KETAT
// ke host loopback (di-guard di bawah): URL non-loopback → throw, sehingga cert buruk ke internet tak
// pernah diterima. Egress tetap divalidasi `guardEgress` (loopback ada di allowlist).

/** Hostname loopback yang boleh dipakai jalur insecure-TLS. IPv6 `::1` muncul sebagai `[::1]` di
 * `URL.hostname` (konsisten dgn `ALLOWED_HOSTS`). */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export interface LoopbackResponse {
  status: number;
  body: string;
}

/** Bentuk `https.request` yang dipakai (seam test). */
export type HttpsRequestFn = typeof httpsRequest;

/**
 * POST JSON ke endpoint HTTPS **loopback** dengan `rejectUnauthorized:false` (G-23). Melempar
 * `EgressBlockedError` bila URL bukan `https:` loopback (insecure-TLS tak pernah untuk host non-loopback)
 * atau host di luar allowlist. `requestImpl` = seam test (default `node:https` request). Respons body
 * dikembalikan mentah — pemanggil bertanggung jawab men-firewall PII/isi (parser ADR-013/G-9).
 */
export function loopbackHttpsPostJson(
  urlString: string,
  jsonBody: string,
  requestImpl: HttpsRequestFn = httpsRequest,
): Promise<LoopbackResponse> {
  guardEgress(urlString);
  const url = new URL(urlString);
  if (url.protocol !== 'https:' || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new EgressBlockedError(`${url.protocol}//${url.hostname} (hanya https loopback)`);
  }
  return new Promise<LoopbackResponse>((resolve, reject) => {
    const opts: RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      // Hanya berlaku ke loopback (sudah di-guard di atas) — cert self-signed agy LS (G-23).
      rejectUnauthorized: false,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(jsonBody),
      },
    };
    const req = requestImpl(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }),
      );
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(jsonBody);
    req.end();
  });
}
