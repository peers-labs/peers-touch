# Peers Dev Worktree 治理 - Acceptance Matrix

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-09-23 | **Updated**: 2026-09-24
> **Owner**: Platform Team
> **Module**: `apps/dev/`

---

| ID | Journey / Risk | Action | Expected Result | Evidence |
|---|---|---|---|---|
| DUI-A01 | DUI-J01 / discovery completeness | 创建两个临时 Git worktree，均不注册 | API 返回两个独立 workspace 行，branch/HEAD 与 Git 一致 | `status.test.mjs` |
| DUI-A02 | DUI-C02 / self-report isolation | 两个 canonical root 分别上报 | 写入不同 workspace observation 路径，互不覆盖 | observation store tests |
| DUI-A03 | DUI-C02 / atomicity | 并发上报同一 workspace | 文件始终为完整 closed-schema JSON，最新报告可读 | observation store tests |
| DUI-A04 | DUI-C03 / stale owner data | active-work branch 与 Git branch 不同 | 行主 branch 使用 Git 值，并报告 identity mismatch | `status.test.mjs` |
| DUI-A05 | DUI-C04 / timestamps | registration、declaration、active-work、report 时间不同 | API 输出三个独立时间及其最大 `updatedAt` | `status.test.mjs` |
| DUI-A06 | DUI-C04 / corrupt report | 一个 observation digest 无效 | 对应行 `invalid`，其他行继续显示 | `status.test.mjs` |
| DUI-A07 | DUI-C05 / stale server | 服务启动后源码 HEAD 改变 | snapshot 返回 `restart-required`，UI 显示 warning | `index.test.mjs` |
| DUI-A08 | privacy boundary | 生成真实 snapshot | JSON 不含 canonical root、私有状态路径和 secret profile 字段 | redaction tests |
| DUI-A09 | runtime receiver | 启动新源码 Dev UI 并读取 4177 | 页面显示全部 discovered worktrees 和更新时间列 | `dev-ui-browser-e2e` |
| DUI-A10 | DUI-J02 / selection | 选择一个 worktree 后刷新状态 | 仍按 `workspaceId` 选中，且不改变 conversation/Plan/registration | browser test + owner-state readback |
| DUI-A11 | DUI-C07 / sort and filter | 依次选择 activity、updated、created、disk、ahead、behind、name 并切换方向 | 行顺序符合值与 unavailable-last 规则；搜索和状态过滤可组合 | browser test |
| DUI-A12 | DUI-C08 / metric provenance | 检查真实 linked worktree | 创建时间、disk、ahead/behind 均携带 source/ref 和 checkedAt，失败为 typed unavailable | `worktree.test.mjs` |
| DUI-A13 | DUI-J03 / protected targets | 对 main、serving、conversation-bound、protected、detached、locked、dirty、active、unmerged fixture 请求预检 | 每个目标返回独立 blocker，不签发票据 | `worktree.test.mjs` |
| DUI-A14 | DUI-J03 / stale decision | 获取票据后修改目标 HEAD 或 dirty 状态 | 执行返回 `WORKTREE_REMOVAL_STATE_CHANGED`，worktree 和 branch 均保留 | `worktree.test.mjs` |
| DUI-A15 | DUI-J03 / request integrity | 发送跨 origin、非 JSON、无 token、错确认、过期或复用票据 | HTTP 在调用治理服务前拒绝请求 | `worktree-governance.test.mjs` |
| DUI-A16 | DUI-J03 / successful retirement | 删除 clean、inactive、merged linked worktree | worktree 与 idle workspace state 消失，branch 和 Acceptance Evidence 保留 | `worktree.test.mjs` + browser test |
| DUI-A17 | DUI-J03 / partial cleanup | Git removal 成功后注入 registry/state cleanup failure | 返回 `WORKTREE_REMOVAL_PARTIAL` 并明确剩余清理项 | `worktree.test.mjs` |

## Non-Claims

- 自报 freshness 不证明 worktree 正在执行任务。
- Git discovery 不创建 registration、profile、slot 或 runtime lease。
- 页面时间不替代 Plan、Session、declaration 或 Acceptance 证据。
- filesystem birth time 是创建时间估计，不宣称为 Git 历史事实。
- 本地 master 距离不隐含 remote fetch 新鲜度，也不触发 branch 删除。
- 浏览器中的选择和删除票据都不是 Agent executionRoot 或操作授权。
