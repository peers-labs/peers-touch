-- Station-owned artifact body store for Agent orchestration.
CREATE TABLE IF NOT EXISTS agent_task_artifact_blobs (
    blob_id VARCHAR(128) PRIMARY KEY,
    artifact_id VARCHAR(64) NOT NULL,
    task_id VARCHAR(36) NOT NULL,
    step_id VARCHAR(36),
    turn_id VARCHAR(36),
    event_id VARCHAR(36),
    event_seq BIGINT NOT NULL DEFAULT 0,
    body_kind VARCHAR(32),
    body_uri TEXT,
    content_hash TEXT,
    byte_size BIGINT NOT NULL DEFAULT 0,
    retention_policy VARCHAR(64),
    retention_status VARCHAR(32),
    body_text TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_agent_task_artifact_blobs_artifact ON agent_task_artifact_blobs(artifact_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_artifact_blobs_task ON agent_task_artifact_blobs(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_artifact_blobs_step ON agent_task_artifact_blobs(step_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_artifact_blobs_turn ON agent_task_artifact_blobs(turn_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_artifact_blobs_event ON agent_task_artifact_blobs(event_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_artifact_blobs_event_seq ON agent_task_artifact_blobs(event_seq);
CREATE INDEX IF NOT EXISTS idx_agent_task_artifact_blobs_body_kind ON agent_task_artifact_blobs(body_kind);
CREATE INDEX IF NOT EXISTS idx_agent_task_artifact_blobs_retention_policy ON agent_task_artifact_blobs(retention_policy);
CREATE INDEX IF NOT EXISTS idx_agent_task_artifact_blobs_retention_status ON agent_task_artifact_blobs(retention_status);
CREATE INDEX IF NOT EXISTS idx_agent_task_artifact_blobs_created ON agent_task_artifact_blobs(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_task_artifact_blobs_expires ON agent_task_artifact_blobs(expires_at);
