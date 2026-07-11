// Seam actuation inject-continue (I-12 poin 1 / ADR-014 §1) — dua sisi dari SATU kanal IPC:
//
//   • WRAPPER side (`createInjectHandler`): `acca run` pemilik PTY meng-host handler ini di socket
//     kontrol per-sesi (`sessionControlSocketPath`). Saat daemon minta, ia menjalankan gating lokal
//     (ADR-014) lalu menulis token "continue" LITERAL ke PTY-nya sendiri.
//   • DAEMON side (`requestInject`): supervisor me-connect sebagai klien ke socket kontrol sesi dan
//     mengirim perintah `inject` (TANPA payload apa pun).
//
// INJECTION FIREWALL STRUKTURAL (ADR-008/013): token yang di-inject adalah konstanta `CONTINUE_TOKEN`
// yang di-hardcode di WRAPPER — ia TAK PERNAH datang dari args IPC maupun dari isi output agent.
// Perintah `inject` di kabel tak membawa konten sama sekali (args diabaikan), jadi tak ada kanal untuk
// menyelundupkan teks dari daemon (apalagi dari transcript) ke keystroke sesi. Ini properti keamanan
// inti seam ini, bukan sekadar konvensi.

import { checkInjectGating } from '../shared/pty-control.js';
import { DaemonNotRunningError, sendCommand } from './ipc-client.js';

/** Token continue LITERAL TETAP. `\r` = Enter di terminal raw (ConPTY/xterm kirim CR, bukan LF) →
 *  mengetik "continue" lalu menekan Enter di prompt agent yang idle. TAK PERNAH diturunkan dari
 *  output (injection firewall). Keystroke pasti untuk agy = TBD live-verify (ADR-014 catatan agy). */
export const CONTINUE_TOKEN = 'continue\r';

/** Balasan handler inject (wrapper→daemon). `injected:false` + `reason` bila gating menolak. */
export interface InjectHandlerResult {
  injected: boolean;
  reason: string | null;
}

export interface InjectHandlerDeps {
  /** Proses PTY masih hidup (belum exit). */
  isAlive: () => boolean;
  /** Tulis teks ke PTY sesi (mis. `ptyProcess.write`). Dipanggil HANYA dengan `CONTINUE_TOKEN`. */
  write: (text: string) => void;
  /** Foreground = agent (bukan shell); `undefined` = belum dihitung → tak memblokir (ADR-014 gating). */
  foregroundIsAgent?: () => boolean | undefined;
  /** Sesi idle di prompt (bukan mid-turn); `undefined` = belum dihitung → tak memblokir. */
  idle?: () => boolean | undefined;
  /** R3 (I-21): dipanggil TEPAT setelah token berhasil ditulis. Wrapper memakainya untuk mengembalikan
   *  sesinya ke RUNNING + un-latch limit-watcher (ADR-017: wrapper = penulis lifecycle sesinya) supaya
   *  siklus limit berikutnya terdeteksi. TANPA argumen (tak menyentuh injection firewall — token tetap
   *  literal). Hanya dipanggil pada jalur inject SUKSES (gating lulus). */
  onInjected?: () => void;
}

/** Bangun handler IPC `inject` sisi-wrapper (bentuk `IpcHandler`). Parameter args IPC sengaja
 *  DIABAIKAN — lihat catatan injection firewall di header. Gating LULUS → tulis `CONTINUE_TOKEN`. */
export function createInjectHandler(deps: InjectHandlerDeps): (args?: unknown) => InjectHandlerResult {
  return (_args?: unknown): InjectHandlerResult => {
    const reason = checkInjectGating({
      procAlive: deps.isAlive(),
      hasPtyHandle: true, // wrapper memegang PTY (node-pty `.write`) — bukan fd numerik
      foregroundIsAgent: deps.foregroundIsAgent?.(),
      idle: deps.idle?.(),
    });
    if (reason !== null) return { injected: false, reason };
    deps.write(CONTINUE_TOKEN);
    // R3 (I-21): sinkron & setelah write — kembalikan status RUNNING + un-latch watcher SEBELUM
    // balasan `injected:true` sampai ke daemon, jadi state konsisten begitu output turn baru mengalir.
    deps.onInjected?.();
    return { injected: true, reason: null };
  };
}

/** Hasil permintaan inject dari sisi daemon. `reachable:false` = wrapper tak mendengarkan di socket
 *  kontrol (sesi kemungkinan sudah mati / tak meng-host) → daemon TIDAK men-spin, cukup surface. */
export interface InjectRequestResult {
  reachable: boolean;
  injected: boolean;
  reason: string | null;
}

/** Sisi daemon: minta wrapper pemilik `socketPath` meng-inject continue. Perintah `inject` dikirim
 *  TANPA args (injection firewall). TAK PERNAH melempar (semua kegagalan → `reachable:false`), supaya
 *  dispatch supervisor tak pernah masuk retry-spin (pelajaran revert Haiku). */
export async function requestInject(socketPath: string, opts?: { timeoutMs?: number }): Promise<InjectRequestResult> {
  try {
    const data = await sendCommand(socketPath, 'inject', undefined, { timeoutMs: opts?.timeoutMs ?? 3000 });
    const d = (data ?? {}) as { injected?: unknown; reason?: unknown };
    return {
      reachable: true,
      injected: d.injected === true,
      reason: typeof d.reason === 'string' ? d.reason : null,
    };
  } catch (err) {
    if (err instanceof DaemonNotRunningError) {
      return { reachable: false, injected: false, reason: 'wrapper_unreachable' };
    }
    // Timeout / error socket lain: perlakukan setara tak-terjangkau (jangan spin) — surface via reason.
    return { reachable: false, injected: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
