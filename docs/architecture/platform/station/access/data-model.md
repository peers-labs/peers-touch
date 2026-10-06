# Station 接入生命周期 - 数据模型

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-27 | **Updated**: 2026-10-06
> **Owner**: Identity and Access

---

## 1. Station Identity

```text
StationIdentityRequest
  challenge

StationIdentityStatement
  challenge
  station_peer_id
  canonical_origin
  capabilities[]
  issued_at_unix_ms
  expires_at_unix_ms

StationIdentityResponse
  statement_bytes
  host_public_key
  signature
```

URL 只用于连接。客户端在任何 credential submission 前验证 statement，并以
`station_peer_id` 作为 registry identity。签名不属于 statement 字段，而是与
canonical `statement_bytes` 和 `host_public_key` 一起由 response 返回。

## 2. Access Attempt

```text
StartAccessAttemptRequest
  station_url
  client {
    platform
    app_version
    device_id
    locale
    lifecycle_generation
  }
  session_id
  station_peer_id

StartAccessAttemptResponse
  decision
  station_label

AccessDecision
  state
  attempt_id
  current_gate_id
  gates[]
  actor
  access_grant_id
  expires_at
  message

SubmitAccessGateRequest
  attempt_id
  gate_id
  type
  action_input
  action_id
  station_peer_id
  device_id
  lifecycle_generation
  schema_revision
  schema_digest
  submission_id

GetAccessDecisionRequest | CancelAccessAttemptRequest
  attempt_id
  station_peer_id
  device_id
  lifecycle_generation
```

每个 gate action 绑定
`attempt_id + gate_id + action_id + schema_revision + schema_digest`。提交、查询
和取消都携带 attempt、Station、Device 与 lifecycle identity；过期或任一绑定
不匹配时返回 typed failure。

## 3. Access State Machine

```text
unselected
  -> identity_verifying
  -> identity_confirm_required
  -> access_gating
  -> runtime_bootstrapping
  -> ready
```

允许的终止结果：

- `ready`
- `cancelled`
- `blocked_typed`

未知 gate、无效 wire、identity mismatch 和 attempt expiry 不产生其他接入路径。

## 4. Scope Tuple

```text
AccessScope
  station_peer_id
  actor_ptid
  device_id
  lifecycle_generation
```

Session、Messaging、Federation context、缓存和 projection 必须共享同一 tuple。
异步结果只有在完整 tuple 仍匹配时才能提交。

## 5. Federation Context

```text
FederationContext
  federation_id
  display_name
  state
  station_peer_id
  revision
```

依赖 Federation 的 search、resolve 和 Conversation mutation 必须携带明确
`federation_id`。客户端不得推导默认 ID。

## 6. Capability References

Station Access 模块引用以下当前能力：

- `station.identity.verify`
- `access.gate.start`
- `access.gate.submit`
- `access.gate.decision`
- `access.gate.cancel`

能力的 method、path、request/response Proto 和 Station owner 由
`station-api-capabilities.yaml` 定义，本模块不复制第二份 route registry。

## 7. Client-Class Session Slot

```text
ClientClass
  desktop
  mobile
  web

ActorSessionClassSlot
  actor_id          // Station-internal storage identity
  client_class
  active_session_id
  device_id
  lifecycle_generation
  revoked
  revoked_reason
```

`SessionRecord.device_type` 是当前持久化字段名，但其业务含义是
`ClientClass`，只允许 canonical enum。`device_id` 是安装实例身份，不是
Session 并发类别。

不变量：

- `(actor_id, client_class)` 最多存在一个 `revoked=false` 的 Session；
- `actor_sessions` 以 partial unique index
  `(user_id, device_type) WHERE revoked = false` 执行该不变量；
- 新同类 Session 激活与旧同类 Session 的 `kicked` 撤销在一个事务中完成；
- 不同 `client_class` 的 Session 不参与该事务的撤销集合；
- password、OAuth 和 takeover 入口产生相同 class-slot 结果；
- 非 canonical 类别不得写入；历史 alias 只允许在一次性 schema migration
  中归一。

Migration 顺序固定为：归一类别、按 `created_at DESC, id DESC` 选择每个
`(user_id, device_type)` winner、撤销其余 active 行、创建 partial unique
index。任何一步失败都阻止 Station 启动，不以无约束模式继续服务。
