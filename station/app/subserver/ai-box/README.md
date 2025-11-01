# AI Box Subserver (MVP版本)

AI Box 是一个简洁的 AI Agent 管理和对话系统，为 Peers-Touch 平台提供基础智能对话能力。这是MVP（最小可行产品）版本，专注于核心功能。

## 功能特性 (MVP)

### 🧠 Agent 管理 (LobeChat-like设计)
 - **创建 Agent**: 支持配置 AI 模型
 - **获取 Agent**: 查看 Agent 详情
 - **列出 Agents**: 获取所有 Agent 列表
 - **Agent 配置管理**: 分离基础信息和配置信息（类似LobeChat设计）
 - **知识库集成**: PostgreSQL + pgvector 向量存储（类似LobeChat设计）

### 💬 对话管理 (基础)
- **创建对话**: 启动新的对话会话
- **列出对话**: 查看 Agent 的对话历史
- **发送消息**: 与 Agent 进行对话

### 🔧 核心接口
- **健康检查**: 服务状态检查
- **Provider管理**: LobeChat风格的提供商管理（配置、启用、测试连接）
- **知识库管理**: PostgreSQL + pgvector 向量存储
- **Model管理**: 支持模型列表获取和筛选

## API 接口 (MVP)

### 基础接口

#### 健康检查
```http
GET /health
```

#### 获取支持的提供商
```http
GET /providers
```

#### 获取所有提供商详细信息（支持LobeChat前端）
```http
GET /providers/info
```

#### 获取单个提供商信息
```http
GET /providers/{provider_name}
```

#### 更新提供商配置（支持API Key、代理URL等配置）
```http
PUT /providers/{provider_name}/config
Content-Type: application/json

{
  "api_key": "your-api-key-here",
  "api_proxy_url": "https://your-proxy-url.com",
  "use_response_spec": true,
  "client_request_mode": false
}
```

#### 设置提供商启用状态
```http
PUT /providers/{provider_name}/enabled
Content-Type: application/json

{
  "enabled": true
}
```

#### 测试提供商连接
```http
POST /providers/{provider_name}/test?model=gpt-4
```

### 知识库管理接口

#### 创建知识库
```http
POST /knowledge-bases
Content-Type: application/json

{
  "name": "技术文档",
  "description": "项目技术文档集合",
  "type": "vector",
  "config": {
    "chunk_size": 1000,
    "chunk_overlap": 200,
    "embedding_model": "text-embedding-ada-002"
  }
}
```

#### 获取知识库列表
```http
GET /knowledge-bases?limit=20&offset=0
```

#### 关联Agent与知识库
```http
POST /agents/{agent_id}/knowledge-bases
Content-Type: application/json

{
  "knowledge_base_id": "kb_123",
  "priority": 1
}
```

#### 获取Agent关联的知识库
```http
GET /agents/{agent_id}/knowledge-bases
```

### Agent 管理接口

#### 创建 Agent
```http
POST /agents
Content-Type: application/json

{
  "name": "智能助手",
  "description": "一个通用的 AI 助手",
  "model": "gpt-4",
  "provider": "openai",
  "system_prompt": "你是一个 helpful AI assistant",
  "temperature": 0.7,
  "max_tokens": 2048
}
```

#### 获取 Agent 列表
```http
GET /agents?limit=20&offset=0
```

#### 获取单个 Agent
```http
GET /agents/{agent_id}
```

#### 创建 Agent 配置
```http
POST /agents/{agent_id}/configuration
Content-Type: application/json

{
  "model": "gpt-4",
  "provider": "openai",
  "system_prompt": "你是一个 helpful AI assistant",
  "temperature": 0.7,
  "max_tokens": 2048,
  "settings": {
    "top_p": 0.9,
    "frequency_penalty": 0.0,
    "presence_penalty": 0.0
  }
}
```

#### 获取 Agent 配置
```http
GET /agents/{agent_id}/configuration
```

### 对话管理接口

#### 创建对话
```http
POST /conversations
Content-Type: application/json

{
  "agent_id": "agent_123",
  "title": "技术讨论",
  "context": {
    "topic": "golang development"
  }
}
```

#### 获取 Agent 的对话列表
```http
GET /agents/{agent_id}/conversations?limit=20&offset=0
```

#### 发送消息
```http
POST /chat
Content-Type: application/json

{
  "agent_id": "agent_123",
  "message": "你好，请介绍一下 Golang 的并发模型",
  "stream": false
}
```

## 数据模型 (MVP)

### Agent 模型
```go
type Agent struct {
    ID           string                 `json:"id"`
    Name         string                 `json:"name"`
    Description  string                 `json:"description"`
    Model        string                 `json:"model"`
    Provider     string                 `json:"provider"`
    SystemPrompt string                 `json:"system_prompt"`
    Temperature  float32                `json:"temperature"`
    MaxTokens    int                    `json:"max_tokens"`
    Settings     map[string]interface{} `json:"settings"`
    IsActive     bool                   `json:"is_active"`
    CreatedAt    time.Time              `json:"created_at"`
    UpdatedAt    time.Time              `json:"updated_at"`
}
```

### Conversation 模型
```go
type Conversation struct {
    ID        string                 `json:"id"`
    AgentID   string                 `json:"agent_id"`
    Title     string                 `json:"title"`
    Context   map[string]interface{} `json:"context"`
    IsActive  bool                   `json:"is_active"`
    CreatedAt time.Time              `json:"created_at"`
    UpdatedAt time.Time              `json:"updated_at"`
}
```

### Message 模型
```go
type Message struct {
    ID             string                 `json:"id"`
    ConversationID string                 `json:"conversation_id"`
    Role           string                 `json:"role"`
    Content        string                 `json:"content"`
    TokenCount     int                    `json:"token_count"`
    Model          string                 `json:"model"`
    CreatedAt      time.Time              `json:"created_at"`
}
```

## 使用示例

### 1. 创建 Agent
```bash
curl -X POST http://localhost:8080/ai-box/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "代码助手",
    "description": "专业的代码审查助手",
    "model": "gpt-4",
    "provider": "openai",
    "system_prompt": "你是一个专业的代码审查专家",
    "temperature": 0.3,
    "max_tokens": 2048
  }'
```

### 2. 发送消息
```bash
curl -X POST http://localhost:8080/ai-box/chat \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "<agent_id>",
    "message": "解释什么是 goroutine"
  }'
```

### 3. 获取对话历史
```bash
curl http://localhost:8080/ai-box/agents/<agent_id>/conversations
```

### 4. 获取支持的提供商
```bash
curl http://localhost:8080/ai-box/providers
```

### 5. 创建知识库
```bash
curl -X POST http://localhost:8080/ai-box/knowledge-bases \
  -H "Content-Type: application/json" \
  -d '{
    "name": "技术文档",
    "description": "项目技术文档集合",
    "type": "vector",
    "config": {
      "chunk_size": 1000,
      "chunk_overlap": 200,
      "embedding_model": "text-embedding-ada-002"
    }
  }'
```

### 6. 关联Agent与知识库
```bash
curl -X POST http://localhost:8080/ai-box/agents/<agent_id>/knowledge-bases \
  -H "Content-Type: application/json" \
  -d '{
    "knowledge_base_id": "kb_123",
    "priority": 1
  }'
```

## 架构设计 (MVP)

### 文件结构
```
ai-box/
├── ai_box.go          # 子服务器主入口
├── types.go           # 核心数据模型
├── service.go         # 业务逻辑层
├── handlers.go        # HTTP接口层
├── provider.go        # AI模型提供商接口
├── vector_service.go  # 向量存储服务
├── utils.go           # 工具函数
├── README.md          # 文档
└── VECTOR_STORAGE.md  # PostgreSQL向量存储设计
```

### 核心组件
 - **Service Layer**: 核心业务逻辑实现
 - **Handler Layer**: HTTP 请求处理
 - **Model Layer**: 数据模型定义
 - **Provider Layer**: AI模型提供商接口
 - **Utils Layer**: 工具函数集合

## 技术实现 (MVP)

### ✅ 支持LobeChat前端特性
 - ✅ 使用`frame/core/store`进行数据库操作
 - ✅ 使用`frame/core/logger`的全局日志函数
 - ✅ 遵循子服务器架构模式
 - ✅ 支持微服务部署
 - ✅ LobeChat风格的Provider接口抽象
 - ✅ PostgreSQL + pgvector 向量存储（LobeChat设计）
 - ✅ Agent配置分离设计（类似LobeChat）
 - ✅ 完整的Provider配置管理（API Key、代理URL、功能开关）
 - ✅ 提供商连接测试功能
 - ✅ 支持模型列表获取和筛选
- 🚫 无插件系统（MVP后添加）
- 🚫 无知识库集成（MVP后添加）
- 🚫 无复杂的权限管理（MVP后添加）
- 🚫 无统计分析（MVP后添加）

## 开发计划

### ✅ MVP阶段 (当前)
- [x] 基础Agent管理
- [x] 基础对话管理
- [x] 核心API接口
- [x] 健康检查
- [x] 基础数据模型
- [x] PostgreSQL + pgvector 向量存储支持
- [x] Agent配置分离设计（LobeChat风格）
- [x] 知识库管理功能

### 🚧 下一阶段
- [ ] 插件系统集成
- [ ] 完整的RAG功能实现
- [ ] 多模型支持
- [ ] 流式响应
- [ ] 用户认证
- [ ] 向量搜索优化

### 📋 未来功能
- [ ] 高级统计分析
- [ ] 性能优化
- [ ] 企业级安全
- [ ] 监控告警

## 快速开始

```bash
# 编译
go build ./subserver/ai-box/...

# 运行测试
go test ./subserver/ai-box/...

# 集成到主应用
# 在main.go中添加AI Box子服务器
```

这个MVP版本提供了一个功能完整但简洁的AI Agent系统，可以作为Peers-Touch平台的智能对话核心组件。