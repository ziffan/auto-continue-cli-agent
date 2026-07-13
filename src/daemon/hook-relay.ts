// Sisi-WRAPPER kanal DATA hook Claude Code (I-23) — pasangan dari forwarder `acca __hook <id>`
// (`cli/commands/hook.ts`). Wrapper meng-host handler ini di socket kontrol per-sesi (bersama `inject`);
// CC menjalankan subproses hook saat `StopFailure`/`SessionStart` fire → forwarder meneruskan pesan
// ternormalisasi `{event, error?, ccSessionId?}` ke sini.
//
// KANAL DATA, BUKAN KANAL AKSI. Berbeda dari `inject` (yang sengaja TANPA payload agar tak ada kanal
// menyelundupkan keystroke), `hook` membawa data — tetapi data itu HANYA mengalir ke dua tujuan
// terkontrol: (a) `feedStopFailure(error)` → taxonomy `classify` yang TETAP (deteksi limit primer,
// ADR-001), dan (b) `captureCcSessionId(id)` → kolom identifier `cli_session_id` (I-20/R2b). Tak ada
// teks payload yang pernah jadi keystroke atau aksi turunan → injection firewall ADR-013 utuh (jalur
// perintah & jalur data terpisah). Bentuk payload tak dikenal → no-op senyap.

import { isCanonicalUuid } from '../shared/ids.js';

export interface HookMessage {
  event?: unknown;
  error?: unknown;
  ccSessionId?: unknown;
}

export interface HookHandlerDeps {
  /** StopFailure → umpan `error` (enum) ke limit-watcher (`feedSignal` stopfailure). Semua nilai error
   *  diteruskan apa adanya; `classify` yang memutuskan limit/overload/none (relay ini "bodoh"). */
  feedStopFailure: (error: string) => void;
  /** SessionStart → simpan `cli_session_id` CC. Dipanggil PALING BANYAK sekali (latch di handler ini):
   *  SessionStart fire di startup DAN resume/compact, id percakapan konstan → tulisan berulang mubazir. */
  captureCcSessionId: (ccSessionId: string) => void;
}

/** Bangun handler IPC `hook` sisi-wrapper. Return balasan sepele `{ok:true}` (CC mengabaikan
 *  output/exit hook — ini murni observability side-effect). */
export function createHookHandler(deps: HookHandlerDeps): (args: unknown) => { ok: true } {
  let ccIdCaptured = false;
  return (args: unknown): { ok: true } => {
    const a = (args ?? {}) as HookMessage;
    if (a.event === 'StopFailure' && typeof a.error === 'string') {
      deps.feedStopFailure(a.error);
    } else if (
      a.event === 'SessionStart' &&
      typeof a.ccSessionId === 'string' &&
      // C-2 (audit ketiga 12 Jul): validasi UUID kanonik SEBELUM menyimpan — nilai ini kelak jadi argv
      // `claude --resume <id>`. Socket kontrol per-sesi 0600 di POSIX, tapi named pipe Windows ber-ACL
      // terbuka (I-26/A-8) → proses lokal lain bisa menulis payload hook; bentuk non-UUID (mis. berawalan
      // `--`) → no-op senyap (konsisten kekonservatifan capturer agy, patterns.ts). Firewall struktural,
      // bukan kebetulan spawn tanpa shell.
      isCanonicalUuid(a.ccSessionId) &&
      !ccIdCaptured
    ) {
      ccIdCaptured = true;
      deps.captureCcSessionId(a.ccSessionId);
    }
    return { ok: true };
  };
}
