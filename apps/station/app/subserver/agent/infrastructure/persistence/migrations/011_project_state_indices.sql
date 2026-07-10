-- Station-owned Project/Milestone state query index for Atelier projection.
CREATE TABLE IF NOT EXISTS agent_project_states (
    project_id VARCHAR(64) PRIMARY KEY,
    task_id VARCHAR(36) NOT NULL,
    project_state VARCHAR(32),
    milestone_state VARCHAR(32),
    source_event_id VARCHAR(36),
    source_event_seq BIGINT NOT NULL DEFAULT 0,
    payload_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_project_states_task ON agent_project_states(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_project_states_project_state ON agent_project_states(project_state);
CREATE INDEX IF NOT EXISTS idx_agent_project_states_milestone_state ON agent_project_states(milestone_state);
CREATE INDEX IF NOT EXISTS idx_agent_project_states_event ON agent_project_states(source_event_id);
CREATE INDEX IF NOT EXISTS idx_agent_project_states_event_seq ON agent_project_states(source_event_seq);
CREATE INDEX IF NOT EXISTS idx_agent_project_states_created ON agent_project_states(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_project_states_updated ON agent_project_states(updated_at);
