-- +migrate Up
-- 2026-04-12 — Add agent config tables (config_json decomposition)

CREATE TABLE IF NOT EXISTS agent_chat_configs (
	agent_id VARCHAR(36) PRIMARY KEY,
	history_count INT NOT NULL DEFAULT 20,
	enable_history_count BOOLEAN NOT NULL DEFAULT true,
	enable_auto_create_topic BOOLEAN NOT NULL DEFAULT true,
	auto_create_topic_threshold INT NOT NULL DEFAULT 10,
	enable_max_tokens BOOLEAN NOT NULL DEFAULT false,
	enable_streaming BOOLEAN NOT NULL DEFAULT true,
	enable_context_compression BOOLEAN NOT NULL DEFAULT false,
	compression_model_id TEXT,
	context_window_size INT NOT NULL DEFAULT 4096,
	search_mode VARCHAR(20) NOT NULL DEFAULT 'auto',
	use_model_builtin_search BOOLEAN NOT NULL DEFAULT false,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_model_params (
	agent_id VARCHAR(36) PRIMARY KEY,
	temperature DOUBLE PRECISION NOT NULL DEFAULT 0.7,
	top_p DOUBLE PRECISION NOT NULL DEFAULT 0.9,
	frequency_penalty DOUBLE PRECISION NOT NULL DEFAULT 0,
	presence_penalty DOUBLE PRECISION NOT NULL DEFAULT 0,
	max_tokens INT NOT NULL DEFAULT 2048,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS agent_voice_configs (
	agent_id VARCHAR(36) PRIMARY KEY,
	tts_provider TEXT,
	tts_voice TEXT,
	tts_speed DOUBLE PRECISION NOT NULL DEFAULT 1.0,
	tts_auto_read BOOLEAN NOT NULL DEFAULT false,
	stt_provider TEXT,
	stt_language TEXT,
	stt_auto_stop BOOLEAN NOT NULL DEFAULT true,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_tool_profiles (
	agent_id VARCHAR(36) PRIMARY KEY,
	profile VARCHAR(20) NOT NULL DEFAULT 'balanced',
	allow TEXT,
	deny TEXT,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- +migrate Down
DROP TABLE IF EXISTS agent_tool_profiles;
DROP TABLE IF EXISTS agent_voice_configs;
DROP TABLE IF EXISTS agent_mcp_bindings;
DROP TABLE IF EXISTS agent_skill_bindings;
DROP TABLE IF EXISTS agent_knowledge_bindings;
DROP TABLE IF EXISTS agent_model_params;
DROP TABLE IF EXISTS agent_chat_configs;
