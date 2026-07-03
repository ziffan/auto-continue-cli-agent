import type { DatabaseInstance } from '../db.js';

/** Repositori `meta` — key/value (heartbeat + schema_version). */
export function createMetaRepo(db: DatabaseInstance) {
  return {
    get(key: string): string | undefined {
      const row = db.prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?').get(key);
      return row?.value;
    },

    set(key: string, value: string): void {
      db.prepare(
        'INSERT INTO meta (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = @value',
      ).run({ key, value });
    },
  };
}

export type MetaRepo = ReturnType<typeof createMetaRepo>;
