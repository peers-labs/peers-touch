-- Durable Station-owned gate plan index for Agent orchestration.
CREATE TABLE IF NOT EXISTS agent_task_gate_plans (
    gate_plan_id VARCHAR(64) PRIMARY KEY,
    task_id VARCHAR(36) NOT NULL,
    step_id VARCHAR(36),
    source VARCHAR(128),
    status VARCHAR(32),
    plan_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_task_gate_plans_task ON agent_task_gate_plans(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_gate_plans_step ON agent_task_gate_plans(step_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_gate_plans_source ON agent_task_gate_plans(source);
CREATE INDEX IF NOT EXISTS idx_agent_task_gate_plans_status ON agent_task_gate_plans(status);
CREATE INDEX IF NOT EXISTS idx_agent_task_gate_plans_created ON agent_task_gate_plans(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_task_gate_plans_updated ON agent_task_gate_plans(updated_at);
