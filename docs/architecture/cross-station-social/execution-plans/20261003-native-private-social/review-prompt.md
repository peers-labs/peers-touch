# Cross-Station Private Social Plan Review Prompt

> **Status**: active
> **Version**: v1.4
> **Created**: 2026-10-03 | **Updated**: 2026-10-03
> **Owner**: Social / Federation

---

你是 Peers-Touch 执行计划评审专家。请审阅 Native Desktop 跨 Station 私密
Social 计划，不要评审或扩展到其他产品域。

## 计划背景

当前同 Station 私密 Moments 已在 Native Desktop 证明。下一步只补齐同一 active
Federation 内两个 Home Station 之间的私密 Post、媒体、Comment、Reaction、恢复和
撤销，并复用现有 Federation transport、Key Exchange 与 Secure Content。

## 上游产品与架构

- `docs/architecture/social/product-definition.md`
- `docs/architecture/social/experience-contract.md`
- `docs/architecture/social/product-state-model.md`
- `docs/architecture/social/acceptance-matrix.md`
- `docs/architecture/social-runtime/decisions.md`
- `docs/architecture/cross-station-social/design.md`
- `docs/architecture/cross-station-social/decisions.md`
- `docs/architecture/cross-station-social/data-model.md`
- `docs/architecture/cross-station-social/integration.md`
- `docs/architecture/secure-content/README.md`
- `docs/architecture/secure-content/decisions.md`
- `docs/architecture/api-ownership/decisions.md`
- `docs/architecture/federation/README.md`
- `docs/global/domain-model.md`
- `docs/client/desktop/global-context-kernel.md`
- `docs/client/desktop/runtime-projections.md`
- `docs/architecture/i18n/i18n-architecture.md`
- `docs/architecture/runtime/unified-handler-architecture.md`
- `docs/architecture/realtime/event-stream.md`
- `docs/global/coding-guide/desktop/kernel-events.md`
- `docs/architecture/storage/unified-runtime-storage-architecture.md`
- `docs/global/coding-guide/desktop/page-component.md`
- `docs/global/coding-guide/common/logging.md`
- `docs/architecture/acceptance-framework/README.md`
- `docs/architecture/acceptance-framework/domain-onboarding.md`

## 计划路径

`docs/architecture/cross-station-social/execution-plans/20261003-native-private-social/plan.md`

## 评审重点

1. 计划是否严格限制为 Human private Social，未引入与需求无关的泛化领域层。
2. 十四个 Task Slice 是否都能在 2-4 小时内形成独立可用或内部闭环版本；
   `CSS-02A/B/C/D` 是否分别闭合远端 admission、单好友文本、Group snapshot/fence
   和混合/Group 受众，
   而不是一个过大的协议/服务/UI 批次。
3. 每个单元是否严格对应一个可构建、可回滚的 Conventional Commit。
4. 中间单元是否只跑 focused checks + 当前/前序 Journey，未要求全量 Gate。
5. 最终单元是否只跑 Social/API ownership/Browser boundary 专项 Gate。
6. `secure_content/prekey.proto` 与 `key_exchange.proto` 的职责是否正确区分。
7. Source Social、recipient projection、Federation transport、Key Exchange 的
   authority 是否单一且无反向依赖。
8. Comment 是否完整覆盖 prepare、submit、exact replay 和 source revalidation。
9. 大对象是否只通过 source-authorized ciphertext peer stream，而非 durable frame、
   public URL 或客户端直连。
10. Mobile 是否只有共享 proto 生成兼容，且无产品实现或 readiness 声明。
11. Tauri embedded React 是否保留，同时 browser-gateway Social 注册被彻底移除。
12. 十四个 Task Slice 串行是否与共享 contracts、Social authority 和同一运行环境一致。
13. AS17..AS24 是否覆盖成功、网络错误、超时、非法输入、取消、重启和清理。
14. `design.md` §2 是否逐项裁决 `AAR-C01..C10`，每项具备 trigger、owner、
    disposition、integration、no-parallel-truth 和 evidence；任何缺项或无依据的
    `not_applicable` 均阻断。
15. Social 事件与 projection freshness 的权威契约是否只存在于 `design.md`
    §4.1；Plan traceability 与各 Task 是否只引用它且没有语义漂移。
16. 所有好友 Post、Comment、Reaction、删除、关系变化、撤销和 resync 是否从
    已提交事实进入统一 typed EventBus，再由唯一 `momentsRuntime` owner 更新
    projection；禁止页面刷新、模块私有 Tauri listener 或第二 runtime owner
    充当 freshness 主路径。
17. 每条事件链是否同时具备 producer、Rust bridge、Desktop kernel
    `eventBus` catalog/type、runtime consumer、store effect 和 periodic reconcile；
    任一孤立 producer/consumer、未消费事件、重复订阅或无对账路径均为阻塞项。
18. Acceptance 是否从接收方证明：Moments 页面未打开或处于隐藏状态时事件仍使
    projection 收敛，重复事件不重复计数，断线丢事件后 reconcile 可恢复，登出、
    Actor/Station 切换后旧订阅与旧 projection 不泄漏。
19. `social-cross-station-eventbus-contract` 是否存在且通过，并且静态 contract
    Gate 没有被用来替代 `social-cross-station-native-e2e` 的真实双客户端证据。
20. `CSS-D09` 是否只解除 `SC-D29` 对同 Federation 远端 Group 成员的临时
    locality guard，并保留 typed target、Conversation authority、snapshot/fence、
    `CUSTOM_DENY(PUBLIC)` 拒绝和 no-partial-publish。
21. `CSS-09` 是否为 `native-desktop` functional Task，具备合法的
    `runtimeReuse`、`four`/`fiveArm` 与 `station-four`/`station-five-arm`
    binding、最多两个并发客户端、Bob2 replacement、exact-source attestation 和
    cleanup-complete。
22. Task source/write sets 是否覆盖 `packages/locales`、typed error parity、现有
    metrics owner，以及实际新增的 runtime/test 文件；命令是否从 repo root 可执行。
23. `CSS-08A` 是否以唯一 `SCHEMA_ACTIVATION` intent 串行执行两个精确 reset
    scope，生成 exact-source canonical schema attestations，并在任何后续源码变化
    后使 CSS-09 fail closed。
24. `CSS-00..08` 是否全部为 source-only 且只由同 workstream 的 CSS-09 直接
    完成功能闭环；任何私密 Native Journey 是否都严格位于 source freeze 和
    CSS-08A activation 之后。

## 输出格式

### 总体判断：[通过 / 有条件通过 / 需要修改]

### Findings

按严重度列出问题，每条包含计划或架构文件路径、行号、失败场景和建议修改。
若无问题，明确写“无阻塞问题”，并列出剩余未运行的产品证据。

### 维度结论

1. 依赖顺序
2. Scope 边界
3. Authority 与 proto-first
4. 原子切换与删除义务
5. 验收与失败覆盖
6. 2-4 小时时间盒、commit 边界与串行约束
7. Mobile/Browser 平台边界
8. `AAR-C01..C10`、架构真源与 Plan 执行投影一致性
