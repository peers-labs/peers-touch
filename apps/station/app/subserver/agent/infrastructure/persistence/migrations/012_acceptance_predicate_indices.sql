-- Station-owned acceptance predicate registry/query index for Atelier projection.
CREATE TABLE IF NOT EXISTS agent_acceptance_predicates (
    predicate_id VARCHAR(64) PRIMARY KEY,
    task_id VARCHAR(36) NOT NULL,
    scope VARCHAR(32),
    level VARCHAR(8),
    evaluator VARCHAR(32),
    expr TEXT,
    last_eval BOOLEAN,
    human_signoff BOOLEAN NOT NULL DEFAULT FALSE,
    source_event_id VARCHAR(36),
    source_event_seq BIGINT NOT NULL DEFAULT 0,
    payload_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_acceptance_predicates_task ON agent_acceptance_predicates(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_acceptance_predicates_scope ON agent_acceptance_predicates(scope);
CREATE INDEX IF NOT EXISTS idx_agent_acceptance_predicates_level ON agent_acceptance_predicates(level);
CREATE INDEX IF NOT EXISTS idx_agent_acceptance_predicates_evaluator ON agent_acceptance_predicates(evaluator);
CREATE INDEX IF NOT EXISTS idx_agent_acceptance_predicates_last_eval ON agent_acceptance_predicates(last_eval);
CREATE INDEX IF NOT EXISTS idx_agent_acceptance_predicates_human_signoff ON agent_acceptance_predicates(human_signoff);
CREATE INDEX IF NOT EXISTS idx_agent_acceptance_predicates_event ON agent_acceptance_predicates(source_event_id);
CREATE INDEX IF NOT EXISTS idx_agent_acceptance_predicates_event_seq ON agent_acceptance_predicates(source_event_seq);
CREATE INDEX IF NOT EXISTS idx_agent_acceptance_predicates_created ON agent_acceptance_predicates(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_acceptance_predicates_updated ON agent_acceptance_predicates(updated_at);
