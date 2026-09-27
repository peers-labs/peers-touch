---
kind: invariant
title: Call Resolution 必须完整保存信令 Session Identity
status: active
owns:
  - apps/station/app/subserver/events/
  - apps/desktop/src/modules/p2p/callP2p.ts
  - apps/mobile/src/features/call/
referenced-by: []
related:
  - docs/architecture/chat-lifecycle/data-model.md
  - docs/architecture/chat-lifecycle/decisions.md
detected: 2026-09-24
---

# Call Resolution 必须完整保存信令 Session Identity

## What must hold

Call Resolution 的 `session_ulid` MUST 完整保存客户端生成的 canonical signaling
session identity。当前 Direct 形式由两个最长 255-byte PTID 与一个分隔符组成，因此
Station 持久化字段 MUST 支持至少 511 bytes；禁止截断、hash 替代或让内存值与数据库
值采用不同表示。

Federation receiver 的 retryable domain failure MUST NOT 被 HTTP ingress 映射为
`CALL_ALREADY_HANDLED`。只有 terminal domain rejection 才能表示已提交的冲突或过期
终态。

Desktop 与 Mobile 的 Acceptance projection MUST 将本地 `ended + endReason`
映射回相同的 canonical terminal state，并保留 Station 返回的
`winning_device_id`；平台本地状态机差异不得改变跨客户端断言语义。
loser 已进入 `handled_elsewhere` 后，后续 authoritative readback MUST 保持该终态，
不得用 call-level `REJECTED` 覆盖 endpoint-level loser 结果。

## Why this is non-negotiable

Call Resolution 使用 `(callee_actor_ptid, call_id)` 做 durable CAS，并把
caller、callee、session 与 request digest 绑定到同一 `OPEN` record。若数据库列窄于
canonical session identity，PostgreSQL 会拒绝首次 `CALL_REQUEST`，导致合法来电在
任何仲裁发生前失败。

若 sender Home Station 再把该 retryable storage failure 折叠为
`CALL_ALREADY_HANDLED`，客户端会错误地认为已有 winner，既掩盖真实基础设施故障，
也破坏 CCU-D06 的 typed fail-closed 语义。

## How to verify

- `cd apps/station && go test ./app/subserver/events/... -count=1` 必须通过。
- `TestCallResolutionSchemaSupportsCanonicalDirectSessionIdentity` 必须证明 schema
  宽度覆盖两个最大 PTID 组成的 session identity。
- `TestCallResolutionConflictRequiresTerminalDomainRejection` 必须证明 retryable
  domain rejection 不会被识别为 call conflict。
- Mobile `callState.test.ts` 与 `actions.social.test.ts` 必须证明 reject winner
  identity 被保留，且 `ended + rejected` 投影为 canonical `rejected`。
- `python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-call-resolution-e2e`
  必须在 PostgreSQL-backed Callee Home Station 创建 `OPEN` record 并完成仲裁。

## Crosswalks

- `CCU-D06`：`docs/architecture/chat-lifecycle/decisions.md`
- Call Resolution 数据模型：`docs/architecture/chat-lifecycle/data-model.md`
