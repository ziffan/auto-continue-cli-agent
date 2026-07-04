// Temukan port TCP listen milik sebuah PID (agy Language Server bind gRPC + HTTP di dua port
// random — dipakai jalur probe usage agy, M3d.4). Lintas-OS: Windows (PowerShell Get-NetTCPConnection,
// SUDAH terkorelasi per-PID oleh OS) dan Linux (korelasi inode /proc/<pid>/fd → /proc/net/tcp{,6}).
// Semua I/O di-inject via `PortDiscoveryDeps` supaya testable tanpa proses/OS nyata.

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { platform as osPlatform } from 'node:os';

/** Dilempar saat OS tak didukung, atau I/O (exec/proc) gagal secara tak terduga. */
export class PortDiscoveryError extends Error {
  constructor(pid: number, reason: string) {
    super(`PortDiscovery: gagal menemukan port untuk PID ${pid} — ${reason}`);
    this.name = 'PortDiscoveryError';
  }
}

export interface PortDiscoveryDeps {
  // Cast tipis ke `string` (bukan namespace ambient `NodeJS.Platform`) — pola sama seperti
  // `daemon/supervisor.ts`/`daemon/ipc-server.ts` (eslint no-undef tak mengenali `NodeJS` di file ini).
  platform?: () => string;
  exec?: (cmd: string, shell: string) => string;
  readDir?: (path: string) => string[];
  readLink?: (path: string) => string;
  readFile?: (path: string) => string;
}

function dedupe(ports: number[]): number[] {
  return [...new Set(ports)];
}

function runPowerShell(pid: number, exec: (cmd: string, shell: string) => string): number[] {
  const cmd = `Get-NetTCPConnection -OwningProcess ${pid} -State Listen -EA SilentlyContinue | Select-Object -Expand LocalPort`;
  let out: string;
  try {
    out = exec(cmd, 'powershell.exe');
  } catch {
    return []; // gagal exec (mis. proses sudah mati) → kosong, bukan throw (caller yang putuskan).
  }
  const ports: number[] = [];
  for (const line of out.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const n = parseInt(trimmed, 10);
    if (Number.isInteger(n) && n >= 1 && n <= 65535) ports.push(n);
  }
  return dedupe(ports);
}

function discoverWindows(pid: number, deps: Required<Pick<PortDiscoveryDeps, 'exec'>>): number[] {
  return runPowerShell(pid, deps.exec);
}

/** Kumpulkan set inode socket milik PID via `/proc/<pid>/fd/<n>` → `readlink` → `socket:[<inode>]`. */
function collectSocketInodes(
  pid: number,
  readDir: (path: string) => string[],
  readLink: (path: string) => string,
): Set<string> {
  const fdDir = `/proc/${pid}/fd`;
  let entries: string[];
  try {
    entries = readDir(fdDir);
  } catch (err) {
    throw new PortDiscoveryError(pid, `tak bisa membaca ${fdDir}: ${String(err)}`);
  }
  const inodes = new Set<string>();
  for (const entry of entries) {
    let link: string;
    try {
      link = readLink(`${fdDir}/${entry}`);
    } catch {
      continue; // fd race (ditutup di antara readdir & readlink) — skip, bukan fatal.
    }
    const m = /^socket:\[(\d+)\]$/.exec(link);
    if (m?.[1] !== undefined) inodes.add(m[1]);
  }
  return inodes;
}

/** Parse satu tabel `/proc/net/tcp{,6}` → port LISTEN yang inode-nya ada di `inodes`. */
function portsFromProcNetTcp(content: string, inodes: Set<string>): number[] {
  const ports: number[] = [];
  const lines = content.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const cols = trimmed.split(/\s+/);
    const localAddress = cols[1];
    const st = cols[3];
    const inode = cols[9];
    if (localAddress === undefined || st === undefined || inode === undefined) continue;
    if (st !== '0A') continue; // hanya LISTEN
    if (!inodes.has(inode)) continue;
    const hexPort = localAddress.split(':')[1];
    if (hexPort === undefined) continue;
    const port = parseInt(hexPort, 16);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) ports.push(port);
  }
  return ports;
}

function discoverLinux(
  pid: number,
  deps: Required<Pick<PortDiscoveryDeps, 'readDir' | 'readLink' | 'readFile'>>,
): number[] {
  const inodes = collectSocketInodes(pid, deps.readDir, deps.readLink);
  const ports: number[] = [];

  try {
    ports.push(...portsFromProcNetTcp(deps.readFile('/proc/net/tcp'), inodes));
  } catch (err) {
    throw new PortDiscoveryError(pid, `tak bisa membaca /proc/net/tcp: ${String(err)}`);
  }

  try {
    ports.push(...portsFromProcNetTcp(deps.readFile('/proc/net/tcp6'), inodes));
  } catch {
    // tcp6 boleh gagal/absen (mis. IPv6 dimatikan) — skip, bukan fatal.
  }

  return dedupe(ports);
}

export function discoverLocalPorts(pid: number, deps: PortDiscoveryDeps = {}): number[] {
  const platform = (deps.platform ?? osPlatform)();
  if (platform === 'win32') {
    return discoverWindows(pid, { exec: deps.exec ?? ((cmd, shell) => execSync(cmd, { shell, encoding: 'utf-8' })) });
  }
  if (platform === 'linux') {
    return discoverLinux(pid, {
      readDir: deps.readDir ?? ((p) => readdirSync(p)),
      readLink: deps.readLink ?? ((p) => readlinkSync(p)),
      readFile: deps.readFile ?? ((p) => readFileSync(p, 'utf-8')),
    });
  }
  // darwin dst — tak ada /proc, target proyek hanya Ubuntu (daily) + Windows (weekend) (CLAUDE.md §6).
  throw new PortDiscoveryError(pid, 'OS unsupported');
}
