---
kind: playbook
title: Dev Test Accounts
status: active
owns:
  - apps/station/app/conf/actor.yml
  - apps/station/frame/touch/actor/seed.go
  - apps/station/frame/touch/actor/seed_dev_friends.go
  - apps/station/frame/touch/setup.go
detected: 2026-07-06
---

# Dev Test Accounts

> **Status**: active
> **Version**: v2.1
> **Created**: 2026-07-06 | **Updated**: 2026-08-04
> **Owner**: Peers-Touch Engineering

---

## 1. Scope

本文档记录本地开发、验收、E2E 性能排查可复用的测试资源物料。

本文档不定义生产账号、权限策略、认证架构或安全边界。

---

## 2. Dev 测试账号矩阵

### 2.1 账号配置

定义文件：`apps/station/app/conf/actor.yml`

所有账号密码均为 `1`，PIN 均为 `111111`。

| Account | Email | Display Name | Avatar | 角色定位 | 默认互为好友 |
|---------|-------|--------------|--------|---------|-------------|
| **alice** | `alice@p.t` | Alice ${LABEL} | Coral | 主测试用户 / 发起方 | ✅ |
| **bob** | `bob@p.t` | Bob ${LABEL} | Blue | 对端用户 / 接收方 | ✅ |
| **carol** | `carol@p.t` | Carol ${LABEL} | Violet | 第三方 / 跨站联邦用户 | ✅ |

> `${LABEL}` 展开为 `PEERS_NODE_LABEL` 环境变量（如 "One"、"Two"），方便区分多站同名用户。
>
> Station 为每个 demo account 提供不同的默认头像。启动时只回填空头像，不覆盖开发者已自定义的头像。

### 2.2 命名来源

采用密码学经典命名（Alice & Bob convention）：

- **Alice** — 通讯发起方
- **Bob** — 通讯接收方
- **Carol** — 第三方参与者

### 2.3 自动好友关系

Station 启动时，前 3 个 preset user（alice、bob、carol）会自动互相加为好友。

实现：`frame/touch/actor/seed_dev_friends.go` → 在 `friend_chat_sessions` 表中幂等插入会话行。

陌生人、权限隔离、压力与安全测试必须使用 disposable Station 数据，
不得向共享开发 Station 持续注册临时 actor。

### 2.4 多站联邦测试矩阵

| Station | Profile | 账号 | 联邦身份示例 |
|---------|---------|------|-------------|
| Station One (246.80) | `one` | alice, bob, carol | `@alice@10.37.246.80:18080` |
| Station Two (118.48) | `two` | alice, bob, carol | `@alice@10.37.118.48:18080` |
| Station Three (local) | `three` | alice, bob, carol | `@alice@localhost:18080` |

**跨站好友** 不自动 seed（需要完整的 Send Request → Accept 流程）。典型跨站测试对：

- `alice@station-one` ↔ `carol@station-two`（发起方↔第三方，跨站互搜/加好友/聊天）
- `bob@station-one` ↔ `bob@station-two`（同名不同站，验证联邦 handle 唯一性）

### 2.5 快速登录指南

```
Email:    alice@p.t  (或 bob@p.t / carol@p.t)
Password: 1
PIN:      111111
```

---

## 3. 使用约束

- 不用于生产环境。
- 共享开发 Station 上的普通验收复用 alice、bob、carol，不得每次运行注册新 actor。
- 必须创建临时 actor 的 E2E（压力、安全、隔离）只能运行在 disposable Station 数据库中。
- 性能排查报告引用这些账号时，只记录账号标识和测试环境，不扩散到生产文档。
- 多站测试时注意：每个 Station 独立 seed，同一 email 在不同 Station 上是**不同用户**。
