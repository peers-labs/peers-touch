-- +migrate Up
-- 2026-04-12 — Add Workspace tables for OSS file storage

CREATE TABLE IF NOT EXISTS agent_workspaces (
	id VARCHAR(36) PRIMARY KEY,
	agent_id VARCHAR(36) NOT NULL,
	name TEXT NOT NULL,
	type VARCHAR(20) NOT NULL DEFAULT 'directory',
	storage_backend VARCHAR(20) NOT NULL DEFAULT 'oss',
	oss_bucket TEXT,
	oss_prefix TEXT,
	total_bytes BIGINT NOT NULL DEFAULT 0,
	file_count INT NOT NULL DEFAULT 0,
	last_synced_at TIMESTAMPTZ,
	last_synced_device TEXT,
	meta TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_agent_id ON agent_workspaces(agent_id);

CREATE TABLE IF NOT EXISTS agent_workspace_files (
	id VARCHAR(36) PRIMARY KEY,
	workspace_id VARCHAR(36) NOT NULL,
	path TEXT NOT NULL,
	size BIGINT NOT NULL DEFAULT 0,
	sha256 TEXT,
	mime_type TEXT,
	last_modified_at TIMESTAMPTZ,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_file_workspace_id ON agent_workspace_files(workspace_id);

-- +migrate Down
DROP TABLE IF EXISTS agent_workspace_files;
DROP TABLE IF EXISTS agent_workspaces;
