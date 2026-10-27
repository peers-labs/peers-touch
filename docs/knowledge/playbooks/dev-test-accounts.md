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
> **Version**: v2.2
> **Created**: 2026-07-06 | **Updated**: 2026-09-12
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

| Account | Email | Display Name | Avatar | 角色定位 | 好友关系 |
|---------|-------|--------------|--------|---------|---------|
| **alice** | `alice@p.t` | Alice ${LABEL} | Coral | 主测试用户 / 发起方 | bob、carol |
| **bob** | `bob@p.t` | Bob ${LABEL} | Teal | 对端用户 / 接收方 / mixed 群 owner | alice、carol、dave |
| **carol** | `carol@p.t` | Carol ${LABEL} | Violet | 第三方 / 跨站联邦用户 | alice、bob、dave |
| **dave** | `dave@p.t` | Dave ${LABEL} | Blue | 陌生人场景：bob/carol 的好友，但**不是 alice 的好友** | bob、carol |

> `${LABEL}` 展开为 `PEERS_NODE_LABEL` 环境变量（如 "One"、"Two"），方便区分多站同名用户。
>
> Station 为每个 demo account 提供不同的内联默认头像。preset 图像必须是满幅方形素材，不得在素材内部烘焙圆形 mask；各客户端统一由 `UserSquareAvatar` 控制圆角。启动时只迁移本 Station 本地 demo Actor 的空头像、已退役外部 URL 或旧版圆形 preset；`remote_cached` Actor 必须通过签名 Home-Station profile 刷新，不能按用户名改写。开发者已自定义的其他头像保持不变。

### 2.2 命名来源

采用密码学经典命名（Alice & Bob convention）：

- **Alice** — 通讯发起方
- **Bob** — 通讯接收方、含陌生人的 mixed 群 owner
- **Carol** — 第三方参与者
- **Dave** — 部分连接者：与 bob/carol 是好友，与 alice 互为陌生人，用于“群里有陌生人”场景

### 2.3 自动好友关系

Station 启动时幂等建立两批双向好友（`follows` 表）：

- alice ↔ bob、alice ↔ carol、bob ↔ carol（三人全连接）
- bob ↔ dave、carol ↔ dave（dave 只接入 bob/carol，**不与 alice 建立好友关系**）

实现：`frame/touch/actor/seed_dev_friends.go` → 在 `follows` 表中幂等插入双向
social graph 边，使 unified Conversation 的 relationship gate 认可该好友关系。
若旧版 `friend_chat_sessions` 表存在，同时写入兼容会话行；该表不是好友关系权威。

陌生人、权限隔离、压力与安全测试必须使用 disposable Station 数据，
不得向共享开发 Station 持续注册临时 actor。

### 2.4 dev 群拓扑（计划中，尚未自动 seed）

预设的两个 dev 群场景如下，统一通过当前 Conversation 权威子服务器
（`apps/station/app/subserver/conversation`）的建群命令创建，不允许直接写库：

| 名称 | Owner | 成员 | 拓扑含义 |
|---|---|---|---|
| Friends | alice | alice、bob、carol | 全员互为好友 |
| Mixed | bob | bob、alice、dave | dave 是 bob 的好友、对 alice 是陌生人；由 bob 拉入 |

建群命令要求每个成员 actor 已有活跃注册设备（endpoint），而 preset 用户在首次
登录前没有设备，因此群组不能在 Station 启动 seed 阶段创建。当前需要成员先登录、
再由 owner 走真实建群流程；自动化 seed（设备就绪后引导或独立 dev 命令）待定。

### 2.5 多站联邦测试矩阵

| Station | Profile | 账号 | 联邦身份示例 |
|---------|---------|------|-------------|
| Station One (TEST-NET) | `one` | alice, bob, carol, dave | `@alice@192.0.2.10:18080` |
| Station Two (TEST-NET) | `two` | alice, bob, carol, dave | `@alice@192.0.2.20:18080` |
| Station Three (local) | `three` | alice, bob, carol, dave | `@alice@localhost:18080` |

**跨站好友** 不自动 seed（需要完整的 Send Request → Accept 流程）。典型跨站测试对：

- `alice@station-one` ↔ `carol@station-two`（发起方↔第三方，跨站互搜/加好友/聊天）
- `bob@station-one` ↔ `bob@station-two`（同名不同站，验证联邦 handle 唯一性）

### 2.6 快速登录指南

```
Email:    alice@p.t  (或 bob@p.t / carol@p.t / dave@p.t)
Password: 1
PIN:      111111
```

---

## 3. 使用约束

- 不用于生产环境。
- Native Acceptance 直接使用本文档与 `actor.yml` 声明的 disposable 账号密码；
  不要求额外的 secret-style password 环境变量。Acceptance Harness 和测试数据不进入
  production Desktop package。
- 共享开发 Station 上的普通验收复用 alice、bob、carol，不得每次运行注册新 actor。
- 必须创建临时 actor 的 E2E（压力、安全、隔离）只能运行在 disposable Station 数据库中。
- 性能排查报告引用这些账号时，只记录账号标识和测试环境，不扩散到生产文档。
- 多站测试时注意：每个 Station 独立 seed，同一 email 在不同 Station 上是**不同用户**。
