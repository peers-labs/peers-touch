# 可达对等联邦（Federation over Reachable Peers）— 阶段 Scope

> **Status**: draft（待评审）
> **Created**: 2026-10-28
> **Owner**: Federation / Conversation / Node Connectivity
> **源码基线**: `0aa6572ec`
> **关系**: 本文是 [组网与日常通信评审设计](./design.md) 的阶段收敛版；冲突处以本文的阶段边界为准。
> 本文不替代 active 架构（`../design.md`、`../../../platform/runtime/node-connectivity/`），只定义本期做什么、不做什么。

---

## 1. 为什么收窄

公网 Relay 平台与公网联邦发现属于平台建设，当前资源不覆盖；同时最基本的“已知站点之间组联邦”仍不完整（同站聊天被 federation_id 卡住、邀请/操作恢复/远端目录缺失）。

本期只保证一件事：

> **联邦提供方与加入方只要在网络层互相可达——直连或任一方自行解决的 Relay——就能完成完整的联邦生命周期与跨站业务。**

未来的公网 Relay 平台、公网联邦发现平台是在本内核之外叠加“候选供给”和“公开目录”，**不重构本期契约**。

## 2. 已验收基线（不重写，只增量）

`federation-full-lifecycle` Gate（`tooling/acceptance/features/federation-full-lifecycle.yaml`，
Gate `tooling/acceptance/gates/federation/two_station_lifecycle_e2e.py`）已在
four / fiveArm 两台互相可达的 Station 上证明：

- single_admin 联邦创建与 typed 非法输入拒绝；
- 非 sequencer 站点提交 join proposal、bootstrap replica 后两侧联邦身份一致；
- 重复 join 幂等，不推进 ledger head；
- 两侧成员/角色投影一致，Native Desktop 渲染同一 active context；
- 非 owner 经 sequencer 退出、双方投影收敛；
- 重新加入、Native 进程重启后恢复；
- 非 owner 不能归档、sequencer 不能直接退出、仅创建者可归档。

**这些是本期的地基，保持兼容。** 本期不更改 ledger 事件语义、单 sequencer 模型与
已验收的 join/leave/rejoin/archive 路径。

## 3. 核心定义

### 3.1 可达（Reachable）

站点 B 对站点 A 可达，当且仅当 A 能用 B 的**显式连接资料**完成：

1. 传输连通：TCP/libp2p 建链成功（直连 origin，或经 B/A 自行挂载的 Relay circuit）；
2. 内层身份验证：Node TLS SPKI + Station 根身份与资料一致；
3. 一次带签名 token 的治理 HTTP 调用成功（如 resolve identity / fetch head）。

三层全部成立才叫可达。**可达是成员关系的前置条件，不是成员关系本身。**

### 3.2 可达性与 DHT / Relay / Federation 的关系

| 机制 | 本期角色 |
|---|---|
| 显式 endpoint（邀请/连接资料） | **唯一必需的发现方式**；治理同步、proposal、业务帧都先消费它 |
| libp2p Direct（公网 IP / 局域网 / 自有域名） | 支持，一等路径 |
| 自管 Relay（任一方自行部署/挂载的标准 Circuit v2） | 支持；沿用现有 enrollment/ACL/attachment，不要求平台运营 |
| DHT / bootstrap seed / locator | **非必需、不阻塞**；配置了可用就用，不配置不影响显式 endpoint 联邦 |
| 官方公网 Relay | 不提供 |
| 公网联邦发现 / 公开网络目录 | 不提供 |

代码事实支撑：远端治理同步直取成员记录中的 `StationURL`
（`app/subserver/federation/sync_manager.go:159`）；远端 join 强制要求
`federation_endpoint`（`handler.go:180-184`）；业务帧在 RelayAccess 不可用时
回退到 `StationURLResolver` 的直连 origin
（`frame/core/federation/transport.go:303-330`）。
即当前架构本来就是“显式 endpoint 优先、DHT 可选”。

### 3.3 连接资料（Connection Material）

邀请/申请必须显式携带，不依赖任何中心化目录：

```text
federation_id / genesis 摘要（加入哪个网络）
sequencer station_peer_id 与 Station 签名公钥（验证谁有权批准）
sequencer endpoint：HTTPS origin，或“Relay circuit + 对端路由”描述
邀请方对上述材料的签名与过期时间
```

加入方先用它解析 sequencer 身份、校验期望公钥，再提交 proposal
（现有 `ResolveStationIdentity → SubmitProposal → BootstrapReplica` 链已经按此顺序工作）。

连接资料只提供**联系线索与传输授权**，不自动授予联邦成员资格；批准仍由 sequencer 治理完成。

## 4. 范围内（In Scope）

### 4.1 同站解耦（最高优先）

- 新增 LocalStation scope：同站 Direct 会话不构造、不要求 `federation_id`。
- 改动贯穿 conversation command/aggregate/wire（Go）与 Native engine（Rust），
  现状双端都拒绝空 federation_id：
  `app/subserver/conversation/production_http.go:136`、
  `domain/valueobject/value_objects.go:60-75`、
  `apps/desktop/src-tauri/src/messaging/engine.rs:3020-3025`。
- 同站注册、找本站人、同站聊天在**未加入任何联邦**时完全可用；
  同站路径不依赖 DHT、Relay、成员同步。

### 4.2 可达性驱动的联邦生命周期

- 创建、邀请（绑定目标 Station、过期、撤销）、无邀请申请、批准/拒绝；
- 邀请材料以 §3.3 字段表达；UI 中引导管理员确认“双方网络已可达”，不可达时给出
  typed 原因（endpoint 不通 / 身份不匹配 / 对端不是 sequencer），不假装在加入；
- 组网操作持久化、幂等、可恢复：
  `validating → awaiting_approval → submitting → replicating → completed`，
  支持 `retry_wait`（对端暂时不可达）与 `cancelled/rejected/expired`；
  页面刷新、进程重启后从已确认阶段继续，不重复 proposal、不重复 ledger 事件。

### 4.3 账本与同步（在已验收基线上补完整）

- 沿用 append-only hash chain、单 sequencer、BootstrapReplica 校验；
- sync cursor 增补：last attempt/success、typed error、next retry、
  applied/head seq；缺 fetcher、对端 4xx/5xx、空 endpoint 进入显式降级，不静默；
- fork（同 seq 不同 hash）显式失败；
- sequencer 交接：复用 `SEQUENCER_CHANGED` 事件与 single_admin policy，
  补齐可操作的交接流程（冻结写入→对端追平→CAS 切换），永久丢失进入只读策略。

### 4.4 跨站业务在可达对端上跑通

- `/federation/*` 帧（conversation、key-exchange、attachments、realtime、social）
  在直连或自管 Relay 上语义一致；durable outbox、幂等键、typed disposition 沿用；
- 投递状态分层：已保存 / Home Station 已收 / 远端 Station 已收 / 接收设备已展示；
  transport 成功不等于已送达；
- 远端暂时不可达：消息入 outbox 保留，恢复后自动继续，不重复；
- 建群前预检全体成员共同 scope，无法覆盖的成员在提交前指出。

### 4.5 目录与找人

- Home Station 聚合：本地 Actor 目录 + 已加入联邦**且当前可达**成员的远端目录；
- 远端查询必须显式带 federation scope（沿用 `handler_catalog.go` 约束）；
- 部分成员不可达时返回“部分结果 + 不可达成员列表”，禁止把未完成搜索显示成“没有这个人”；
- 未加入联邦时只搜本站；联系人分享链接可以确认身份，但不能自动扩大授权。

### 4.6 就绪状态分层（替换单一 DHT 健康开关）

产品/客户端只消费以下分层投影，每一层独立降级：

```text
client_access   客户端 ↔ 本站
local_chat      同站能力（不依赖任何联邦条件）
member_reach    本站 ↔ sequencer / 所需成员 endpoint 可达
ledger_sync     本地 head 与 sequencer head 的关系（追平/落后/失联/fork）
relay_route     本站当前是否有活动 circuit（仅诊断，不是联邦条件）
dht_seed        DHT/seed 状态（本期允许 not_required）
cross_delivery  跨站投递可用性 = member_reach ∧ ledger_sync ∧ 业务路由可达
```

`/actor/federation/health` 当前只返回 DHT peer/seed 计数
（`frame/touch/federation_health_handler.go`），**不得**再作为联邦/搜索总开关；
客户端无调用方时按废弃处理，新投影在联邦 context API 中提供。

### 4.7 管理端体验

- Dashboard 联邦页：创建网络 / 接受邀请 / 申请加入，输入的是连接资料，不是节点技术配置；
- 不出现 bootstrap seed、multiaddr、手动挂载中继的必填步骤；
- 自管 Relay 的挂载仍可在现有 Relay/Transport 管理页完成（运维动作），
  与“加入联邦”动作解耦；
- Desktop/Mobile 普通用户无任何组网操作。

## 5. 范围外（Out of Scope，本期明确不做）

- 官方/公网 bootstrap seed 节点的运营、SLA、多地域部署；
- 签名 seed 候选的公网分发服务（accepted 的 bootstrap-connection-material
  落地推迟，但合同保留，见 §7）；
- 官方公网 Relay、配额/计费平台、Relay 推荐与 Relay-to-Relay mesh；
- 公网联邦公开目录、“浏览/搜索所有公开网络”；
- 用 DHT locator 自动发现陌生 Station 并发起联邦；
- 完整共识、多 sequencer 并发写入、区块链化；
- 新传输协议或第二套业务 wire。

物理边界（产品需如实表达，不许诺 P2P 万能打通）：

> 双方都在对称 NAT 后、没有任何公网可达节点、也没有自行准备 Relay 时，
> 本期无法帮助其连通。需要一方公网可达或自行提供中继。

## 6. 与已验收基线的差异（允许改的不足）

以下是基线验收之后仍然成立的不足，属本期修复，不改变已验收事件语义：

1. 同站 Direct 的 federation_id 硬依赖（架构违例，§4.1）。
2. 远端 join 有 endpoint 要求，但**无面向用户的邀请材料形态**：
   `federation_id + endpoint + 期望身份` 仍靠站外传递，需产品化封装与验签。
3. 加入操作无持久 operation：对端中途不可达、页面刷新后的恢复行为无合同。
4. sync cursor 无 attempt/error/next-retry，失联只落日志（`sync_manager.go`）。
5. catalog 只查本地库与未过期缓存（`handler_catalog.go`），无实时远端聚合与部分失败表达。
6. 健康语义把 DHT 计数当联邦就绪（§4.6）。
7. sequencer 交接只有 policy/replay 形状，无完整操作链。
8. `federation.yml`/`routing.go` 中“进程内两个 DHT、bootstrap 自建 Host”等
   过时注释需订正（事实是唯一 kernel Host/DHT，bootstrap 借用注入）。

## 7. 未来平台化的兼容路径（只承诺接口，不承诺时间）

本期所有跨站动作都经过两个可替换端口，未来平台只替换其供给来源：

```text
本期：  邀请连接材料（显式 endpoint） ──▶ 可达成员联邦内核
未来：  公网发现目录 ──┐
        签名 seed 候选 ─┼─▶ 生成同样的“可达成员 + 连接材料” ──▶ 同一内核
        官方 Relay 平台 ─┘
```

- `StationURLResolver` / `RelayAccess`（`frame/core/federation/transport.go`）
  已把“目标是谁”和“字节怎么到”分开；未来新增公开发现 provider，
  产出的仍是同一套 endpoint + 验签材料。
- bootstrap-connection-material 合同（accepted，未实施）未来落地时，
  只是自动填充候选 endpoint/relay，不改变联邦批准语义。
- 私有部署始终可以继续只用显式邀请、完全不接入公网平台。

## 8. 验收方向（不写具体 Gate 实现，只定义必须被证明的结果）

- 两台仅有显式 endpoint、**未配置任何 DHT seed** 的 Station，可完成
  创建→邀请→加入→同步→跨站消息/群/附件→退出→重加全链路；
- 同站两用户在无联邦、无 Relay、无 seed 条件下可注册并聊天；
- 加入/同步过程中杀死对端与重启本站，操作恢复且无重复 ledger 事件、无重复消息；
- 直连与经自管 Relay 两种路径产生相同的 typed receiver 结果；
- 对端不可达时目录返回部分结果，消息排队，恢复后自动送达，接收端展示才出回执；
- 已验收的 `federation-full-lifecycle` 断言继续全部通过（不回归）。

## 9. 证据索引

- 已验收范围：`tooling/acceptance/features/federation-full-lifecycle.yaml`；
  `tooling/acceptance/gates/federation/two_station_lifecycle_e2e.py`
- 显式 endpoint 加入：`apps/station/app/subserver/federation/handler.go:134-230`
- 治理同步用成员 StationURL：`apps/station/app/subserver/federation/sync_manager.go:155-190`
- 直连/Relay 二选一投递：`apps/station/frame/core/federation/transport.go:184-330`
- 目录范围与缓存：`apps/station/app/subserver/federation/handler_catalog.go:155-219`
- 跨站能力路由表：`apps/station/frame/core/federation/routes.go:17-75`
- 同站 federation_id 耦合：见 §6.1 三处引用
- 网络域全貌与代码对账：
  `deliverables/network-architecture-review-20261028/network-architecture-review.md`
