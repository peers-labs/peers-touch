# G2 — v1 IM 统一执行计划（依赖有序）

> **Status**: P0/P1 已实施；P2/P3 严格加密收口进行中；P4 被 Mobile P2/P3 与三 Station MLS 收敛门阻塞
> **Stage**: v1（不涉及任何版本号升级）
> **Created**: 2026-07-12 | **Updated**: 2026-08-01
> **Current Worktree/Branch**: `peers-chat-high-chat` / `feat/group-detail-history-ux-pr`
> **Governing decisions**: [`../decisions.md`](../decisions.md) D-01…D-05、D-07（沿用）；D-08…D-12（v1 归一）
> **Verification gate**: [`20260712-g0-mls-verification.md`](./20260712-g0-mls-verification.md)（G0 未过前，群聊 MLS 相位不得实施）
> **Governing invariant**: [`../../../knowledge/invariants/actor-presence-ownership.md`](../../../knowledge/invariants/actor-presence-ownership.md)
> **Supersedes**: [`20260704-foundation-federated-im.md`](./20260704-foundation-federated-im.md)（Sender Keys 版本，已作废）
> **Owner**: Architecture（待指派）

---

## 0. 本计划的作用与边界

把 v1 IM 归一（D-08…D-12）拆成**依赖有序、可原子切换、可验收**的相位。本文件是计划，不是实施；**任何相位进入产品代码前需用户批准**（目标约束）。

关键调度洞察：**并非所有工作都被 G0（MLS 验证）阻塞**。私聊加密（D-09）与 Station 信封底座（D-10）不依赖 MLS 库选型，可先批先做；只有群聊加密（D-08）相位挂在 G0 门之后。这样能在等待 MLS 选型/验证期间并行推进，缩短关键路径。

### 全局硬约束（每个相位都必须守）

- **单一真源 / 无脑裂 / 无历史债**（`pt-refactor-discipline`）：新路径落地即迁移全部消费者并删旧路径，禁止兼容桥、双写、`_legacy`、feature flag 遗留。
- **严格加密单路径**（D-08、D-09、D-11）：私聊只接受 X3DH + Double Ratchet `v=1`，群聊只接受 MLS；禁止 plaintext decode、chain-only `v=0`、Sender Keys 与 raw-text fallback。
- **历史数据不进入应用迁移**：旧明文、`v=0` 与 Sender Keys 数据不读取、不迁移，也不由应用代码删除；P6 通过单独审批的运维 SQL 清理，清理前由严格解码器 fail closed / ignore。
- **presence 归属**（上方 invariant）：chat 只能 `presence.IsActorOnline` 窄读，禁止 chat 本地存 reachability、禁止 chat 私有 presence 流。
- **proto-first**：数据模型先改 `model/domain/**.proto`，不手改生成码，按官方脚本重生成。
- **E2EE 红线**：Station 不持明文/群密钥/私钥；日志与指标不含敏感载荷。
- **版本禁令**：不升级任何框架/协议/proto/依赖/库/API/schema 版本号，除非单独批准。
- **文本走信封，P2P 仅音视频/大文件**（D-12）。

---

## 1. 相位依赖图（DAG）

```text
P0 契约冻结（proto 单一合同）
   │
   ├────────────► P1 Station 信封底座（D-10：outbox/inbox/cursor/幂等/ACK/重试/死信/背压；本地+联邦 transport）
   │                     │
   │                     ├────────────► P2 私聊闭环（D-09：X3DH+Double Ratchet v1 only，多设备，跨站，离线恢复）
   │                     │
   │                     └────────────► P3 群聊闭环（D-08：MLS only）  ← 受 G0 门约束（G0 通过 + MLS 库经批准）
   │                                          │
   ├──────────────────────────────────────────┘
   ▼
P4 客户端 Runtime 归一（Desktop + Mobile：Gateway→Adapter→Normalizer→Reducer→Store→Supervisor→UI）
   │
   ▼
P5 Chat UX 闭环（原型对齐 + 全状态覆盖）
   │
   ▼
P6 原子删除旧世界（Sender Keys / friend type50 / pending map / group offline 双轨 / 旧 crypto fallback / 重复 store / .rej）
   │
   ▼
P7 全量验收（同站/三 Station/离线重启/多设备/成员进出/authority 故障/安全负例/100 人压力/双端交互矩阵）
```

关键路径：`P0 → P1 → (P2 ∥ P3) → P4 → P5 → P6 → P7`。P2 与 P3 可并行；P3 额外等 G0。

---

## 2. 相位定义（范围 / 依赖 / 交付物 / 验收门 / 原子切换）

### P0 契约冻结（proto 单一合同）
- **依赖**：G1 已完成（decisions/design/data-model 已定）。**不被 G0 阻塞**。
- **范围**：在 `model/domain/chat/`、`model/domain/federation/`、`model/domain/realtime/` 定义 v1 单一合同：`Conversation`、`ConversationMember`、`ConversationCommand`、`CommittedConversationEvent`、`StationEnvelope`（类型化 QoS）、`DeviceInboxItem`、`MessageReceipt`、`DeliveryCursor`、`FederatedMlsKeyDeliveryEnvelope`、私聊 session/device 契约、消息/附件/引用/线程/编辑/撤回、typed error codes、消息状态机枚举（`local_queued→submitted→committed→home_delivered→device_delivered→read`）。
- **交付物**：proto 源 + 按官方脚本重生成；`data-model.md` 与 proto 一致。
- **验收门**：proto 生成通过；`check-social-wire-contract.sh` 类门通过；无手改生成码。
- **原子切换**：新 proto 引入即为唯一合同；旧 chat proto 消息在 P6 统一删除（此前不新增消费者）。

### P1 Station 信封底座（D-10）
- **依赖**：P0。**不被 G0 阻塞**。
- **范围**：一个信封协议 + 路由框架，多类型化 QoS；durable outbox / per-device inbox / cursor / 幂等 / ACK / retry+backoff / dead-letter / 背压；同站 local transport + 跨站 federation relay（peer-JWT，沿用 D-03）。
- **交付物**：Station 侧信封服务 + 持久化 + 联邦投递；契约测试。
- **验收门**：单站直投 + 跨站 relay 幂等/重试/cursor 恢复通过；presence 只走窄读（invariant 校验命令零命中）。
- **原子切换**：friend/group 的业务私有队列在 P6 删除；P1 期间新老并存仅允许到 P6 之前的最短窗口，且不得双写同一事实。

### P2 私聊闭环（D-09）
- **依赖**：P0、P1。**不被 G0 阻塞**（不使用 MLS）。
- **范围**：确定性 Direct Conversation ID + 确定性 authority（DP-4）；X3DH 初始握手；Double Ratchet `v=1` 接入真实收发；多设备 session manager + fanout；设备新增/吊销/丢失恢复；发送/送达/已读/失败重试；编辑/撤回/删除/引用/线程；加密附件；本地全文搜索；安全码/身份变化提示。删除 plaintext decode、chain-only `v=0`、版本协商 feature flag 与 raw-text fallback；未知/旧格式 fail closed。
- **验收门**：同站+跨站私聊 L2/L3；多设备；离线重启补投；被吊销设备不能解未来消息。
- **原子切换**：私聊旧 pending map 在 P6 删除。

### P3 群聊闭环（D-08）— **受 G0 门约束**
- **依赖**：P0、P1、**G0 通过 + MLS 库与版本经用户批准**。
- **范围**：authority 排序 MLS Commit（与 `membership_epoch` 原子绑定，C-4）；KeyPackage 目录；建群/邀请/加入/退出/踢人/转让/解散；actor membership 与 device membership 分离；Welcome/Commit 经信封投递；历史可见性；authority 不可用只读降级（D-05）；follower 投影同步 + fork protection；群消息/回执/编辑/撤回/线程；群附件加密。删除 plaintext decode、Sender Keys/SKDM 与 raw-text fallback；未知/旧格式 fail closed。
- **验收门**：三 Station 群聊 L3；成员进出后可解密集合正确；安全负例（伪造 Commit / 旧 epoch / 移除后解密）；100 人压力。
- **原子切换**：Sender Keys/SKDM/friend type50 在 P6 删除。

### P4 客户端 Runtime 归一
- **依赖**：P2、P3（能力就绪后统一收口）。
- **范围**：Desktop + Mobile 统一 `Gateway→Wire Adapter→Normalizer→Projection Reducer→Store→IM Runtime Supervisor→UI`；拆巨型模块（`socialChat.ts`/`socialRealtime.ts`/`ChatPage.tsx`/`group_chat/service.go`/`handler.go`）。页面禁止 mount-time fetch / 自建 timer / 自建 SSE / 管理密钥或 P2P 生命周期。遵守 `pt-desktop-runtime-projections`。
- **验收门**：`pt-frontend-component-tree-review` 通过；Desktop check/test/build、Mobile check 通过。

### P5 Chat UX 闭环
- **依赖**：P4。
- **范围**：先出可执行交互原型（`pt-prototype-design`），覆盖会话列表/空态/加载/错误/离线、时间线与滚动锚点、乐观发送与失败恢复、送达/已读、等待密钥/身份变化/安全警告、群邀请/入群/退群/踢人/解散、authority degraded、多设备提示、搜索/引用/线程/编辑/撤回、附件上传加密重试；Desktop 键鼠 + Mobile 长按/BottomSheet/键盘安全区。删 `ChatMessageArea.tsx.rej`。
- **验收门**：`pt-prototype-sync-guardian` 实现与原型一致；交互矩阵覆盖。

### P6 原子删除旧世界（D-11）
- **依赖**：P2、P3、P4、P5 的替代路径全部就绪。
- **范围**：删除 Sender Keys 全套、friend-chat type50、旧 key-exchange proto、friend pending map、group offline 双轨、重复 store 路径、`ChatMessageArea.tsx.rej`；验证 P2/P3 已删除旧 crypto fallback。旧聊天数据不做应用内迁移或删除，由单独审批的运维 SQL 清空（D-11）。
- **验收门**：全仓搜索旧符号（SKDM / SenderKey / type50 / pending map / plaintext decode / `crypto.dr_enabled` 等）**零活跃命中**；无兼容桥/双写/feature flag 残留；运维 SQL 执行后旧数据行数为零并留存脱敏证据；`pt-completion-auditor` 无过度声明。

### P7 全量验收
- **依赖**：P6。
- **范围**：同站 / 三 Station / 离线重启 / 多设备 / 成员进出 / authority 故障 / 安全负例 / 100 人压力 / Desktop+Mobile 交互矩阵；密钥泄漏扫描。
- **验收门**：`pt-quality-check` 汇总证据 + `pt-github-review` 判定可合并。

---

## 3. 与 G0 门的关系（明确哪些可先行）

| 相位 | 是否被 G0 阻塞 | 说明 |
|------|----------------|------|
| P0 契约冻结 | 否（MLS 信封字段可先按 D-08 形状定，opaque bytes 不依赖具体库） | 可先批先做 |
| P1 信封底座 | 否 | 可先批先做 |
| P2 私聊闭环 | 否 | 不用 MLS，可与 P1 后并行 |
| P3 群聊闭环 | **是** | 需 G0 通过 + MLS 库/版本批准 |
| P4/P5 | 部分 | 私聊部分可先行；群聊 UI 等 P3 |
| P6/P7 | 是 | 需全部替代路径就绪 |

---

## 4. 批准状态与推进项

### 已批准（2026-07-12）
1. **P0/P1 产品代码实施** — 已完成：conversation/envelope subservers + Desktop Tauri commands + TS service contracts + contract tests PASS。
2. **MLS 选库** — openmls 0.8.1 选定，已引入 Desktop Cargo.toml 产品依赖。
3. **压力预算** — 用户授权按默认阈值执行，C-7 已验证通过（裕量 ≥10×）。

### 当前执行授权（2026-08-01）
1. **P2/P3 严格加密收口** — 已批准；Desktop S1 为下一执行闭包，Mobile 与三 Station 门随后并行。
2. **P4 客户端 Runtime 归一** — 已批准但依赖未满足；P2/P3 完成前保持 BLOCKED。
3. **P5–P7** — 维持原依赖顺序，不提前启动。

### 2026-07-31 P2/P3 E2EE 激活切片

- **P2 / Desktop DM**：`X3dhSessionInit` 经既有 DKX opaque envelope 投递；接收端消费持久化
  SPK/OPK 后初始化 Double Ratchet。新消息发送强制先完成会话建立，`crypto.dr_enabled`
  默认 `true`，协商双方均支持时固定为 `v=1`；关闭 kill switch 时仍使用加密的 legacy
  chain-only sender，不启用明文发送。
- **P3 / Desktop group message path**：group send/edit 强制通过 OpenMLS application message；
  无本地 MLS state 时 fail closed。建群、加人、移除成员均生成并分发 Welcome/Commit。
- **已废止的临时兼容（2026-08-01）**：本切片曾保留
  `plaintext history decode → DR decrypt → legacy chain decrypt`。该行为与 D-11 冲突，
  已由下方严格切换修订取代，不再是允许的目标状态。
- **本切片证据**：X3DH→DR 双端 round trip、DR SQLCipher persistence + OPK single-use、
  OpenMLS create/add/remove/encrypt/decrypt 单测通过；Desktop Rust `cargo check` 通过。
- **Profile three live evidence（2026-07-31）**：
  - DM：两个独立 Desktop Rust gateway 完成 bundle 发布、X3DH、DR `v=1`、加密提交与接收端解密；
    Station 原样保存 102-byte opaque frame，明文泄漏检查为 false
    （conversation `d-c0ef931d01981a1c29460a7336a89760`）。
  - Group：两个独立 Desktop Rust gateway 完成 MLS identity、Welcome/join、application encrypt、
    Station commit 与接收端 decrypt；Station 原样保存 200-byte opaque application message，
    明文泄漏检查为 false
    （conversation `a23ab593-d7e1-4b64-aa0d-75247a8a6c0d`，membership epoch 1）。
- **未关闭门**：C-4/C-5 三 Station 下 membership epoch 与 MLS Commit 原子绑定/跨进程收敛
  仍是 `PARTIAL PASS`，不能据此声明完整 P3 或 P7 ready。
- **2026-08-01 closure evidence**：
  - SQLCipher 根因是 keyring-rs 未启用 native backend，macOS 实际使用 process-only mock。
    Desktop 已改为目标平台原生持久化 backend；backend regression 与 fresh actor
    create → native restart → reopen 同一 DB/key bundle 均通过。
  - `/conversation/direct` mutual-follow allow 已由 gate test 固化。
  - `/conversation/messages` GET query 的 snake_case 与 quoted numeric binding 已修复并由
    typed-handler test 固化；message list 同时返回 commit/edit/retract lifecycle events。
  - Desktop read/thread/settings/mutation 开始切到统一 conversation service，旧 session fallback
    与 UI-owned friend-request refresh timer 已移除；changed-path TypeScript diagnostics、
    social wire/runtime boundary、Rust check 均通过。
  - Profile `three` 已部署 `9eb590fb`，安全修复后升级到 `4dd517be`；远端 build metadata、
    container restart 与 health closure 均通过。
  - canonical DM live gate 通过：mutual-follow direct create、X3DH/DR `v=1`、send/edit/thread/retract、
    opaque-byte equality、receiver exact decrypt、thread count、unread/read cursor、member settings
    （conversation `d-cd5eff67494bb89ef67a4958e6846d1a`）。
  - canonical MLS live gate 通过：Welcome/join、send/edit/thread、member remove、epoch `1→2`、
    removed-member future decrypt/send/read 三项拒绝、opaque-byte equality
    （conversation `52cf3462-f7f4-4eab-991c-17415c66b72b`）。
  - Desktop App/Web MLS lifecycle command parity 已补齐；MLS provider state + original signer 作为
    actor-scoped SQLCipher blob 独立持久化。完整 process stop/start 后 DR 与 MLS deferred
    ciphertext 均 exact decrypt；profile key files 为 `0600`，profile storage plaintext scan
    零命中。
- **P4 hard blockers**：
  - Mobile 当前没有 X3DH/Double Ratchet 或 OpenMLS engine：DM 仍为 per-message sealed envelope，
    group 仍为 Sender Keys。Desktop + Mobile Runtime 归一在 Mobile P2/P3 完成前不可声明。
  - C-4/C-5 三 Station MLS membership/Commit 收敛仍未通过。

### 2026-08-01 严格加密切换修订（已批准）

- **用户决策**：不保留任何兼容路径；历史消息允许丢弃。
- **运行时合同**：
  - Direct 仅发布/接受 `supported_versions=[1]`，只运行 X3DH + Double Ratchet `v=1`。
  - Group 仅运行 OpenMLS application message，不接受 plaintext 或 Sender Keys。
  - 解码必须先验证协议信封；格式缺失、未知版本、旧格式与解密失败统一 fail closed，
    不把载荷尝试解释为明文。
  - 删除 `crypto.dr_enabled` 及所有 rollback/fallback 分支；回滚只依赖 Git/部署回滚。
- **历史数据合同**：
  - 应用不读取、不迁移、不重加密，也不执行历史数据删除。
  - P6 前旧行可以物理保留但对产品不可见；P6 使用单独审批、可审计的运维 SQL 清空。
  - 任何 SQL 清理必须先备份必要的非消息业务真源，并以表/字段白名单限定影响范围。
- **依赖修正**：P2/P3 严格加密门关闭前，P4 不得声明进行中或完成；P5 不得启动。

### 当前实施状态与下一执行闭包

| Phase | 状态 | 已有证据 | 关闭条件 |
|---|---|---|---|
| P0 | DONE | proto build / wire contract | — |
| P1 | DONE | conversation/envelope Station gates | — |
| P2 | IN PROGRESS | Desktop strict DR v1 S1 + live restart PASS | Mobile DR v1；跨站/多设备/吊销门 |
| P3 | IN PROGRESS | Desktop strict MLS S1 + removal/restart PASS | Mobile OpenMLS；C-4/C-5 三 Station；压力门 |
| P4 | BLOCKED | Desktop 部分 canonical migration | P2/P3 全部门关闭后执行 Desktop + Mobile Runtime 归一 |
| P5 | PENDING | — | P4 完成 |
| P6 | PENDING | — | P2–P5 替代路径完成；原子删旧世界 + 运维 SQL 清理 |
| P7 | PENDING | 单 Station Desktop 局部证据 | P6 完成后执行完整验收矩阵 |

**下一执行闭包：`P2/P3-S1 Desktop strict encrypted-only cutover`**

1. 删除 DM/group direct plaintext decode、DM `v=0`、raw-text fallback 与
   `crypto.dr_enabled` feature flag；bundle 仅声明 `[1]`。
2. 将 DM/group 解码统一为“验证信封 → DR v1/MLS 解密 → 验证
   `ChatEncryptedMessagePayload`”，任一步失败都只显示 decrypt-failed 状态。
3. 增加旧明文、`v=0`、未知版本、损坏密文的 fail-closed 负例；不得增加数据迁移或删除代码。
4. 运行 Desktop check/Rust tests、双 Rust gateway DM+MLS E2E、完整 stop/start recovery、
   Station opaque-byte equality 与本地/Station plaintext marker scan。
5. S1 关闭后，并行进入 `P2/P3-S2 Mobile DR/OpenMLS parity` 与
   `P3-S3 C-4/C-5 three-Station convergence`；两者完成后才进入 P4。

### 2026-08-01 `P2/P3-S1` 关闭证据

- Desktop DM/group 解码已删除 plaintext probing、DR `v=0`、raw-text fallback 与
  `crypto.dr_enabled`；Direct bundle 只发布 `[1]`。
- Rust 边界只接受 `negotiated_version=1`；chain-only Tauri/conversation 命令已删除。
  Desktop Sender Keys 前端与 Tauri 注册面已删除，dev HTTP gateway 在 dispatch 前 fail closed；
  Sender Keys 源码与表的物理删除仍属于 P6。
- 应用启动时的 `legacy_group_plaintext_wipe_v1` 已删除；历史数据不再由应用代码修改。
- `socialChat.strictCrypto.test.ts`：9/9 PASS，覆盖 plaintext、`v=0`、未知版本、损坏信封、
  raw decrypted bytes、旧命令面与应用内数据删除负例。
- Rust `cargo check --bin peers-touch-desktop` PASS；crypto binary tests 23/23 PASS。
- Profile `three` 两个独立 Rust gateway：
  - 旧 Sender Keys 命令返回 `NOT_FOUND`。
  - `crypto_init_session negotiatedVersion=0` 返回 `INVALID_ARGUMENT`。
  - 双端 session status 均为 `{established:true, version:1}`，fresh DR exact decrypt PASS。
  - fresh two-member MLS exact decrypt PASS。
  - 完整 stop/start 后 deferred DR 与 MLS ciphertext exact decrypt PASS。
- canonical `/conversation/command` 提交返回的 committed event 与客户端 DR envelope
  byte-for-byte 相等，第二客户端 exact decrypt PASS
  （message `fb7610c3-3fcf-44d6-8f27-1d3add3d6a18`）。
- bundle fetch 只返回 `supported_versions:[1]`；profile plaintext marker scan 零命中，
  SQLCipher key files `0600`，transient MLS state files 为零。
- Desktop social wire/runtime boundary gates PASS。完整 `pnpm run check` 仍因仓库既有
  React 18/19 `ReactNode` 类型重复、MessageList prop 与 provider typing 基线错误 FAIL；
  本切片改动文件未新增诊断。
- **P4 已知缺口**：dev HTTP gateway 尚未注册 `conversation_list_messages` 等完整 canonical
  read command parity；S1 使用 Station committed response 完成 opaque-byte 证据，不把该缺口
  误报为 P4 已完成。P4 Runtime 归一时必须补齐并删除旧 read command。

**下一执行闭包（可并行）**

1. `P2/P3-S2 Mobile DR/OpenMLS parity`：以同一 proto/wire 合同替换 Mobile sealed-envelope
   DM 与 Sender Keys group runtime。
2. `P3-S3 C-4/C-5 three-Station convergence`：补齐 membership epoch / MLS Commit
   原子绑定、跨进程收敛与移除后安全负例。

### 2026-08-02 Desktop 证明优先级修订（已批准）

- **顺序调整**：Mobile 实施后移；先关闭
  `P2/P3-S1.1 Desktop multi-worktree E2E`，不得用同一 worktree 的 App/Web
  证据代替独立 worktree 证明。
- **代码同源**：`peers-chat-high-chat` 作为 source commit；
  `peers-group-chat` 在独立 E2E branch 上检出同一 commit，不合并或覆盖其历史分支。
- **环境拓扑**：
  - high-chat 保持 Profile `three` slot 2。
  - group-chat 使用独立 slot/profile，但 `PT_STATION_URL` 同为
    `http://10.37.94.156:18080`，且不重复部署 Station。
  - Station 只从 high-chat 执行 `make station`。
- **客户端矩阵**：两个 worktree 均启动 `make desktop` 与 `make desktop-web`
  （4 个独立 Rust gateway / storage scope）。
- **账号矩阵**：使用 Profile `three` 预置账号 `a`、`b`、`c`
  （产品证据别名 Alice、Bob、Third）。
- **DM 门**：
  - Alice→Bob、Bob→Alice、Alice→Third fresh X3DH + DR v1。
  - Station committed payload byte equality、receiver exact decrypt、replay rejection。
  - 四客户端中至少一条跨 worktree App↔App、一条 App↔Web、一条 Web↔Web。
- **Group 门**：
  - Alice 建三人 MLS group，Bob/Third 处理 Welcome。
  - 三方 application message exact decrypt；跨 worktree App/Web 均覆盖。
  - remove Third 后 epoch 前进；Third future decrypt/send/read 均拒绝。
- **Restart 门**：四个 Desktop runtime 全停后重启，deferred DM/MLS ciphertext exact decrypt。
- **存储门**：四个 profile storage plaintext marker scan 零命中；key files `0600`；
  transient MLS state files 为零。
- **后续顺序**：S1.1 关闭后再进入 Mobile parity；C-4/C-5 three-Station
  convergence 仍须在 P4 前关闭。

---

## 5. 声明

- P0/P1 已关闭。
- P2/P3 只有 Desktop 单 Station 主路径具备真实证据；严格单路径、Mobile 与三 Station 门未关闭。
- P4 被 P2/P3 阻塞，当前不得声明 P4 或后续相位完成。
