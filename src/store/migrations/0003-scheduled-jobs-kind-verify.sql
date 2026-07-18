-- 0003-scheduled-jobs-kind-verify.sql — perluas CHECK(kind) scheduled_jobs dengan 'verify' (I-35).
-- SQLite tak bisa ALTER CHECK in-place → rebuild tabel (create-copy-drop-rename). Aman: NOL tabel
-- lain mereferensikan scheduled_jobs (ia sisi CHILD dari FK ke sessions), jadi DROP tak melanggar FK,
-- dan INSERT..SELECT mengisi baris yang session_id-nya masih menunjuk sessions yang ada (FK on tetap
-- lolos). Baris lama tetap valid — nilai kind lama ('probe'/'resume') masuk himpunan CHECK baru.
-- Migrasi jalan dalam transaksi (db.ts runMigrations) → atomik.

CREATE TABLE scheduled_jobs_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id        TEXT NOT NULL REFERENCES sessions(id),
  run_at            INTEGER NOT NULL,
  kind              TEXT NOT NULL CHECK(kind IN ('probe', 'resume', 'verify')),
  attempts          INTEGER NOT NULL DEFAULT 0,
  next_backoff_ms   INTEGER NULL,
  created_at        INTEGER NOT NULL
);

INSERT INTO scheduled_jobs_new (id, session_id, run_at, kind, attempts, next_backoff_ms, created_at)
  SELECT id, session_id, run_at, kind, attempts, next_backoff_ms, created_at FROM scheduled_jobs;

DROP TABLE scheduled_jobs;
ALTER TABLE scheduled_jobs_new RENAME TO scheduled_jobs;

CREATE INDEX idx_jobs_runat ON scheduled_jobs(run_at);

UPDATE meta SET value = '3' WHERE key = 'schema_version';
