-- Durable interrupt lifecycle for Agent orchestration.
CREATE TABLE IF NOT EXISTS agent_interrupt_requests (
    interrupt_id VARCHAR(36) PRIMARY KEY,
    task_id VARCHAR(36) NOT NULL,
    step_id VARCHAR(36),
    turn_id VARCHAR(36),
    interrupt_type TEXT,
    status INTEGER NOT NULL,
    payload_json TEXT,
    resume_payload_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    consumed_at DATETIME,
    consumed_step_id VARCHAR(36),
    consumed_turn_id VARCHAR(36)
);

CREATE INDEX IF NOT EXISTS idx_agent_interrupt_requests_task ON agent_interrupt_requests(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_interrupt_requests_step ON agent_interrupt_requests(step_id);
CREATE INDEX IF NOT EXISTS idx_agent_interrupt_requests_turn ON agent_interrupt_requests(turn_id);
CREATE INDEX IF NOT EXISTS idx_agent_interrupt_requests_status ON agent_interrupt_requests(status);
CREATE INDEX IF NOT EXISTS idx_agent_interrupt_requests_created ON agent_interrupt_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_interrupt_requests_resolved ON agent_interrupt_requests(resolved_at);
CREATE INDEX IF NOT EXISTS idx_agent_interrupt_requests_consumed ON agent_interrupt_requests(consumed_at);
CREATE INDEX IF NOT EXISTS idx_agent_interrupt_requests_consumed_step ON agent_interrupt_requests(consumed_step_id);
CREATE INDEX IF NOT EXISTS idx_agent_interrupt_requests_consumed_turn ON agent_interrupt_requests(consumed_turn_id);
