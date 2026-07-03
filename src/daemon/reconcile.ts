// Rekonsiliasi sesi orphan saat daemon start (ISSUES I-3). Pure/testable: liveness PID di-inject
// (`isAlive`) supaya tak perlu proses OS nyata untuk mengetes logika ini.

import type { EventsRepo } from '../store/repositories/events.js';
import type { SessionsRepo } from '../store/repositories/sessions.js';

export interface ReconcileDeps {
  sessions: SessionsRepo;
  events: EventsRepo;
  isAlive: (pid: number) => boolean;
}

/**
 * Baris `sessions` yang masih `proc_state='alive'` tapi PID pemiliknya sudah mati (wrapper mati
 * keras — SIGKILL/terminal ditutup/crash — sebelum sempat `markExited`) ditulis-balik lewat
 * `markOrphanExited` + audit `events`. M1 hanya memitigasi ini di tampilan (`status`, read-only
 * — ISSUES I-1); ini menutup sisi tulis-baliknya di daemon start (ADR-015: daemon = penulis
 * tunggal `sessions`). Mengembalikan jumlah sesi yang direkonsiliasi.
 */
export function reconcileOrphans(deps: ReconcileDeps): number {
  const orphans = deps.sessions
    .listActive()
    .filter((s) => s.proc_state === 'alive' && s.pid !== null && !deps.isAlive(s.pid));

  for (const session of orphans) {
    deps.sessions.markOrphanExited(session.id);
    deps.events.append({
      session_id: session.id,
      type: 'status_change',
      payload: { to: 'exited', reason: 'orphan_reconciled', pid: session.pid },
    });
  }

  return orphans.length;
}
