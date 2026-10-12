# Bot 能力（IM Bot Actor）

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-10-11 | **Updated**: 2026-10-11
> **Owner**: Architecture Team
> **Module**: `app/subserver/bot`（规划中，尚无代码）

---

## 1. Document Scope

本文档集定义：

- 一类新的非人类 actor：传统 IM Bot（`ACTOR_KIND_AGENT`），以及它在身份、会话、通知、Desktop 驻留中的架构位置。
- 外部系统（coding agent hook、CI、SaaS）通过 Station webhook 投递事件，事件进入 Bot↔owner 会话并触发实时通知的端到端合同。
- Desktop 菜单栏驻留（tray）与 OS 通知能力。
- 本地 hook 适配 CLI `peersbot`。

本文档集不定义：

- Bot 的双向指令/审批/回复能力（webhook 仅入站，回调通道为后续能力）。
- 联邦投递、Bot 向非 owner 发信（仅留缝，v1 不实现）。
- A2A 协议行为：Bot 是 IM actor 身份，与 A2A Agent Card 无关。
- 移动端新功能（v1 无移动 push 分发器；见 design §2.2 AAR 表 push 行）。

## 2. 背景与问题

coding agent 在另一应用中完成任务或等待确认时，用户无法被及时触达。现有 Station
具备 notification 子域、会话图和 SSE 通道，但：没有非人类会话身份；通知生产不
触发实时扇出（仅落库 + Desktop 15 秒轮询）；Desktop 没有托盘与 OS 通知。

Bot 能力用一个原语同时补上这三块：**Bot actor + webhook 摄入 + 统一会话/通知投递**。

## 3. 设计目标

1. Bot 从第一天起就是 actor 的一类，消息走统一会话图，不建设平行通知通道。
2. 一个 webhook 原语同时服务本机 CLI 与外部系统，摄入管道只有一份。
3. 诚实表达信任边界：Station 驻留 Bot 的会话不是端到端保密会话，客户端不得显示 E2EE 锁。
4. hook 任何情况下不阻塞 coding agent（固定超时、有界 spool、exit 0）。
5. Desktop 可关闭窗口驻留菜单栏，事件以 OS 通知触达，点击深链回到会话。

## 4. 文档导航

| 文档 | 说明 |
|------|------|
| [product-definition.md](./product-definition.md) | 产品论点、能力范围、Journey、产品状态、验收标准 |
| [design.md](./design.md) | 核心原则、架构适用性评审（AAR）、系统架构、契约、失败语义、质量门 |
| [decisions.md](./decisions.md) | 决策索引与 BOT-D01…D12 ADR |
| [data-model.md](./data-model.md) | proto 变更、投递类型、状态机、持久化、限流常量 |
| [integration.md](./integration.md) | 与 identity / conversation / notification / events / Desktop / CLI 的映射与影响面 |
| [module-layout.md](./module-layout.md) | Station / model / Desktop / CLI 目标目录树 |
| [acceptance-matrix.md](./acceptance-matrix.md) | 场景矩阵与架构验证门 |
| [execution-plans/20261012-bot-inbox-execution.md](./execution-plans/20261012-bot-inbox-execution.md) | 垂直切片执行计划（S0–S5，待 Owner 确认冻结） |

模块在 DESIGN 评审通过、状态翻为 active 时登记进
`docs/architecture/engineering/architecture-governance/architecture-modules.json`
与 `docs/README.md` §4.1；draft 阶段按治理规则有意不登记。
