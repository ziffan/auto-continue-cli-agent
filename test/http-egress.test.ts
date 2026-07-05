import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  EgressBlockedError,
  guardEgress,
  loopbackHttpsPostJson,
  safeFetch,
  type HttpsRequestFn,
} from '../src/shared/http.js';

/** Fake `https.request` → membalas `status`+`body` async (meniru urutan cb(res) lalu data/end). */
function fakeHttps(status: number, body: string, onWrite?: (chunk: string) => void): HttpsRequestFn {
  return ((_opts: unknown, cb: (res: unknown) => void) => {
    const res = new EventEmitter() as EventEmitter & { statusCode?: number };
    res.statusCode = status;
    const req = new EventEmitter() as EventEmitter & {
      write: (c: string) => void;
      end: () => void;
    };
    req.write = (c: string) => onWrite?.(c);
    req.end = () => {
      setImmediate(() => {
        cb(res); // pemanggil memasang listener data/end di sini
        res.emit('data', Buffer.from(body));
        res.emit('end');
      });
    };
    return req;
  }) as unknown as HttpsRequestFn;
}

describe('guardEgress', () => {
  it.each([
    'https://api.anthropic.com/api/oauth/usage',
    'https://cloudcode-pa.googleapis.com/foo',
    'https://api.telegram.org/botTOKEN/sendMessage',
    'http://localhost:1234/x',
    'http://127.0.0.1:55031/y',
    'http://[::1]:8080/z',
  ])('allows allowlisted host: %s', (url) => {
    expect(() => guardEgress(url)).not.toThrow();
  });

  it('blocks a host not in the allowlist', () => {
    expect(() => guardEgress('https://evil.example.com/steal')).toThrow(EgressBlockedError);
  });

  it('throws for an invalid URL string', () => {
    expect(() => guardEgress('not a url at all')).toThrow(EgressBlockedError);
  });
});

describe('safeFetch', () => {
  it('calls fetchImpl for an allowlisted host', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    await safeFetch('https://api.anthropic.com/api/oauth/usage', undefined, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does NOT call fetchImpl for a blocked host', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    await expect(safeFetch('https://evil.example.com/steal', undefined, fetchImpl)).rejects.toThrow(EgressBlockedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('loopbackHttpsPostJson', () => {
  const URL_OK = 'https://127.0.0.1:16484/exa.language_server_pb.LanguageServerService/GetUserStatus';

  it('resolves status + body for an https loopback host', async () => {
    const resp = await loopbackHttpsPostJson(URL_OK, '{}', fakeHttps(200, '{"ok":true}'));
    expect(resp).toEqual({ status: 200, body: '{"ok":true}' });
  });

  it('writes the json body to the request', async () => {
    const written: string[] = [];
    await loopbackHttpsPostJson(URL_OK, '{"a":1}', fakeHttps(200, '', (c) => written.push(c)));
    expect(written).toEqual(['{"a":1}']);
  });

  it('rejects a non-loopback host even if allowlisted (insecure-TLS loopback only)', () => {
    const impl = vi.fn() as unknown as HttpsRequestFn;
    expect(() => loopbackHttpsPostJson('https://api.anthropic.com/x', '{}', impl)).toThrow(
      EgressBlockedError,
    );
    expect(impl).not.toHaveBeenCalled();
  });

  it('rejects http:// loopback (must be https)', () => {
    const impl = vi.fn() as unknown as HttpsRequestFn;
    expect(() => loopbackHttpsPostJson('http://127.0.0.1:16484/x', '{}', impl)).toThrow(
      EgressBlockedError,
    );
    expect(impl).not.toHaveBeenCalled();
  });

  it('rejects a host outside the allowlist before requesting', () => {
    const impl = vi.fn() as unknown as HttpsRequestFn;
    expect(() => loopbackHttpsPostJson('https://evil.example.com/x', '{}', impl)).toThrow(
      EgressBlockedError,
    );
    expect(impl).not.toHaveBeenCalled();
  });
});
