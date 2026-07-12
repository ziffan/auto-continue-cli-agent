import type { Command } from 'commander';
import { sendCommand } from '../../daemon/ipc-client.js';
import { sessionControlSocketPath } from '../../shared/paths.js';

/** Baca SELURUH stdin sebagai string (payload hook JSON yang CC kirim ke subproses hook). */
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

/**
 * Perintah INTERNAL (tersembunyi) `acca __hook <sessionId>` — forwarder hook CC (I-23). Dipasang sebagai
 * hook `command` di settings.json yang wrapper generate; CC menjalankannya sebagai subproses saat
 * `StopFailure`/`SessionStart` fire dan mengirim payload event lewat **stdin**.
 *
 * Tugasnya SEMPIT & best-effort: baca payload → ekstrak HANYA field terkontrol
 * (`hook_event_name`, `error` [enum], `session_id` [identifier]) → teruskan ke socket kontrol per-sesi
 * milik wrapper. TAK PERNAH mencetak ke stdout (SessionStart memakai stdout sebagai konteks Claude —
 * kita tak menyuntik apa pun) & SELALU exit 0 (kedua event mengabaikan output/exit code; forwarder tak
 * boleh mengganggu CC). **Injection firewall (ADR-013):** forwarder tak meneruskan teks bebas
 * (transcript/pesan) — hanya field terklasifikasi; sisi wrapper hanya meng-`classify` `error` &
 * menyimpan `session_id`, tak menurunkan aksi apa pun dari isi.
 */
export function registerHookCommand(program: Command): void {
  program
    .command('__hook <sessionId>', { hidden: true })
    .description('(internal) forwarder hook Claude Code → socket kontrol sesi')
    .action(async (sessionId: string) => {
      try {
        const raw = await readStdin();
        const payload = JSON.parse(raw) as {
          hook_event_name?: unknown;
          error?: unknown;
          session_id?: unknown;
        };
        const msg = {
          event: typeof payload.hook_event_name === 'string' ? payload.hook_event_name : undefined,
          error: typeof payload.error === 'string' ? payload.error : undefined,
          ccSessionId: typeof payload.session_id === 'string' ? payload.session_id : undefined,
        };
        await sendCommand(sessionControlSocketPath(sessionId), 'hook', msg, { timeoutMs: 2000 });
      } catch {
        // Best-effort: wrapper tak mendengarkan / payload rusak / timeout → abaikan (jangan ganggu CC).
      }
      process.exit(0);
    });
}
