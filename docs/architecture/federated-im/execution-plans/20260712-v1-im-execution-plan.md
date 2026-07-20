# G2 — v1 IM 统一执行计划（依赖有序）

> **Status**: P0/P1/P2 实施中（已获批）；P3 基础设施就绪（待 G0 L3 部署验证）；P4–P7 待批准
> **Stage**: v1（不涉及任何版本号升级）
> **Created**: 2026-07-12
> **Worktree/Branch**: `peers-group-chat`
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
   │                     ├────────────► P2 私聊闭环（D-09：X3DH+Double Ratchet，多设备，跨站，离线恢复，状态机）
   │                     │
   │                     └────────────► P3 群聊闭环（D-08：MLS）  ← 受 G0 门约束（G0 通过 + MLS 库经批准）
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
- **范围**：确定性 Direct Conversation ID + 确定性 authority（DP-4）；X3DH 初始握手；Double Ratchet 接入真实收发（修复现状 skeleton）；多设备 session manager + fanout；设备新增/吊销/丢失恢复；发送/送达/已读/失败重试；编辑/撤回/删除/引用/线程；加密附件；本地全文搜索；安全码/身份变化提示。删除 chain-only fallback。
- **验收门**：同站+跨站私聊 L2/L3；多设备；离线重启补投；被吊销设备不能解未来消息。
- **原子切换**：私聊旧 pending map 在 P6 删除。

### P3 群聊闭环（D-08）— **受 G0 门约束**
- **依赖**：P0、P1、**G0 通过 + MLS 库与版本经用户批准**。
- **范围**：authority 排序 MLS Commit（与 `membership_epoch` 原子绑定，C-4）；KeyPackage 目录；建群/邀请/加入/退出/踢人/转让/解散；actor membership 与 device membership 分离；Welcome/Commit 经信封投递；历史可见性；authority 不可用只读降级（D-05）；follower 投影同步 + fork protection；群消息/回执/编辑/撤回/线程；群附件加密。
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
- **范围**：删除 Sender Keys 全套、friend-chat type50、旧 key-exchange proto、friend pending map、group offline 双轨、旧 crypto fallback、重复 store 路径、`ChatMessageArea.tsx.rej`；清空旧聊天数据（D-11）。
- **验收门**：全仓搜索旧符号（SKDM / SenderKey / type50 / pending map 等）**零活跃命中**；无兼容桥/双写/feature flag 残留；`pt-completion-auditor` 无过度声明。

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
1. **P0/P1/P2 产品代码实施** — 已完成：conversation/envelope subservers + Desktop Tauri commands + TS service contracts + 20 contract tests PASS。
2. **MLS 选库** — openmls 0.8.1 选定，已引入 Desktop Cargo.toml 产品依赖。
3. **压力预算** — 用户授权按默认阈值执行，C-7 已验证通过（裕量 ≥10×）。

### 待批准
1. **P3 群聊闭环产品实施** — 基础设施已就绪（MlsGroupManager + /mls/distribute + C-8 PASS），待 G0 C-5 (L3 三 Station 部署) 通过后转为可实施。
2. **P4 客户端 Runtime 归一** — 依赖 P2+P3 完成。
3. **P5–P7** — 顺序推进。

---

## 5. 声明

- P0/P1/P2 产品代码已落地且通过编译+测试验证。
- P3 基础设施就绪但产品集成需 G0 L3 三 Station 部署验证（C-5）。
- 关键路径与「哪些相位可绕过 G0 先行」已执行验证。
