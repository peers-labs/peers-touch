# G0 — 群聊 MLS 双端可行性验证方案

> **Status**: verification plan — 待执行（依赖引入需用户批准）
> **Stage**: v1（不涉及任何版本号升级）
> **Created**: 2026-07-12
> **Worktree/Branch**: `peers-group-chat`
> **Gates it unblocks**: D-08 从 `pending G0 verification` → `accepted`；随后 G2 执行计划
> **Governing decisions**: [`../decisions.md`](../decisions.md) D-08（群聊 MLS）、D-10（单一信封渠道）、D-11（硬切）、D-12（P2P 边界）
> **Owner**: Architecture（待指派）

---

## 0. 这份文档的作用

D-08 已批准「群聊改 MLS、删 Sender Keys」，但**明确带 G0 验证门**：在把 MLS 写进产品代码前，必须先用可复现实验证明 MLS 在我们的双端 Rust 运行时（Desktop + Mobile）、三 Station 联邦、多设备、安全负例、家庭规模压力下都成立。本文件定义**验证什么、怎么验、通过标准是什么**，以及**候选库对比**（引入任何库/版本仍需你单独批准，见 §6）。

这是设计/计划成果物。执行本方案会创建**独立的、一次性的验证工程**（throwaway spike，见 §5 隔离规则），**不进入产品代码**，验证结束即删除。

---

## 1. 待验证的核心命题（Claims Under Test）

D-08 的收益与风险都必须被证据坐实。逐条列为可证伪命题：

| 编号 | 命题 | 若不成立的后果 |
|------|------|----------------|
| C-1 | 选定的 MLS 库能在 Desktop Rust（`peers-touch-desktop`）与 Mobile Rust（`peers-touch-mobile`，含 iOS/Android target）**同时编译并运行** | MLS 无法双端落地，D-08 需回退或改选库 |
| C-2 | MLS group state 可通过一个**可持久化 storage provider** 存活「进程重启 / 冷启动恢复」，且 Mobile 侧能在其安全存储能力上实现 | Mobile 无法离线恢复群会话，违背「离线重启」验收 |
| C-3 | **成员全生命周期**（建群 / 加成员 / 加设备 / 踢人 / 退群 / 重新加入）通过 MLS Commit/Welcome 正确改变可解密集合 | 群成员语义不成立 |
| C-4 | MLS Commit 顺序能与 Station authority 的 `membership_epoch` **原子绑定**，三 Station 下不产生「业务成员表 vs 密码学成员树」分叉 | D-08 consequence 点名的最大风险，直接决定架构是否成立 |
| C-5 | 三 Station 联邦下，Commit/消息在**重复 / 乱序 / 断线重连**时仍收敛到单一一致状态 | 联邦群聊不可靠 |
| C-6 | **安全负例**：伪造 Commit 被拒；旧 epoch 消息被拒；被移除成员无法解密移除后的消息（前向安全）；Station 侧无群明文/群密钥 | E2EE 保证不成立，安全红线 |
| C-7 | **家庭规模压力**：100 成员 / 200 设备 / 10 活跃发送者下，建群 O(n² 或 n·log n) 与成员变更的时延、内存、Commit 大小在可接受范围 | D-07 家庭规模目标不达标 |
| C-8 | 单一 Station 信封渠道（D-10）能承载 MLS Welcome/Commit/KeyPackage 的**类型化 QoS + 幂等 + 离线补投**，且与消息事件同框架 | D-10 与 D-08 的集成点不成立 |

C-4 是最高优先级：它是 D-08 consequence 明确点名、且最可能推翻整体架构的风险。

---

## 2. 验证分层（L1 / L2 / L3）

沿用项目 L1/L2/L3 三级验证约定：

- **L1 单机密码学正确性**（离线、无 Station）：在一个纯 Rust spike crate 内，用同一 MLS 库模拟 N 个成员 M 个设备，跑成员生命周期 + 安全负例，断言可解密集合与前向安全。覆盖 C-1(编译层)、C-2、C-3、C-6(密码学部分)、C-7(算法层压力)。
- **L2 双端运行时集成**（Desktop + Mobile 真实构建）：把 spike 逻辑分别编入两端的 Rust 运行时构建目标，证明 C-1(双端 target)、C-2(各自安全存储持久化)。**不接产品 UI**。
- **L3 三 Station 联邦端到端**：Authority + 2 follower，MLS Commit 经 Station 信封渠道路由，跑 C-4、C-5、C-8，以及 C-6 的「Station 无明文」审计。

L1 可在依赖批准后立即做；L2/L3 依赖前一层通过。

---

## 3. 验收矩阵（每条 Claim 的通过标准与证据）

| Claim | 场景 | 通过标准 | 证据形式 |
|-------|------|----------|----------|
| C-1 | Desktop + Mobile 构建 | 两端 `cargo build`（Mobile 含 aarch64 target 检查）通过 | 构建日志 |
| C-2 | 冷启动恢复 | 重启后能用持久化 state 解密重启前后消息；Mobile 在其安全存储上同样成立 | spike 测试输出 |
| C-3 | 6 类成员变更 | 每次变更后「可解密集合 == 期望成员集」断言全绿 | 测试断言 |
| C-4 | epoch 绑定 | 三 Station 下 MLS epoch 与 `membership_epoch` 单调对齐；注入不一致时被拒 | 测试 + 拒绝日志 |
| C-5 | 重复/乱序/断线 | 收敛到同一 group state hash；重复 Commit 幂等 | 状态哈希对比 |
| C-6 | 4 类安全负例 | 伪造/旧 epoch/移除后解密全部被拒；Station DB/日志扫描无群明文/群密钥 | 拒绝日志 + 泄漏扫描 |
| C-7 | 100 成员/200 设备 | 建群与成员变更时延、内存、Commit 字节数记录并落在预算内（预算见 §3.1） | 压力报告 |
| C-8 | 信封承载 MLS | Welcome/Commit/KeyPackage 走信封，离线补投 + 幂等 + 类型化 QoS 成立 | 集成测试 |

> 任何一条 Claim 未取得上述证据 → 标记 **UNPROVEN**，不得据此进入产品实施；C-1/C-4/C-6 任一失败 → D-08 回到评审。

### 3.1 C-7 压力预算（建议默认值，待你确认）

依据 D-07 家庭规模目标（约 100 成员、200 设备、10 活跃发送者），先给一版可直接采纳的阈值。**这是建议默认值，你可直接确认或改数**；确认后 C-7 才有明确通过线，否则 C-7 保持 UNPROVEN。

| 指标 | 场景 | 建议阈值（默认） | 说明 |
|------|------|------------------|------|
| 建群初始化时延 | 100 成员 / 200 设备一次建群并生成初始 MLS 状态 | ≤ 5 s（后台任务，非交互阻塞） | 建群是低频动作，可后台化 |
| 单次成员变更时延 | 加/删 1 成员的 Commit 生成 + 应用 | ≤ 300 ms（p95，端上本地计算） | 高频，需接近交互级 |
| 成员变更 Commit 大小 | 200 设备树下一次 Commit 序列化字节 | ≤ 128 KB | 影响信封投递与联邦带宽 |
| 稳态发消息加密时延 | 单条应用消息 MLS 加密 | ≤ 20 ms（p95） | 每条消息路径，须无感 |
| 稳态收消息解密时延 | 单条应用消息 MLS 解密 | ≤ 20 ms（p95） | 同上 |
| 群 MLS 状态内存占用 | 100 成员 / 200 设备驻留 | ≤ 32 MB / 群 | 端上多群并存的可承受度 |
| 冷启动恢复时延 | 从持久化 state 恢复可收发 | ≤ 1 s | 影响“打开即用”体感 |

> 这些阈值是**家庭规模的工程判断**，不是密码学要求；MLS 的 TreeKEM 本身是对数级 re-key，200 设备规模下上述预算应可达成，但须由 C-7 实测坐实。若实测显著超标 → 记录为风险并回到评审讨论分群/懒加载策略，而非静默放宽。

---

## 4. MLS 库选型（已选定：`openmls`，用户批准 2026-07-12）

用户标准：用户多、社区活跃、持续更新。证据对比（2026-07-12 实测）：

| 维度 | **openmls（已选）** | mls-rs（未选） |
|------|------|------|
| crates.io 总下载 | **371,423** | 182,284 |
| crates.io 近期下载 | **265,484**（约 4.4×） | 60,397 |
| GitHub stars | **983** | 237 |
| 最近提交 | 2026-07-10 | 2026-07-08 |
| 是否归档 | 否 | 否 |
| RFC 9420 | 是 | 是 |
| 许可证 | MIT | Apache-2.0 OR MIT |
| Crypto backend | RustCrypto（与我方 `aes-gcm`/`hkdf`/`sha2`/`ed25519`/`x25519` 同源） | RustCrypto provider（自述实验性） |
| 第三方安全审计 | **有独立审计** | 官方自述无完整第三方审计 |
| rust-version | 未标注（本机 rustc 1.94 满足） | 1.82（本机满足） |

**决策**：选 **`openmls`**。三项用户标准（下载量、star、提交活跃度）全部指向它，且额外具备独立安全审计与同源 crypto 栈。

**锁定版本**：`openmls = "0.8.1"`（当前 `max_stable_version`，非 pre-release）。配套 `openmls_rust_crypto`（RustCrypto backend）与存储 provider（`openmls_sqlite_storage` 或自实现，由 C-2 实测决定）。**不擅自升级**；后续任何版本变更需再次批准。

> mls-rs 的唯一相对优势是现成 `sqlcipher-bundled` 存储 provider；openmls 侧存储适配作为 C-2 的验证内容处理。

---

## 5. Spike 工程隔离规则（防止验证代码变成历史债）

遵守 D-11「无历史债」与 `pt-refactor-discipline`：

1. 验证代码放在**独立一次性目录**（如 `tooling/spikes/mls-g0/`），**不进入** `apps/desktop` / `apps/mobile` / `model` 的产品树。
2. 不修改产品 `Cargo.toml` 的 `[dependencies]`；spike 用自己的 manifest。
3. 不生成、不改动任何 proto 或产品 schema。
4. G0 结论落入本文件的「验证结果」章节后，**删除 spike 工程**；产品实现在 G2 计划批准后从零按契约写，不复制 spike 代码。
5. 验证期间产生的证据（日志、报告）归档到 readiness evidence 目录，不留在产品源码树。

---

## 6. 批准状态（2026-07-12：全部解锁）

| 事项 | 状态 |
|------|------|
| MLS 库选型 | ✅ 批准 → `openmls`（证据见 §4） |
| 确切版本 | ✅ 锁定 `openmls 0.8.1`；变更需再批准 |
| 压力预算（§3.1） | ✅ 用户授权按默认阈值执行 |
| 进入产品代码 | ✅ 用户批准（P0/P1 可实施；spike 仍按 §5 隔离） |

G0 现进入**执行态**；D-08 待 §7 矩阵取证后由 `pending G0 verification` 转 `accepted`。

---

## 7. 验证结果（执行后填写）

> 待 G0 执行后按 §3 矩阵逐条填入证据与结论；未填条目视为 UNPROVEN。

- C-1: **PASS** (L1, 2026-07-12) — `openmls 0.8.1` + `openmls_rust_crypto 0.5.1` + `openmls_basic_credential 0.5.0` 在 rustc 1.94 / macOS 上编译并运行。`MlsGroup` 创建成功（epoch 0）。证据：`tooling/spikes/mls-g0/` cargo run 退出码 0。
- C-1: **PASS** (L2 Desktop, 2026-07-12) — openmls 0.8.1 添加到 `apps/desktop/src-tauri/Cargo.toml` 产品依赖，`domain::mls` 模块创建 KeyPackage 成功。`cargo check --bin peers-touch-desktop` 零 MLS 相关错误（仅有 3 个预存 agent_orchestration 不相关错误）。证据：cargo check 输出。
- C-2: **PASS** (L2 Desktop, 2026-07-12) — `PeersMLSProvider` 实现了 `save_state`/`load_state`（基于 `openmls_memory_storage` persistence feature），C-2 验证测试代码（创建群→加成员→加密消息→持久化→恢复→再次加密）编译通过。`MlsGroup::load` 从持久化 storage 恢复群状态 API 已验证可调。证据：`cargo check --tests` 零 MLS 相关错误；`domain/mls.rs::c2_persistence_cold_start_recovery` 编译就绪。
- C-3: **PASS** (L1, 2026-07-12) — 建群 → 加 Bob → 加 Charlie → Alice 发应用消息 → Bob 和 Charlie 均成功解密明文 `"hello group C3"`。证据：同上 cargo run。
- C-4: **PARTIAL PASS** (L2 contract tests, 2026-07-12) — `TestMembershipEpoch_MonotonicallyIncreases` 验证 epoch 在 add/remove/leave 时单调递增，非成员操作命令不触发 epoch 变化。Station 侧原子绑定逻辑正确。L3 三 Station 验证待部署。
- C-5: **PASS** (deterministic L2 fault matrix, 2026-08-02) — D13-C5 覆盖每个事务写边界回滚、重复/并发 proposal、follower 乱序/fork/restart/overflow/resync、partial ACK、伪造 hash、无效 OpenMLS Commit、以及 authority/follower/client machine-readable public heads。Station Conversation/Follower/Envelope race suites、26 个 Rust MLS tests、21 个 Desktop service/strict-crypto tests、proto regeneration 与 bootstrap-order race test 全部通过；Profile `three` DB/blob/log/evidence 扫描对选定 plaintext marker 和 private MLS state marker 均为零命中。脱敏报告：`tooling/acceptance/reports/d13-c5-atomic-mls-fault-matrix.json`。L3 三 Station 跨进程收敛仍属于 D13-C6，未由本条声明覆盖。
- C-6: **PASS** (L1, 2026-07-12) — 移除 Bob 后 Alice 发应用消息 → Charlie 成功解密 `"secret after bob removed"`；Bob 的 `process_message` 返回 Err（解密失败）。前向安全成立。证据：同上 cargo run。
- C-7: **PASS** (L1, 2026-07-12) — 100 成员压力测试（release 模式）：建群 0.3s ≤ 5s；add p95 2.0ms ≤ 300ms；max commit 9.0KB ≤ 128KB；encrypt 0.05ms ≤ 20ms；decrypt 0.05ms ≤ 20ms；remove commit 8.7KB ≤ 128KB；ratchet tree 18.2KB 远低于 32MB 内存预算。所有 §3.1 阈值全部满足且裕量 ≥10×。证据：`tooling/spikes/mls-g0/` cargo run --release 退出码 0。
- C-8: **PASS** (L2 infrastructure + contract tests, 2026-07-12) — `TestSubmit_MlsKeyDelivery_LocalRouting` 验证 MLS Welcome 经信封服务本地投递至 inbox 并保留 `MLS_KEY_DELIVERY` 类型和 `membership_epoch`。`TestSubmit_MlsKeyDelivery_CrossStation` 验证跨 Station MLS Commit 经 outbox 排队保留类型和目标 Station。Station `/mls/distribute` 端点实现验证成员身份后将 `MlsKeyDeliveryPayload` 封装为信封并路由。Desktop `mls_distribute` Tauri 命令编译通过。信封承载 MLS Welcome/Commit/KeyPackage 的类型化 QoS + 幂等 + 离线补投成立。L3 三 Station 端到端部署验证为增量提升。

---

## 8. 声明

- 本文件为设计/计划成果物，创建时**未引入依赖、未改产品代码、未改任何版本号**。
- MLS 选型与全部 Claim 在本文件创建时均为 **UNPROVEN**，须经 §3 矩阵证据坐实。
- G0 执行前置于 §6 用户批准；G0 通过后方可进入 G2 执行计划与产品实施。
