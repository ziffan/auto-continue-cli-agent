import { describe, expect, it } from 'vitest';
import { ClaudeCredentialsError, extractClaudeToken, loadClaudeCredentials } from '../src/shared/credentials.js';

describe('extractClaudeToken', () => {
  it('returns the token for a valid shape', () => {
    const cred = { claudeAiOauth: { accessToken: 'sk-ant-oat-abc123' } };
    expect(extractClaudeToken(cred)).toBe('sk-ant-oat-abc123');
  });

  it('throws ClaudeCredentialsError when claudeAiOauth is absent', () => {
    expect(() => extractClaudeToken({ somethingElse: true })).toThrow(ClaudeCredentialsError);
  });

  it('throws ClaudeCredentialsError when accessToken is not a string', () => {
    expect(() => extractClaudeToken({ claudeAiOauth: { accessToken: 12345 } })).toThrow(ClaudeCredentialsError);
  });

  it('throws ClaudeCredentialsError when accessToken is absent', () => {
    expect(() => extractClaudeToken({ claudeAiOauth: {} })).toThrow(ClaudeCredentialsError);
  });

  it('throws ClaudeCredentialsError for non-object input', () => {
    expect(() => extractClaudeToken(null)).toThrow(ClaudeCredentialsError);
    expect(() => extractClaudeToken('nope')).toThrow(ClaudeCredentialsError);
  });
});

describe('loadClaudeCredentials', () => {
  it('parses valid JSON via the injected readFileImpl', () => {
    const readFileImpl = (() =>
      JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } })) as unknown as typeof import('node:fs').readFileSync;
    const cred = loadClaudeCredentials(readFileImpl);
    expect(cred).toEqual({ claudeAiOauth: { accessToken: 'tok' } });
  });

  it('throws ClaudeCredentialsError when the file read throws', () => {
    const readFileImpl = (() => {
      throw new Error('ENOENT: no such file');
    }) as typeof import('node:fs').readFileSync;
    expect(() => loadClaudeCredentials(readFileImpl)).toThrow(ClaudeCredentialsError);
  });

  it('throws ClaudeCredentialsError when the file content is invalid JSON', () => {
    const readFileImpl = (() => 'not json {{{') as unknown as typeof import('node:fs').readFileSync;
    expect(() => loadClaudeCredentials(readFileImpl)).toThrow(ClaudeCredentialsError);
  });

  it('error messages never contain the token value', () => {
    const readFileImpl = (() => {
      throw new Error('ENOENT: no such file, super-secret-token-xyz');
    }) as typeof import('node:fs').readFileSync;
    try {
      loadClaudeCredentials(readFileImpl);
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain('super-secret-token-xyz');
    }
  });
});
