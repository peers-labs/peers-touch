-- +migrate Up
CREATE TABLE IF NOT EXISTS frontend_telemetry_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_ptid TEXT NOT NULL,
  event_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  ts REAL NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  module TEXT NOT NULL,
  runtime TEXT NOT NULL,
  device_id TEXT,
  session_id TEXT,
  owner TEXT,
  page_id TEXT,
  section_id TEXT,
  interaction_id TEXT,
  phase TEXT,
  severity TEXT,
  duration_ms REAL,
  tags_json TEXT,
  data_json TEXT,
  created_at DATETIME NOT NULL,
  received_at DATETIME NOT NULL,
  deleted_at DATETIME
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_frontend_telemetry_actor_ptid_event
ON frontend_telemetry_events(actor_ptid, event_id);

CREATE INDEX IF NOT EXISTS idx_frontend_telemetry_events_interaction
ON frontend_telemetry_events(actor_ptid, interaction_id);

CREATE TABLE IF NOT EXISTS frontend_telemetry_rollups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_ptid TEXT NOT NULL,
  runtime TEXT NOT NULL,
  module TEXT NOT NULL,
  kind TEXT NOT NULL,
  window_start DATETIME NOT NULL,
  window_minutes INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  duration_count INTEGER NOT NULL DEFAULT 0,
  p50_duration_ms REAL,
  p95_duration_ms REAL,
  max_duration_ms REAL,
  last_observed_at DATETIME NOT NULL,
  last_interaction_id TEXT,
  updated_at DATETIME NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_frontend_telemetry_rollup
ON frontend_telemetry_rollups(actor_ptid, runtime, module, kind, window_start, window_minutes);

-- +migrate Down
DROP TABLE IF EXISTS frontend_telemetry_rollups;
DROP TABLE IF EXISTS frontend_telemetry_events;
