// Egress guard (NFR §Security / ADR-013): satu-satunya jalur keluar jaringan yang diizinkan.
// Semua panggilan HTTP di codebase ini WAJIB lewat `safeFetch` — tak ada `fetch` telanjang.
// Allowlist sengaja sempit: hanya host yang benar-benar dipakai probe usage (CC/agy) + Telegram +
// loopback (agy Language Server lokal). Host lain → `EgressBlockedError`, bukan silently proceed.

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
