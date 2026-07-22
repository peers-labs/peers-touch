-- Federation Governance Schema — Phase 1
-- Source: docs/architecture/federation/data-model.md + wire-protocol.md

BEGIN;

-- Federation entity
CREATE TABLE IF NOT EXISTS federation (
    id              BIGSERIAL PRIMARY KEY,
    federation_id   VARCHAR(30) NOT NULL UNIQUE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    policy_type     VARCHAR(30) NOT NULL DEFAULT 'single_admin',
    sequencer_station_peer_id VARCHAR(128) NOT NULL,
    genesis_hash    BYTEA NOT NULL,
    head_hash       BYTEA NOT NULL,
    head_seq        BIGINT NOT NULL DEFAULT 0,
    created_by_actor_id VARCHAR(64) NOT NULL,
    created_by_station_peer_id VARCHAR(128) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_federation_status ON federation(status);

-- Federation Ledger Event (append-only)
CREATE TABLE IF NOT EXISTS federation_ledger_event (
    id              BIGSERIAL PRIMARY KEY,
    event_id        VARCHAR(30) NOT NULL UNIQUE,
    federation_id   VARCHAR(30) NOT NULL REFERENCES federation(federation_id),
    seq             BIGINT NOT NULL,
    prev_hash       BYTEA NOT NULL,
    event_hash      BYTEA NOT NULL,
    event_type      SMALLINT NOT NULL,
    payload_bytes   BYTEA NOT NULL,
    payload_hash    BYTEA NOT NULL,
    actor_id        VARCHAR(64) NOT NULL,
    actor_federated_handle VARCHAR(255) NOT NULL DEFAULT '',
    station_peer_id VARCHAR(128) NOT NULL,
    sequencer_station_peer_id VARCHAR(128) NOT NULL,
    actor_signature BYTEA NOT NULL,
    station_signature BYTEA NOT NULL,
    sequencer_signature BYTEA NOT NULL,
    created_at_unix_ms BIGINT NOT NULL,
    UNIQUE(federation_id, seq)
);

CREATE INDEX idx_ledger_event_federation_seq ON federation_ledger_event(federation_id, seq);

-- Federation Station Membership
CREATE TABLE IF NOT EXISTS federation_station_membership (
    id              BIGSERIAL PRIMARY KEY,
    federation_id   VARCHAR(30) NOT NULL REFERENCES federation(federation_id),
    station_peer_id VARCHAR(128) NOT NULL,
    station_name    VARCHAR(255) NOT NULL DEFAULT '',
    station_url     VARCHAR(512) NOT NULL DEFAULT '',
    role            VARCHAR(30) NOT NULL DEFAULT 'member_station',
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_by_event_id VARCHAR(30) NOT NULL DEFAULT '',
    UNIQUE(federation_id, station_peer_id)
);

CREATE INDEX idx_membership_federation ON federation_station_membership(federation_id);
CREATE INDEX idx_membership_station ON federation_station_membership(station_peer_id);

-- Federation Actor Role
CREATE TABLE IF NOT EXISTS federation_actor_role (
    id              BIGSERIAL PRIMARY KEY,
    federation_id   VARCHAR(30) NOT NULL REFERENCES federation(federation_id),
    actor_id        VARCHAR(64) NOT NULL,
    actor_federated_handle VARCHAR(255) NOT NULL DEFAULT '',
    station_peer_id VARCHAR(128) NOT NULL,
    role            VARCHAR(30) NOT NULL,
    granted_by_event_id VARCHAR(30) NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ,
    UNIQUE(federation_id, actor_id)
);

CREATE INDEX idx_actor_role_federation ON federation_actor_role(federation_id);

-- Actor Signing Key
CREATE TABLE IF NOT EXISTS actor_signing_key (
    id              BIGSERIAL PRIMARY KEY,
    actor_id        VARCHAR(64) NOT NULL UNIQUE,
    public_key      BYTEA NOT NULL,
    encrypted_private_key BYTEA NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rotated_at      TIMESTAMPTZ
);

-- Federation Ledger Sync Cursor
CREATE TABLE IF NOT EXISTS federation_sync_cursor (
    id              BIGSERIAL PRIMARY KEY,
    federation_id   VARCHAR(30) NOT NULL REFERENCES federation(federation_id),
    remote_station_peer_id VARCHAR(128) NOT NULL,
    last_seen_head_hash BYTEA,
    last_seen_head_seq BIGINT NOT NULL DEFAULT 0,
    last_applied_seq BIGINT NOT NULL DEFAULT 0,
    last_sync_at    TIMESTAMPTZ,
    status          VARCHAR(30) NOT NULL DEFAULT 'healthy',
    error_code      INTEGER NOT NULL DEFAULT 0,
    error_message   TEXT NOT NULL DEFAULT '',
    UNIQUE(federation_id, remote_station_peer_id)
);

COMMIT;
