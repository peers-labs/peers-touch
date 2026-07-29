# Federation Architecture — 架构设计

> **Status**: accepted
> **Version**: v0.2
> **Created**: 2026-05-31 | **Updated**: 2026-07-21
> **Owner**: Architecture Team

---

## 1. 核心原则

1. **Federation 是持久虚拟实体** — Federation 不是用户关系，也不是临时 Station 连接；它是独立存在的虚拟网络。
2. **Station 是成员节点** — Station 可以加入多个 Federation，并持有相关 ledger 副本。
3. **Actor / Account 是参与者** — Actor 可以在已加入 Federation 内社交；Account 只是用户侧产品语言，默认不能改变联邦拓扑。
4. **治理事实上账本** — 创建、邀请、加入、退出、授权、策略变更等进入 Federation Ledger。
5. **社交数据不上账本** — 聊天、点赞、评论、好友请求内容、在线状态不进入 Federation Ledger。
6. **用户不记地址** — 用户通过搜索、联系人、好友列表等日常入口自然接触联邦内的人，而不是手动输入 `@user@host`。
7. **Federation 语境显式化** — Catalog、Resolver、Station list、Public actor list 都必须带 `federation_id`，禁止默认全局联邦范围。
8. **身份模型复用 ActorRef** — 跨 Station 身份以 `ActorRef`、federated handle、`station_peer_id` 表达；`Account` 只作为产品语言，不成为新的 wire identity。
9. **Station 是真源，Client 是投影** — Federation membership、policy、ledger、权限裁决归 Station；Desktop Settings/Dashboard 只消费 Station 投影。

---

## 2. 系统架构

```text
Desktop
  ├─ Station Picker
  │   └─ 选择当前 Home Station，本地配置层
  ├─ 搜索 / 联系人 / 聊天（日常入口）
  │   └─ 跨联邦 handle 解析、好友来源标注、联邦 scope 筛选
  └─ Settings → Federation（低频配置入口）
      ├─ Actor Identity & Visibility
      ├─ Routing Health
      └─ Joined Federations (Join / Leave)

Dashboard → Federation（治理入口）
  ├─ Create Federation
  ├─ Approve / Reject Station 加入
  ├─ Ledger 管理
  └─ Policy & Admin 治理

Home Station
  ├─ Federation Service
  │   ├─ Federation materialized state
  │   ├─ Station membership
  │   ├─ Federation role checks
  │   └─ Federation Ledger replay
  ├─ Actor / Catalog / Resolver
  │   └─ 用户发现、profile hydrate、可见性控制
  └─ Ledger Sync
      └─ 与其他成员 Station 同步治理事件

Remote Station
  ├─ Federation Ledger 副本
  ├─ Station metadata
  └─ Public actors by visibility policy

Relay / Bootstrap
  └─ 提供网络发现、连接和未来 ledger event transport 的运行时基础
```

Station Picker 和 Federation 入口的边界必须保持清晰：

- Station Picker 回答“Desktop 当前连接哪个 Home Station”。
- Settings → Federation 回答“我的联邦身份、可见性和已加入的联邦”。
- Dashboard → Federation 回答“联邦治理：创建、审批、Ledger、策略”。
- 搜索/联系人/聊天 回答“我能找到谁、跟谁聊天”——联邦作为底层 scope 自然生效，用户无需“进入联邦”。

### 2.1 组件边界

- Station app layer 拥有 Federation governance 真源。
- Station frame layer 提供 relay、bootstrap、locator、resolver、signing 等基础设施。
- Client 只消费 Station projection，不保存 Federation 真源。
- 具体映射和迁移影响见 [integration.md](./integration.md)。

---

## 3. 核心概念

### 3.1 Actor / Account

Actor 是系统身份模型，跨 Station 和跨进程必须使用 `ActorRef` 或其可验证投影。Account 是面向用户的产品语言，表示一个人类用户使用 Home Station 上的 Actor 参与 Federation。

Actor / Account 可以：

- 浏览 Home Station 已加入的 Federation。
- 浏览 Federation 内成员 Station 的公开用户。
- 与已联邦范围内的用户加好友、follow、聊天。
- 管理自己的可见性和屏蔽列表。

普通 Actor / Account 不可以：

- 创建或删除 Station membership。
- 邀请或移除 Station。
- 修改 Federation policy。
- 授权或撤销 federation admin。

### 3.2 Station

Station 是 Actor 的 Home Station，也是 Federation 的成员节点。Station 负责：

- 决定本站是否加入、退出、屏蔽某个 Federation。
- 保存 Federation Ledger 的本地副本。
- 根据 ledger replay 出 materialized state。
- 暴露本站在 Federation 内允许公开的用户目录。
- 执行 Station 级权限检查。

一个 Station 可以同时加入多个 Federation。

### 3.3 Federation

Federation 是持久虚拟网络。它拥有：

- `federation_id`
- metadata
- 成员 Station 集合
- 管理员和治理角色
- policy
- genesis event
- ledger head
- materialized state

Federation 不依赖创建者个人存续。创建者只是初始管理员，创建者退出或删除账号不应导致 Federation 消失。

### 3.4 Federation Ledger

Federation Ledger 是 permissioned append-only ledger。它记录治理事实，不记录普通社交数据。

每个事件形成 hash chain：

```text
genesis_event
  └─ event_1(prev_hash = genesis_hash)
      └─ event_2(prev_hash = event_1_hash)
          └─ event_3(prev_hash = event_2_hash)
```

成员 Station 通过同步 ledger events 复制 Federation 状态。任何 Station 都可以通过 replay 验证当前状态。

第一阶段不引入完整共识，而采用每个 Federation 一个 active sequencer 的模型：

- `sequencer_station_peer_id` 由 genesis event 或后续 policy event 指定。
- 只有 active sequencer 可以为正式 ledger event 分配 `seq`、`prev_hash` 和 `event_hash`。
- 非 sequencer Station 发起治理动作时，先提交 signed proposal，由 sequencer 校验 policy 后追加为正式 event。
- 成员 Station 收到同一 `seq` 但不同 `event_hash` 时必须进入 `fork_detected` 防护状态，停止接受该 Federation 的新 head，并上报告警。
- sequencer 失联时，Federation 根据 policy 进入 `read_only` 或通过 quorum / multi-sig handover event 选出新 sequencer。
- v1 `single_admin` policy 下，如果无法产生合法 handover event，Federation 进入 `orphaned`，只能浏览和验证历史，不能追加治理事实。

这不是完整链共识。它的目标是在三节点测试网和早期 permissioned Federation 中提供确定性 head，避免多个管理员同时写入导致不可恢复分叉。

---

## 4. 权限模型

### 4.1 Station 级权限

| Role | 权限 |
|------|------|
| `station_owner` | Station 最高治理者；默认由第一个 preset user 或第一个注册用户担任 |
| `federation_admin` | 由 `station_owner` 授权；可以代表本站处理 Federation 加入、退出、邀请、审批等动作 |
| `member` | 普通用户；可以通过搜索/联系人发现联邦内其他人并社交，不能修改联邦拓扑 |

同一 Station 的用户看到的 Federation 状态一致，但可操作能力不同。

### 4.2 Federation 级权限

| Role | 权限 |
|------|------|
| `federation_owner` | 初始治理者；可授权管理员；不作为 Federation 生命周期依赖 |
| `federation_admin` | 管理成员 Station、审批加入、暂停恶意 Station、更新规则 |
| `federation_moderator` | 可选；后续用于内容治理，不默认拥有 topology 管理权 |

### 4.3 Actor / Account 级行为

联邦建立后，Actor / Account 间社交不再逐个由管理员审批：

- 加好友
- follow
- 聊天
- 屏蔽用户
- 调整个人可见性

这些是普通用户行为，不是 Federation Ledger 治理事件。

---

## 5. Federation 生命周期

### 5.1 Create

```text
station_owner / federation_admin
  → Create Federation
  → 当前 Station 成为第一个 member station
  → 创建者成为初始 federation_owner
  → 写入 genesis event
```

### 5.2 Invite

Federation admin 邀请某个 Station。目标 Station 的 `station_owner` 或 `federation_admin` 审批。通过后写入 `StationJoinApproved` event。

### 5.3 Join

Station 主动申请加入 Federation。Federation admin 根据 policy 审批。通过后成为 member station。

### 5.4 Leave

Station owner/admin 可以让本站退出 Federation。退出只影响本站，不影响 Federation 本身。

### 5.5 Suspend / Remove

Federation admin 可以暂停或移除某个 Station。具体需要单管理员、多签或 quorum 由 Federation policy 决定。

### 5.6 Founder Leaves

创建者离开后，Federation 继续存在。如果还有其他 admin 或 admin station，治理继续。如果没有管理员，Federation 进入 `orphaned` 状态，并等待恢复流程。

### 5.7 Archive

Federation 归档必须由 policy 决定，不能只依赖创建者个人决定。

### 5.8 Sequencer Handover

Sequencer handover 是治理事件，必须上账本：

```text
current sequencer / quorum admin stations
  → ProposeSequencerHandover
  → policy checks signatures and quorum
  → append SequencerChanged event
  → new sequencer starts assigning future seq
```

任何 Station 本地配置都不能单方面改变 Federation sequencer。没有合法 `SequencerChanged` event 的 head 切换必须被视为 fork 或 operator error。

---

## 6. Federation Discovery 与 Scope

Federation discovery 分三层，不能混用：

| 层 | 回答的问题 | 真源 |
|----|------------|------|
| Federation manifest | 这个 Federation 是谁、genesis hash 是什么、初始成员/入口有哪些 | genesis event + signed manifest |
| Station membership | 当前 Federation 有哪些成员 Station | Federation Ledger replay |
| Actor catalog | 在该 Federation scope 内有哪些可发现 Actor | 成员 Station 的 scoped catalog |

Discovery 和查询必须显式带 `federation_id`：

```text
Federation Discovery（由 Station API 提供，Client 按入口消费）
  → list federations from Home Station (Settings / Dashboard)
  → list member stations by federation_id (Dashboard)
  → search catalog by federation_id + prefix/filter (搜索入口)
  → resolve actor by federation_id + federated_handle (联系人/聊天)
```

`federation_id` 的作用：

- 限定 fan-out 的 Station 范围，只查询 active member stations。
- 应用 Federation policy，例如是否允许 public catalog、是否需要登录、是否允许跨 Federation discover。
- 支持同一 Station 在不同 Federation 中暴露不同公开目录。

如果未来保留 handle-only resolve，它只能作为高级路径，并且必须声明 resolve 语境：默认 Home Station 已加入 Federation 范围、用户选择的 Federation、或显式 external resolve。

不得引入全局 Peers-Touch registry。Relay / Bootstrap 只提供连接和转发能力，不成为 Federation membership 或 policy 真源。

---

## 7. 联邦与用户感知

### 7.1 设计哲学：联邦是基础设施，不是产品入口

联邦是底层网络拓扑——用户日常感知的一级入口是"人"（搜索、联系人、好友、聊天），而不是"联邦"本身。正如普通人不会天天意识到自己在哪个国家的互联网上，用户也不应频繁操作联邦。

这意味着：

- **搜索和联系人** 是用户发现联邦内其他人的自然入口。搜索框支持跨联邦 handle 解析（`@user@station.example.com`），联系人列表显示来自各联邦的好友，不需要先"进入联邦"再"找人"。
- **Settings → Federation** 是低频配置入口——查看联邦身份、调整 Actor 可见性、查看路由健康、加入/离开联邦。类似护照管理：偶尔需要，不是日常动作。
- **Dashboard → Federation** 是治理入口——创建联邦、审批 Station 加入、管理 Ledger、策略变更。这是 Station 管理员的低频但重要的操作。
- **不设独立的"联邦广场"一级页面**。联邦存在感通过社交流（好友来源标注 Station/Federation）、搜索结果（跨联邦发现）和偶尔的 Settings 配置自然渗透，而不是要求用户主动进入一个专门页面浏览联邦拓扑。

### 7.2 各入口职责分工

| 入口 | 频率 | 用户角色 | 职责 |
|------|------|---------|------|
| 搜索/联系人/聊天 | 日常 | 所有用户 | 发现联邦内的人、加好友、聊天、follow |
| Settings → Federation | 低频 | 所有用户 | 查看身份、调 visibility、查健康、Join/Leave |
| Dashboard → Federation | 极低频 | Station 管理员 | 创建联邦、审批 Station、Ledger 管理、策略治理 |

### 7.3 联邦上下文的渗透方式

普通用户不需要"进入联邦"就能感受到联邦：

- 好友 profile 标注来源 Station 和所属 Federation。
- 搜索结果按联邦 scope 筛选时，明确展示结果来自哪个联邦。
- 群聊成员列表标注跨站成员的 Home Station。
- 消息加密状态（MLS/X3DH）自然展示端到端安全性。

管理员需要治理时，通过 Dashboard 操作 Federation Ledger；普通用户不接触 Ledger。

---

## 8. 安全与隐私边界

### 8.1 Ledger 安全

- Ledger payload 不得包含 token、password、session、private key、email 等 PII 或 secret。
- Event hash 必须基于 deterministic protobuf canonical bytes，禁止 JSON canonicalization 作为跨 Station 事实源。
- Event 必须包含 actor signature 和 station signature；receiver 必须同时校验签名、权限、policy 和 `prev_hash`。
- Station signing key rotation 必须通过治理事件表达；没有旧 key 或 policy quorum 背书的新 key 不得自动信任。
- 被 suspend / removed 的 Station 不得继续作为 valid publisher / sequencer。

### 8.2 Actor 可见性

现有 actor visibility 是全局 `hidden / by_handle / indexed`。多 Federation 后需要增加 Federation scoped visibility：

- 全局 `hidden` 优先级最高，任何 Federation 都不可发现。
- 全局 `by_handle` 表示可被精确 resolve，但默认不可进入 catalog。
- 全局 `indexed` 表示允许进入 catalog，但最终是否展示还要看 Federation scoped visibility 和 Federation policy。
- Federation scoped visibility 可以把某个 Actor 在某个 Federation 中降级为 hidden / by_handle，但不能越过全局 visibility 升级公开范围。
