import { describe, expect, it } from 'vitest';
import { discoverLocalPorts, PortDiscoveryError } from '../src/shared/port-discovery.js';

describe('discoverLocalPorts — linux (inode correlation)', () => {
  const PID = 4242;

  function makeDeps(tcp6Throws = true) {
    const readDir = (path: string): string[] => {
      expect(path).toBe(`/proc/${PID}/fd`);
      return ['0', '1', '23'];
    };
    const readLink = (path: string): string => {
      if (path === `/proc/${PID}/fd/0`) return 'socket:[1111]';
      if (path === `/proc/${PID}/fd/1`) return 'socket:[2222]';
      if (path === `/proc/${PID}/fd/23`) return 'pipe:[3333]'; // not a socket — must be ignored
      throw new Error(`unexpected fd path: ${path}`);
    };
    const tcpFixture = [
      '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
      // LISTEN, inode 1111 (owned by PID) — port hex 1F90 = 8080 — should be included
      '   0: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1111 1 0000000000000000 100 0 0 10 0',
      // LISTEN, inode 2222 (owned by PID) — port hex 270F = 9999 — should be included
      '   1: 00000000:270F 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 2222 1 0000000000000000 100 0 0 10 0',
      // non-LISTEN (TIME_WAIT, st=06) even though inode 1111 matches — must be excluded
      '   2: 00000000:1F90 00000000:0000 06 00000000:00000000 00:00000000 00000000  1000        0 1111 1 0000000000000000 100 0 0 10 0',
      // LISTEN but inode 9999 is NOT owned by this PID — must be excluded
      '   3: 00000000:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 9999 1 0000000000000000 100 0 0 10 0',
    ].join('\n');
    const readFile = (path: string): string => {
      if (path === '/proc/net/tcp') return tcpFixture;
      if (path === '/proc/net/tcp6') {
        if (tcp6Throws) throw new Error('ENOENT: no ipv6');
        return '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode';
      }
      throw new Error(`unexpected path: ${path}`);
    };
    return { platform: () => 'linux', readDir, readLink, readFile };
  }

  it('returns only ports owned by the PID in LISTEN state, hex-decoded correctly', () => {
    const ports = discoverLocalPorts(PID, makeDeps());
    expect(ports.sort((a, b) => a - b)).toEqual([8080, 9999]);
  });

  it('tolerates /proc/net/tcp6 failing (IPv6 disabled) without throwing', () => {
    const ports = discoverLocalPorts(PID, makeDeps(true));
    expect(ports.length).toBeGreaterThan(0);
  });

  it('wraps a fd-directory read failure in PortDiscoveryError', () => {
    const deps = {
      platform: () => 'linux',
      readDir: () => {
        throw new Error('EACCES');
      },
      readLink: () => '',
      readFile: () => '',
    };
    expect(() => discoverLocalPorts(PID, deps)).toThrow(PortDiscoveryError);
  });
});

describe('discoverLocalPorts — windows', () => {
  const PID = 9001;

  it('parses newline-separated LocalPort output from Get-NetTCPConnection', () => {
    const exec = (cmd: string): string => {
      expect(cmd).toContain(`-OwningProcess ${PID}`);
      return '55031\n55032\n';
    };
    const ports = discoverLocalPorts(PID, { platform: () => 'win32', exec });
    expect(ports).toEqual([55031, 55032]);
  });

  it('returns an empty array when exec output is empty', () => {
    const exec = (): string => '';
    const ports = discoverLocalPorts(PID, { platform: () => 'win32', exec });
    expect(ports).toEqual([]);
  });

  it('returns an empty array (not throw) when exec itself throws', () => {
    const exec = (): string => {
      throw new Error('process exited with code 1');
    };
    const ports = discoverLocalPorts(PID, { platform: () => 'win32', exec });
    expect(ports).toEqual([]);
  });
});

describe('discoverLocalPorts — unsupported OS', () => {
  it('throws PortDiscoveryError on darwin (no /proc, out of project scope)', () => {
    expect(() => discoverLocalPorts(123, { platform: () => 'darwin' })).toThrow(PortDiscoveryError);
  });
});
