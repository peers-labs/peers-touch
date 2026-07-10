-- Station-owned DirectRun records for direct model intents.
CREATE TABLE IF NOT EXISTS agent_direct_runs (
    direct_run_id VARCHAR(64) PRIMARY KEY,
    task_id VARCHAR(36),
    provider_id VARCHAR(128) NOT NULL,
    model_intent VARCHAR(128) NOT NULL,
    input_snapshot_json TEXT,
    budget_ref VARCHAR(128),
    policy_ref VARCHAR(128),
    trace_id VARCHAR(128),
    state VARCHAR(64),
    source VARCHAR(128),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_direct_runs_task ON agent_direct_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_direct_runs_provider ON agent_direct_runs(provider_id);
CREATE INDEX IF NOT EXISTS idx_agent_direct_runs_model ON agent_direct_runs(model_intent);
CREATE INDEX IF NOT EXISTS idx_agent_direct_runs_budget ON agent_direct_runs(budget_ref);
CREATE INDEX IF NOT EXISTS idx_agent_direct_runs_policy ON agent_direct_runs(policy_ref);
CREATE INDEX IF NOT EXISTS idx_agent_direct_runs_trace ON agent_direct_runs(trace_id);
CREATE INDEX IF NOT EXISTS idx_agent_direct_runs_state ON agent_direct_runs(state);
CREATE INDEX IF NOT EXISTS idx_agent_direct_runs_source ON agent_direct_runs(source);
CREATE INDEX IF NOT EXISTS idx_agent_direct_runs_created ON agent_direct_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_direct_runs_updated ON agent_direct_runs(updated_at);
