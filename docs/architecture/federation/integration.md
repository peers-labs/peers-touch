# Federation Architecture — 集成与映射

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-05-31 | **Updated**: 2026-05-31
> **Owner**: Architecture Team

---

## 1. 与现有模块的映射

### 1.1 Station app/frame

Federation 落地必须遵守 Station 平台分层：

| 层 | 责任 | 不允许 |
|----|------|--------|
| Station app layer | Federation lifecycle、membership、policy、role、ledger append/replay、materialized state、Plaza API | 直接管理 relay read loop、DHT routing、transport 连接 |
| Station frame layer | relay、bootstrap、locator、resolver、profile envelope、station signing key、transport、auth middleware | 积累 Federation 业务规则或治理状态 |

实现时可以在 app layer 增加 Federation subserver；frame 只提供基础设施 primitive。app 可以依赖 frame，frame 不得依赖 app，也不得读取 Federation policy 表来裁决治理权限。

### 1.2 Catalog / Resolver

`docs/architecture/identity/federation-catalog.md` 解决“如何发现用户”。Federation 文档解决“谁属于哪个 Federation、谁有权治理、治理事实如何持久和验证”。

二者关系：

```text
Federation membership / policy
  -> 决定可查询 Station 范围
  -> Catalog 在该 federation_id 范围内返回可发现 ActorRef
  -> Resolver hydrate 具体 actor profile
```

Catalog 不负责 Federation lifecycle，也不负责 Station membership 治理。

### 1.3 ActivityPub

整体架构历史上提到 ActivityPub federation。Federation Ledger 不是 ActivityPub 的简单替代，而是 Peers-Touch 内部治理真源：

- Federation Ledger 管 Station membership、policy、role、sequencer、governance audit。
- ActivityPub 可作为未来对外互操作协议，承载与外部 fediverse 的 actor / activity 兼容。
- 内部 Station-to-Station 治理事实必须以 Peers-Touch proto + ledger 为准。
- 如果 ActivityPub 事件影响 Federation governance，必须被转换为合法 ledger proposal / event 后才生效。

---

## 2. 影响面分析

### 2.1 Model / Proto

所有跨 Station wire payload 必须先定义在 `model/domain/federation/*.proto`。Station 内部可以使用数据库表和 materialized state，但不得绕过 proto 语义另起一套对外模型。

需要补充的 proto 方向：

```text
model/domain/federation/federation.proto
model/domain/federation/federation_ledger.proto
model/domain/federation/federation_membership.proto
model/domain/federation/federation_policy.proto
model/domain/federation/federation_manifest.proto
model/domain/federation/federation_sync.proto
model/domain/federation/federation_discovery.proto
```

现有 Catalog proto 方向需要补充 `federation_id`。没有 `federation_id` 的 Catalog API 只能作为 legacy / advanced handle discovery，不能作为 Federation scoped 发现的默认入口。

### 2.2 Client Projection

普通客户端与 operator surface 都消费 Federation projection，但职责不同：

- Desktop/Mobile 只缓存 Federation context、scoped Catalog/Resolver 结果与连接状态。
- 普通客户端不保存 ledger head、membership、policy，也不暴露治理命令。
- Dashboard/CLI 可以消费治理 projection 并提交 operator intent；最终权限裁决始终在 Station。
- Desktop/Mobile 使用同一显式 `federation_id` 语义，不改变 Station 作为共享业务真源的边界。

Station Plaza projection 至少包含：

- `federation_id`、name、description、status、policy summary。
- current `head_hash`、`head_seq`、sequencer、sync status。
- 当前 Actor 的 capability：can_invite、can_approve_join、can_update_policy、can_view_ledger。
- 成员 Station 分页列表。
- 按 `federation_id` scoped 的 public actor search。

### 2.3 Relay / Broadcast

Ledger sync 或 discovery 如果新增 relay-mediated topic，必须遵守现有 relay 纪律：

- relay read loop 不得执行阻塞业务逻辑。
- topic 必须 deny-by-default allow-list。
- relay 可以 stamp `origin_peer_id`，但不能成为业务权限裁决者。
- receiver 必须做 origin authority、replay protection、local relevance 检查。

---

## 3. 迁移策略

### 3.1 Catalog Scope

现有 Catalog 文档需要补充 `federation_id` 参数和 Federation scoped visibility。未完成补充前，Catalog 只能视为 actor discovery primitive，不能代表完整 Federation scoped discovery。

### 3.2 Legacy Handle Resolve

如果未来保留 handle-only resolve，它只能作为高级路径，并且必须声明 resolve 语境：

- Home Station 已加入 Federation 范围。
- 用户选择的 Federation。
- 显式 external resolve。

### 3.3 ActivityPub Interop

ActivityPub 互操作应在 Federation Ledger 真源之后接入。任何外部 activity 影响 governance 前，都必须转换成 proposal 并通过 policy 校验。
