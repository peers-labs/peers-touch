-- +migrate Up

CREATE TABLE IF NOT EXISTS agent_goal_events (
    domain_event_id VARCHAR(64) PRIMARY KEY,
    goal_id VARCHAR(64) NOT NULL,
    event_seq BIGINT NOT NULL,
    event_type VARCHAR(96) NOT NULL,
    goal_revision BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_goal_events_goal_seq
    ON agent_goal_events (goal_id, event_seq);
CREATE INDEX IF NOT EXISTS idx_agent_goal_events_goal
    ON agent_goal_events (goal_id);
CREATE INDEX IF NOT EXISTS idx_agent_goal_events_type
    ON agent_goal_events (event_type);

CREATE TABLE IF NOT EXISTS agent_realtime_actor_cursors (
    target_actor_ptid TEXT PRIMARY KEY,
    next_sequence BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_realtime_outbox (
    outbox_id VARCHAR(64) PRIMARY KEY,
    domain_event_id VARCHAR(64) NOT NULL,
    target_actor_ptid TEXT NOT NULL,
    workspace_id VARCHAR(64) NOT NULL DEFAULT '',
    actor_sequence BIGINT NOT NULL,
    realtime_event_id VARCHAR(64) NOT NULL,
    domain_sequence BIGINT NOT NULL,
    event_type VARCHAR(96) NOT NULL,
    goal_id VARCHAR(64) NOT NULL DEFAULT '',
    task_id VARCHAR(64) NOT NULL DEFAULT '',
    goal_revision BIGINT NOT NULL DEFAULT 0,
    event_class VARCHAR(16) NOT NULL,
    state VARCHAR(16) NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL,
    lease_owner VARCHAR(64) NOT NULL DEFAULT '',
    lease_generation BIGINT NOT NULL DEFAULT 0,
    lease_expires_at TIMESTAMPTZ,
    realtime_cursor VARCHAR(64) NOT NULL DEFAULT '',
    last_error TEXT NOT NULL DEFAULT '',
    delivered_at TIMESTAMPTZ,
    committed_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_realtime_domain_target
    ON agent_realtime_outbox (domain_event_id, target_actor_ptid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_realtime_actor_seq
    ON agent_realtime_outbox (target_actor_ptid, actor_sequence);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_realtime_actor_cursor
    ON agent_realtime_outbox (target_actor_ptid, realtime_event_id);
CREATE INDEX IF NOT EXISTS idx_agent_realtime_pending
    ON agent_realtime_outbox (
        target_actor_ptid,
        workspace_id,
        state,
        next_attempt_at
    );

-- +migrate Down

DROP INDEX IF EXISTS idx_agent_realtime_pending;
DROP INDEX IF EXISTS idx_agent_realtime_actor_cursor;
DROP INDEX IF EXISTS idx_agent_realtime_actor_seq;
DROP INDEX IF EXISTS idx_agent_realtime_domain_target;
DROP TABLE IF EXISTS agent_realtime_outbox;
DROP TABLE IF EXISTS agent_realtime_actor_cursors;
DROP INDEX IF EXISTS idx_agent_goal_events_type;
DROP INDEX IF EXISTS idx_agent_goal_events_goal;
DROP INDEX IF EXISTS idx_agent_goal_events_goal_seq;
DROP TABLE IF EXISTS agent_goal_events;
