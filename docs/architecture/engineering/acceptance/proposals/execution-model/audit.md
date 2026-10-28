# Gate 执行重复盘点

> **Status**: draft
> **Authority**: non-normative
> **Created**: 2026-10-22 | **Updated**: 2026-10-22
> **Owner**: Acceptance

## 结论与证据范围

源码基准为 `d6466fddf658676dcb2ee80dfd6ec3bf19c6fb99`；
其父提交为 `0129dae50ce57b66101d8aed4f6d93a15c9c6e1b`。
PR #150 含一个提交、426 个变更文件，GitHub 返回 MERGEABLE，仍为 Draft。
这只是 Git 合并状态，不代表产品或发布就绪。

本轮对全部 234 个 Catalog 定义做命令与启动字段归组，聚焦阅读 Access、
Chat、Moments 三个 Task 的 33 个 Gate 入口及相关 Runner、Suite 与判定逻辑。
没有完整审查全部 234 个实现，也没有运行这些产品 Gate。

以下标记含义：

- **源码事实**：由当前代码或合同直接确认。
- **推断**：由调用边界推导，未经过运行计量。
- **提案**：目标结构，尚未实施。
- **未证明**：缺少对应现场或证据，不能报告 PASS。

## A1：功能和证明执行重复

**源码事实**：`tasks/R001-05-CHAT.md:6` 的
`release-chat-functional` 与 `release-chat-proof` 使用逐字相同的命令，
含同一 runtime cell 和相同顺序的 19 个 Gate。
`tasks/R001-06-MOMENTS.md:6` 的两项检查同样重复 5 个 Gate。
这里的 Task 路径前缀为
`docs/architecture/engineering/acceptance/execution-plans/20261017-release-0.0.1-mobile-ios-desktop/`。

两项检查的 ID/verificationClass 不同，但 CLI 没有相应执行模式差异。
**推断**：如果两项都执行，就分别选择 38 次 Chat、10 次 Moments Gate；
这些是选择次数，不是实际客户端启动数或耗时。

**提案**：开发阶段执行一条聚焦真实 Journey；正式闭环另运行选定的正式生产者。
正式生产者本次产生的基础、交互等断言供多个 Gate 使用。
不能在开发结束后把不具备正式取证合同的记录重新标成 ACCEPTANCE_PROOF。

## A2：不同 Gate 标签重复完整 interactions 流程

**源码事实**：

- `gates.yaml:227-247` 与相应 lifecycle 定义都启动 `native_interactions_runner`。
- `chat/native_interactions_runner.py:2734-2913` 无条件执行 Direct、Group、
  timeout/retry、offline、Station restart、成员移除与设备撤销等流程。
- `:2930-2935,2972-2988` 通过子类改变 Gate/phase/spec/journey 标签，
  不改变上述运行体。

这两个入口是 `chat-native-interactions-e2e` 与
`chat-lifecycle-interactions-group-e2e`。
**提案**：一份场景生产证据，两个判定视图引用各自需要的 assertion。
如果随后合同要求不同平台或故障条件，则形成不同 case，而非复用标签。

## A3：资源复用边界留在 Gate 内

**源码事实**：`tooling/scripts/acceptance-run.py:2191-2244` 在 Gate 循环内
创建 run、provisioner 和 runtime-cell 状态；
`:2294-2317` 准备环境，`:2564-2597` 在同一迭代内停止和清理。
共享 environment ID 并没有将这些迭代连接为一个 Suite。

例如 Chat 的五个 mixed Gate 使用 `chat-mixed-native`，
四个 Mobile 场景使用 `mobile-direct-simulator`，仍分别进入外层生命周期。
**推断**：这会重复生命周期调用；准备器内部是否复用构建缓存、
真实部署/启动发生多少次，必须测量，不能从循环直接推出。

现有 `core/suite_runtime.py:208-334` 已能拒绝 Scenario-owned provisioning、
重复资源事件和重复 Scenario。它是账本，不负责启动或拦截未记账的实际动作。
这是既有 D-21 在外层组合的缺口，不是“没有 Suite 架构”。

## A4：Mobile 普通登录夹带恢复和其他域前置

**源码事实**：`mobile/messaging_journey.py:60-116` 认证后调用
`_activate_authenticated_shell`；`:827-849` 无条件调用
`lifecycle.restart`，要求 scope 为 `webview`，随后等待身份和 Social 就绪。

普通 Chat 登录准备因此还执行恢复行为并依赖 Social。
**提案**：普通准备等待真实 Access/Messaging readiness；
Social readiness 只属于使用 Social 的节点。WebView 重启属于有独立恢复断言
的 case。不能仅删重启：先查清首次登录就绪链路并验证其无需重启。

## A5：Access 有共享正向断言，也有独立故障语义

**源码事实**：`station_access/auth_e2e.py:124-225` 与
`scope_isolation_e2e.py:82-159` 都检查同 Actor 跨 Desktop/iOS、
不同设备身份和重启后的身份/scope 保持。

应复用这部分共同场景；以下独立检查仍保留：

- 认证前签名 Station binding。
- logout 后旧 scope 不可用、切换另一 Actor 的隔离。
- OAuth loopback、取消与 provider 约束。
- Session class coexistence、同 class takeover 与前任撤销。
- 路线续订、撤销状态清理和不同 Station scope。

`session_class_suite_e2e.py:193-480` 用消息观察共存、接管后的存活端、
被撤销前任的行为。这里后续消息发生在接管前后不同状态，属于必要探针；
旧消息已送达不能代替接管后的断言。
其中普通 same-station baseline 与首次 coexistence 场景的相邻收发可由同一次
受控收发联合证明，前提是身份/class 及双方可见结果都被显式捕获。

## A6：相同入口可能只是不同证据消费者

**源码事实**：

- `social/desktop_private_e2e.py:109-133` 与
  `social/cross_station_native_e2e.py:26-46` 读取同一 CSS-09 Suite，
  分别判断 same-Station 和 cross-Station 结果；不重新执行 Journey。
- 全 Catalog 启动字段归组找到 `RAL-G02..RAL-G08` 同入口，以及两个 Relay
  aggregate 同入口。`relay_attachment_lifecycle_e2e.py:917-935` 和
  `relay_aggregate.py:149-171` 按 Gate ID 选择不同证据投影/集合。
- release operation analysis 和 release aggregate 读取已有不可变证据。

这些条目不应因命令相同就删除或合并判定。Catalog 归组是审查提示，
语义去重必须追到 producer、case 和 assertion。

## A7：加密证明须按能力拆开

**源码事实**：`chat/native_two_client_runner.py:1123-1143` 先观察接收 UI
的正确明文与同 message ID，再以 `lambda: True` 记录 `message.decrypted`。
正确明文观察支持该条消息的端到端成功路径；这个步骤名没有增加另一项密码学断言。
仅有发送 API 成功，连这项接收证明也不成立。

Direct、MLS、附件、Social 私密内容采用不同状态和协议，不能互相代证。
来源示例：

- `social/cross_station_prekey.py` 验证远端 PreKey admission、replay 和计划隔离，
  并明确将原生接收可见性列为 unprovenScope。
- `social/cross_station_revocation_recovery.py` 检查 tombstone/recovery 合同，
  同样不宣称 Native revocation 或 Bob2 recovery 已可见。
- Station 的 `TestFederatedContentPreKeyPeerClaimsBindRequest`、
  `TestFederatedPrivateTombstoneRejectsStaleDeliveryWithoutResurrection`
  分别针对身份约束和撤销后防复活；正常收发不能覆盖这些条件。

**提案**：先执行本次上层能力确实依赖的身份/密钥/协议基础证明，再运行业务。
不把“全部安全专项”设为所有场景的统一前置。

## A8：现有流水线审计无法证明实际执行图复用

**源码事实**：`acceptance-pipeline-audit.py:174-218` 校验 runtimeReuse schema
和唯一 FUNCTIONAL_CHECK 入口，没有解析该入口命令的 Gate/producer 图。
历史审计结果为 contract PASS、runtimeReports 空、proofState NOT_RUN。
本轮对相关 Task 和上述核心代码与审计快照的 blob 比较无差异。

本轮重跑 pipeline auditor 时，其 `planctl inspect` 子进程在 30 秒 deadline
内未结束，返回 ACCEPTANCE_PIPELINE_AUDIT_INPUT_INVALID/FAIL/UNPROVEN。
本次没有得到新的 pipeline PASS；超时原因尚未定位，不从中推断产品故障或
复用失败。上述 A1/A2/A3 来自直接源码检查，不依赖该审计通过。

因此 contract PASS 不能排除 A1/A2/A3，也不能说明账本未覆盖的动作没有发生。
新设计需要声明、编译图、实际调用计量三者一致的检查。

## 与 P1 闭环的关系

现有源码发现仍需修复及原生复现，不因 Gate 去重而消失：

- `apps/mobile/src/pages/moments/MomentCommentsSection.tsx`：
  失败后编辑内容/回复仍复用不可变 draft revision，导致持续冲突。
- `apps/mobile/src-tauri/src/messaging/engine.rs:3768-3771`：
  command-plan convergence 通过无 observer drain 消费/确认 Inbox，
  后续 worker 无法补发已经消费的其他会话投影通知。
- `apps/mobile/src-tauri/src/messaging/adapter.rs`：
  清理把 superseded attempt 当终态，可能删除仍需重准备的互动目标。
- `apps/mobile/src-tauri/src/social/mod.rs:1881-1902`：
  重复验收 prepareKeys 对既有恢复 epoch 生成不同随机 master，破坏热复用。

同设备恢复、旧异步读取回填、身份缓存/搜索范围 fencing 等既有 P1 候选保留；
未经逐项复核，不能宣称 PR 的所有 P1 已关闭。

## 未证明范围

没有当前源码的 Gate 耗时、启动次数、真实热复用率、原生产品回归或完整发布 PASS。
本盘点不修改历史 manifest，不将缺失断言、Harness readback 或步骤标签升格为 UI 证明。
