-- Durable gate result query index for Agent orchestration.
CREATE TABLE IF NOT EXISTS agent_task_gate_results (
    gate_result_id VARCHAR(36) PRIMARY KEY,
    task_id VARCHAR(36) NOT NULL,
    step_id VARCHAR(36),
    turn_id VARCHAR(36),
    event_id VARCHAR(36),
    event_seq BIGINT NOT NULL DEFAULT 0,
    gate_id VARCHAR(64),
    gate_plan_id VARCHAR(64),
    name TEXT,
    status VARCHAR(32),
    summary TEXT,
    blocking BOOLEAN NOT NULL DEFAULT FALSE,
    artifact_ids_json TEXT,
    checks_json TEXT,
    produced_by VARCHAR(128),
    payload_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_task_gate_results_task ON agent_task_gate_results(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_gate_results_step ON agent_task_gate_results(step_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_gate_results_turn ON agent_task_gate_results(turn_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_gate_results_event ON agent_task_gate_results(event_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_gate_results_event_seq ON agent_task_gate_results(event_seq);
CREATE INDEX IF NOT EXISTS idx_agent_task_gate_results_gate ON agent_task_gate_results(gate_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_gate_results_plan ON agent_task_gate_results(gate_plan_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_gate_results_status ON agent_task_gate_results(status);
CREATE INDEX IF NOT EXISTS idx_agent_task_gate_results_blocking ON agent_task_gate_results(blocking);
CREATE INDEX IF NOT EXISTS idx_agent_task_gate_results_produced_by ON agent_task_gate_results(produced_by);
CREATE INDEX IF NOT EXISTS idx_agent_task_gate_results_created ON agent_task_gate_results(created_at);
