-- Station-owned project acceptance query indexes for Atelier projection.
CREATE TABLE IF NOT EXISTS agent_project_blockers (
    blocker_id VARCHAR(64) PRIMARY KEY,
    task_id VARCHAR(36) NOT NULL,
    scope VARCHAR(32),
    owner VARCHAR(64),
    severity VARCHAR(32),
    state VARCHAR(32),
    evidence_ref TEXT,
    reason TEXT,
    source_event_id VARCHAR(36),
    source_event_seq BIGINT NOT NULL DEFAULT 0,
    payload_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_project_blockers_task ON agent_project_blockers(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_project_blockers_scope ON agent_project_blockers(scope);
CREATE INDEX IF NOT EXISTS idx_agent_project_blockers_owner ON agent_project_blockers(owner);
CREATE INDEX IF NOT EXISTS idx_agent_project_blockers_severity ON agent_project_blockers(severity);
CREATE INDEX IF NOT EXISTS idx_agent_project_blockers_state ON agent_project_blockers(state);
CREATE INDEX IF NOT EXISTS idx_agent_project_blockers_event ON agent_project_blockers(source_event_id);
CREATE INDEX IF NOT EXISTS idx_agent_project_blockers_event_seq ON agent_project_blockers(source_event_seq);
CREATE INDEX IF NOT EXISTS idx_agent_project_blockers_created ON agent_project_blockers(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_project_blockers_updated ON agent_project_blockers(updated_at);

CREATE TABLE IF NOT EXISTS agent_project_residual_risks (
    risk_id VARCHAR(64) PRIMARY KEY,
    task_id VARCHAR(36) NOT NULL,
    description TEXT,
    state VARCHAR(32),
    evidence_ref TEXT,
    owner VARCHAR(64),
    source_event_id VARCHAR(36),
    source_event_seq BIGINT NOT NULL DEFAULT 0,
    payload_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_project_residual_risks_task ON agent_project_residual_risks(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_project_residual_risks_state ON agent_project_residual_risks(state);
CREATE INDEX IF NOT EXISTS idx_agent_project_residual_risks_owner ON agent_project_residual_risks(owner);
CREATE INDEX IF NOT EXISTS idx_agent_project_residual_risks_event ON agent_project_residual_risks(source_event_id);
CREATE INDEX IF NOT EXISTS idx_agent_project_residual_risks_event_seq ON agent_project_residual_risks(source_event_seq);
CREATE INDEX IF NOT EXISTS idx_agent_project_residual_risks_created ON agent_project_residual_risks(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_project_residual_risks_updated ON agent_project_residual_risks(updated_at);
