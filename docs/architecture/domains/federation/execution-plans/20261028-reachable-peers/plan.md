# 可达对等联邦 · 第一批：同站解耦（LocalStation Scope）

> **Status**: draft → 执行中
> **Created**: 2026-10-28
> **Owner**: Conversation / Federation
> **上游合同**: [可达对等联邦阶段 Scope](../../review/reachable-peers-scope.md) §4.1
> **源码基线**: `0aa6572ec`

## 1. 目标与非目标

目标：未加入任何联邦、没有 Relay/seed 的两个同站用户，可创建 Direct 会话并收发消息。
同站路径不解析远端路由、不调用联邦传输、不要求选择 federation。

非目标（本批不做）：跨站链路改动、群 MLS、邀请材料产品化、sync cursor、sequencer 交接、
官方 seed/Relay、客户端 UI 改版。这些在后续批次。

## 2. 关键事实（已核对，决定方案形态）

`federation_id` 不是普通入参，它在现有实现中是会话授权 scope 标识，且深度参与一致性：

- 聚合根创建/重放要求非空：`domain/aggregate/conversation.go:211,346`；
- 进入事件哈希链：`domain/event/event.go:626`（`[]byte(state.FederationID)`）；
- 乐观并发令牌 `ObservedFederationID`：`aggregate/conversation.go:902`；
- 持久化非空列与幂等：`infrastructure/persistence/*`；
- Rust 双端对账与生命周期要求非空：`apps/desktop/src-tauri/src/messaging/engine.rs:1810,3023,3651`、`lifecycle.rs:412,443`；
- reopen 冲突判定：`production_capabilities.go:1894`。

**结论（干净方案，无遗留）**：不引入伪造 ID，也不保留非空字符串约束。
把会话的授权维度从“一个 federation_id 字符串”升级为一个**判别类型 `CommunicationScope`**，
这是会话/发现/投递共同依赖的能力抽象，而不是一个本地联邦实体：

```text
CommunicationScope（判别类型，非实体）
  ├─ Local      { stationID }                  // 派生自 Actor 归属；无账本、无生命周期
  └─ Federation { federationID }               // 引用真实联邦，受 Ledger 成员关系约束
```

- Local 不是联邦：不创建、不入 `federation` 表、不可邀请/加入/退出/同步/交接。
  “成员”由 `actor.home_station ==本站` 派生。
- 持久化：会话表用 `scope_kind` + 可空 `federation_id`（Local 行 federation_id 为 NULL），
  不再用非空字符串承载同站语义。
- 哈希链：对 scope 的**规范化编码**（kind + 值）入链，取代 `[]byte(FederationID)`；
  Local 有确定编码，不存在空串歧义。
- 早期过渡实现里的 `local:<station>` 字符串、reopen 兼容分支、`SeedDevFederation`
  假联邦种子全部删除，不做双写/双判/数据迁移。

## 3. 合同

### 3.1 统一能力端口

会话、目录发现、出站投递面向同一个端口，按 scope 分派实现；业务层不出现 `if federation`：

```go
type CommunicationScope interface {
    Kind() ScopeKind                       // Local | Federation
    Authorize(ctx, subject, target ActorRef) error   // 能否发起会话/操作
    SearchActors(ctx, q, viewer) (entries []Entry, partial PartialResult, err error)
    Delivery() MessageDelivery             // Local=本站 inbox；Federation=/federation 帧
}
```

- Local 实现：身份归属判定 + 本站目录 + 本地 inbox；零网络、零账本。
- Federation 实现：active 成员投影授权 + 联邦目录 + `/federation/*` 帧（直连/Relay）。
- 联邦**治理生命周期**（Create/Invite/Approve/Sync/Handover/Leave）不进该端口；
  Local 没有这些操作。

### 3.2 权威判定

- scope 由会话 authority Station 依据双方 Actor 的 Home Station 权威派生：
  - 双方同站 → `Local{本站}`；不解析远端路由、不调 DHT/Relay/联邦发现。
  - 异站 → 必须有真实 `Federation{federationID}` 与已验签路由。
- 客户端不再选择/构造 scope；创建请求不携带 federation_id，由服务端解析。
- Local 会话拒绝异站成员加入/跨站投递，fail-closed（typed `SCOPE_STATION_MISMATCH`）。
- 未来公网发现/官方 Relay 只是再增加 scope 供给实现，会话内核不变。

### 3.3 删除项（无兼容路径）

- `frame/touch/actor/seed_dev_federation.go` 整个文件 + `setup.go` 调用：**已删除**。
  同站聊天改由 Local scope 成立，不再种假联邦；预置用户/好友种子保留但加双重守卫：
  无任何 HTTP/RPC 入口；`peers.actor.dev_seed_enabled` 默认 false（opt-in），
  开发 conf 显式打开，生产 overlay 须显式关闭。跨重启的“只生效一次”由数据库级
  幂等保证（actor 身份查重、好友边 OnConflict DoNothing），不使用进程内
  `sync.Once`（重启失效，会给虚假保证）。frame `go build ./...` 与 touch/actor
  测试通过。
- `valueobject`/`identity` 中的 `local:` 字符串形态、`existingDirectCanReopen` 的
  同站等价分支、gate 里对 `local:` 前缀的字符串判定，改为 scope 类型判定。（待办：Scope 类型迁移）
- 旧的“同站也必填 federation_id”客户端契约与 Rust 非空校验。（待办：proto/Rust 批次）

### 3.4 失败语义

- 跨站但联邦缺失/非法/非成员：typed 拒绝（维持现有联邦错误码族）。
- scope 类型与成员归属不一致：`SCOPE_STATION_MISMATCH`。
- Local 不触发外部网络；本站离线由 Station Access 层表达，与联邦无关。

## 4. 任务拆分（依赖顺序）

- **T0 标识族收口（已完成）**
  统一 ID 生成与分类，见 [标识族](../../../engineering/identifier-foundation.md)：
  网络身份（libp2p PeerID，frame）与域资源标识（`fed_`/`evt_` ULID，
  `app/internal/identity`）分族；federation 与 ledger event 的内联生成已迁移到
  `identity.NewFederationID/NewLedgerEventID`。
- **T1 判别 Scope 值对象（已完成）**
  新增 `valueobject.Scope = Local(station) | Federation(fed_id)`（私有字段 + 构造校验 +
  `Equal/Canonical/JSON`）；删除旧字符串方案 `LocalStationFederationID` /
  `IsLocalStationScope` / `ScopeBelongsToStation`。群聊仅允许 Federation。
- **T2 聚合/命令/查询层迁移（已完成，含哈希链）**
  `CreateInput`/`Snapshot`/`ConversationState`/`MemberAuthorityCommand` 等以 `Scope`
  取代 `FederationID`；事件状态哈希输入改用 `Scope.Canonical()`；群计划/Leave intent/
  follower 等联邦专属结构保留 federation_id；Direct 同站 Local、跨站 Federation；
  系统 Direct/Service Plaintext 固定 Local（移除 `LocalScope.LocalFederation` 端口与
  假本地联邦适配器）。
- **T3 生产层权威判定与授权 wrapper（Go 侧已完成）**
  - frame `social_gate.Operation` 用结构化 `ScopeKind`（frame 自带 `local`/`federation`
    常量，frame 不依赖 app）取代 `local:` 字符串前缀，保留
    `Subject/TargetStationPeerID` 与 `SameStation()`/`LocalScope()`；
  - `ConversationGateEvaluator` 同站分支只跑关系策略、不调跨站授权；local 跨站 fail-closed；
  - `production_http.createDirect` 与 `EnsureAcceptedRelationshipDirectConversation`
    按 Actor Home Station 归属派生 `Local/Federation` scope；`existingDirectCanReopen`
    改为严格 `Scope.Equal`，删除迁移等价分支；
  - 同站 typing 不经联邦帧，直接本地 realtime 发布；
  - 持久化 `conversations.scope_kind` + 可空 `federation_id`，破坏性硬切换迁移
    （可空加入→回填→放宽 NOT NULL→规范校验），Local 行 federation_id 为 NULL。
  - 测试：gate 分支用例与 conversation/social/federation 全部 Go 测试通过。
- **T3-rem 真实跨站授权实现（已完成）**：`productionCrossStationAuthorizer`
  实现 `social_gate.CrossStationAuthorizer`，要求 subject/target 两站均为该 Federation
  active 成员，fail-closed，并在 subserver 装配（不再传 nil）。Direct 跨站所需 Federation
  由 `FederationDirectory.ResolveSharedFederation(stationA, stationB)` 按站点对解析唯一共享
  Federation（0 个→未联合、多个→歧义），客户端 Direct 创建不再传 federation id。
- **T4 Rust 端（Desktop + Mobile 已完成，Journey 已证）**
  两端 `create_direct_conversation` 与 Tauri/HTTP 入参去掉 `federation_id`，请求体不再发送；
  lifecycle 水合与 store/投影校验允许 Local Direct 的空 federation（仅群仍强制非空）。
  Desktop `cargo check` 通过、messaging 单测全绿；Mobile `src-tauri` `cargo test --offline`
  380 项全绿（含新增 `authority_scope_accepts_local_direct_without_federation`）。
  Journey：Desktop 原生双客户端同站 Gate
  `chat-native-single-station-two-client-e2e` PROVEN（run 20261029T005949，
  PG 真值 `scope_kind=local`、`federation_id IS NULL`、2 成员、3 事件、无联邦帧）；
  Mobile 双 iOS 模拟器 Gate `mobile-simulator-social-convergence-e2e` PROVEN
 （run 20261029T032148，`directScope=local`，typing 8ms / 送达 753ms / 回执 257ms，
  无 mock，双端绑定同一 source-attested Station）。
  Mobile 身份预置走新增的 acceptance-only 命令
  `secure_storage_acceptance_seed_identity`（`acceptance-harness` feature 门控，
  crypto 域校验 key 形状与 32B seed 并读回；生产 web storage fence 不变）。
- **T5 TS/客户端（Desktop + Mobile 已完成，Journey 已证，见 T4 Gate）**
  `CreateDirectConversationInput` / Mobile `MessagingCreateDirectInput.federationId`
  改为可选且 IPC 不再透传（账户 mutation scope 仍照常发送，仅服务端派生会话 scope）；
  Desktop SocialChatPage、Mobile Contacts 发起 Direct 不再选联邦。Desktop `tsc --noEmit`
  0 错误、相关 vitest 全绿；Mobile `check:web`（mobile-social-wire / social-runtime-boundaries
  / tsc）通过、相关 vitest 全绿（仅余 3 个与 scope 无关的基线失败：recovery surface fixtures、
  actorDisplayName 解析、request pagination 末页 peerName 投影）。
  注：客户端本地投影暂用「可空 federation」兼容，未新增独立 scope_kind 存储列（后续增强）。
- **T5-proto（已完成）**：`CreateDirectConversationRequest` 移除字段 3 `federation_id`
  （reserved）；`Conversation`/`ConversationPublicHead`/`ConversationAuthoritySnapshot`
  增加 `ConversationScopeKind scope_kind` 与对应枚举，Go/TS 经 `model/build.sh` 重生成、
  Rust 经 messaging-core build.rs 重生成。
- **T6 验证（单测 + 同站/跨站 Journey 已证）**
  Go conversation/social/federation 全包 + frame gate、Rust messaging、TS services/store
  单测全绿；新增 Local scope 构造/JSON/迁移、gate 同站/跨站分支、CrossStationAuthorizer、
  ResolveSharedFederation（0/1/多交集）单测。
  同站真实 Journey 已证：干净库·无联邦·两同站用户 Direct 可建可收发——Desktop
  `chat-native-single-station-two-client-e2e`（PG 真值 local/NULL）与 Mobile
  `mobile-simulator-social-convergence-e2e`（双模拟器、directScope=local）PROVEN。
  跨站真实 Journey 已证（2026-10-29，一次性站对 chat-native-four/chat-native-five）：
  `federation-two-station-lifecycle-e2e` PROVEN（270s，create/join/幂等/leave/rejoin/
  restart/archive 全周期）；`chat-native-multi-device-e2e` PROVEN（run
  20261029T093030556953Z-adbdd15827b03464ba2bf1e262715734，251s，5 断言：
  native_runtime/actor_isolation/bob1_initial_delivery/session_handoff/
  bob2_enrollment_operational 全 PROVEN）——peer-only 联邦 Direct 创建成功、
  `bob1_initial_delivery` 跨站送达，bob2 同安装替换登录后 bob1 权威会话被吊销、
  bob2 enrollment 可解析既有会话并继续收发。
  multi-device 会话交接曾因验收基建缺陷失败：原 clone 只搬
  `peers-touch/desktop/data/secure-store/identity-keys`，而服务端 CreateWithKick 的
  替换键 `(station_peer_id, user_id, device_id)` 取的是 canonical 安装 id
  `peers-touch/<PT_PROFILE>/data/auth/device_id`（device_install，遵循 launch
  profile 段）。修复后 clone 合同以 CloneStorageEntry 表达源/目标相对路径，按 actor
  profile 段重映射安装 id 文件，identity keys 仍走固定 crypto sandbox 段；session_handoff
  断言更正为 Station Access 合同的「同 Actor + 同安装 id」（旧断言要求 device id
  不同，是单会话设计残留）。见 docs/knowledge 跨显示器 operator 指针条目。
  另：origin/master 的 macOS semantic Cell 资格探测存在回归（adapter 缺
  snapshot_operator_state、启动抢焦、XPC NSOpenPanel 选择被 -25205 拒绝），本批一并
  带入对应 tooling 修复使 Cell 可达 LEASED。
  persistent four/fiveArm 站另有历史数据问题：站对现存 8 个双端 active Federation，
  `ResolveSharedFederation` 按设计返回歧义（409），跨站 gate 必须使用一次性站对。
- **T7 Recovery 归档 Local 支持（已完成代码+单测，Journey 已证其管线）**：归档为 serde JSON
  （非 proto），`RecoveryConversationProjection` 增加 `#[serde(default)] scope_kind`，
  归档格式 v4→v5（版本严格匹配）。Local Direct 允许空 federation；Federation 行仍强制非空；
  Local group 拒绝；无 scope 字段的 pre-v5 投影按「Direct+空 federation=Local」推断。
  Desktop 导出从本地会话行派生 scope。messaging-core、desktop recovery 单测全绿，
  覆盖 Local Direct 空 federation、Local group 拒绝、pre-v5 推断等差异路径。
  真实 Recovery Journey `chat-native-recovery-e2e` PROVEN（run
  20261029T093905008810Z-a96d046d5487e578b8e9fa201b1784a9，132s）：source 身份、native
  runtime、actor 隔离、明文收发、24 词助记词校验、同机无引擎恢复、重装恢复及恢复后三轮
  收发全部 PROVEN，证明 v5 归档导出/恢复端到端管线。
  证据边界（如实记录）：现有 recovery gate 在打开 Direct 前显式要求站对存在共享 active
  Federation（`shared_federation_id` 前置），fixture 种子使 alice/bob 同属该 Federation，
  故该 Journey 覆盖的是 federation 非空行；Local Direct recovery 的空-federation codec
  差异仅由单测覆盖，尚无 local-only recovery gate。Local Direct 真实收发本身已由
  chat-native-single-station-two-client-e2e PROVEN。

每批保持现有联邦验收断言通过。T1–T3 可在 Station 侧独立闭环；T4–T5 是端到端所需。

## 5. 明确不改

- 不改 federation Ledger、事件序列化版本与既有哈希；
- 不改群聊/MLS 路径；
- 不引入新传输协议或新表（local scope 复用 federation_id 列）；
- 不在本批提供公网发现/中继。

## 6. 验收标准（可判定）

1. 不配置任何 federation/seed/relay，同站两用户经 `/conversation/direct` 创建成功，
   持久化 `scope_kind=local` 且 `federation_id` 为 NULL，可正常收发。
2. local scope 会话在加入异站成员、跨站投递时被 typed 拒绝。
3. 历史真实联邦 scope 的会话行为不变；reopen 采用严格 `Scope.Equal`（破坏性硬切换，
   不再保留同站等价/迁移分支）。
4. Rust（Desktop + Mobile）同站创建不强制 federation_id，投影对账通过；跨站仍强制。
5. `federation-full-lifecycle` 与现有 conversation 测试全部通过。
