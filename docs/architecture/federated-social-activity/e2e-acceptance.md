# Federated Human Social Activity — E2E 验收机制

> **Status**: draft
> **Version**: v0.2
> **Created**: 2026-06-17 | **Updated**: 2026-06-17
> **Owner**: Architecture Team

---

## 1. 验收目标

E2E 验收必须证明当前阶段 Human 联邦社交闭环成立：

1. 多 Station Human Actor 可以被发现、展示、关注和互动。
2. Feed 能解释 source station、relationship reason、audience 和 interaction boundary。
3. Public、followers、circle、self audience 不越权。
4. 评论、reaction、关注、屏蔽在本地和跨站场景下行为一致。
5. Runtime projection 能通过事件消费和周期 reconcile 保持新鲜度。
6. Reload / reconnect 后 Feed 状态可以恢复。

Agent、A2A、Applet 不进入当前阶段 E2E。

---

## 2. 测试拓扑

```text
┌──────────────────────┐                 ┌──────────────────────┐
│ Station A            │                 │ Station B            │
│                      │  federation     │                      │
│ Alice @alice@a       │◄───────────────►│ Bob @bob@b           │
│ Carol @carol@a       │                 │ Dana @dana@b         │
│ Infra Circle         │                 │ Public users         │
└──────────────────────┘                 └──────────────────────┘
```

最小环境：

- 2 个 Station：A、B。
- 4 个 Human Actor：Alice、Bob、Carol、Dana。
- 1 个 Circle：Alice 的 Infra Circle，成员包含 Carol。
- 关系：Alice follows Bob，Bob does not follow Alice，Carol in Alice circle。
- 内容：public post、followers post、circle post、self post。

---

## 3. 验收场景

### E2E-H01: 本地 Home Feed

**Given**

- Alice 登录 Station-A。
- Carol 在 Station-A 发布 public post。

**When**

- Alice 打开 Home Feed。

**Then**

- Feed 显示 Carol 的动态。
- 卡片显示 Carol 是本地 Human Actor。
- relationship reason 显示本地关系或 public local。
- audience 显示 public。

### E2E-H02: 跨站 Public Feed

**Given**

- Bob 在 Station-B 发布 public post。
- Station-A 与 Station-B 建立 federation。

**When**

- Alice 打开 Federated Feed。

**Then**

- Feed 显示 Bob 的公开动态。
- 卡片显示 `@bob@station-b` 和 Station-B。
- relationship reason 显示 public federated。
- Alice 可以打开 Bob Profile。

### E2E-H03: Follow 后进入 Home Feed

**Given**

- Alice follows Bob。
- Bob 发布 public post。

**When**

- Alice 打开 Home Feed。

**Then**

- Bob 的动态进入 Home Feed。
- relationship reason 显示 because you follow Bob。
- Profile 显示 following 状态。

### E2E-H04: Followers Audience 不越权

**Given**

- Bob 发布 followers-only post。
- Alice 未被 Bob 关注或授权。

**When**

- Alice 打开 Home / Federated / Bob Profile。

**Then**

- Alice 不应看到该 post。
- Projection 中不得出现该 object。
- 审计日志记录 audience filter。

### E2E-H05: Circle Audience

**Given**

- Alice 发布 Infra Circle post。
- Carol 在 Infra Circle 中。
- Bob 不在 Infra Circle 中。

**When**

- Carol 和 Bob 分别打开 Feed。

**Then**

- Carol 可见该 post，audience explanation 显示 circle。
- Bob 不可见该 post。
- UI 不暴露完整 circle member list。

### E2E-H06: Comment / Reaction 跨站互动

**Given**

- Bob 发布 public post。
- Alice 可见该 post。

**When**

- Alice 评论并 reaction。

**Then**

- Bob 的 post stats 更新。
- Alice 本地 Feed 立即显示互动状态。
- reconnect / reload 后状态仍一致。

### E2E-H07: Block Actor / Station

**Given**

- Alice 可见 Bob 的 public federated posts。

**When**

- Alice block Bob 或 Station-B。

**Then**

- Bob 或 Station-B 内容从 Feed 移除或折叠。
- Search/Profile 显示 blocked 状态。
- 后续 reconcile 不重新引入被屏蔽内容。

### E2E-H08: Runtime Freshness

**Given**

- Alice 正在查看 Feed。
- Bob 在远端发布 public post。

**When**

- Realtime event 到达，或周期 reconcile 运行。

**Then**

- Feed projection 更新。
- 页面没有 mount-time fetch 依赖。
- Runtime log 显示 event consumed 或 reconcile completed。

---

## 4. 回归矩阵

| 维度 | 必测项 |
|------|--------|
| Actor | local human、remote human、unresolved human |
| Source | local station、trusted remote station、blocked station |
| Audience | public、followers、circle、self |
| Reason | following、circle、mentioned、public federated、profile view |
| Interaction | comment、reaction、follow、unfollow、block |
| Projection | event update、periodic reconcile、reload recovery |
| UI | source badge、reason line、audience badge、profile link |
| Security | no private leakage、no member list leakage、no blocked reinsert |

---

## 5. 可观测性

每个 E2E 场景必须产生证据：

- Station log：audience decision、relationship reason、delivery id。
- Desktop runtime log：bootstrap、event consumed、reconcile completed。
- Store snapshot：feed ids、objectsById、relationship reason、audience explanation。
- UI evidence：screenshot 或 DOM snapshot。

禁止记录：

- token、password、secret key。
- 私密动态正文。
- 未脱敏 PII。

---

## 6. 验收命令形态

最终应形成以下命令族：

```bash
./tooling/scripts/e2e/federated-human-social/bootstrap.sh
./tooling/scripts/e2e/federated-human-social/run.sh --scenario E2E-H02
./tooling/scripts/e2e/federated-human-social/run.sh --all
./tooling/scripts/e2e/federated-human-social/report.sh
```

验收报告必须包含：

- 场景 ID。
- 参与 Station / Actor / Audience。
- Post / comment / reaction / relationship ids。
- UI evidence。
- 通过/失败原因。
