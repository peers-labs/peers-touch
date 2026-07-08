-- Station-owned Policy / Defect query indexes for Atelier projection.
CREATE TABLE IF NOT EXISTS agent_atelier_policies (
    policy_projection_id VARCHAR(128) PRIMARY KEY,
    policy_id VARCHAR(64) NOT NULL,
    task_id VARCHAR(36) NOT NULL,
    hard_deny BOOLEAN NOT NULL DEFAULT FALSE,
    source_event_id VARCHAR(36),
    source_event_seq BIGINT NOT NULL DEFAULT 0,
    payload_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_atelier_policies_policy ON agent_atelier_policies(policy_id);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_policies_task ON agent_atelier_policies(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_policies_hard_deny ON agent_atelier_policies(hard_deny);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_policies_event ON agent_atelier_policies(source_event_id);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_policies_event_seq ON agent_atelier_policies(source_event_seq);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_policies_created ON agent_atelier_policies(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_policies_updated ON agent_atelier_policies(updated_at);

CREATE TABLE IF NOT EXISTS agent_atelier_policy_rules (
    rule_id VARCHAR(96) PRIMARY KEY,
    policy_id VARCHAR(64) NOT NULL,
    task_id VARCHAR(36) NOT NULL,
    scope VARCHAR(32),
    expr TEXT,
    severity VARCHAR(32),
    source_event_id VARCHAR(36),
    source_event_seq BIGINT NOT NULL DEFAULT 0,
    payload_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_atelier_policy_rules_policy ON agent_atelier_policy_rules(policy_id);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_policy_rules_task ON agent_atelier_policy_rules(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_policy_rules_scope ON agent_atelier_policy_rules(scope);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_policy_rules_severity ON agent_atelier_policy_rules(severity);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_policy_rules_event ON agent_atelier_policy_rules(source_event_id);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_policy_rules_event_seq ON agent_atelier_policy_rules(source_event_seq);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_policy_rules_created ON agent_atelier_policy_rules(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_policy_rules_updated ON agent_atelier_policy_rules(updated_at);

CREATE TABLE IF NOT EXISTS agent_atelier_defects (
    defect_id VARCHAR(96) PRIMARY KEY,
    task_id VARCHAR(36) NOT NULL,
    source VARCHAR(32),
    state VARCHAR(32),
    evidence_ref TEXT,
    summary TEXT,
    expected_change TEXT,
    target_refs_json TEXT,
    source_event_id VARCHAR(36),
    source_event_seq BIGINT NOT NULL DEFAULT 0,
    payload_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_atelier_defects_task ON agent_atelier_defects(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_defects_source ON agent_atelier_defects(source);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_defects_state ON agent_atelier_defects(state);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_defects_event ON agent_atelier_defects(source_event_id);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_defects_event_seq ON agent_atelier_defects(source_event_seq);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_defects_created ON agent_atelier_defects(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_defects_updated ON agent_atelier_defects(updated_at);
