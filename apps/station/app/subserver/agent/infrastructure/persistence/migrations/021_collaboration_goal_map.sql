-- +migrate Up

CREATE TABLE IF NOT EXISTS agent_collaboration_task_goal_maps (
    legacy_task_id VARCHAR(36) PRIMARY KEY,
    owner_ptid TEXT NOT NULL,
    goal_id VARCHAR(64) NOT NULL,
    task_id VARCHAR(36) NOT NULL,
    goal_node_id VARCHAR(64) NOT NULL,
    root_step_id VARCHAR(36) NOT NULL,
    root_attempt_id VARCHAR(36) NOT NULL,
    state VARCHAR(16) NOT NULL,
    block_reason VARCHAR(64) NOT NULL DEFAULT '',
    source_status INTEGER NOT NULL,
    source_updated_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_collaboration_task_goal_maps_goal
    ON agent_collaboration_task_goal_maps (goal_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_collaboration_task_goal_maps_task
    ON agent_collaboration_task_goal_maps (task_id);
CREATE INDEX IF NOT EXISTS idx_agent_collaboration_task_goal_maps_owner
    ON agent_collaboration_task_goal_maps (owner_ptid);
CREATE INDEX IF NOT EXISTS idx_agent_collaboration_task_goal_maps_state
    ON agent_collaboration_task_goal_maps (state);

-- +migrate Down

DROP INDEX IF EXISTS idx_agent_collaboration_task_goal_maps_state;
DROP INDEX IF EXISTS idx_agent_collaboration_task_goal_maps_owner;
DROP INDEX IF EXISTS idx_agent_collaboration_task_goal_maps_task;
DROP INDEX IF EXISTS idx_agent_collaboration_task_goal_maps_goal;
DROP TABLE IF EXISTS agent_collaboration_task_goal_maps;
