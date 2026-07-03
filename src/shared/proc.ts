/**
 * True bila proses `pid` masih hidup. `process.kill(pid, 0)` tak mengirim sinyal —
 * hanya menguji keberadaan. Dipakai `status` untuk menandai sesi orphan (RUNNING basi)
 * tanpa menulis DB (rekonsiliasi tulis-balik = tugas daemon, ISSUES I-3).
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = proses tak ada. EPERM = ada tapi tak boleh dikirim sinyal → anggap hidup.
    return (err as { code?: string }).code === 'EPERM';
  }
}
