-- +migrate Up
-- 2026-04-12 — Add agent binding tables

CREATE TABLE IF NOT EXISTS agent_knowledge_bindings (
	id VARCHAR(36) PRIMARY KEY,
	agent_id VARCHAR(36) NOT NULL,
	resource_id VARCHAR(36) NOT NULL,
	policy VARCHAR(20) NOT NULL DEFAULT 'auto',
	enabled BOOLEAN NOT NULL DEFAULT true,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kb_agent_id ON agent_knowledge_bindings(agent_id);

CREATE TABLE IF NOT EXISTS agent_skill_bindings (
	id VARCHAR(36) PRIMARY KEY,
	agent_id VARCHAR(36) NOT NULL,
	skill_id VARCHAR(36) NOT NULL,
	enabled BOOLEAN NOT NULL DEFAULT true,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skill_binding_agent_id ON agent_skill_bindings(agent_id);

CREATE TABLE IF NOT EXISTS agent_mcp_bindings (
	id VARCHAR(36) PRIMARY KEY,
	agent_id VARCHAR(36) NOT NULL,
	server_name VARCHAR(128) NOT NULL,
	enabled BOOLEAN NOT NULL DEFAULT true,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_binding_agent_id ON agent_mcp_bindings(agent_id);

-- +migrate Down
DROP TABLE IF EXISTS agent_mcp_bindings;
DROP TABLE IF EXISTS agent_skill_bindings;
DROP TABLE IF EXISTS agent_knowledge_bindings;
