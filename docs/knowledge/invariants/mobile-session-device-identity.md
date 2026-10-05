---
kind: invariant
title: Mobile Session 与 Messaging 必须共享设备身份
status: active
owns:
  - apps/mobile/src-tauri/src/runtime/oauth/
  - apps/mobile/src-tauri/src/messaging/
  - packages/messaging-core/src/identity/
  - apps/station/frame/core/facility/session/
  - apps/station/app/subserver/actor_identity/
  - apps/station/app/subserver/events/
referenced-by: []
related:
  - docs/architecture/domains/identity/unified-actor-system.md
  - docs/architecture/domains/chat/lifecycle/decisions.md
detected: 2026-09-24
---

# Mobile Session 与 Messaging 必须共享设备身份

## What must hold

同一个 Mobile 安装实例的认证 Session 与 Messaging Actor Device 必须使用同一个
`device_id`。OAuth/native session 生成并持久化设备标识；Messaging 激活必须复用
该标识创建或恢复签名设备身份。`X-Device-ID`、Actor Device certificate、消息端点
和 Call lifecycle payload 不得各自生成独立设备标识。

## Why this is non-negotiable

Station 会把 JWT `session_id` 原子绑定到完成签名校验的 Actor Device。后续实时信号
同时校验 Session 绑定、`X-Device-ID` 与 payload 中的设备标识。若 Mobile 认证层
和 Messaging 层各自生成设备 ID，设备注册或信令请求会被正确地拒绝为 HTTP 403，
导致消息恢复与来电仲裁无法启动。

该约束同时保护设备撤销语义。一个物理安装实例若投影为两个逻辑设备，Session
撤销、Actor Device 撤销和多端 winner/loser 状态将指向不同主体，无法形成可信的
单调收敛。

## How to verify

- `cargo test --manifest-path packages/messaging-core/Cargo.toml identity::enrollment`
  必须证明显式 Session device ID 被写入新 enrollment。
- `cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml messaging::lifecycle::tests`
  必须证明 Mobile runtime 投影同一 device ID，并拒绝用另一 device ID 恢复既有
  Messaging identity。
- `python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-mixed-client-multi-device-e2e`
  必须通过 Mobile `messaging.reconcile`，不得出现 session/device binding 403。
- `python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-call-resolution-e2e`
  必须证明 Call lifecycle header、payload 与 Session 使用同一设备标识。

## Crosswalks

- `docs/knowledge/invariants/actor-identity-boundary.md`
- `docs/architecture/domains/identity/unified-actor-system.md`
- `docs/architecture/domains/chat/lifecycle/decisions.md` 中的 `CCU-D06`
