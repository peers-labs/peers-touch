# Cross-Station Private Social Plan Review Prompt

> **Status**: active
> **Version**: v1.1
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
- `docs/architecture/cross-station-social/design.md`
- `docs/architecture/cross-station-social/decisions.md`
- `docs/architecture/cross-station-social/data-model.md`
- `docs/architecture/cross-station-social/integration.md`
- `docs/architecture/secure-content/README.md`
- `docs/architecture/secure-content/decisions.md`
- `docs/architecture/api-ownership/decisions.md`
- `docs/architecture/federation/README.md`

## 计划路径

`docs/architecture/cross-station-social/execution-plans/20261003-native-private-social/plan.md`

## 评审重点

1. 计划是否严格限制为 Human private Social，未引入与需求无关的泛化领域层。
2. 每个 Agent 单元是否能在 2-4 小时内形成独立可用版本，而非只交付底层部件。
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
12. 九个单元串行是否与共享 contracts、Social authority 和同一运行环境一致。
13. AS17..AS24 是否覆盖成功、网络错误、超时、非法输入、取消、重启和清理。

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
