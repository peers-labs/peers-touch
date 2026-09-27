-- +migrate Up

-- Add actor_ptid, version, display_name, base_url to agent_providers
ALTER TABLE agent_providers ADD COLUMN IF NOT EXISTS actor_ptid TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_providers ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE agent_providers ADD COLUMN IF NOT EXISTS display_name VARCHAR(256);
ALTER TABLE agent_providers ADD COLUMN IF NOT EXISTS base_url TEXT;
DROP INDEX IF EXISTS idx_agent_providers_actor_ptid_provider;
CREATE UNIQUE INDEX idx_agent_providers_actor_ptid_provider ON agent_providers (actor_ptid, name);

-- Add actor_ptid and version to agent_credential_pool
ALTER TABLE agent_credential_pool ADD COLUMN IF NOT EXISTS actor_ptid TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_credential_pool ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
DROP INDEX IF EXISTS idx_credentials_actor_ptid_provider;
CREATE UNIQUE INDEX idx_credentials_actor_ptid_provider ON agent_credential_pool (actor_ptid, provider);

-- Create agent_models table
CREATE TABLE IF NOT EXISTS agent_models (
    id VARCHAR(36) PRIMARY KEY,
    actor_ptid TEXT NOT NULL DEFAULT '',
    provider_id VARCHAR(64) NOT NULL,
    model_id VARCHAR(128) NOT NULL,
    display_name VARCHAR(256),
    enabled BOOLEAN NOT NULL DEFAULT true,
    capabilities_json JSONB,
    context_window INTEGER,
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_agent_models_actor_ptid_provider_model ON agent_models (actor_ptid, provider_id, model_id);

-- +migrate Down

DROP INDEX IF EXISTS idx_agent_models_actor_ptid_provider_model;
DROP TABLE IF EXISTS agent_models;

DROP INDEX IF EXISTS idx_credentials_actor_ptid_provider;
ALTER TABLE agent_credential_pool DROP COLUMN IF EXISTS actor_ptid;
ALTER TABLE agent_credential_pool DROP COLUMN IF EXISTS version;

DROP INDEX IF EXISTS idx_agent_providers_actor_ptid_provider;
ALTER TABLE agent_providers DROP COLUMN IF EXISTS actor_ptid;
ALTER TABLE agent_providers DROP COLUMN IF EXISTS version;
ALTER TABLE agent_providers DROP COLUMN IF EXISTS display_name;
ALTER TABLE agent_providers DROP COLUMN IF EXISTS base_url;
