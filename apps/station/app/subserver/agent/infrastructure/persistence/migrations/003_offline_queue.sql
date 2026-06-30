-- Migration: 003_offline_queue
-- Date: 2026-06-26
-- Description: Agent offline operation queue table

CREATE TABLE IF NOT EXISTS agent_offline_ops (
    id VARCHAR(36) PRIMARY KEY,
    agent_id VARCHAR(36) NOT NULL,
    device_id VARCHAR(64) NOT NULL,
    op_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    payload TEXT NOT NULL,
    client_request_id VARCHAR(64),
    retry_count INT NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_offline_agent_device ON agent_offline_ops (agent_id, device_id);
CREATE INDEX IF NOT EXISTS idx_offline_status ON agent_offline_ops (status);
CREATE INDEX IF NOT EXISTS idx_offline_client_req ON agent_offline_ops (client_request_id);
CREATE INDEX IF NOT EXISTS idx_offline_agent_status ON agent_offline_ops (agent_id, status);
