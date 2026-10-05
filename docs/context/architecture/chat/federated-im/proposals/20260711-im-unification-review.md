# v1 IM 统一架构评审提案（Peers-Touch Chat）

> **Status**: APPROVED (2026-07-11) — 决策已并入正式真源，见下方「批准结果」
> **Stage**: v1（不涉及任何版本号升级；文内外部协议名中的版本号仅为引用）
> **Created**: 2026-07-11
> **Worktree/Branch**: `peers-group-chat`
> **Scope**: 同 Station / 跨 Station、私聊 / 群聊、在线 / 离线、多设备、成员全生命周期、消息状态、E2EE、Station 可靠信封渠道、Desktop / Mobile 交互
> **Owner**: Architecture（待指派）
> **本文件性质**: 评审记录。决策已落入 [`decisions.md`](../decisions.md) D-08…D-12（唯一真源）；本文件保留为评审依据，不再重复承载真源。

---

## 批准结果（2026-07-11）

用户已批准以下决策，正式条款见 [`decisions.md`](../decisions.md)：

| DP | 决定 | 落入决策 |
|----|------|----------|
| DP-1 | 单一 Station 信封渠道 + 类型化 QoS | D-10 |
| DP-2 | 群聊 MLS（RFC 9420）+ 删除 Sender Keys，先过 G0 验证 | D-08（supersede D-06） |
| DP-3 | 私聊 X3DH + Double Ratchet，删除 chain-only fallback | D-09 |
| DP-4 | 私聊确定性会话 ID 与 authority | D-09 消费（execution 阶段细化） |
| DP-5 | 硬切换 + 清空旧聊天数据，无兼容桥 | D-11 |
| DP-6 | 文本走信封，P2P 仅音视频/大文件 | D-12 |

MLS 具体库与确切版本仍需在 G0 后**单独申请批准**方可引入。

---

## 0. 这份文档要你决策什么（已完成，存档）

这是一次结构性重构（`pt-refactor-discipline`），目标是把当前散落、脑裂、半实现的 chat 能力，收敛为**单一真源**的 v1 IM 系统，且**不留历史债**。

在写任何产品代码之前，需要你对第 6 节的 6 个决策点（DP-1…DP-6）明确批准。其中 **DP-2（群聊加密选型）与现有已接受决策 D-06 直接冲突**，必须你来裁决。

---

## 1. 现状证据（只读盘点结论）

以下均为本工作树代码 / 文档实证，非记忆：

| 编号 | 证据 | 问题定性 |
|------|------|----------|
| E-1 | `apps/station/app/subserver/group_chat/service.go` ≈ 4595 行；`handler.go` 巨大 | Station 群聊职责聚合，难以演进 |
| E-2 | `apps/desktop/src/store/socialChat.ts` ≈ 2911 行；`socialRealtime.ts` 庞大 | 客户端发送/实时/密钥/P2P 混在一处 |
| E-3 | `apps/mobile/src/features/chat/ChatPage.tsx` ≈ 1820 行 | 页面承载副作用与业务 |
| E-4 | SKDM 同时走 friend-chat control type 50 **和** Station SKDM 信封 | 密钥分发**双通道脑裂** |
| E-5 | `double_ratchet.rs` 顶部注释自述「M1 skeleton, not wired into any send/recv path」 | 私聊棘轮**未接入**发送链 |
| E-6 | `sender_keys.rs` 在 desktop 与 mobile 两份副本已出现 diff（`current_message_key_snapshot` 仅 desktop 有） | 密码学实现**复制后漂移** |
| E-7 | friend-chat 进程内 `pending map`、group offline 双轨、realtime durable store、proposal/event/SKDM 多套 outbox | 可靠性机制**各自为政** |
| E-8 | `group-sender-keys.md`、`chat-ratchet-upgrade.md`、`e2e-encryption-architecture.md`、`federated-im/*` 说法并存 | 文档与代码**多处不一致** |
| E-9 | mobile secure storage 仅 `set/get` KV（iOS Keychain / unsupported），desktop 为 SQLCipher 连接池 | 两端**安全持久化能力不对等** |

**结论**：chat 不是「没能力」，而是**底座散落 + 主链未闭合 + 双通道脑裂 + 文档漂移**。这正是 `pt-refactor-discipline` 要求「一次砍干净」的场景。

---

## 2. 目标架构（v1，单一真源）

### 2.1 统一投递主链

```
Client device
  → Home Station ingress（本人所属 Station，唯一入口）
  → Conversation Authority（会话威权：私聊/群聊都有唯一 authority）
  → Committed Conversation Event（定序、单调 seq）
  → Federation delivery outbox（跨站）/ local transport（同站）
  → Recipient Home Station durable inbox（每收件人持久化）
  → 每设备唯一 SSE 下行
  → client projection / ACK / reconcile（cursor 恢复）
```

要点：

- **同站 = 跨站**：业务语义一致，唯一差别是 transport adapter（本地直投 vs 联邦 relay + JWT）。这与已接受的 D-03（远端提 proposal、authority commit）一致。
- **私聊与群聊共享框架**：`Conversation / Member / Command / CommittedEvent / StationEnvelope / DeviceInbox / Receipt / Cursor` 一套骨架；业务投影各自独立，不共用业务表。
- **文本永远走 Station 可靠信封**；P2P（WebRTC）**只**承载音视频与（未来）大文件直传，绝不承载文本。
- **统一消息状态机**：
  ```
  local_queued → submitted → committed → home_delivered → device_delivered → read
  失败 → 持久化可重试态（有限重试 + 自愈，不无限循环、不静默降级为明文）
  ```

### 2.2 单一 Station 信封渠道（一个协议框架，多类型化 QoS）

「归一」= **一个统一的信封协议 + 路由框架**，**不是**把所有东西塞进一张表或一个无差别队列。承载多种 payload，各有持久性与 QoS：

- 消息事件（可靠、定序、持久）
- 密钥协商载荷（私聊 X3DH 初始握手 / 群聊密钥协商）
- 回执（送达 / 已读）
- 轻量信令（typing 等，可丢弃、不持久）
- 通话信令（低延迟，配合 P2P）

删除并入此框架的旧机制：friend-chat `pending map`、group offline 双轨、重复 friend/group outbox、临时 retry ledger、friend-chat control type 50 的 SKDM 搭车通道。

### 2.3 会话威权（Authority）

- 每个会话（私聊/群聊）有唯一 authority Station，负责定序、成员 epoch、生命周期。沿用 D-01…D-05、D-07。
- 私聊 authority 与会话 ID 必须**确定性**推导（见 DP-4），避免双方同时发起产生两个会话。
- authority 不可用 → 只读降级（D-05）；authority 迁移/恢复协议在 v1 标注 UNPROVEN，作为独立工作项。

---

## 3. 加密选型（本提案核心，含与 D-06 的冲突）

### 3.1 私聊：X3DH + Double Ratchet（把 skeleton 接入主链）

- 每设备独立会话，由显式多设备 session manager 管理。
- 删除任何 chain-only fallback；棘轮真正接入发送/接收路径（修复 E-5）。

### 3.2 群聊：建议改用 MLS（RFC 9420），删除 Sender Keys —— **与 D-06 冲突**

**为什么动 D-06**：D-06「Sender Keys 设备本地化」是在「尚无通用信令信封」的早期背景下做的。现在 Station 信封渠道已存在，Sender Keys 的两大代价凸显：成员每次变更需各自轮换并做 O(n²) SKDM 分发；且必须「等每个发送者上线轮换」才能达成移除后前向安全。E-4/E-6 表明它已经产生双通道脑裂与实现漂移。

**MLS 的收益**：把成员变更、密码学 epoch、设备成员、Welcome/Commit、密钥更新统一为对数级 TreeKEM 操作；authority 只**排序 MLS Commit**，不持有明文或群密钥（仍满足 D 系列「Station 不持有明文」）。

**这是有意的两种加密引擎**，由 `ConversationKind`（direct / group）唯一决定，**不是**兼容双路径、不是脑裂。

> ⚠️ **选型未定死**：MLS 仅为 **PROPOSED**。落库前必须过 DP-2 的验证门（见第 5 节），否则标记 UNPROVEN。

### 3.3 候选 MLS 实现（只读调研，均未引入）

| 库 | 版本(调研时) | 移动端 | 存储 | 审计 | 备注 |
|----|------|--------|------|------|------|
| `openmls` + `openmls_rust_crypto` | 0.8.x / 0.5.x | 有移动构建能力（需验证 iOS/Android target） | 需实现 storage provider（有 sqlite provider feature） | 有独立安全审计（需确认遗留项） | 纯 Rust，贴合现有 RustCrypto 依赖栈 |
| `mls-rs` (awslabs) | 0.55.x | 官方声明支持多平台，含 FFI | `mls-rs-provider-sqlite`（默认 sqlcipher-bundled，与 desktop 现状同源） | 官方自述**尚无完整第三方审计**；RustCrypto provider 实验性 | rust-version 1.82，功能完整、RFC 一致性测试齐 |

**引入任何一个库及其确切版本前，单独向你申请批准**（对齐 AGENTS.md「未经批准不得增改依赖/版本」）。

---

## 4. 与现有决策的关系（防脑裂对照）

| 现有决策 | 本提案 | 处置 |
|----------|--------|------|
| D-01 独立 Group Event Log | 保留，纳入统一 CommittedEvent 骨架 | 不变 |
| D-02 creator Home 为 authority | 保留，扩展到私聊确定性 authority（DP-4） | 扩展 |
| D-03 远端 proposal / authority commit | 保留，作为同站=跨站统一语义基础 | 不变 |
| D-04 普通消息不跑共识 | 保留 | 不变 |
| D-05 authority 丢失只读降级 | 保留，迁移/恢复标 UNPROVEN | 不变 |
| **D-06 Sender Keys 设备本地化** | **建议 supersede → MLS** | **需 DP-2 批准；批准后在同一次变更内改 decisions.md 并标 superseded** |
| D-07 家庭规模优先 | 保留，压力目标 100 人 / 200 设备 | 不变 |

---

## 5. 阶段门（G0…G5，先证据后实施）

- **G0 证据与验证**（进行中）：MLS 双端可行性最小原型（Desktop+Mobile：建群/加设备/加人/踢人/离线 Commit/状态恢复）；三 Station 定序/重复/乱序/断线；多设备；安全负例（伪造 Commit、旧 epoch、被移除成员续解）；100 人/200 设备压力。**未过 G0，选型保持 UNPROVEN。**
- **G1 架构评审批准**：你确认 DP-1…DP-6 → 改正式 `design.md` / `decisions.md` / `data-model.md`。
- **G2 执行计划批准**：`pt-architecture-execution-methodology` 产出依赖 DAG + 原子切换点 + 门禁 + 证据计划。
- **G3 分领域原子实施**：Model proto → Station 信封底座 → 私聊闭环 → 群聊闭环 → 客户端 Runtime → Chat UX。
- **G4 删除旧世界**：Sender Keys / friend type50 / 旧 key-exchange proto / pending map / group offline 双轨 / 旧 crypto fallback / `.rej` / 重复 store；全仓搜索旧符号必须为 0；禁止双写、feature flag、兼容桥、`_legacy`。
- **G5 全量验收**：同站 / 三 Station / 离线重启 / 多设备 / 成员进出 / authority 故障 / 安全负例 / 100 人压力 / Desktop+Mobile 交互矩阵。

---

## 6. 待批准决策点（DP）

- **DP-1 单一 Station 信封渠道**：接受「一个协议框架 + 类型化 QoS」，删除所有业务私有 pending/offline/重复 outbox。
- **DP-2 群聊加密选型（与 D-06 冲突，最关键）**：是否同意「群聊 MLS + 删除 Sender Keys」，并授权先做 G0 MLS 双端验证？（三选一：同意走验证 / 维持 Sender Keys 但先修脑裂 / 暂缓待更多材料）
- **DP-3 私聊加密**：接受「X3DH + Double Ratchet，删除 chain-only fallback，棘轮接入主链」。
- **DP-4 私聊确定性会话/authority 规则**：接受由双方 DID 确定性推导会话 ID 与 authority，杜绝并发双会话。
- **DP-5 硬切换、无兼容层**：接受删除旧数据/协议路径、不做兼容迁移（旧聊天数据处理方式需你确认：直接清空 or 一次性单向迁移）。
- **DP-6 P2P 边界**：接受「文本永远走 Station 信封，P2P 仅音视频/大文件」。

---

## 7. 声明

- 本轮只读 + 仅新增本评审草稿；**未改产品代码、未改正式架构真源、未引入依赖、未改任何版本号**。
- MLS 选型、authority 迁移、Station 信封本地投递耐久性等标记为 **UNPROVEN**，须经 G0 证据坐实。
- 批准 DP-1…DP-6 后，我按 `pt-plan-and-document` 改正式文档、按 `pt-architecture-execution-methodology` 出执行计划，再进入 G3 实施。
