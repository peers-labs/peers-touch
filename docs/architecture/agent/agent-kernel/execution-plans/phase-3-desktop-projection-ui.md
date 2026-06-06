# Phase 3 — Desktop Projection and Peers-Touch UI

> **Status**: draft
> **Version**: 2026.06
> **Created**: 2026-06-06 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Module**: `apps/desktop/`

---

## 1. 目标

用 Peers-Touch Desktop 架构承接 Agent Kernel：新增 `agentRuntime` RuntimeDescriptor、Station stream bridge、Agent Center / Chat / Profile / Assets / Growth 页面。

---

## 2. 交付范围

1. Desktop Rust `agent` command 模块：Station API gateway、stream bridge、local path grant。
2. Desktop Web `runtimes/agent/agentRuntime.ts`。
3. Projection：agent list、profile、thread list、thread detail、approval queue、memory、skill、growth。
4. 页面：
   - AgentCenterPage
   - AgentChatPage
   - AgentProfilePage
   - AgentMemoryPage
   - AgentSkillPage
   - AgentToolsPage
   - AgentGrowthPage
5. Tool approval 卡片与 Turn event timeline。
6. Provider 能力矩阵 UI：Kernel-native AgentProvider、ModelBackend、CLI-wrapped AgentProvider 的可控性与风险标签。
7. LobeUI first，antd fallback；不引入 Agent Box UI 框架。

---

## 3. 不做什么

- 不复制 Agent Box 页面。
- 不在页面组件里 mount-time fetch。
- 不把 Agent profile 缓存在 Desktop 作为真源。
- 不做 Mobile UI。

---

## 4. 验收标准

1. Desktop 刷新后 Agent list 和 Thread detail 能从 projection 恢复。
2. Turn 流式事件能实时驱动 ConversationFlow。
3. 工具审批卡能在 Chat 页面和 Tools 页面同步显示。
4. Profile 页面保存后 Station profile 更新，projection 随事件刷新。
5. Memory/Skill/Growth 页面只通过 `agentRuntime` 消费数据。
6. `cd apps/desktop && pnpm run check` 通过。

---

## 5. 风险

| 风险 | 处理 |
|------|------|
| 页面直接调用 service API | PageDescriptor 审查阻断 |
| stream 断线导致状态过期 | agentRuntime 支持 reconnect + snapshot refresh |
| UI 太像 Agent Box | 评审以 Peers-Touch 信息架构和 LobeUI 为准 |
