-- 测试数据库初始化脚本
-- 创建测试数据库和用户
CREATE DATABASE IF NOT EXISTS peers_touch_test;

-- 切换到测试数据库
\c peers_touch_test;

-- 创建扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Provider 表（示例）
CREATE TABLE IF NOT EXISTS providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    logo VARCHAR(512),
    source_type VARCHAR(50) NOT NULL,
    api_key VARCHAR(512),
    api_endpoint VARCHAR(512),
    model_config JSONB,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- OSS Files 表（示例）
CREATE TABLE IF NOT EXISTS oss_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_key VARCHAR(512) NOT NULL UNIQUE,
    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL,
    content_type VARCHAR(100),
    storage_path VARCHAR(1024) NOT NULL,
    uploader_id UUID,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX idx_providers_source_type ON providers(source_type);
CREATE INDEX idx_providers_is_active ON providers(is_active);
CREATE INDEX idx_oss_files_file_key ON oss_files(file_key);
CREATE INDEX idx_oss_files_uploader_id ON oss_files(uploader_id);

-- 插入测试数据
INSERT INTO providers (id, name, description, logo, source_type, api_key, api_endpoint, is_active) VALUES
    ('11111111-1111-1111-1111-111111111111', 'Test Provider 1', '测试 Provider 1', 'https://example.com/logo1.png', 'openai', 'test-key-1', 'https://api.openai.com/v1', true),
    ('22222222-2222-2222-2222-222222222222', 'Test Provider 2', '测试 Provider 2', 'https://example.com/logo2.png', 'anthropic', 'test-key-2', 'https://api.anthropic.com', true),
    ('33333333-3333-3333-3333-333333333333', 'Inactive Provider', '未激活的 Provider', 'https://example.com/logo3.png', 'custom', 'test-key-3', 'https://custom.api.com', false);

-- 插入测试文件记录
INSERT INTO oss_files (id, file_key, file_name, file_size, content_type, storage_path) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'test/file1.txt', 'file1.txt', 1024, 'text/plain', '/storage/test/file1.txt'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'test/image.png', 'image.png', 2048, 'image/png', '/storage/test/image.png');

-- 创建更新时间触发器
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_providers_updated_at BEFORE UPDATE ON providers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_oss_files_updated_at BEFORE UPDATE ON oss_files
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 授权
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO test_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO test_user;
