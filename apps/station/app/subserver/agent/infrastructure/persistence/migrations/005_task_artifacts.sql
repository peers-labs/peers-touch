-- Durable artifact evidence index for Agent orchestration.
CREATE TABLE IF NOT EXISTS agent_task_artifacts (
    artifact_id VARCHAR(64) PRIMARY KEY,
    task_id VARCHAR(36) NOT NULL,
    step_id VARCHAR(36),
    turn_id VARCHAR(36),
    event_id VARCHAR(36),
    event_seq BIGINT NOT NULL DEFAULT 0,
    run_id VARCHAR(64),
    kind VARCHAR(64),
    name TEXT,
    uri TEXT,
    checksum TEXT,
    produced_by VARCHAR(128),
    refs_json TEXT,
    payload_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_task_artifacts_task ON agent_task_artifacts(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_artifacts_step ON agent_task_artifacts(step_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_artifacts_turn ON agent_task_artifacts(turn_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_artifacts_event ON agent_task_artifacts(event_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_artifacts_event_seq ON agent_task_artifacts(event_seq);
CREATE INDEX IF NOT EXISTS idx_agent_task_artifacts_run ON agent_task_artifacts(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_artifacts_kind ON agent_task_artifacts(kind);
CREATE INDEX IF NOT EXISTS idx_agent_task_artifacts_produced_by ON agent_task_artifacts(produced_by);
CREATE INDEX IF NOT EXISTS idx_agent_task_artifacts_created ON agent_task_artifacts(created_at);
