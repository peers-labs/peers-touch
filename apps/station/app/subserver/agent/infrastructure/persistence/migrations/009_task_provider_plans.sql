-- Station-owned typed provider plans for Agent orchestration tasks.
CREATE TABLE IF NOT EXISTS agent_task_provider_plans (
    provider_plan_id VARCHAR(64) PRIMARY KEY,
    task_id VARCHAR(36) NOT NULL,
    source VARCHAR(128),
    status VARCHAR(32),
    plan_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_task_provider_plans_task ON agent_task_provider_plans(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_provider_plans_source ON agent_task_provider_plans(source);
CREATE INDEX IF NOT EXISTS idx_agent_task_provider_plans_status ON agent_task_provider_plans(status);
CREATE INDEX IF NOT EXISTS idx_agent_task_provider_plans_created ON agent_task_provider_plans(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_task_provider_plans_updated ON agent_task_provider_plans(updated_at);
