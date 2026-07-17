// T-L5 (M5.3): regresi keamanan egress whitelist — pelengkap `test/http-egress.test.ts` (sudah
// mencakup allow/block dasar untuk `guardEgress`/`safeFetch`/`loopbackHttpsPostJson`). File ini
// HANYA menambah sudut yang belum tercakup di sana: URL tak valid lewat jalur `safeFetch`/
// `loopbackHttpsPostJson` (bukan cuma `guardEgress` telanjang), dan percobaan bypass allowlist lewat
// domain-confusion (subdomain/suffix trick) — properti keamanan yang belum ada test eksplisitnya.

import { describe, expect, it, vi } from 'vitest';
import {
  EgressBlockedError,
  guardEgress,
  loopbackHttpsPostJson,
  safeFetch,
  type HttpsRequestFn,
} from '../src/shared/http.js';

describe('security-egress: domain-confusion tidak boleh lolos allowlist', () => {
  it.each([
    'https://api.anthropic.com.evil.com/steal', // suffix trick — hostname sebenarnya evil.com
    'https://evil.com/api.anthropic.com', // path trick, bukan hostname
    'https://notapi.anthropic.com/x', // prefix trick
    'https://api-anthropic.com/x', // typosquat mirip
  ])('blocks host-confusion attempt: %s', (url) => {
    expect(() => guardEgress(url)).toThrow(EgressBlockedError);
  });
});

describe('security-egress: safeFetch menolak URL tak valid tanpa memanggil fetchImpl', () => {
  it('URL malformed → EgressBlockedError, fetchImpl TAK terpanggil', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    await expect(safeFetch('not-a-valid-url', undefined, fetchImpl)).rejects.toThrow(EgressBlockedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('security-egress: loopbackHttpsPostJson end-to-end allow/block matrix', () => {
  it('lolos untuk https loopback beralamat IP (127.0.0.1) dengan port sembarang', async () => {
    const impl: HttpsRequestFn = ((_opts: unknown, cb: (res: unknown) => void) => {
      const listeners = new Map<string, (arg?: unknown) => void>();
      const res = {
        statusCode: 200,
        on: (ev: string, fn: (arg?: unknown) => void) => {
          if (ev === 'data') fn(Buffer.from('{}'));
          if (ev === 'end') fn();
        },
      };
      const req = {
        write: () => {},
        end: () => cb(res),
        on: (ev: string, fn: (arg?: unknown) => void) => {
          listeners.set(ev, fn);
        },
      };
      return req;
    }) as unknown as HttpsRequestFn;

    const resp = await loopbackHttpsPostJson('https://127.0.0.1:9999/probe', '{}', impl);
    expect(resp.status).toBe(200);
  });

  it('URL sama sekali tak valid → EgressBlockedError, requestImpl TAK terpanggil', () => {
    const impl = vi.fn() as unknown as HttpsRequestFn;
    expect(() => loopbackHttpsPostJson('::::not a url::::', '{}', impl)).toThrow(EgressBlockedError);
    expect(impl).not.toHaveBeenCalled();
  });

  it('host allowlisted publik (bukan loopback) via https tetap diblokir (insecure-TLS hanya loopback)', () => {
    const impl = vi.fn() as unknown as HttpsRequestFn;
    expect(() => loopbackHttpsPostJson('https://api.telegram.org/x', '{}', impl)).toThrow(EgressBlockedError);
    expect(impl).not.toHaveBeenCalled();
  });
});
