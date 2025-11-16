# AI Box 聊天记录功能设计

## 设计目标
基于LobeChat的实际实现，为Peers Touch的AI Box功能设计一套完整的聊天记录系统，支持服务端持久化、多端同步、话题管理等功能。

## 技术选型分析

### 参考LobeChat的实现
- **数据库**: PostgreSQL (支持pgvector插件用于RAG)
- **ORM框架**: Drizzle ORM
- **迁移策略**: 程序化迁移，构建时自动执行
- **架构模式**: 客户端(IndexedDB/PGLite) + 服务端(PostgreSQL)双模式

### Peers Touch适配
- 保持现有的libp2p去中心化架构
- 支持离线操作和点对点同步
- 与现有AI Box功能深度集成
- 兼容现有的key_vaults安全机制

## 数据模型设计

### 核心实体关系
```
AiProvider (1) ←→ (N) ChatSession
ChatSession (1) ←→ (N) ChatTopic
ChatSession (1) ←→ (N) ChatMessage
ChatTopic (1) ←→ (N) ChatMessage
ChatMessage (1) ←→ (N) MessageAttachment
```

### Protobuf数据定义

#### ChatSession（聊天会话）
```protobuf
message ChatSession {
  string id = 1;                    // 唯一标识符
  string title = 2;               // 会话标题
  string description = 3;           // 会话描述
  string avatar = 4;                // 头像URL
  string background_color = 5;      // 背景色
  
  // 关联配置
  string provider_id = 6;           // AI提供商ID
  string user_id = 7;               // 用户ID
  string model_name = 8;            // 使用的模型
  
  // 状态管理
  bool pinned = 9;                  // 是否置顶
  string group = 10;                // 分组
  int64 created_at = 11;            // 创建时间
  int64 updated_at = 12;            // 更新时间
  
  // 扩展配置
  map<string, string> meta = 13;    // 元数据
  string config_json = 14;          // 配置JSON
}
```

#### ChatMessage（聊天消息）
```protobuf
message ChatMessage {
  string id = 1;                    // 唯一标识符
  string session_id = 2;            // 会话ID
  string topic_id = 3;               // 话题ID（可选）
  
  // 消息内容
  string role = 4;                   // 角色: user/assistant/system
  string content = 5;                // 消息内容
  string error_json = 6;             // 错误信息JSON
  
  // 多模态支持
  repeated MessageAttachment attachments = 7;  // 附件列表
  string images_json = 8;            // 图片数据JSON
  
  // 元数据
  string metadata_json = 9;           // 元数据JSON（工具调用、推理等）
  string plugin_json = 10;            // 插件调用JSON
  string tool_calls_json = 11;        // 工具调用JSON
  string reasoning_json = 12;         // 推理过程JSON
  
  // 时间戳
  int64 created_at = 13;              // 创建时间
  int64 updated_at = 14;              // 更新时间
}
```

#### ChatTopic（聊天话题）
```protobuf
message ChatTopic {
  string id = 1;                     // 唯一标识符
  string session_id = 2;              // 会话ID
  string title = 3;                   // 话题标题
  string description = 4;              // 话题描述
  
  // 消息范围
  int32 message_count = 5;             // 消息数量
  string first_message_id = 6;         // 第一条消息ID
  string last_message_id = 7;           // 最后一条消息ID
  
  // 时间戳
  int64 created_at = 8;                // 创建时间
  int64 updated_at = 9;                // 更新时间
}
```

#### MessageAttachment（消息附件）
```protobuf
message MessageAttachment {
  string id = 1;                       // 唯一标识符
  string message_id = 2;               // 消息ID
  string name = 3;                     // 文件名
  int64 size = 4;                      // 文件大小
  string type = 5;                     // 文件类型
  string url = 6;                      // 文件URL
  string metadata_json = 7;              // 元数据JSON
  int64 created_at = 8;                // 创建时间
}
```

## 数据库表结构设计

### PostgreSQL表结构

#### sessions表
```sql
CREATE TABLE sessions (
  id VARCHAR(36) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  avatar VARCHAR(500),
  background_color VARCHAR(7),
  provider_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  model_name VARCHAR(100),
  pinned BOOLEAN DEFAULT FALSE,
  group_name VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  meta JSONB,
  config_json JSONB
);

-- 索引
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_provider_id ON sessions(provider_id);
CREATE INDEX idx_sessions_pinned ON sessions(pinned) WHERE pinned = TRUE;
CREATE INDEX idx_sessions_created_at ON sessions(created_at DESC);
```

#### messages表
```sql
CREATE TABLE messages (
  id VARCHAR(36) PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  topic_id VARCHAR(36) REFERENCES topics(id) ON DELETE SET NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT,
  error_json JSONB,
  attachments_json JSONB,
  images_json JSONB,
  metadata_json JSONB,
  plugin_json JSONB,
  tool_calls_json JSONB,
  reasoning_json JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_messages_topic_id ON messages(topic_id);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX idx_messages_content_search ON messages USING gin(to_tsvector('english', content));
```

#### topics表
```sql
CREATE TABLE topics (
  id VARCHAR(36) PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  message_count INTEGER DEFAULT 0,
  first_message_id VARCHAR(36) REFERENCES messages(id),
  last_message_id VARCHAR(36) REFERENCES messages(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_topics_session_id ON topics(session_id);
CREATE INDEX idx_topics_created_at ON topics(created_at DESC);
```

#### attachments表
```sql
CREATE TABLE attachments (
  id VARCHAR(36) PRIMARY KEY,
  message_id VARCHAR(36) NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  size BIGINT,
  type VARCHAR(100),
  url VARCHAR(1000),
  metadata_json JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_attachments_message_id ON attachments(message_id);
CREATE INDEX idx_attachments_type ON attachments(type);
```

## gRPC服务接口设计

### ChatSessionService（会话服务）
```protobuf
service ChatSessionService {
  // 会话管理
  rpc CreateSession(CreateSessionRequest) returns (ChatSession);
  rpc GetSession(GetSessionRequest) returns (ChatSession);
  rpc ListSessions(ListSessionsRequest) returns (ListSessionsResponse);
  rpc UpdateSession(UpdateSessionRequest) returns (ChatSession);
  rpc DeleteSession(DeleteSessionRequest) returns (google.protobuf.Empty);
  
  // 会话状态管理
  rpc PinSession(PinSessionRequest) returns (google.protobuf.Empty);
  rpc UnpinSession(UnpinSessionRequest) returns (google.protobuf.Empty);
  rpc ArchiveSession(ArchiveSessionRequest) returns (google.protobuf.Empty);
}

message CreateSessionRequest {
  string title = 1;
  string description = 2;
  string provider_id = 3;
  string model_name = 4;
  map<string, string> meta = 5;
  string config_json = 6;
}

message ListSessionsRequest {
  string user_id = 1;
  int32 page_size = 2;
  string page_token = 3;
  string filter = 4;  // 过滤条件
  string order_by = 5; // 排序字段
}
```

### ChatMessageService（消息服务）
```protobuf
service ChatMessageService {
  // 消息发送（支持流式响应）
  rpc SendMessage(SendMessageRequest) returns (stream MessageResponse);
  rpc SendMessageUnary(SendMessageRequest) returns (MessageResponse);
  
  // 消息历史
  rpc GetMessageHistory(GetMessageHistoryRequest) returns (MessageHistoryResponse);
  rpc ListMessages(ListMessagesRequest) returns (ListMessagesResponse);
  
  // 消息管理
  rpc UpdateMessage(UpdateMessageRequest) returns (ChatMessage);
  rpc DeleteMessage(DeleteMessageRequest) returns (google.protobuf.Empty);
  rpc RegenerateMessage(RegenerateMessageRequest) returns (stream MessageResponse);
  
  // 附件管理
  rpc UploadAttachment(UploadAttachmentRequest) returns (UploadAttachmentResponse);
  rpc DeleteAttachment(DeleteAttachmentRequest) returns (google.protobuf.Empty);
}

message SendMessageRequest {
  string session_id = 1;
  string topic_id = 2;  // 可选
  string content = 3;
  repeated MessageAttachment attachments = 4;
  string metadata_json = 5;
  bool stream = 6;
}
```

### ChatTopicService（话题服务）
```protobuf
service ChatTopicService {
  // 话题管理
  rpc CreateTopic(CreateTopicRequest) returns (ChatTopic);
  rpc GetTopic(GetTopicRequest) returns (ChatTopic);
  rpc ListTopics(ListTopicsRequest) returns (ListTopicsResponse);
  rpc UpdateTopic(UpdateTopicRequest) returns (ChatTopic);
  rpc DeleteTopic(DeleteTopicRequest) returns (google.protobuf.Empty);
  
  // 话题分支
  rpc ForkTopic(ForkTopicRequest) returns (ChatTopic);
  rpc MergeTopic(MergeTopicRequest) returns (google.protobuf.Empty);
}
```

## 存储策略与性能优化

### 数据分层存储
1. **热数据层**（最近7天）
   - 全索引，内存优化
   - 实时同步到客户端
   
2. **温数据层**（7-30天）
   - 基础索引，压缩存储
   - 按需加载到客户端
   
3. **冷数据层**（30天前）
   - 归档到对象存储
   - 查询时异步加载

### 索引优化策略
```sql
-- 复合索引优化
CREATE INDEX idx_messages_session_created ON messages(session_id, created_at DESC);
CREATE INDEX idx_topics_session_count ON topics(session_id, message_count DESC);
CREATE INDEX idx_sessions_user_pinned ON sessions(user_id, pinned DESC, created_at DESC);

-- 全文搜索优化
CREATE INDEX idx_messages_content_fts ON messages USING gin(to_tsvector('simple', content));
CREATE INDEX idx_sessions_title_fts ON sessions USING gin(to_tsvector('simple', title));
```

### 查询性能优化
- 分页查询使用游标而非OFFSET
- 大消息内容分离存储（content vs metadata）
- 预计算常用统计信息（如消息数量）
- 使用物化视图优化复杂查询

## 安全与权限设计

### 数据加密
- **传输加密**: TLS 1.3 for gRPC
- **存储加密**: 敏感字段AES-256加密
- **密钥管理**: 集成现有key_vaults机制

### 访问控制
```protobuf
message AccessControl {
  string user_id = 1;
  repeated string roles = 2;           // owner, editor, viewer
  map<string, bool> permissions = 3;   // read, write, delete, share
  int64 granted_at = 4;
  int64 expires_at = 5;
}
```

## 与现有Peers Touch架构集成

### libp2p集成
- 使用libp2p进行点对点消息同步
- 支持离线消息缓存和重播
- 实现CRDT冲突解决机制

### 去中心化存储
- 消息内容分布式存储
- 会话元数据本地缓存
- 全局索引分布式维护

### 同步策略
1. **实时同步**: 在线节点间实时推送
2. **定时同步**: 离线节点定期拉取更新
3. **冲突解决**: 基于时间戳和向量时钟
4. **数据修复**: 检测到不一致时自动修复

## 扩展性考虑

### 水平扩展
- 会话数据按user_id分片
- 消息数据按session_id分片
- 使用一致性哈希保证负载均衡

### 垂直扩展
- 读写分离：主库写入，从库查询
- 缓存层：Redis缓存热点数据
- CDN：静态资源全球分发

### 未来扩展
- 多租户支持
- 企业级权限管理
- AI模型训练数据导出
- 第三方平台集成

这个设计文档结合了LobeChat的实际实现经验和Peers Touch的架构特点，为AI Box聊天记录功能提供了完整的技术方案。