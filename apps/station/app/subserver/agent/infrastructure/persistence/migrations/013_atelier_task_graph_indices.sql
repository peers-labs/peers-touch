-- Station-owned MilestoneTree / TaskGraph query indexes for Atelier projection.
CREATE TABLE IF NOT EXISTS agent_atelier_milestones (
    milestone_id VARCHAR(64) PRIMARY KEY,
    task_id VARCHAR(36) NOT NULL,
    parent_id VARCHAR(64),
    title TEXT,
    state VARCHAR(32),
    task_ids_json TEXT,
    acceptance_predicate_ids_json TEXT,
    depends_on_json TEXT,
    source_event_id VARCHAR(36),
    source_event_seq BIGINT NOT NULL DEFAULT 0,
    payload_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_atelier_milestones_task ON agent_atelier_milestones(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_milestones_parent ON agent_atelier_milestones(parent_id);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_milestones_state ON agent_atelier_milestones(state);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_milestones_event ON agent_atelier_milestones(source_event_id);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_milestones_event_seq ON agent_atelier_milestones(source_event_seq);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_milestones_created ON agent_atelier_milestones(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_milestones_updated ON agent_atelier_milestones(updated_at);

CREATE TABLE IF NOT EXISTS agent_atelier_task_graph_nodes (
    node_id VARCHAR(64) PRIMARY KEY,
    task_id VARCHAR(36) NOT NULL,
    milestone_id VARCHAR(64),
    title TEXT,
    state VARCHAR(32),
    agent_role VARCHAR(64),
    artifact_ids_json TEXT,
    gate_ids_json TEXT,
    source_event_id VARCHAR(36),
    source_event_seq BIGINT NOT NULL DEFAULT 0,
    payload_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_atelier_task_graph_nodes_task ON agent_atelier_task_graph_nodes(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_task_graph_nodes_milestone ON agent_atelier_task_graph_nodes(milestone_id);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_task_graph_nodes_state ON agent_atelier_task_graph_nodes(state);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_task_graph_nodes_role ON agent_atelier_task_graph_nodes(agent_role);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_task_graph_nodes_event ON agent_atelier_task_graph_nodes(source_event_id);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_task_graph_nodes_event_seq ON agent_atelier_task_graph_nodes(source_event_seq);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_task_graph_nodes_created ON agent_atelier_task_graph_nodes(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_task_graph_nodes_updated ON agent_atelier_task_graph_nodes(updated_at);

CREATE TABLE IF NOT EXISTS agent_atelier_task_graph_edges (
    edge_id VARCHAR(160) PRIMARY KEY,
    task_id VARCHAR(36) NOT NULL,
    from_id VARCHAR(64),
    to_id VARCHAR(64),
    type VARCHAR(32),
    source_event_id VARCHAR(36),
    source_event_seq BIGINT NOT NULL DEFAULT 0,
    payload_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_atelier_task_graph_edges_task ON agent_atelier_task_graph_edges(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_task_graph_edges_from ON agent_atelier_task_graph_edges(from_id);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_task_graph_edges_to ON agent_atelier_task_graph_edges(to_id);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_task_graph_edges_type ON agent_atelier_task_graph_edges(type);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_task_graph_edges_event ON agent_atelier_task_graph_edges(source_event_id);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_task_graph_edges_event_seq ON agent_atelier_task_graph_edges(source_event_seq);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_task_graph_edges_created ON agent_atelier_task_graph_edges(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_atelier_task_graph_edges_updated ON agent_atelier_task_graph_edges(updated_at);
