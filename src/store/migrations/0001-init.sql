-- 0001-init.sql — skema awal (DATA-MODEL.md adalah sumber kebenaran; forward-only).

CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  tool            TEXT NOT NULL CHECK(tool IN ('claude', 'antigravity')),
  cli_session_id  TEXT NULL,
  cwd             TEXT NOT NULL,
  pid             INTEGER NULL,
  status          TEXT NOT NULL CHECK(status IN ('RUNNING', 'LIMIT_HIT', 'WAITING', 'RESUMED', 'EXITED', 'BLOCKED', 'FAILED')),
  proc_state      TEXT NOT NULL CHECK(proc_state IN ('alive', 'exited')),
  detected_at     INTEGER NULL,
  detect_source   TEXT NULL,
  reset_at        INTEGER NULL,
  reset_source    TEXT NULL CHECK(reset_source IS NULL OR reset_source IN ('exact', 'heuristic', 'backoff')),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  archived_at     INTEGER NULL
);

CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_updated ON sessions(updated_at);

-- events (append-only, audit trail) — tak pernah UPDATE/DELETE.
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NULL REFERENCES sessions(id),
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_events_session ON events(session_id, created_at);

-- scheduled_jobs (tahan restart daemon) — aktif M2/M3, tabel dibuat sekarang agar migrasi tak berulang nanti.
CREATE TABLE scheduled_jobs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id        TEXT NOT NULL REFERENCES sessions(id),
  run_at            INTEGER NOT NULL,
  kind              TEXT NOT NULL CHECK(kind IN ('probe', 'resume')),
  attempts          INTEGER NOT NULL DEFAULT 0,
  next_backoff_ms   INTEGER NULL,
  created_at        INTEGER NOT NULL
);

CREATE INDEX idx_jobs_runat ON scheduled_jobs(run_at);

-- meta (heartbeat + versi skema)
CREATE TABLE meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

INSERT INTO meta (key, value) VALUES ('schema_version', '1');
