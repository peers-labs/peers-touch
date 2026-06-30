# Agent Workspace OSS 托管与配置拆解执行计划

> 基于设计文档 `docs/architecture/agent/agent-workspace-oss-architecture.md` 的实施路线图

---

## 1. 阶段概览

| 阶段 | 名称 | 交付物 | 依赖 | 预估工作量 |
|------|------|--------|------|-----------|
| **Phase 1** | Workspace 元数据上移 + OSS 托管 | Proto 定义、GORM 模型、Migration、Workspace API、OSS 签名 | 无 | 大 |
| **Phase 2** | config_json 拆解 | Proto 定义、GORM 模型、Migration、配置 API、数据迁移脚本 | Phase 1 | 中 |
| **Phase 3** | Agent 领域事件接入 SSE | 事件定义、SSE 推送、端侧事件消费 | Phase 1 + Phase 2 | 中 |
| **Phase 4** | 离线操作队列 | 端侧 Outbox 存储、回放引擎、冲突处理 | Phase 3 | 中 |

---

## 2. Phase 1：Workspace 元数据上移 + OSS 托管

### 2.1 任务清单

#### 2.1.1 Proto 定义

| 任务 | 文件 | 说明 |
|------|------|------|
| 新增 Workspace 相关 message | `model/domain/agent/workspace.proto` | Workspace、WorkspaceFile、WorkspaceChange 及 API |
| 更新 agent.proto | `model/domain/agent/agent.proto` | 添加 workspace 关联字段 |
| 运行 Proto 生成 | `model/build.sh` | 生成 Go、Rust、TypeScript 类型 |

#### 2.1.2 Station 层

| 任务 | 文件 | 说明 |
|------|------|------|
| 新增 GORM 模型 | `apps/station/app/subserver/agent/infrastructure/persistence/models.go` | AgentWorkspace、AgentWorkspaceFile |
| 新增 Repository | `apps/station/app/subserver/agent/infrastructure/persistence/workspace.go` | Workspace CRUD、文件清单管理 |
| 新增 Domain Service | `apps/station/app/subserver/agent/domain/workspace_service.go` | Workspace 业务逻辑 |
| 新增 Application Service | `apps/station/app/subserver/agent/application/workspace_service.go` | API 层适配 |
| 新增 Handler | `apps/station/app/subserver/agent/interface/http/workspace_handler.go` | HTTP 路由与 handler |
| 新增 Router | `apps/station/app/subserver/agent/interface/http/router.go` | 注册 workspace 路由 |
| OSS 签名服务 | `apps/station/app/subserver/agent/infrastructure/oss/workspace_oss.go` | 生成上传/下载签名 URL |
| Migration | `apps/station/app/subserver/agent/infrastructure/persistence/migrations/` | 创建 agent_workspace、agent_workspace_file 表 |

#### 2.1.3 Desktop 端

| 任务 | 文件 | 说明 |
|------|------|------|
| 新增 Workspace Store | `apps/desktop/src/store/workspace.ts` | Zustand store，管理 workspace 状态 |
| 新增 Workspace Service | `apps/desktop/src/services/workspace-service.ts` | Station API 封装 |
| 新增 Workspace Runtime | `apps/desktop/src/runtimes/agentWorkspaceRuntime.ts` | 同步逻辑、事件监听 |
| 更新 API 类型 | `apps/desktop/src/services/desktop_api.ts` | 添加 Workspace 相关类型 |
| 更新 AgentResourceManagement | `apps/desktop/src/pages/AgentResourceManagement.tsx` | Workspace 标签页适配新 API |

#### 2.1.4 Mobile 端

| 任务 | 文件 | 说明 |
|------|------|------|
| 新增 Workspace Store | `apps/mobile/src/store/workspace.ts` | Zustand store |
| 新增 Workspace Service | `apps/mobile/src/services/workspace-service.ts` | Station API 封装 |
| 新增 Workspace Runtime | `apps/mobile/src/runtimes/agentWorkspaceRuntime.ts` | 同步逻辑 |

### 2.2 关键实现细节

#### OSS 签名 URL 流程

```go
// 请求上传签名
func (s *WorkspaceOSSService) GetUploadURL(
    ctx context.Context,
    workspaceID, path, contentType string,
    contentLength int64,
    contentSHA256 string,
) (string, error)

// 请求下载签名
func (s *WorkspaceOSSService) GetDownloadURL(
    ctx context.Context,
    workspaceID, path string,
) (string, error)
```

#### 变更提交（幂等）

```go
func (s *WorkspaceApplicationService) CommitChanges(
    ctx context.Context,
    workspaceID string,
    changes []model.WorkspaceChange,
    clientRequestID string, // 幂等 key
) (*model.CommitWorkspaceChangesResponse, error)
```

---

## 3. Phase 2：config_json 拆解

### 3.1 任务清单

#### 3.1.1 Proto 定义

| 任务 | 文件 | 说明 |
|------|------|------|
| 新增配置相关 message | `model/domain/agent/agent_config.proto` | AgentChatConfig、AgentModelParams、Binding 等 |
| 运行 Proto 生成 | `model/build.sh` | 生成各语言类型 |

#### 3.1.2 Station 层

| 任务 | 文件 | 说明 |
|------|------|------|
| 新增 GORM 模型 | `apps/station/app/subserver/agent/infrastructure/persistence/models.go` | AgentChatConfig、AgentModelParams、AgentKnowledgeBinding、AgentSkillBinding、AgentMcpBinding、AgentVoiceConfig、AgentToolProfile |
| 新增 Repository | `apps/station/app/subserver/agent/infrastructure/persistence/agent_config.go` | 配置 CRUD |
| 新增 Domain Service | `apps/station/app/subserver/agent/domain/agent_config_service.go` | 配置业务逻辑 |
| 新增 Application Service | `apps/station/app/subserver/agent/application/agent_config_service.go` | API 层适配 |
| 新增 Handler | `apps/station/app/subserver/agent/interface/http/agent_config_handler.go` | HTTP handler |
| 更新 Router | `apps/station/app/subserver/agent/interface/http/router.go` | 注册配置路由 |
| Migration | `apps/station/app/subserver/agent/infrastructure/persistence/migrations/` | 创建新表 |
| 数据迁移脚本 | `apps/station/app/subserver/agent/infrastructure/persistence/migrations/` | 从 config_json 迁移到新表 |
| 并行写入 Hook | `apps/station/app/subserver/agent/infrastructure/persistence/` | 写入新表时同步更新 config_json |

#### 3.1.3 Desktop 端

| 任务 | 文件 | 说明 |
|------|------|------|
| 更新 API 类型 | `apps/desktop/src/services/desktop_api.ts` | 添加配置相关类型 |
| 更新 Agent Store | `apps/desktop/src/store/agent.ts` | 支持细粒度配置更新 |
| 更新 Skill Store | `apps/desktop/src/store/skill.ts` | 支持 Agent-Skill 绑定 |
| 更新 MCP Store | `apps/desktop/src/store/mcp.ts` | 支持 Agent-MCP 绑定 |

#### 3.1.4 Mobile 端

| 任务 | 文件 | 说明 |
|------|------|------|
| 更新 API 类型 | `apps/mobile/src/services/` | 添加配置相关类型 |
| 更新 Stores | `apps/mobile/src/store/` | 支持细粒度配置更新 |

### 3.2 迁移脚本逻辑

```go
func MigrateAgentConfig(ctx context.Context, db *gorm.DB) error {
    // 1. 查询所有 agent
    // 2. 解析 config_json
    // 3. 写入新表（agent_chat_config, agent_model_params, etc.）
    // 4. 跳过已迁移的记录（通过新增字段标记）
}
```

---

## 4. Phase 3：Agent 领域事件接入 SSE

### 4.1 任务清单

#### 4.1.1 Station 层

| 任务 | 文件 | 说明 |
|------|------|------|
| 定义事件类型 | `apps/station/app/subserver/agent/domain/events.go` | workspace.*, agent.config.*, agent.knowledge.*, agent.skill.*, agent.mcp.* |
| 事件发布 | `apps/station/app/subserver/agent/infrastructure/event/event_publisher.go` | 发布到 SSE 通道 |
| SSE Handler | `apps/station/app/subserver/agent/interface/http/sse_handler.go` | 订阅 agent 领域事件 |

#### 4.1.2 Desktop 端

| 任务 | 文件 | 说明 |
|------|------|------|
| SSE 客户端 | `apps/desktop/src/services/sse-client.ts` | 连接 Station SSE |
| 事件处理器 | `apps/desktop/src/runtimes/eventHandler.ts` | 处理 agent.* 事件 |
| 更新 Stores | `apps/desktop/src/store/` | 响应事件更新状态 |

#### 4.1.3 Mobile 端

| 任务 | 文件 | 说明 |
|------|------|------|
| SSE 客户端 | `apps/mobile/src/services/sse-client.ts` | 连接 Station SSE |
| 事件处理器 | `apps/mobile/src/runtimes/eventHandler.ts` | 处理 agent.* 事件 |

---

## 5. Phase 4：离线操作队列

### 5.1 任务清单

#### 5.1.1 Desktop 端

| 任务 | 文件 | 说明 |
|------|------|------|
| OfflineOperation 存储 | `apps/desktop/src/runtimes/offlineQueue.ts` | IndexedDB 存储 |
| 回放引擎 | `apps/desktop/src/runtimes/offlineQueue.ts` | FIFO 回放 + 幂等 |
| 冲突处理 UI | `apps/desktop/src/components/offlineConflictDialog.tsx` | 冲突提示与选择 |

#### 5.1.2 Mobile 端

| 任务 | 文件 | 说明 |
|------|------|------|
| OfflineOperation 存储 | `apps/mobile/src/runtimes/offlineQueue.ts` | SQLite 存储 |
| 回放引擎 | `apps/mobile/src/runtimes/offlineQueue.ts` | FIFO 回放 + 幂等 |

---

## 6. 依赖关系图

```
Phase 1: Workspace OSS
    │
    ├── Proto 定义
    │   ├── workspace.proto
    │   └── 更新 agent.proto
    │
    ├── Station 层
    │   ├── GORM 模型
    │   ├── Repository
    │   ├── Domain Service
    │   ├── Application Service
    │   ├── Handler + Router
    │   ├── OSS 签名服务
    │   └── Migration
    │
    └── 端侧
        ├── Workspace Store
        ├── Workspace Service
        ├── Workspace Runtime
        └── 更新 UI 组件

Phase 2: config_json 拆解
    │
    ├── Proto 定义 → agent_config.proto
    │
    ├── Station 层
    │   ├── GORM 模型（7 张新表）
    │   ├── Repository
    │   ├── Domain Service
    │   ├── Application Service
    │   ├── Handler + Router
    │   ├── Migration
    │   ├── 数据迁移脚本
    │   └── 并行写入 Hook
    │
    └── 端侧
        ├── 更新 API 类型
        └── 更新 Stores

Phase 3: SSE 事件
    │
    ├── Station 层
    │   ├── 事件定义
    │   ├── 事件发布
    │   └── SSE Handler
    │
    └── 端侧
        ├── SSE 客户端
        ├── 事件处理器
        └── 更新 Stores

Phase 4: 离线队列
    │
    └── 端侧
        ├── OfflineOperation 存储
        ├── 回放引擎
        └── 冲突处理 UI
```

---

## 7. 验收标准（按阶段）

### Phase 1 验收
- [ ] Proto 定义完整，生成的类型正确
- [ ] Station 数据库 Migration 执行成功
- [ ] Workspace CRUD API 功能正常
- [ ] OSS 签名 URL 生成正确，端侧可直传
- [ ] 变更提交幂等性验证通过
- [ ] Desktop Workspace 标签页展示同步数据
- [ ] Mobile Workspace 功能可用

### Phase 2 验收
- [ ] 7 张配置表 Migration 执行成功
- [ ] 数据迁移脚本执行成功，数据正确
- [ ] 细粒度配置 API 功能正常
- [ ] `config_json` 并行写入验证通过
- [ ] 端侧可独立更新各配置项

### Phase 3 验收
- [ ] Workspace 变更事件正确触发
- [ ] 配置变更事件正确触发
- [ ] 端侧 SSE 连接稳定
- [ ] 事件去重机制生效
- [ ] 端侧状态实时更新

### Phase 4 验收
- [ ] 离线操作正确入队
- [ ] 重连后自动回放
- [ ] 幂等性验证通过
- [ ] 冲突处理 UI 正常显示

---

## 8. 实施注意事项

### 8.1 向后兼容
- Phase 1 和 Phase 2 期间，`config_json` 保持可用
- 旧 API 接口标记 deprecated，逐步移除
- 端侧适配期间新旧 API 并存

### 8.2 性能考虑
- Workspace 文件清单采用增量拉取，避免全量同步
- OSS 直传不走 Station 数据流，减少服务器压力
- 事件发布采用批量模式，避免高频推送

### 8.3 安全性
- OSS 签名 URL 设置有效期（上传 5min，下载 10min）
- 签名 URL 仅授权特定 path 和操作类型
- 端侧存储使用加密（LocalStorage 除外）

### 8.4 测试策略
- 单元测试：各层逻辑独立测试
- 集成测试：API 端到端测试
- 同步测试：双端同步场景验证
- 离线测试：网络断开/重连场景验证

---

## 9. 参考文档

- 设计文档：`docs/architecture/agent/agent-workspace-oss-architecture.md`
- 多端同步协议：`docs/client/mobile/sync-protocol.md`
- Station/Desktop 边界：`docs/architecture/boundaries/station-desktop-scope-boundary.md`
