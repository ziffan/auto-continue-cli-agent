import { describe, expect, it, vi } from 'vitest';
import { EgressBlockedError, guardEgress, safeFetch } from '../src/shared/http.js';

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
