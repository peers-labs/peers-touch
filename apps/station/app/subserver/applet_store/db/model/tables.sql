
-- Initial schema for Applet Store

CREATE TABLE IF NOT EXISTS applets (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    description TEXT,
    icon VARCHAR(255),
    developer_id VARCHAR(64),
    status INTEGER DEFAULT 2,
    download_count BIGINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_applets_developer_id ON applets(developer_id);
CREATE INDEX idx_applets_status ON applets(status);

CREATE TABLE IF NOT EXISTS applet_versions (
    id VARCHAR(64) PRIMARY KEY,
    applet_id VARCHAR(64) NOT NULL,
    version VARCHAR(32) NOT NULL,
    bundle_hash VARCHAR(128),
    bundle_size BIGINT,
    bundle_path VARCHAR(255),
    bundle_domain VARCHAR(255),
    storage_backend VARCHAR(64),
    changelog TEXT,
    min_sdk_version VARCHAR(32),
    status INTEGER DEFAULT 2,
    channel INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (applet_id) REFERENCES applets(id) ON DELETE CASCADE
);

CREATE INDEX idx_applet_versions_applet_id ON applet_versions(applet_id);
CREATE INDEX idx_applet_versions_status ON applet_versions(status);
CREATE INDEX idx_applet_versions_channel ON applet_versions(channel);

CREATE TABLE IF NOT EXISTS applet_manifests (
    id VARCHAR(64) PRIMARY KEY,
    applet_id VARCHAR(64) NOT NULL,
    version_id VARCHAR(64) NOT NULL UNIQUE,
    version VARCHAR(32) NOT NULL,
    manifest_json TEXT NOT NULL,
    target_platforms TEXT,
    permissions TEXT,
    capabilities TEXT,
    integrity_json TEXT,
    bridge_protocol VARCHAR(64),
    runtime_type VARCHAR(32),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_applet_manifests_applet_id ON applet_manifests(applet_id);

CREATE TABLE IF NOT EXISTS applet_bundle_assets (
    id VARCHAR(64) PRIMARY KEY,
    version_id VARCHAR(64) NOT NULL,
    path VARCHAR(255) NOT NULL,
    sha256 VARCHAR(128) NOT NULL,
    size_bytes BIGINT,
    content_type VARCHAR(128),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_applet_bundle_assets_version_id ON applet_bundle_assets(version_id);

CREATE TABLE IF NOT EXISTS applet_version_channels (
    id VARCHAR(64) PRIMARY KEY,
    applet_id VARCHAR(64) NOT NULL,
    channel INTEGER NOT NULL,
    version VARCHAR(32) NOT NULL,
    rollout_percent INTEGER DEFAULT 100,
    enabled BOOLEAN DEFAULT TRUE,
    rollback_version VARCHAR(32),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_applet_version_channels_applet_id ON applet_version_channels(applet_id);
CREATE INDEX idx_applet_version_channels_channel ON applet_version_channels(channel);

CREATE TABLE IF NOT EXISTS applet_install_states (
    id VARCHAR(64) PRIMARY KEY,
    actor_ptid VARCHAR(255) NOT NULL,
    device_id VARCHAR(128),
    applet_id VARCHAR(64) NOT NULL,
    version VARCHAR(32) NOT NULL,
    channel INTEGER DEFAULT 1,
    status INTEGER DEFAULT 1,
    config_json TEXT,
    status_reason TEXT,
    installed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_applet_install_actor_device ON applet_install_states(actor_ptid, device_id);
CREATE UNIQUE INDEX idx_applet_install_identity ON applet_install_states(actor_ptid, device_id, applet_id);
CREATE INDEX idx_applet_install_status ON applet_install_states(status);

CREATE TABLE IF NOT EXISTS applet_capability_policies (
    id VARCHAR(64) PRIMARY KEY,
    policy_id VARCHAR(64) NOT NULL,
    applet_id VARCHAR(64) NOT NULL,
    version VARCHAR(32) NOT NULL,
    capability VARCHAR(128) NOT NULL,
    methods_json TEXT,
    decision INTEGER NOT NULL,
    reason TEXT,
    max_payload_bytes BIGINT,
    timeout_ms INTEGER,
    quota_per_minute INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_applet_capability_policies_policy_id ON applet_capability_policies(policy_id);
CREATE INDEX idx_applet_capability_policies_applet_id ON applet_capability_policies(applet_id);

CREATE TABLE IF NOT EXISTS applet_service_policies (
    id VARCHAR(64) PRIMARY KEY,
    policy_id VARCHAR(64) NOT NULL,
    applet_id VARCHAR(64) NOT NULL,
    version VARCHAR(32) NOT NULL,
    service_id VARCHAR(128) NOT NULL,
    kind VARCHAR(64),
    allowed_methods_json TEXT,
    allowed_paths_json TEXT,
    streaming BOOLEAN DEFAULT FALSE,
    station_path_prefix VARCHAR(255),
    decision INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_applet_service_policies_policy_id ON applet_service_policies(policy_id);
CREATE INDEX idx_applet_service_policies_applet_id ON applet_service_policies(applet_id);

CREATE TABLE IF NOT EXISTS applet_audit_records (
    id VARCHAR(64) PRIMARY KEY,
    audit_id VARCHAR(128) NOT NULL UNIQUE,
    actor_ptid VARCHAR(255),
    device_id VARCHAR(128),
    applet_id VARCHAR(64),
    version VARCHAR(32),
    session_id VARCHAR(128),
    capability VARCHAR(128),
    method VARCHAR(128),
    decision INTEGER,
    reason TEXT,
    metadata_json TEXT,
    recorded_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_applet_audit_records_actor_ptid ON applet_audit_records(actor_ptid);
CREATE INDEX idx_applet_audit_records_device_id ON applet_audit_records(device_id);
CREATE INDEX idx_applet_audit_records_applet_id ON applet_audit_records(applet_id);
CREATE INDEX idx_applet_audit_records_session_id ON applet_audit_records(session_id);
CREATE INDEX idx_applet_audit_records_decision ON applet_audit_records(decision);
CREATE INDEX idx_applet_audit_records_recorded_at ON applet_audit_records(recorded_at);
