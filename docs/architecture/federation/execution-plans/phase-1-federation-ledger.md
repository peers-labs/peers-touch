# Phase 1: Federation Ledger 最小闭环

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-05-31 | **Updated**: 2026-05-31
> **Owner**: Architecture Team

---

## 1. 目标

Phase 1 的目标是把 Federation 从概念实体落成可验证的治理真源：

- 一个 Federation 可以通过 genesis event 创建。
- 成员 Station 可以通过 ledger event 加入、退出、暂停和恢复。
- 每个成员 Station 可以 replay 同一组 ledger events 并得到同一 materialized state。
- v1 使用 active sequencer 形成唯一 head，非 sequencer Station 只能提交 proposal。
- Federation Plaza 可以从 Station projection 读取 Federation、成员 Station 和当前 Actor capability。

本阶段不是完整 Federation 产品，也不是 ActivityPub 互操作落地。

---

## 2. 非目标

- 不实现完整 BFT、PoW、PoS、token、gas 或通用区块链。
- 不把聊天、点赞、评论、好友请求内容、在线状态写入 Federation Ledger。
- 不实现完整 Desktop 联邦广场 UI，只定义和验证 Station projection。
- 不实现外部 ActivityPub governance 互操作。
- 不实现复杂多签治理，只预留 policy 和 handover 扩展位。

---

## 3. 领域责任

| 领域 | 责任 | 交付边界 |
|------|------|----------|
| Model / Proto | 定义跨 Station wire 契约和 deterministic bytes 语义 | proto 源文件，不包含生成物手写修改 |
| Station Federation Service | 承载 lifecycle、append、proposal、replay、materialized state | Station app layer，不下沉到 frame |
| Sequencer | 为正式 event 分配 `seq`、`prev_hash`、`event_hash` | v1 单 active sequencer |
| Ledger Sync | 同步 event、检测 head drift 和 fork | 可先用 request/response，同步 transport 可替换 |
| Catalog Scope | 让 discovery 默认带 `federation_id` | 不再把 Catalog 当全局目录 |
| Plaza Projection | 给 Client 提供只读 view model 和 capability | Client 不保存 ledger 真源 |
| Testnet Seed | 生成与正式流程同构的 genesis / membership events | 不直接写 materialized state |

---

## 4. 执行闭环

标准闭环：

```text
Create Federation
  -> write genesis event by sequencer
  -> replay into materialized state
  -> expose Plaza projection
  -> invite / join Station through proposal or direct sequencer append
  -> sync events to member Stations
  -> member Stations replay same head
  -> Catalog / Plaza queries execute under federation_id
```

异常闭环：

```text
Receive ledger event
  -> verify deterministic hash
  -> verify actor / station / sequencer signatures
  -> verify policy and membership authority
  -> detect seq / prev_hash mismatch
  -> enter fork_detected instead of advancing state
```

完成 Phase 1 时，正向闭环和异常闭环都必须可通过三节点测试网复现。

---

## 5. 依赖顺序

### 5.1 P0: Proto 契约

先定义 wire 契约，避免 Station、Desktop、Catalog 各自发明模型。

交付物：

- `federation.proto`：Federation metadata、status、policy summary。
- `federation_ledger.proto`：LedgerEvent、event payload oneof、Proposal、hash/signature fields。
- `federation_membership.proto`：StationMembership、ActorRole、StationRole projection。
- `federation_policy.proto`：policy type、sequencer、capability 判断输入。
- `federation_manifest.proto`：DiscoveryManifest、genesis verification fields。
- `federation_sync.proto`：FetchEvents、FetchHead、SyncCursor、ForkDetected。
- `federation_plaza.proto`：ListFederations、ListMemberStations、GetCapabilities。

验收标准：

- 所有跨 Station payload 使用 protobuf，不使用 JSON 作为事实源。
- Ledger event hash 的输入字段和 canonical bytes 规则明确。
- Event payload 能表达 `FederationCreated`、`StationJoinApproved`、`StationLeft`、`StationSuspended`、`StationRemoved`、`AdminGranted`、`AdminRevoked`、`PolicyUpdated`、`SequencerChanged`。
- Proposal 和正式 LedgerEvent 是不同消息，proposal 不能被当成 head event。

### 5.2 P1: Station Federation Service

在 Station app layer 落 Federation governance 真源。

交付物：

- Create federation：生成 genesis event、初始 policy、初始 sequencer。
- Append event：只允许 sequencer 追加正式 event。
- Submit proposal：非 sequencer Station 提交 signed proposal。
- Replay：从 events 重建 materialized state。
- Role check：基于 Station role、Federation actor role、membership、policy 判定 capability。
- State projection：输出 Federation summary、head、sequencer、members、capabilities。

验收标准：

- materialized state 可完全由 ledger replay 重建。
- 本地 DB projection 与 ledger head 不一致时，必须丢弃 projection 并 replay。
- frame layer 不读取 Federation policy 表，不裁决治理权限。
- 普通社交行为不会创建 ledger event。

### 5.3 P2: Active Sequencer 与 Fork Detection

确保 v1 head 唯一，避免多 Station 并发写入造成不可恢复分叉。

交付物：

- sequencer assignment：genesis event 指定 `sequencer_station_peer_id`。
- event append gate：非 current sequencer 不能追加正式 event。
- proposal accept / reject：sequencer 校验后生成正式 event 或拒绝 proposal。
- handover placeholder：支持 `SequencerChanged` event，但复杂 quorum 可后续扩展。
- fork detection：同一 `seq` 不同 `event_hash` 进入 `fork_detected`。

验收标准：

- 非 sequencer Station 直接 append 正式 event 被拒绝。
- 同一 `seq` 不同 `event_hash` 不会推进 materialized state。
- `fork_detected` 状态可在 Plaza projection 或运维接口中被看见。
- sequencer 失联不会导致本地配置私自切换 head。

### 5.4 P3: Ledger Sync 与 Testnet Seed

让多个 Station 复制并验证同一 Federation governance state。

交付物：

- Fetch head：获取远端 `head_hash`、`head_seq`、sequencer。
- Fetch events：按 `federation_id`、`from_seq` 拉取 events。
- Apply events：校验后按序应用到本地 ledger store。
- Sync cursor：记录 remote station、last seen head、last applied seq、sync status。
- 三节点 testnet seed：生成真实 genesis 和 membership events。

验收标准：

- 三节点 replay 后得到同一 `head_hash` 和 `head_seq`。
- seed 不直接写 materialized state。
- 远端落后、不可达、fork 都有明确 sync status。
- sync payload 不包含 token、password、private key、email 等 PII 或 secret。

### 5.5 P4: Catalog Scope 与 Plaza Projection

把 Federation Ledger 的治理状态投影到用户可理解的发现入口。

交付物：

- Catalog search request 默认携带 `federation_id`。
- Station list 只返回 active member stations。
- Actor visibility 使用 global visibility、federation scoped visibility、federation policy 合成。
- Plaza projection 输出 Federation list、member station list、current actor capabilities。
- Legacy handle resolve 标记为 advanced / explicit context 路径。

验收标准：

- 不存在默认全局 Catalog search 主路径。
- `BY_HANDLE` actor 不会因为 Plaza 或 Catalog scope 被枚举。
- Desktop / Client 只消费 projection，不保存 ledger truth。
- capability projection 与 Station 端最终权限裁决一致。

---

## 6. 交付物

Phase 1 完成时必须交付：

- Proto 源文件：覆盖 Federation、Ledger、Membership、Policy、Manifest、Sync、Plaza。
- Station app-layer Federation Service：支持 genesis、append、proposal、replay、projection。
- Ledger sync 最小实现：支持三节点 head 同步和 fork detection。
- Catalog scope 改造方案或实现：默认 discovery 带 `federation_id`。
- Testnet seed：三节点生成真实 genesis / membership events。
- 文档回链：如 proto 或接口命名发生变化，更新 `data-model.md` 和 `integration.md`。

---

## 7. 验证标准

### 7.1 功能验证

- 创建 `peers-testnet` Federation 后，node-a / node-b / node-c replay 得到同一 head。
- node-b 作为非 sequencer 直接 append 正式 event 会失败。
- node-b 提交 proposal 后，node-a sequencer 可以 accept 并生成正式 event。
- 人为制造同一 `seq` 不同 `event_hash` 时，receiver 进入 `fork_detected`。
- Station list 只包含当前 Federation 的 active member stations。
- Catalog search 必须携带 `federation_id`。

### 7.2 安全验证

- event hash 使用 deterministic protobuf canonical bytes。
- actor signature、station signature、sequencer signature 任一无效时 event 被拒绝。
- suspend / removed Station 不能继续作为 valid publisher 或 sequencer。
- ledger event payload 不包含 token、password、private key、session、email。
- BY_HANDLE actor 不会被 indexed catalog 枚举。

### 7.3 架构验证

- Federation governance 代码不落入 Station frame layer。
- frame layer 只提供 relay、locator、resolver、signing、transport primitive。
- Desktop 不保存 ledger head 或 membership 真源。
- materialized state 可删除后通过 replay 完整恢复。

### 7.4 推荐命令

```bash
./model/build.sh
cd apps/station && gofmt -l . && go test ./...
./tooling/scripts/check-go-style.sh
```

如果本阶段只提交文档，不要求执行代码验证，但后续实现 PR 必须通过上述命令。

---

## 8. 依赖

前置依赖：

- `docs/architecture/federation/design.md`
- `docs/architecture/federation/data-model.md`
- `docs/architecture/federation/integration.md`
- `docs/architecture/identity/unified-actor-system.md`
- `docs/architecture/identity/federation-catalog.md`
- `docs/station/base.md`
- `docs/global/domain-model.md`

实现依赖：

- Proto-First：先改 `model/domain/federation/*.proto`，再生成平台代码。
- Station app/frame 分层：app layer 拥有 governance，frame layer 只提供 primitive。
- Relay 纪律：新增 relay topic 必须 deny-by-default allow-list，并在 receiver 做 authority / replay / relevance gate。

---

## 9. 风险与控制

| 风险 | 控制 |
|------|------|
| Ledger 变成普通 DB 复制 | 所有 materialized state 必须可由 ledger replay 重建 |
| Sequencer 单点导致不可用 | v1 允许 read-only / orphaned，handover 通过 event 表达 |
| Catalog 继续隐式全局搜索 | 默认用户路径强制 `federation_id` |
| frame 积累 federation 业务规则 | D-10 约束，review 时检查 frame 不读取 policy / role 表 |
| BY_HANDLE 被 Plaza 枚举 | effective visibility 规则和测试用例覆盖 |
| relay topic 被滥用 | topic allow-list、origin authority、replay protection、local relevance gate |

---

## 10. Phase 退出条件

全部条件满足后，Phase 1 才能视为完成：

- 三节点测试网能创建并同步 `peers-testnet` Federation。
- 三节点 replay 后 head 一致。
- 非 sequencer append 被拒绝，proposal 路径可用。
- fork detection 可复现且不会推进错误 state。
- Plaza projection 可以列出 Federation、member stations、current actor capabilities。
- Catalog / Station list / Public actor list 主路径均带 `federation_id`。
- 文档、proto、Station 实现之间没有并行模型或命名漂移。
