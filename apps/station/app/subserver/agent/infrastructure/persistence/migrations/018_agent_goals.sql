-- +migrate Up

CREATE TABLE IF NOT EXISTS agent_goals (
    goal_id VARCHAR(64) PRIMARY KEY,
    owner_ptid TEXT NOT NULL,
    workspace_id VARCHAR(64) NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    outcome TEXT NOT NULL,
    non_goals_json JSONB NOT NULL DEFAULT '[]',
    constraints_json JSONB NOT NULL DEFAULT '[]',
    budget_json JSONB NOT NULL DEFAULT '{}',
    acceptance_criteria_json JSONB NOT NULL DEFAULT '[]',
    status INTEGER NOT NULL,
    revision BIGINT NOT NULL DEFAULT 1,
    graph_revision BIGINT NOT NULL DEFAULT 0,
    acceptance_revision BIGINT NOT NULL DEFAULT 0,
    create_idempotency_key VARCHAR(160) NOT NULL,
    create_payload_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_goals_owner_idempotency
    ON agent_goals (owner_ptid, create_idempotency_key);
CREATE INDEX IF NOT EXISTS idx_agent_goals_owner_updated
    ON agent_goals (owner_ptid, updated_at);

-- +migrate Down

DROP INDEX IF EXISTS idx_agent_goals_owner_updated;
DROP INDEX IF EXISTS idx_agent_goals_owner_idempotency;
DROP TABLE IF EXISTS agent_goals;
