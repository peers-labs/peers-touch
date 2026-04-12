# Agent Memory 系统架构设计

> **Peers-Touch 专业级 Agent 记忆系统**
> 记录用户行为与偏好，保留 Agent 思考过程，实现跨端共享的持久化记忆能力。

---

## 1. 设计目标

### 1.1 核心目标
- 构建专业级 Agent 记忆系统，使 AI Agent 具备长期记忆能力。
- 记忆不仅仅是"展示给用户看"，更要在每次对话中**真正参与 Agent 的推理与决策**。
- 记忆作为跨端共享数据，遵循 Station 为 SoT（Source of Truth）的架构原则。

### 1.2 专业记忆应该做什么
| 能力 | 说明 |
|------|------|
| **用户画像构建** | 从对话中提取用户身份、偏好、习惯、关注点，形成持续演进的用户画像 |
| **对话上下文增强** | 在每次对话前自动检索相关记忆，注入 Agent 系统提示词，使 Agent "记得"用户 |
| **Agent 思考记录** | 记录 Agent 每轮对话的推理过程、决策依据、工具调用结果 |
| **行为轨迹追踪** | 记录用户与 Agent 交互的关键行为（话题切换、偏好表达、反馈信号） |
| **时间衰减与遗忘** | 模拟人类记忆的遗忘曲线，近期记忆权重高，远期记忆自然衰减 |
| **跨 Agent 共享** | 用户画像等核心记忆可在多个 Agent 间共享，避免每个 Agent 从零开始 |
| **记忆检索与排序** | 向量语义检索 + 关键词检索 + 时间衰减 + 重排序，精准召回相关记忆 |

### 1.3 非目标
- 不替代 AI Chat 的消息存储（消息归消息，记忆归记忆）。
- 不做通用知识库（记忆是关于"这个用户"和"这个 Agent 与用户的交互"的）。
- 不做 RAG 文档检索系统（那是 Knowledge Base 的职责）。

---

## 2. 记忆层级模型

采用五层记忆模型，源自 LobeHub 的 Memory 架构（identity / context / experience / preference / activity），各层拥有独立的数据结构和子表：

```
┌─────────────────────────────────────────────────────────┐
│                    Memory Layer Model                     │
│                  （源自 LobeHub Memory）                   │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  L1: Identity（身份层）                               │ │
│  │  用户是谁？名字、职业、关系、角色、技术栈...            │ │
│  │  ● 用户级 ● 跨 Agent 共享 ● 极少变更 ● 永不过期      │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  L2: Preference（偏好层）                             │ │
│  │  用户喜欢什么？沟通风格、行为指令、适用范围...          │ │
│  │  ● 用户级 ● 跨 Agent 共享 ● 缓慢演变 ● 长期保留      │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  L3: Context（上下文层）                              │ │
│  │  正在进行什么？项目、目标、关系、进行中的情境...        │ │
│  │  ● 用户级 ● 有状态（planned/ongoing/completed/...）   │ │
│  │  ● 含关联对象（objects）和主体（subjects）            │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  L4: Experience（经验层）                             │ │
│  │  学到了什么？situation → reasoning → action →         │ │
│  │  outcome → keyLearning，可迁移的经验教训              │ │
│  │  ● Agent 级 ● 时间衰减 ● 中期保留                    │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  L5: Activity（活动层）                               │ │
│  │  发生了什么？具体事件、时间地点人物、主观反馈...        │ │
│  │  ● 用户级 ● 含时间范围（starts_at/ends_at）          │ │
│  │  ● 含地点、参与者、反馈叙述                           │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 2.1 各层详细说明

| 层级 | 作用域 | 写入来源 | DB 子表 | 生命周期 | 检索优先级 | 示例 |
|------|--------|---------|---------|----------|-----------|------|
| **Identity** | 用户级 | Agent Tool 调用 | `user_memories_identities` | 永久 | 最高 | "后端工程师，主用 Go 语言，关系: self" |
| **Preference** | 用户级 | Agent Tool 调用 | `user_memories_preferences` | 永久（可修正） | 高 | "回答请用中文，代码注释用英文" |
| **Context** | 用户级 | Agent Tool 调用 | `user_memories_contexts` | 状态驱动（ongoing → completed） | 中 | "正在进行微服务迁移项目，状态: ongoing，紧急度: 0.8" |
| **Experience** | Agent 级 | Agent Tool 调用 | `user_memories_experiences` | 180 天衰减 | 中 | "situation: 数据库选型 → reasoning: 对比 PG/MySQL → action: 选 PG → keyLearning: PG 在 JSON 查询上优势大" |
| **Activity** | 用户级 | Agent Tool 调用 | `user_memories_activities` | 时间衰减 | 中 | "3月15日 14:00-16:00 参加架构评审，地点: 会议室A，反馈: 方案获批" |

### 2.2 跨 Agent 共享策略

```
                    用户 Alice
                       │
          ┌────────────┼────────────┐
          │            │            │
     Agent: Coder  Agent: Writer  Agent: Analyst
          │            │            │
          │            │            │
          ▼            ▼            ▼
     ┌────────────────────────────────┐
     │  Identity + Preference + Context│  ← 共享：所有 Agent 都知道用户是谁、喜好什么、正在做什么
     │  + Activity（用户级记忆）        │
     └────────────────────────────────┘
          │            │            │
          ▼            ▼            ▼
     ┌────────┐  ┌────────┐  ┌────────┐
     │Experie.│  │Experie.│  │Experie.│  ← 隔离：每个 Agent 有自己的经验教训
     └────────┘  └────────┘  └────────┘
```

---

## 3. 系统架构

### 3.1 整体架构

```
┌────────────────────────────────────────────────────────────────────┐
│                          Client Layer                               │
│                                                                      │
│  ┌──────────────────────┐    ┌───────────────────────────────────┐ │
│  │  Desktop (Tauri/TS)  │    │  Mobile (Android / iOS)            │ │
│  │                      │    │                                     │ │
│  │  ┌────────────────┐  │    │  ┌────────────────┐                │ │
│  │  │  Memory Page   │  │    │  │  Memory Page   │                │ │
│  │  │  (Browse/Search│  │    │  │  (Browse/Search│                │ │
│  │  │   /Persona)    │  │    │  │   /Persona)    │                │ │
│  │  └────────────────┘  │    │  └────────────────┘                │ │
│  │                      │    │                                     │ │
│  │  ┌────────────────┐  │    │  ┌────────────────┐                │ │
│  │  │  Chat Input    │  │    │  │  Chat Input    │                │ │
│  │  │  Memory Toggle │  │    │  │  Memory Toggle │                │ │
│  │  └────────────────┘  │    │  └────────────────┘                │ │
│  │                      │    │                                     │ │
│  │  ┌────────────────┐  │    │  Local Cache (SQLite/Room/SwiftData)│ │
│  │  │ Local Cache    │  │    │  - 记忆摘要缓存                     │ │
│  │  │ (Rust SQLite)  │  │    │  - Persona 缓存                    │ │
│  │  └────────────────┘  │    │  - 不缓存 embedding 向量            │ │
│  └──────────┬───────────┘    └───────────────┬───────────────────┘ │
│             │                                 │                      │
└─────────────┼─────────────────────────────────┼──────────────────────┘
              │          HTTP/gRPC               │
              └──────────────┬──────────────────┘
                             │
┌────────────────────────────┼───────────────────────────────────────┐
│                      Station Layer                                  │
│                             │                                        │
│  ┌──────────────────────────▼───────────────────────────────────┐  │
│  │          Memory capability runtime (Go / Agent-owned)         │  │
│  │                                                               │  │
│  │  ┌──────────────────────────────────────────────────────┐   │  │
│  │  │  Handler Layer (handler/)                             │   │  │
│  │  │  HTTP API 端点                                        │   │  │
│  │  │  /memory/list, /memory/search, /memory/persona, ...   │   │  │
│  │  └───────────────────────┬──────────────────────────────┘   │  │
│  │                          │                                    │  │
│  │  ┌──────────────────────────────────────────────────────┐   │  │
│  │  │  Service Layer (service/)                             │   │  │
│  │  │                                                       │   │  │
│  │  │  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │   │  │
│  │  │  │  Extraction  │  │  Retrieval   │  │  Persona   │  │   │  │
│  │  │  │  Service     │  │  Service     │  │  Service   │  │   │  │
│  │  │  │              │  │              │  │            │  │   │  │
│  │  │  │  从对话中    │  │  向量+关键词  │  │  自动生成  │  │   │  │
│  │  │  │  提取记忆    │  │  混合检索    │  │  用户画像  │  │   │  │
│  │  │  └─────────────┘  └──────────────┘  └────────────┘  │   │  │
│  │  │                                                       │   │  │
│  │  │  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │   │  │
│  │  │  │  Injection   │  │  Lifecycle   │  │  Event     │  │   │  │
│  │  │  │  Service     │  │  Service     │  │  Service   │  │   │  │
│  │  │  │              │  │              │  │            │  │   │  │
│  │  │  │  构建 memory │  │  衰减/合并/  │  │  审计日志  │  │   │  │
│  │  │  │  上下文注入  │  │  归档/清理   │  │  事件发布  │  │   │  │
│  │  │  └─────────────┘  └──────────────┘  └────────────┘  │   │  │
│  │  └──────────────────────────────────────────────────────┘   │  │
│  │                          │                                    │  │
│  │  ┌──────────────────────────────────────────────────────┐   │  │
│  │  │  Infrastructure Layer (db/ + embedding/)              │   │  │
│  │  │                                                       │   │  │
│  │  │  ┌────────────────┐      ┌─────────────────────┐    │   │  │
│  │  │  │  PostgreSQL     │      │  Embedding Engine    │    │   │  │
│  │  │  │  + pgvector     │      │  (调用 Provider 体系) │    │   │  │
│  │  │  │                │      │                       │    │   │  │
│  │  │  │  记忆存储       │      │  文本 → 向量          │    │   │  │
│  │  │  │  向量索引       │      │  复用 Agent 的        │    │   │  │
│  │  │  │  全文检索       │      │  Provider/Model 配置  │    │   │  │
│  │  │  └────────────────┘      └─────────────────────┘    │   │  │
│  │  └──────────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  agent SubServer（当前主线）                                  │  │
│  │  - 在 turn/completion 流程中调用 memory 的 Extraction        │  │
│  │  - 在 turn/completion 流程中调用 memory 的 Injection         │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

### 3.2 记忆在 AI 对话中的工作流

这是记忆系统最核心的价值——真正参与 Agent 推理：

```
用户发送消息
     │
     ▼
┌──────────────────────────────────────────────────────────┐
│  agent: turn/completion pipeline                         │
│                                                           │
│  Step 1: 检索相关记忆（Memory Retrieval）                 │
│  ├── 从用户消息中提取语义 query                           │
│  ├── 调用 memory.RetrievalService.Search()               │
│  │   ├── 向量语义检索（pgvector cosine similarity）      │
│  │   ├── 关键词检索（PostgreSQL tsvector）                │
│  │   ├── 时间衰减加权（decay_factor）                    │
│  │   └── 混合排序 + 重排序 → Top-K 记忆                  │
│  └── 结果：[{layer, summary, relevance_score}, ...]      │
│                                                           │
│  Step 2: 构建增强提示词（Memory Injection）               │
│  ├── 读取 Persona（用户画像摘要）                         │
│  ├── 将 Top-K 记忆格式化为 system message 的一部分        │
│  │   ┌─────────────────────────────────────────────┐     │
│  │   │ <memory_context>                             │     │
│  │   │ ## About the User                            │     │
│  │   │ - Backend engineer, primarily uses Go        │     │
│  │   │ - Prefers concise answers with code examples │     │
│  │   │                                              │     │
│  │   │ ## Relevant Past Interactions                │     │
│  │   │ - [3d ago] Discussed microservice migration, │     │
│  │   │   chose event-driven architecture            │     │
│  │   │ - [1w ago] Set up PostgreSQL with pgvector   │     │
│  │   │   for vector search                          │     │
│  │   │ </memory_context>                            │     │
│  │   └─────────────────────────────────────────────┘     │
│  └── 注入到 messages 数组的 system prompt 中              │
│                                                           │
│  Step 3: 调用 LLM 生成回复                               │
│  ├── 发送增强后的 messages 到 Provider                    │
│  └── 流式返回 AI 回复                                    │
│                                                           │
│  Step 4: 异步提取新记忆（Memory Extraction）              │
│  ├── 用 LLM 分析本轮对话，提取值得记住的信息              │
│  │   ├── 新的身份信息 → Identity 层                      │
│  │   ├── 新的偏好表达 → Preference 层                    │
│  │   ├── 新的/变更的情境 → Context 层                    │
│  │   ├── 经验教训 → Experience 层                        │
│  │   └── 具体活动事件 → Activity 层                      │
│  ├── 去重：与已有记忆比对，避免重复存储                    │
│  ├── 生成 embedding 向量                                 │
│  └── 持久化到 PostgreSQL + 发布 memory.updated 事件      │
│                                                           │
│  Step 5: 更新活动记忆（Activity Memory）                  │
│  ├── 记录当前对话作为一次 activity 事件                    │
│  └── 含时间、参与者、反馈等结构化信息                      │
└──────────────────────────────────────────────────────────┘
```

### 3.3 Memory Effort 等级

Agent 级别的 `memory.effort` 配置控制记忆系统的积极性：

| 等级 | Retrieval Top-K | Extraction | 适用场景 |
|------|----------------|------------|---------|
| **low** | activities: 2, preferences: 2, contexts: 0, experiences: 0 | 仅提取 Identity 变更 | 轻量对话、临时问答 |
| **medium** | activities: 3, preferences: 3, contexts: 0, experiences: 0 | 提取全部层，每轮分析 | 日常使用（默认） |
| **high** | activities: 6, preferences: 6, contexts: 4, experiences: 4 | 深度分析每轮，记录经验教训 | 重要项目协作、长期任务 |

---

## 4. Proto 定义

### 4.1 文件位置

```
model/domain/memory/
├── memory.proto           # 核心记忆模型
├── memory_api.proto        # API 请求/响应消息
└── persona.proto           # 用户画像模型
```

### 4.2 memory.proto

```protobuf
syntax = "proto3";

package peers_touch.model.memory.v1;

import "google/protobuf/timestamp.proto";

option go_package = "github.com/peers-labs/peers-touch/station/app/subserver/memory/model;model";

// 记忆层级（与 LobeHub 一致）
enum MemoryLayer {
  MEMORY_LAYER_UNSPECIFIED = 0;
  MEMORY_LAYER_IDENTITY = 1;     // 身份层：用户是谁（角色、关系、人口属性）
  MEMORY_LAYER_PREFERENCE = 2;   // 偏好层：用户喜好（指令、范围、优先级）
  MEMORY_LAYER_CONTEXT = 3;      // 上下文层：正在进行的情境/项目/目标
  MEMORY_LAYER_EXPERIENCE = 4;   // 经验层：situation → reasoning → action → keyLearning
  MEMORY_LAYER_ACTIVITY = 5;     // 活动层：具体事件（时间、地点、人物、反馈）
}

// 记忆来源
enum MemorySource {
  MEMORY_SOURCE_UNSPECIFIED = 0;
  MEMORY_SOURCE_EXTRACTION = 1;  // LLM 从对话中自动提取
  MEMORY_SOURCE_AGENT_TOOL = 2;  // Agent 主动调用工具写入
  MEMORY_SOURCE_USER_INPUT = 3;  // 用户手动补充
  MEMORY_SOURCE_SYSTEM = 4;      // 系统自动生成
}

// 记忆实体
message Memory {
  string id = 1;                              // ULID
  string user_id = 2;                         // 所属用户
  string agent_id = 3;                        // 关联 Agent（Identity/Preference 层可为空，表示跨 Agent）
  string session_id = 4;                      // 关联会话（可为空）
  MemoryLayer layer = 5;                      // 记忆层级
  MemorySource source = 6;                    // 写入来源
  string content = 7;                         // 结构化内容（JSON 字符串）
  string summary = 8;                         // 人类可读摘要
  repeated string tags = 9;                   // 语义标签
  double relevance = 10;                      // 基础相关性评分 [0,1]
  int32 access_count = 11;                    // 被检索命中的次数
  google.protobuf.Timestamp last_accessed_at = 12;
  google.protobuf.Timestamp expires_at = 13;  // 过期时间（null 表示永不过期）
  google.protobuf.Timestamp created_at = 14;
  google.protobuf.Timestamp updated_at = 15;
}

// 带评分的检索结果
message ScoredMemory {
  Memory memory = 1;
  double score = 2;                           // 最终综合评分
  ScoringExplanation explain = 3;             // 评分明细（调优用）
}

// 评分明细
message ScoringExplanation {
  double vector_score = 1;      // 向量相似度
  double keyword_score = 2;     // 关键词匹配度
  double weighted_score = 3;    // 加权混合分
  double decay_factor = 4;      // 时间衰减系数
  double after_decay = 5;       // 衰减后分数
  double after_rerank = 6;      // 重排序后分数
  double final_score = 7;       // 最终分数
}

// 记忆事件（审计日志）
message MemoryEvent {
  string id = 1;                              // ULID
  string event_type = 2;                      // extraction / retrieval / injection / decay / merge / delete
  string memory_id = 3;
  string session_id = 4;
  string agent_id = 5;
  MemoryLayer layer = 6;
  string detail_json = 7;                     // 事件详情（JSON）
  int64 latency_ms = 8;                       // 操作耗时
  google.protobuf.Timestamp timestamp = 9;
}

// 记忆统计
message MemoryStats {
  int64 total = 1;
  map<string, int64> by_layer = 2;            // 各层数量
  map<string, int64> by_agent = 3;            // 各 Agent 数量
  int64 storage_bytes = 4;
  int64 vector_count = 5;                     // 向量索引中的条目数
  google.protobuf.Timestamp oldest_memory = 6;
  google.protobuf.Timestamp newest_memory = 7;
}
```

### 4.3 persona.proto

```protobuf
syntax = "proto3";

package peers_touch.model.memory.v1;

import "google/protobuf/timestamp.proto";

option go_package = "github.com/peers-labs/peers-touch/station/app/subserver/memory/model;model";

// 用户画像
// 由 Identity + Preference 层记忆自动合成
message Persona {
  string user_id = 1;
  string tagline = 2;                         // 一句话描述
  string narrative = 3;                       // 详细叙述（Markdown）
  repeated PersonaTrait traits = 4;           // 结构化特征列表
  google.protobuf.Timestamp generated_at = 5; // 最后一次生成时间
  google.protobuf.Timestamp updated_at = 6;
}

// 画像特征项
message PersonaTrait {
  string category = 1;   // identity / preference / behavior
  string key = 2;        // 如 "profession", "coding_style"
  string value = 3;      // 如 "Backend Engineer", "prefers Go"
  double confidence = 4;  // 置信度 [0,1]
  string evidence_ids = 5; // 支撑该特征的记忆 ID 列表（JSON 数组）
}
```

### 4.4 memory_api.proto

```protobuf
syntax = "proto3";

package peers_touch.model.memory.v1;

import "domain/memory/memory.proto";
import "domain/memory/persona.proto";

option go_package = "github.com/peers-labs/peers-touch/station/app/subserver/memory/model;model";

// ── List ──
message ListMemoriesRequest {
  string agent_id = 1;               // 可选，按 Agent 过滤
  MemoryLayer layer = 2;             // 可选，按层级过滤
  string period = 3;                 // 可选，时间窗口：24h / 7d / 30d / 90d
  string order_by = 4;               // created_at（默认）/ relevance / access_count
  int32 page = 5;
  int32 page_size = 6;
}

message ListMemoriesResponse {
  repeated Memory memories = 1;
  int64 total = 2;
}

// ── Search ──
message SearchMemoriesRequest {
  string query = 1;                  // 搜索文本
  repeated MemoryLayer layers = 2;   // 可选，限定层级
  int32 limit = 3;                   // Top-K
  string agent_id = 4;              // 可选
  string period = 5;                // 可选
  double min_score = 6;             // 最低分数阈值
}

message SearchMemoriesResponse {
  repeated ScoredMemory results = 1;
  int64 total_candidates = 2;       // 候选总数（过滤前）
}

// ── Get / Delete ──
message GetMemoryRequest {
  string id = 1;
}

message GetMemoryResponse {
  Memory memory = 1;
}

message DeleteMemoryRequest {
  string id = 1;
}

message DeleteMemoryResponse {
  bool success = 1;
}

// ── Persona ──
message GetPersonaRequest {
  string agent_id = 1;              // 可选，获取特定 Agent 视角的 Persona
}

message GetPersonaResponse {
  Persona persona = 1;
}

message RegeneratePersonaRequest {}

message RegeneratePersonaResponse {
  Persona persona = 1;
}

// ── Stats ──
message GetMemoryStatsRequest {}

message GetMemoryStatsResponse {
  MemoryStats stats = 1;
}

// ── Events ──
message GetMemoryEventsRequest {
  string event_type = 1;            // 可选
  string agent_id = 2;             // 可选
  string period = 3;               // 可选
  int32 limit = 4;
  int32 offset = 5;
}

message GetMemoryEventsResponse {
  repeated MemoryEvent events = 1;
}

// ── Export / Import ──
message ExportMemoriesRequest {
  string agent_id = 1;
  MemoryLayer layer = 2;
}

message ExportMemoriesResponse {
  string version = 1;
  string exported_at = 2;
  repeated Memory memories = 3;
  Persona persona = 4;
}

message ImportMemoriesRequest {
  ExportMemoriesResponse data = 1;
  bool skip_duplicates = 2;
}

message ImportMemoriesResponse {
  int32 imported = 1;
  int32 skipped = 2;
  int32 failed = 3;
}

// ── 内部 API（agent turn pipeline 调用 memory 用） ──

// Retrieval：在生成回复前检索相关记忆
message MemoryRetrievalRequest {
  string user_id = 1;
  string agent_id = 2;
  string session_id = 3;
  string query = 4;                 // 用户当前消息（或语义摘要）
  string effort = 5;                // low / medium / high
}

message MemoryRetrievalResponse {
  repeated ScoredMemory memories = 1;
  Persona persona = 2;
  string formatted_context = 3;     // 格式化好的 memory context 文本，可直接注入 system prompt
}

// Extraction：在 AI 回复后异步提取新记忆
message MemoryExtractionRequest {
  string user_id = 1;
  string agent_id = 2;
  string session_id = 3;
  string user_message = 4;
  string assistant_message = 5;
  string effort = 6;                // low / medium / high
}

message MemoryExtractionResponse {
  repeated Memory extracted = 1;    // 新提取的记忆
  int32 deduplicated = 2;          // 被去重跳过的数量
}
```

---

## 5. Station 子服务设计

### 5.1 目录结构

```
apps/station/app/subserver/memory/
├── plugin.go                    # 插件注册
├── options.go                   # 配置选项
├── memory.go                    # Subserver 实现
├── handler/                     # HTTP Handler
│   ├── memory_handler.go        # 记忆 CRUD + 搜索
│   ├── persona_handler.go       # Persona 端点
│   ├── events_handler.go        # 事件查询
│   ├── internal_handler.go      # 内部 API（retrieval / extraction）
│   └── error_mapper.go          # 错误转换
├── service/                     # 业务逻辑
│   ├── extraction_service.go    # 从对话中提取记忆
│   ├── retrieval_service.go     # 记忆检索与排序
│   ├── injection_service.go     # 构建注入上下文
│   ├── persona_service.go       # Persona 生成与维护
│   ├── lifecycle_service.go     # 衰减/合并/归档/清理
│   └── event_service.go         # 审计事件
├── db/
│   └── model/
│       ├── models.go            # GORM 模型注册
│       ├── memory.go            # 记忆表
│       ├── memory_vector.go     # 向量索引表
│       ├── persona.go           # Persona 表
│       └── memory_event.go      # 事件表
├── embedding/
│   └── embedder.go              # Embedding 调用封装（复用 Provider 体系）
├── model/                       # Proto 生成的 Go 代码
│   ├── memory.pb.go
│   ├── memory_api.pb.go
│   └── persona.pb.go
└── errcode/
    └── error.go                 # 业务错误码
```

### 5.2 API 端点设计

| 路径 | 方法 | 说明 | 认证 |
|------|------|------|------|
| `/memory/list` | GET | 列出记忆（分页+过滤） | JWT |
| `/memory/get` | GET | 获取单条记忆 | JWT |
| `/memory/delete` | POST | 删除记忆 | JWT |
| `/memory/search` | POST | 语义+关键词混合搜索 | JWT |
| `/memory/stats` | GET | 统计信息 | JWT |
| `/memory/persona` | GET | 获取用户画像 | JWT |
| `/memory/persona/regenerate` | POST | 重新生成画像 | JWT |
| `/memory/events` | GET | 查询审计事件 | JWT |
| `/memory/export` | GET | 导出记忆 | JWT |
| `/memory/import` | POST | 导入记忆 | JWT |
| `/memory/internal/retrieve` | POST | 内部：检索记忆（agent pipeline 调用） | Internal |
| `/memory/internal/extract` | POST | 内部：提取记忆（agent pipeline 调用） | Internal |

### 5.3 配置

```yaml
peers:
  node:
    server:
      subserver:
        memory:
          enabled: true
          storage: postgres           # postgres（pgvector）
          embedding:
            provider: ""              # 留空则复用 Agent 的默认 Provider
            model: ""                 # 留空则自动选择 Provider 的 embedding 模型
            dimensions: 0             # 0 = 自动检测
          retrieval:
            vector_weight: 0.7        # 向量检索权重
            keyword_weight: 0.3       # 关键词检索权重
            decay_half_life_days: 30  # 时间衰减半衰期（天）
            default_top_k: 5          # 默认返回条数
            rerank_enabled: false     # 是否启用重排序
          extraction:
            enabled: true             # 是否启用自动提取
            batch_mode: false         # 是否攒批提取（降低 LLM 调用频率）
          lifecycle:
            decay_cron: "0 3 * * *"   # 每天凌晨 3 点执行衰减
            merge_threshold: 0.9      # 相似度超过此值的记忆自动合并
            archive_after_days: 180   # 超过此天数的 Experience 归档
            activity_ttl_days: 365   # Activity 层记忆的保留天数
```

---

## 6. 数据库设计

### 6.1 主记忆表 (touch_memory)

LobeHub 使用主表 + 子表的模式，我们遵循同样的设计。主表存放公共字段：

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT (ULID) | 主键 |
| user_id | TEXT | 所属用户 |
| agent_id | TEXT | 关联 Agent（Identity/Preference/Context/Activity 层可为 NULL，表示跨 Agent） |
| session_id | TEXT | 关联会话 |
| layer | SMALLINT | 记忆层级枚举（identity=1 / preference=2 / context=3 / experience=4 / activity=5） |
| source | SMALLINT | 写入来源枚举 |
| content | JSONB | 结构化内容（各层结构不同，见子表） |
| summary | TEXT | 人类可读摘要 |
| tags | TEXT[] | 语义标签数组 |
| relevance | DOUBLE | 基础相关性评分 |
| access_count | INT | 检索命中次数 |
| last_accessed_at | TIMESTAMP | 最后被检索的时间 |
| expires_at | TIMESTAMP | 过期时间 |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

**索引**：
- `idx_memory_user_layer` ON (user_id, layer)
- `idx_memory_agent` ON (agent_id)
- `idx_memory_session` ON (session_id)
- `idx_memory_created` ON (created_at DESC)
- `idx_memory_summary_fts` ON summary USING GIN (to_tsvector('english', summary))

### 6.2 各层子表（LobeHub 模式）

每个层级有独立子表，存放该层特有的结构化字段：

**touch_memory_identities**（身份子表）

| 列 | 类型 | 说明 |
|----|------|------|
| memory_id | TEXT | 外键 → touch_memory.id |
| role | TEXT | 角色（如 "软件工程师"） |
| relationship | TEXT | 与用户的关系（如 "self", "colleague"） |
| demographic | JSONB | 人口属性（如 location, age_range） |

**touch_memory_preferences**（偏好子表）

| 列 | 类型 | 说明 |
|----|------|------|
| memory_id | TEXT | 外键 → touch_memory.id |
| instruction | TEXT | 偏好指令（如 "回答请用中文"） |
| scope | TEXT | 适用范围（如 "coding", "all"） |
| priority | DOUBLE | 优先级 [0,1] |

**touch_memory_contexts**（上下文子表）

| 列 | 类型 | 说明 |
|----|------|------|
| memory_id | TEXT | 外键 → touch_memory.id |
| status | TEXT | 状态：planned / ongoing / completed / paused |
| urgency | DOUBLE | 紧急度 [0,1] |
| objects | JSONB | 关联对象列表 |
| subjects | JSONB | 关联主体列表 |

**touch_memory_experiences**（经验子表）

| 列 | 类型 | 说明 |
|----|------|------|
| memory_id | TEXT | 外键 → touch_memory.id |
| situation | TEXT | 情境描述 |
| reasoning | TEXT | 推理过程 |
| action | TEXT | 采取的行动 |
| outcome | TEXT | 结果 |
| key_learning | TEXT | 关键教训 |

**touch_memory_activities**（活动子表）

| 列 | 类型 | 说明 |
|----|------|------|
| memory_id | TEXT | 外键 → touch_memory.id |
| activity_type | TEXT | 活动类型 |
| starts_at | TIMESTAMP | 开始时间 |
| ends_at | TIMESTAMP | 结束时间 |
| location | TEXT | 地点 |
| participants | JSONB | 参与者列表 |
| feedback_narrative | TEXT | 主观反馈叙述 |

### 6.3 向量索引表 (touch_memory_vector)

| 列 | 类型 | 说明 |
|----|------|------|
| memory_id | TEXT | 外键 → touch_memory.id |
| embedding | vector(dim) | pgvector 向量（维度由模型决定） |
| model | TEXT | 生成该向量的模型名 |
| created_at | TIMESTAMP | 向量生成时间 |

**索引**：
- `idx_memory_vector_ivfflat` ON embedding USING ivfflat (embedding vector_cosine_ops)

### 6.4 画像表 (touch_persona)

| 列 | 类型 | 说明 |
|----|------|------|
| user_id | TEXT | 主键 |
| tagline | TEXT | 一句话描述 |
| narrative | TEXT | 详细叙述 |
| traits | JSONB | 结构化特征列表 |
| generated_at | TIMESTAMP | 最后生成时间 |
| updated_at | TIMESTAMP | 更新时间 |

### 6.5 事件表 (touch_memory_event)

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT (ULID) | 主键 |
| event_type | TEXT | 事件类型 |
| memory_id | TEXT | 关联记忆 |
| session_id | TEXT | 关联会话 |
| agent_id | TEXT | 关联 Agent |
| layer | SMALLINT | 层级 |
| detail | JSONB | 事件详情 |
| latency_ms | INT | 操作耗时 |
| timestamp | TIMESTAMP | 事件时间 |

**索引**：
- `idx_event_type_ts` ON (event_type, timestamp DESC)
- `idx_event_agent_ts` ON (agent_id, timestamp DESC)

---

## 7. 检索算法

### 7.1 混合检索流程

```
Query: "帮我优化这段 Go 代码的性能"
     │
     ▼
┌──────────────────────────────────────────────┐
│  Step 1: Embedding                            │
│  query → embedding vector (via Provider)      │
└──────────────────┬───────────────────────────┘
                   │
     ┌─────────────┴─────────────┐
     │                           │
     ▼                           ▼
┌──────────────┐         ┌──────────────────┐
│ Vector Search│         │ Keyword Search   │
│ pgvector     │         │ tsvector FTS     │
│              │         │                  │
│ cosine_sim   │         │ ts_rank          │
│ Top-K × 2   │         │ Top-K × 2        │
└──────┬───────┘         └────────┬─────────┘
       │                          │
       └────────────┬─────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│  Step 2: Score Fusion                         │
│                                               │
│  hybrid_score = vector_weight × vector_score  │
│               + keyword_weight × keyword_score│
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│  Step 3: Time Decay                           │
│                                               │
│  decay = 0.5 ^ (days_since_access / half_life)│
│  decayed_score = hybrid_score × decay         │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│  Step 4: Layer Priority Boost                 │
│                                               │
│  Identity:    × 1.5                           │
│  Preference:  × 1.3                           │
│  Context:     × 1.2（ongoing 状态加成）       │
│  Experience:  × 1.0                           │
│  Activity:    × 1.0                           │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│  Step 5: Dedup + Top-K                        │
│                                               │
│  合并重复记忆 → 取 Top-K → 返回 ScoredMemory │
└──────────────────────────────────────────────┘
```

### 7.2 时间衰减公式

```
decay_factor = 0.5 ^ (days_since_last_access / half_life_days)
```

- `half_life_days` 默认 30 天，可配置。
- 30 天未被访问的记忆衰减到 50%。
- 每次被检索命中时，`last_accessed_at` 刷新，衰减重置。
- Identity 和 Preference 层不适用时间衰减（永久）。
- Context 层不按时间衰减，而是按状态流转（completed 后降低优先级）。

---

## 8. 多端同步设计

遵循 [sync-protocol.md](../client/mobile/sync-protocol.md) 中定义的同步架构。

### 8.1 同步方向

Memory 的真源是 **Station**，与 sync-protocol.md §4.3 一致：

```
Station ──── WRITE ────→ PostgreSQL + pgvector
  │
  ├── SSE 事件推送 ──→ Desktop / Mobile（memory.created / memory.updated / memory.deleted）
  │
  └── HTTP API ←── 读取请求 ── Desktop / Mobile
```

| 操作 | 发起方 | 执行方 | 说明 |
|------|--------|--------|------|
| 自动提取 | Station（agent turn 流程触发） | Station memory service | 用户无感知 |
| 浏览/搜索 | 客户端 | Station API | 端侧缓存摘要 |
| 删除 | 客户端 | Station API | 用户主动删除 |
| Persona 查看 | 客户端 | Station API | 缓存 30 分钟 |
| 设置 memory effort | 客户端 | Station (Agent config) | 随 Agent 配置同步 |

### 8.2 SSE 事件

| 事件类型 | 触发时机 | Payload |
|---------|---------|---------|
| `memory.created` | 新记忆提取完成 | `{ memory_id, layer, summary, agent_id }` |
| `memory.updated` | 记忆内容更新或合并 | `{ memory_id, layer, summary }` |
| `memory.deleted` | 记忆被删除 | `{ memory_id }` |
| `memory.persona_updated` | Persona 重新生成 | `{ user_id }` |

### 8.3 端侧缓存策略

| 数据 | 缓存位置 | 缓存深度 | 过期策略 |
|------|---------|---------|---------|
| 记忆摘要列表 | 本地 DB | 最近 200 条 | 24 小时 stale，收到 SSE 事件刷新 |
| Persona | 内存 | 1 份 | 30 分钟过期 |
| 搜索结果 | 不缓存 | — | 每次实时查询 Station |
| Embedding 向量 | 不缓存 | — | 向量仅存在于 Station 侧 |

---

## 9. 记忆生命周期管理

### 9.1 状态机

```
  ┌─────────┐
  │ Created │ ←── Agent Tool 写入 / 用户手动
  └────┬────┘
       │
       ▼
  ┌─────────┐     访问计数 = 0 且超过 archive_after_days
  │ Active  │ ─────────────────────────────────────────────→ ┌──────────┐
  │         │                                                 │ Archived │
  │         │ ←── 被检索命中（刷新 last_accessed_at）         │          │
  └────┬────┘                                                 └────┬─────┘
       │                                                           │
       │  与其他记忆相似度 > merge_threshold                       │ 保留 90 天
       ▼                                                           ▼
  ┌─────────┐                                                ┌──────────┐
  │ Merged  │                                                │ Deleted  │
  │(合并到  │                                                │(物理删除)│
  │ 目标记忆)│ ──→ 原记忆标记删除                              │          │
  └─────────┘                                                └──────────┘

  Context 层特有状态流转：
  planned → ongoing → completed → paused（可逆）
```

### 9.2 定时任务

| 任务 | 调度 | 说明 |
|------|------|------|
| 时间衰减计算 | 每天 03:00 | 更新 relevance 评分 |
| 相似记忆合并 | 每天 04:00 | 合并相似度 > threshold 的记忆对 |
| Activity 层清理 | 每周 | 清理超过 TTL 的 Activity 记忆 |
| 归档 | 每周日 03:00 | 将超期的 Experience 归档 |
| Persona 刷新 | Identity/Preference 变更后异步 | 重新生成 Persona |

---

## 10. 与现有代码的集成点

### 10.1 Agent turn pipeline 集成

Agent 的 turn/completion 流程是记忆系统的核心集成点：

```go
// service/chat_service.go 中的 HandleCompletion 方法

func (s *ChatService) HandleCompletion(ctx context.Context, req *model.ChatCompletionRequest) {
    // 1. 检查 Agent 的 memory 配置
    agentConfig := parseAgentConfig(req.SessionConfig)
    if agentConfig.Memory.Enabled {
        // 2. 检索记忆（调用 memory SubServer 的内部 API）
        memoryCtx := s.memoryClient.Retrieve(ctx, &memoryModel.MemoryRetrievalRequest{
            UserId:    req.UserId,
            AgentId:   req.AgentId,
            SessionId: req.SessionId,
            Query:     extractQuery(req.Messages),
            Effort:    agentConfig.Memory.Effort,
        })

        // 3. 注入记忆上下文到 system prompt
        req.Messages = injectMemoryContext(req.Messages, memoryCtx)
    }

    // 4. 调用 LLM
    response := s.callProvider(ctx, req)

    // 5. 异步提取记忆
    if agentConfig.Memory.Enabled {
        go s.memoryClient.Extract(ctx, &memoryModel.MemoryExtractionRequest{
            UserId:           req.UserId,
            AgentId:          req.AgentId,
            SessionId:        req.SessionId,
            UserMessage:      lastUserMessage(req.Messages),
            AssistantMessage: response.Content,
            Effort:           agentConfig.Memory.Effort,
        })
    }
}
```

### 10.2 Desktop Tauri 集成

Desktop 端的 Rust 层改为调用 Station API，移除 stub 实现：

```
apps/desktop/src-tauri/src/
├── application/memory/mod.rs    # 改为 Station HTTP Client 调用
└── interface/tauri_commands/memory.rs  # 保持不变（命令入口）
```

### 10.3 前端保持现有 UI

现有前端的 Memory UI 已经比较完善，保持以下组件并对接真实数据：
- `MemoryPage.tsx` — Browse/Search/Persona/Events 四个 Tab
- `MemorySettingsTab.tsx` — Memory + Embedding 配置
- `ChatInput.tsx` — Memory 开关（MemoryControls 组件）
- `AgentSettingsModal.tsx` — Agent 级 memory 配置（enabled + effort: low/medium/high）
- `AgentProfilePage.tsx` — Agent 的 Memories Tab（按 identity/preference/context/experience/activity 过滤）

---

## 11. Memory Extraction Prompt 设计

Extraction 是记忆系统的核心能力之一，通过 LLM 从对话中智能提取值得记忆的信息。

### 11.1 Extraction Prompt 模板

```
You are a memory extraction system. Analyze the conversation below and extract 
information worth remembering about the user.

## Current User Persona
{persona_summary}

## Existing Memories (for dedup)
{recent_memories_summary}

## Conversation
User: {user_message}
Assistant: {assistant_message}

## Instructions
Extract memories in the following JSON format. Only extract genuinely new or 
updated information. Skip if the conversation is trivial or the information 
already exists in the persona/memories above.

Return a JSON array of objects:
```json
[
  {
    "layer": "identity|preference|context|experience|activity",
    "summary": "concise human-readable summary",
    "content": { "key": "value pairs of structured data" },
    "tags": ["relevant", "tags"],
    "confidence": 0.0-1.0
  }
]
```

Rules:
- identity: Facts about who the user is (name, job, role, relationships)
- preference: How the user likes things done (instructions, scope, priorities)
- context: Ongoing situations, projects, goals with status tracking
- experience: Lessons learned: situation → reasoning → action → outcome → keyLearning
- activity: Specific events with time, place, participants, and feedback
- Only extract if confidence >= 0.6
- If nothing worth remembering, return empty array []
```

### 11.2 Effort 级别对 Extraction 的影响

| Effort | 提取策略 | LLM 调用 |
|--------|---------|---------|
| low | 仅检查 Identity 变更 | 轻量 prompt，< 200 tokens |
| medium | 全层提取，标准分析 | 标准 prompt，~ 500 tokens |
| high | 深度分析 + 经验教训提炼 | 详细 prompt + experience 层，~ 800 tokens |

---

## 12. 执行计划入口

本文只定义 Agent Memory 的领域模型、检索/注入/提取架构、同步与存储设计。

如需查看实施阶段与落地顺序，请看：

- `execution-plans/agent-memory-adoption-plan.md`

---

## 13. 相关文档

- [全局架构](../global/architecture.md)
- [领域模型规范](../global/domain-model.md)
- [第一性原理](../global/first-principles.md)
- [SubServer 开发标准](../station/subserver-standard.md)
- [多端同步协议](../client/mobile/sync-protocol.md)
- [Station/Desktop 职责边界](../boundaries/station-desktop-scope-boundary.md)
- [统一运行时存储架构](./storage/unified-runtime-storage-architecture.md)
