
-- Initial schema for Applet Store

CREATE TABLE IF NOT EXISTS applets (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    description TEXT,
    icon VARCHAR(255),
    developer_id VARCHAR(64),
    download_count BIGINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_applets_developer_id ON applets(developer_id);

CREATE TABLE IF NOT EXISTS applet_versions (
    id VARCHAR(64) PRIMARY KEY,
    applet_id VARCHAR(64) NOT NULL,
    version VARCHAR(32) NOT NULL,
    bundle_hash VARCHAR(128),
    bundle_size BIGINT,
    bundle_url VARCHAR(255),
    changelog TEXT,
    status VARCHAR(20) DEFAULT 'published',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (applet_id) REFERENCES applets(id) ON DELETE CASCADE
);

CREATE INDEX idx_applet_versions_applet_id ON applet_versions(applet_id);
