import * as pty from 'node-pty';
import { genSessionId } from '../shared/ids.js';
import type { Tool } from '../shared/types.js';
import type { EventsRepo } from '../store/repositories/events.js';
import type { SessionsRepo } from '../store/repositories/sessions.js';

export interface RunSessionSpec {
  file: string;
  args: string[];
  cwd: string;
  tool: Tool;
}

export interface RunSessionDeps {
  sessions: SessionsRepo;
  events: EventsRepo;
}

export interface RunSessionResult {
  sessionId: string;
  /** Resolve dengan exit code CLI target saat proses (bungkusan PTY) selesai. */
  waitForExit: Promise<number>;
}

/**
 * Inti spawn CLI target via PTY — dipisah dari `commands/run.ts` supaya bisa dipanggil
 * langsung di integration test tanpa TTY nyata (raw-mode dilewati otomatis bila
 * `process.stdin.isTTY` falsy).
 */
export function runSession(spec: RunSessionSpec, deps: RunSessionDeps): RunSessionResult {
  const id = genSessionId();

  deps.sessions.createSession({
    id,
    tool: spec.tool,
    cwd: spec.cwd,
    status: 'RUNNING',
    proc_state: 'alive',
  });
  deps.events.append({ session_id: id, type: 'status_change', payload: { to: 'RUNNING' } });

  const cols = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;

  let ptyProcess;
  try {
    ptyProcess = pty.spawn(spec.file, spec.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: spec.cwd,
      env: process.env,
    });
  } catch (err) {
    // Kegagalan sinkron (mis. binary tak ditemukan) → sesi tak boleh tersisa RUNNING selamanya.
    deps.sessions.markFailed(id);
    deps.events.append({
      session_id: id,
      type: 'status_change',
      payload: { to: 'FAILED', reason: err instanceof Error ? err.message : String(err) },
    });
    return { sessionId: id, waitForExit: Promise.reject(err instanceof Error ? err : new Error(String(err))) };
  }

  deps.sessions.setPid(id, ptyProcess.pid);

  const dataSub = ptyProcess.onData((data: string) => {
    process.stdout.write(data);
  });

  let restoreStdin: (() => void) | undefined;
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onStdinData = (chunk: Buffer): void => {
      ptyProcess.write(chunk.toString('utf8'));
    };
    process.stdin.on('data', onStdinData);

    const onResize = (): void => {
      ptyProcess.resize(process.stdout.columns ?? 80, process.stdout.rows ?? 24);
    };
    process.stdout.on('resize', onResize);

    restoreStdin = (): void => {
      process.stdin.off('data', onStdinData);
      process.stdout.off('resize', onResize);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
  }

  const waitForExit = new Promise<number>((resolve) => {
    ptyProcess.onExit(({ exitCode }) => {
      dataSub.dispose();
      restoreStdin?.();
      deps.sessions.markExited(id);
      deps.events.append({
        session_id: id,
        type: 'status_change',
        payload: { to: 'EXITED', exitCode },
      });
      resolve(exitCode);
    });
  });

  return { sessionId: id, waitForExit };
}
