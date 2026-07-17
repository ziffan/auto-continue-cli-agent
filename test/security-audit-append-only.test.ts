// T-L8 (M5.3): audit-log `events` append-only — jangan hard delete (CLAUDE.md §4, CONVENTIONS.md).
// Struktural: `createEventsRepo` TIDAK boleh mengekspos method apa pun yang mengizinkan mengubah/
// menghapus baris yang sudah ditulis. Perilaku: sekali di-append, baris selalu muncul di `listRecent`/
// `listBySession` dan tak ada API repo untuk membuangnya.

import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, openDb, type DatabaseInstance } from '../src/store/db.js';
import { createEventsRepo } from '../src/store/repositories/events.js';
import { createSessionsRepo } from '../src/store/repositories/sessions.js';

const tempDir = join(tmpdir(), `acca-test-${randomBytes(4).toString('hex')}`);
process.env.ACCA_DATA_DIR = tempDir;

let db: DatabaseInstance;

beforeAll(() => {
  db = openDb();
});

afterAll(() => {
  closeDb(db);
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.ACCA_DATA_DIR;
});

describe('SECURITY INVARIANT: events repo append-only — tak ada jalur update/delete', () => {
  it('permukaan API repo HANYA berisi append/listRecent/listBySession', () => {
    const events = createEventsRepo(db);
    const keys = Object.keys(events).sort();

    expect(keys).toEqual(['append', 'listBySession', 'listRecent']);
  });

  it('tak ada key method yang mengandung update/delete/remove/clear/truncate (nama apa pun)', () => {
    const events = createEventsRepo(db);
    const keys = Object.keys(events);

    for (const key of keys) {
      expect(key).not.toMatch(/update|delete|remove|clear|truncate|purge/i);
    }
  });

  it('perilaku: baris yang di-append tetap muncul utuh, tak ada cara membuang/mengubahnya lewat repo', () => {
    const events = createEventsRepo(db);
    // events.session_id punya FK ke sessions(id) — buat baris sesi dulu supaya append tak ditolak.
    createSessionsRepo(db).createSession({
      id: 'audit-1',
      tool: 'claude',
      cwd: '/tmp/audit',
      status: 'RUNNING',
      proc_state: 'alive',
    });

    events.append({ session_id: 'audit-1', type: 'status_change', payload: { to: 'RUNNING' } });
    events.append({ session_id: 'audit-1', type: 'status_change', payload: { to: 'LIMIT_HIT' } });
    events.append({ session_id: null, type: 'daemon_error', payload: { msg: 'x' } });

    const recent = events.listRecent(10);
    const bySession = events.listBySession('audit-1', 10);

    expect(recent.length).toBeGreaterThanOrEqual(3);
    expect(bySession).toHaveLength(2);

    // Baris tersimpan APA ADANYA (payload = JSON string mentah, id monoton naik, created_at terisi) —
    // tak ada mekanisme repo untuk menimpa/menghapusnya kemudian.
    for (const row of bySession) {
      expect(row.session_id).toBe('audit-1');
      expect(typeof row.id).toBe('number');
      expect(typeof row.created_at).toBe('number');
      expect(() => {
        JSON.parse(row.payload);
      }).not.toThrow();
    }

    // Memanggil append lagi TIDAK PERNAH mengurangi jumlah baris yang sudah ada — hanya menambah.
    const countBefore = events.listRecent(1000).length;
    events.append({ session_id: 'audit-1', type: 'status_change', payload: { to: 'RESUMED' } });
    const countAfter = events.listRecent(1000).length;
    expect(countAfter).toBe(countBefore + 1);
  });
});
