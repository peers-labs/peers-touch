# Device Login Approval — 数据模型

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-11-12 | **Updated**: 2026-11-12
> **Owner**: Identity and Access

本文定义协议草案、状态机、持久化与资源预算。字段名为合同草案，实现时以
proto-first 评审后的 `login_approval.proto` 为准；禁止先写手工模型。

## 1. 协议层结构

### 1.1 状态枚举

```protobuf
enum LoginApprovalState {
  LOGIN_APPROVAL_STATE_UNSPECIFIED = 0;
  LOGIN_APPROVAL_STATE_PENDING = 1;
  LOGIN_APPROVAL_STATE_APPROVED = 2;
  LOGIN_APPROVAL_STATE_IDENTITY_DELIVERY = 3;
  LOGIN_APPROVAL_STATE_DEVICE_PROVED = 4;
  LOGIN_APPROVAL_STATE_ACCESS_PENDING = 5;
  LOGIN_APPROVAL_STATE_CREDENTIAL_DELIVERY = 6;
  LOGIN_APPROVAL_STATE_COMMITTED = 7;
  LOGIN_APPROVAL_STATE_DENIED = 8;
  LOGIN_APPROVAL_STATE_CANCELLED = 9;
  LOGIN_APPROVAL_STATE_EXPIRED = 10;
}
```

### 1.2 无会话面消息（claimant）

```protobuf
message CreateLoginApprovalRequest {
  string request_id = 1;              // 幂等键
  string access_attempt_id = 2;       // 必须绑定 credential-passed 的 attempt
  uint64 access_decision_revision = 3;
  string station_peer_id = 4;
  string claimant_device_id = 5;
  string platform = 6;                // desktop | android | ios
  string device_label = 7;
  bytes claimant_hpke_public_key = 8;
  bytes claimant_device_signing_public_key = 9;
  bytes device_signature = 10;        // PoP，覆盖 canonical 请求
}

message CreateLoginApprovalResponse {
  string approval_id = 1;
  bytes claimant_capability = 2;      // 一次性返回，Station 仅存哈希
  string comparison_code = 3;         // 人眼核对，非兑换凭证
  uint64 revision = 4;
  int64 expires_at_unix_ms = 5;
}

message LoginApprovalStatusRequest {
  string approval_id = 1;
  bytes claimant_capability = 2;
  uint64 observed_revision = 3;
}

message LoginApprovalProjection {
  string approval_id = 1;
  LoginApprovalState state = 2;
  uint64 revision = 3;
  int64 expires_at_unix_ms = 4;
  string comparison_code = 5;
  LoginApprovalErrorCode reason = 6;
  access_gate.v1.AccessDecision access_decision = 7;
  // 永远不含 capability、seed、token
}
```

### 1.3 认证面消息（approver）

```protobuf
message ListPendingLoginApprovalsRequest { uint64 observed_revision = 1; }

message PendingLoginApproval {
  string approval_id = 1;
  actor.v1.ActorRef actor = 2;
  string claimant_device_id = 3;
  string platform = 4;
  string device_label = 5;
  string comparison_code = 6;
  int64 expires_at_unix_ms = 7;
  uint64 revision = 8;
}

message ApproveLoginApprovalRequest {
  string approval_id = 1;
  uint64 observed_revision = 2;
  DeviceLinkHpkeEnvelope identity_material = 3; // 复用 device_link 消息类型
  bytes approver_transcript_signature = 4;
  bytes device_signature = 5;
}

message DenyLoginApprovalRequest {
  string approval_id = 1;
  uint64 observed_revision = 2;
  bytes device_signature = 3;
}
```

`DeviceLinkHpkeEnvelope`、`DeviceLinkIdentityMaterial` 与 transcript 域分隔直接
复用 `device_link.proto` / `device-link-core`，不复制密码学消息。

### 1.4 审批 transcript 绑定

approval transcript 必须覆盖：approval_id、access_attempt_id、Station root、
Actor PTID、双方 device_id、双方 HPKE 公钥、claimant 设备签名公钥、过期时间与
revision。域分隔串使用独立 purpose（`peers-touch/login-approval/.../v1\0`），
禁止与 device-link transcript 互通。

## 2. 状态机

| 当前态 | 事件 | 目标态 | 守卫 |
|---|---|---|---|
| （无） | create | PENDING | attempt 凭据通过、Actor 有已登记设备、未超 pending 上限 |
| PENDING | approve | APPROVED | approver 同 Actor、会话有效、revision CAS |
| PENDING | deny | DENIED | 同 approver 资格 |
| PENDING | claimant cancel | CANCELLED | capability 校验 |
| PENDING | TTL 到期 | EXPIRED | 回收任务 |
| APPROVED | claimant 取材料 | IDENTITY_DELIVERY | capability + 未过期 |
| APPROVED | TTL 到期未取 | EXPIRED | — |
| IDENTITY_DELIVERY | 设备 enrollment proof | DEVICE_PROVED | Actor Identity 校验通过 |
| DEVICE_PROVED | Access 重裁通过 | ACCESS_PENDING | 当前 policy GRANTED |
| ACCESS_PENDING | 凭据加密交付 | CREDENTIAL_DELIVERY | 同事务 |
| CREDENTIAL_DELIVERY | claimant ack | COMMITTED | Session 与设备绑定原子激活 |
| 任意非终态 | approver 会话失效 | DENIED(reason=APPROVER_REVOKED) | 激活锁内裁决 |

全部迁移在 PostgreSQL 事务内以 `observed_revision` CAS 推进；终态不可逆；
重复请求按 request_id 与完整命令摘要幂等返回同一投影。

## 3. 持久化策略

新表归 Station Login Approval 协调器所有（示意，字段以迁移评审为准）：

| 表 | 关键列 | 索引/约束 |
|---|---|---|
| `login_approval_transactions` | approval_id、station_peer_id、user_id、actor_ptid、claimant_device_id、state、revision、access_attempt_id、expires_at、reason | PK approval_id；`(user_id) WHERE state=PENDING` 部分索引；revision 乐观锁 |
| `login_approval_capabilities` | approval_id、capability_hash、created_at | 仅存 SHA-256 哈希；终态后随事务一并归档 |
| `login_approval_audit` | approval_id、actor、event、approver_device_id、revision、at | 追加写，覆盖 create/approve/deny/cancel/expire/ack |

- 不复制 Session 表、Actor Device 表；只持有事务状态与外键式标识。
- TTL 回收复用 Device Link 终态恢复的有界调度模式，pending 回收不阻塞新登录生命周期。
-  capability、HPKE 私钥、seed 明文永不落 Station 业务表；Station 只暂存审批方
   提交的 HPKE 密文。

## 4. 资源预算与限流

| 预算 | 建议值 | 说明 |
|---|---|---|
| 事务 TTL | 10 分钟 | 覆盖人工审批响应；过期显式 EXPIRED |
| 每 Actor 并发 PENDING | 3 | 超出返回 `CAPACITY_EXCEEDED`，不踢旧事务 |
| claimant 轮询间隔 | ≥2s | 持票；服务端令牌桶兜底 |
| approver 轮询间隔 | ≥5s | 仅 Shell 活跃期；后台不轮询 |
| 无会话 create 限流 | 按 Station/IP + attempt 维度 | 复用 Access Gate 限流桶；无有效 attempt 直接拒绝 |
| approver list 返回上限 | 10 | 只读同 Actor 自己的待办 |
| 重试幂等窗口 | 与 TTL 对齐 | request_id 去重 |

## 5. 错误码（草案）

```text
INVALID_ARGUMENT / UNAUTHORIZED_ATTEMPT / ATTEMPT_NOT_CREDENTIAL_PASSED
APPROVAL_NOT_FOUND / CAPABILITY_INVALID / REVISION_CONFLICT
APPROVAL_EXPIRED / NO_APPROVER_ELIGIBLE / APPROVER_REVOKED
DEVICE_LIMIT / CAPACITY_EXCEEDED / ACCESS_BLOCKED / SECURE_STORAGE_FAILED
```

错误走既有 typed error 合同；客户端只按 code 渲染本地化文案，不解析自由文本。

## 6. 类型映射

- Proto `LoginApprovalState` → Station Go 领域枚举（subserver domain），禁止用裸 int 传递。
- 客户端 store 投影只保留去秘密字段；native → renderer 的 projection 经过
  既有去秘密序列化层（对齐 Device Link projection 合同）。
- Access 决策要求新增的 `DEVICE_APPROVAL_REQUIRED` 进入 `access_gate.proto`，
  由 Access owner 模块维护，本模块只消费，不私造并行枚举。
