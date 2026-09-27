# Peers Dev Worktree 治理 - 产品定义

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-09-23 | **Updated**: 2026-09-24
> **Owner**: Platform Team
> **Module**: `apps/dev/`

---

## 1. Product Thesis

目标用户是同时维护多个 Peers-Touch worktree 的研发人员和 Agent。Peers Dev
必须让他们在一个页面内完成 worktree 盘点、比较、定位和安全退役，而不是从超宽
状态表中手工拼接 Git、磁盘和工作流事实。

产品承诺：

> 打开 Peers Dev 后，15 秒内看清当前 Git worktree 集合、活跃度、创建时间来源、
> 磁盘占用和相对 master 的版本距离；用户可筛选、排序并选中一个 worktree 查看完整
> 详情。只有通过安全预检的非活跃 worktree 才能进入显式确认后的退役操作。

## 2. Capability Profile

| ID | 能力 | 级别 | 用户价值 |
|---|---|---|---|
| DUI-C01 | 全量 worktree 发现 | required | 未注册 worktree 也不会从统一视图消失 |
| DUI-C02 | 机会式自报 | required | 活跃 worktree 在 Agent/CLI 活动时更新自身观测 |
| DUI-C03 | 周期性拉式校验 | required | 没有 Agent 活动时仍能校验 branch、HEAD 和存在性 |
| DUI-C04 | 多时间源展示 | required | 区分 reported、state-updated 和 checked 时间 |
| DUI-C05 | 服务源码新鲜度 | required | 明确提示 4177 服务是否需要从新源码重启 |
| DUI-C06 | 可选择治理上下文 | required | 选中一行后集中查看详情和可用动作，不改变会话执行根 |
| DUI-C07 | 筛选与排序 | required | 按名称、活跃度、更新时间、创建时间、磁盘和版本距离快速收敛候选 |
| DUI-C08 | 可证明的生命周期指标 | required | 每项指标显示值、来源、检查时间和不可用状态 |
| DUI-C09 | 受保护的 worktree 退役 | required | 只移除满足安全条件的 linked worktree，保留 Git 分支 |

## 3. Journey

### DUI-J01: 查看统一 worktree 账单

1. 用户打开 `http://127.0.0.1:4177/`。
2. 页面在加载时读取一次状态，之后每 15 秒刷新。
3. 每个 `git worktree list` 中的 worktree 都有独立行，即使没有环境注册、
   declaration 或 active-work。
4. 行内 branch/HEAD 来自本轮 Git 检查，不由旧 active-work 覆盖。
5. 行内显示：
   - `Last reported`: worktree 最近一次主动上报；
   - `State updated`: registration、declaration、active-work 中最新的 Owner 时间；
   - `Checked`: Dev UI 最近一次拉式检查。
6. 若主动上报缺失或过期，页面显示 `unreported` 或 `stale`，但仍保留拉式检查结果。
7. 若 4177 服务启动源码落后于其当前 worktree HEAD，页面显示
   `restart required`，不静默宣称视图来自最新实现。

### DUI-J02: 筛选并评估一个 worktree

1. 用户通过搜索、状态筛选和排序缩小 worktree 集合。
2. 用户选择一行，页面在同一视口打开详情面板。
3. 详情显示 branch、HEAD、dirty、创建时间及来源、磁盘占用及检查时间、
   相对本地 `master`（缺失时回退 `origin/master`）的 ahead/behind、是否已合入、
   registration、声明、租约和删除资格。
4. 指标加载或失败不阻塞其他列表状态，失败项显示 typed unavailable。
5. 选择仅属于当前浏览器页面，不写 Plan、Session、active-work、registration，
   也不改变任何 Agent conversation 的 immutable `executionRoot`。

### DUI-J03: 安全退役一个不活跃 worktree

1. 用户在详情面板请求删除预检。
2. 服务端重新读取 Git、dirty、branch、master 合入关系、live conversation、
   live declaration、active-work、lease、main/server worktree 和 lock 状态。
3. 任一保护条件不满足时，界面列出阻断原因，不提供绕过或 force 入口。
4. 预检通过时，界面要求输入与当前 worktree 名称绑定的确认文本。
5. 服务端只接受同源 JSON 请求、短时一次性票据和精确确认文本，并在执行前再次
   校验状态指纹。
6. 成功后只执行非 force 的 `git worktree remove`，保留 branch；随后清理该
   workspace 的无活跃 Owner 机器状态并刷新列表。
7. 任一步失败都返回 typed error；若 Git worktree 已移除但机器状态清理失败，
   明确显示 partial result，不伪装成完整成功。

## 4. Non-Goals

- 自动注册 worktree、分配 profile 或 slot。
- 从 observation 推导 runtime activity、授权或资源所有权。
- 让浏览器直接写 registry、declaration、active-work、Session 或 Plan。
- 从列表选择重绑当前聊天、Plan 或 Agent executionRoot。
- 自动 fetch、删除 branch、使用 `git worktree remove --force`，或删除主工作树。
- 代替 Git、Development Workflow、Lease Manager 或 Conversation Kernel 成为
  活跃性真源。
- 暴露 canonical root、凭据、日志、用户消息或 Acceptance payload。
- 通过后台常驻 Agent 维持心跳；无 Agent 活动时由 Dev UI 拉式检查兜底。

## 5. Prototype Disposition

本次不新增独立原型。Peers Dev 已是可直接运行的 dashboard，需求对信息层级、
选择语义和危险动作流程没有待确认分歧。L1 由生产源码审查提供，L2/L3 由真实
`apps/dev/` 运行时在桌面和窄屏视口中的截图、点击和删除阻断场景提供。

## 6. Product Acceptance

- Git 实际 worktree 数与 API 的 discovered worktree 数一致。
- stale active-work branch 不再覆盖 Git 本轮观测 branch。
- `make dev-observe` 和 Agent hook 都能刷新当前 workspace 的 `lastReportedAt`。
- 一条 observation 损坏只影响对应 workspace，并显示 typed freshness failure。
- 页面 15 秒轮询后更新时间变化，无需手工刷新。
- Dev UI 服务启动 commit 与当前 commit 不同时显示 restart warning。
- 搜索、状态筛选和全部排序项不修改服务端 Owner 状态，选择在刷新后按
  `workspaceId` 保持。
- 创建时间、磁盘占用和 master 距离均携带来源或 typed unavailable。
- 主工作树、当前服务工作树、live conversation、active declaration、
  active-work、live lease、dirty、detached、locked、未合入 master 的
  worktree 均无法获得删除票据。
- 过期、复用、错 workspace、错确认文本或状态已变化的票据均失败关闭。
- 合法删除保留 branch，且 API 与页面不暴露 canonical root。
