import { describe, expect, it } from 'vitest';
import { createLineDecoder, encodeLine } from '../src/daemon/ipc-protocol.js';

describe('ipc-protocol', () => {
  it('encodeLine terminates with newline and round-trips through JSON.parse', () => {
    const line = encodeLine({ id: 'a1', cmd: 'ping', args: { x: 1 } });
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line.trimEnd())).toEqual({ id: 'a1', cmd: 'ping', args: { x: 1 } });
  });

  it('reassembles a JSON line split across multiple chunks', () => {
    const decoder = createLineDecoder();
    const full = encodeLine({ id: '1', ok: true, data: { hello: 'world' } });
    const mid = Math.floor(full.length / 2);

    expect(decoder.push(full.slice(0, mid))).toEqual([]);
    const lines = decoder.push(full.slice(mid));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toEqual({ id: '1', ok: true, data: { hello: 'world' } });
  });

  it('returns multiple lines delivered in a single chunk', () => {
    const decoder = createLineDecoder();
    const chunk = encodeLine({ id: '1', cmd: 'a' }) + encodeLine({ id: '2', cmd: 'b' });
    const lines = decoder.push(chunk);

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ id: '1', cmd: 'a' });
    expect(JSON.parse(lines[1] as string)).toMatchObject({ id: '2', cmd: 'b' });
  });

  it('keeps a trailing partial line buffered until the next push completes it', () => {
    const decoder = createLineDecoder();
    expect(decoder.push('{"id":"1","cmd":"a"')).toEqual([]);

    const lines = decoder.push('}\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toEqual({ id: '1', cmd: 'a' });
  });

  it('accepts Buffer chunks in addition to strings', () => {
    const decoder = createLineDecoder();
    const lines = decoder.push(Buffer.from(encodeLine({ id: '1', ok: true, data: null })));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toEqual({ id: '1', ok: true, data: null });
  });
});
