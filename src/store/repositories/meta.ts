import type { DatabaseInstance } from '../db.js';

/** Repositori `meta` — key/value (heartbeat + schema_version). */
export function createMetaRepo(db: DatabaseInstance) {
  function get(key: string): string | undefined {
    const row = db.prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?').get(key);
    return row?.value;
  }

  function set(key: string, value: string): void {
    db.prepare(
      'INSERT INTO meta (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = @value',
    ).run({ key, value });
  }

  return {
    get,
    set,

    /** Tulis heartbeat daemon (`daemon_heartbeat_at`/`daemon_pid`) — `acca status` membacanya
     * untuk liveness tanpa perlu daemon hidup/IPC (ADR-015). `nowMsVal` di-inject oleh pemanggil
     * (supervisor), bukan `Date.now()` di sini (CONVENTIONS.md waktu). */
    setHeartbeat(nowMsVal: number, pid: number): void {
      set('daemon_heartbeat_at', String(nowMsVal));
      set('daemon_pid', String(pid));
    },

    /** Baca balik heartbeat; `undefined` bila belum pernah ditulis atau nilainya tak terparse. */
    getHeartbeat(): { at: number; pid: number } | undefined {
      const atRaw = get('daemon_heartbeat_at');
      const pidRaw = get('daemon_pid');
      if (atRaw === undefined || pidRaw === undefined) return undefined;

      const at = Number.parseInt(atRaw, 10);
      const pid = Number.parseInt(pidRaw, 10);
      if (!Number.isFinite(at) || !Number.isFinite(pid)) return undefined;

      return { at, pid };
    },
  };
}

export type MetaRepo = ReturnType<typeof createMetaRepo>;
