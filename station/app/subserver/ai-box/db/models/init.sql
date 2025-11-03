-- AI Box 初始化配置
-- 内置 Ollama 提供商配置

-- 插入 Ollama 默认配置
INSERT INTO ai_box.providers (
    id,
    name,
    peers_user_id,
    sort,
    enabled,
    check_model,
    logo,
    description,
    key_vaults,
    source_type,
    settings,
    config,
    accessed_at,
    created_at,
    updated_at
) VALUES (
    'ollama-default',
    'Ollama',
    'system',  -- 系统级默认配置
    1,         -- 最高优先级
    true,      -- 默认启用
    'llama3.2:latest',  -- 默认检测模型
    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEyIDJMMTMuMDkgOC4yNkwyMCA5TDEzLjA5IDE1Ljc0TDEyIDIyTDEwLjkxIDE1Ljc0TDQgOUwxMC45MSA4LjI2TDEyIDJaIiBmaWxsPSIjRkY2QzAwIi8+Cjwvc3ZnPgo=',  -- Ollama Logo (橙色星形)
    'Ollama 是一个开源的本地 AI 模型运行平台，支持多种大语言模型的本地部署和推理。',
    '{}',      -- 无需密钥配置
    'local',   -- 本地源类型
    '{}',
    '{
        "health_check": {
            "enabled": true,
            "interval": 30,
            "endpoint": "/api/tags"
        },
        "auto_pull": {
            "enabled": false,
            "models": ["llama3.2:latest"]
        },
        "performance": {
            "gpu_layers": -1,
            "num_ctx": 8192,
            "num_predict": 4096,
            "repeat_penalty": 1.1,
            "top_k": 40,
            "top_p": 0.9
        },
        "ui": {
            "show_model_info": true,
            "show_performance_stats": true,
            "default_model": "llama3.2:latest"
        }
    }',
    NOW(),
    NOW(),
    NOW()
) ON CONFLICT (id, peers_user_id) DO UPDATE SET
    name = EXCLUDED.name,
    sort = EXCLUDED.sort,
    enabled = EXCLUDED.enabled,
    check_model = EXCLUDED.check_model,
    logo = EXCLUDED.logo,
    description = EXCLUDED.description,
    settings = EXCLUDED.settings,
    config = EXCLUDED.config,
    updated_at = NOW();

-- 为不同用户创建个人化的 Ollama 配置模板
-- 注意：这里使用占位符，实际使用时需要替换 {user_id}
/*
INSERT INTO ai_box.providers (
    id,
    name,
    peers_user_id,
    sort,
    enabled,
    check_model,
    logo,
    description,
    key_vaults,
    source_type,
    settings,
    config,
    accessed_at,
    created_at,
    updated_at
) 
SELECT 
    'ollama-' || '{user_id}',
    'My Ollama',
    '{user_id}',
    1,
    true,
    'llama3.2:latest',
    (SELECT logo FROM ai_box.providers WHERE id = 'ollama-default' AND peers_user_id = 'system'),
    'My personal Ollama configuration',
    '{}',
    'local',
    (SELECT settings FROM ai_box.providers WHERE id = 'ollama-default' AND peers_user_id = 'system'),
    (SELECT config FROM ai_box.providers WHERE id = 'ollama-default' AND peers_user_id = 'system'),
    NOW(),
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM ai_box.providers 
    WHERE id = 'ollama-' || '{user_id}' AND peers_user_id = '{user_id}'
);
*/