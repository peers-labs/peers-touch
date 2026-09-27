# Peers Dev Worktree 治理 - 体验契约

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-09-23 | **Updated**: 2026-09-24
> **Owner**: Platform Team
> **Module**: `apps/dev/web/`

---

## 1. Information Hierarchy

Worktree 主列表的一行只表达一个 `workspaceId`，并优先展示完成治理判断所需的
摘要：

1. 选择状态与当前 Git 身份：name、workspaceId、branch、短 HEAD、dirty。
2. 活跃度与 Work/Environment 健康摘要。
3. 创建时间、磁盘占用和相对 master 的 ahead/behind。
4. 最近有效活动时间与删除资格。

Git 身份不得由 registration、declaration 或 active-work 的历史 branch/HEAD
替换；历史不一致作为问题显示。Requirement、Journey、profile、slot、资源、
lease 和多 freshness clock 进入选中详情面板，避免主列表横向失控。

## 2. Selection, Filter And Sort

- 行点击和键盘 `Enter` 只选择一个 worktree，并打开同页详情面板。
- 选择键为 `workspaceId`；自动刷新后目标仍存在则保持选择，不存在则清空。
- 选择不写任何机器状态，不改变当前 conversation 的 `executionRoot`。
- 搜索匹配 name、branch、短 workspace ID。
- 状态筛选至少提供 all、active、inactive、attention、removable。
- 排序至少提供 activity、last activity、created、disk usage、ahead、behind 和
  name，并支持升降序。
- 未完成的指标稳定排在数值之后，不得因异步回填导致当前选择丢失。
- 桌面采用主列表加右侧详情；窄屏将详情放在列表下方，控件不互相遮挡。

## 3. Refresh Contract

- 页面首次加载立即请求 `/api/status`。
- 页面保持打开时每 15 秒刷新轻量状态；磁盘指标使用独立缓存，不随每次状态轮询
  重新扫描全部目录。
- 手工刷新与周期刷新共用同一幂等入口。
- 上一次请求未完成时不并发发起下一次请求。
- API 失败保留错误提示，下一周期继续尝试。
- 用户可显式刷新磁盘和 Git 指标；刷新期间保留上一份成功结果并标记 checking。

## 4. Metric Contract

详情面板显示：

- `Created`: filesystem birth time；平台不支持或值不可信时显示 unavailable，
  不伪造成 Git 提交时间。
- `Disk`: `du` 得到的 worktree allocated bytes，以及 `checkedAt`。
- `Base`: 实际比较 ref，优先 `refs/heads/master`，缺失时回退
  `refs/remotes/origin/master`。
- `Ahead / Behind`: `base...HEAD` 的左右计数。
- `Merged`: `HEAD` 是否为 base 的 ancestor；该结论只用于 worktree 移除资格，
  不删除 branch。

所有指标返回 `available | unavailable | checking`，并保留 typed error code。

## 5. Freshness Copy

每行显示四个绝对本地时间：

- `Reported`: 最近主动上报时间；缺失时显示 `Never reported`。
- `State`: registration、declaration heartbeat、active-work 中最新时间；
  均缺失时显示 `No owner update`。
- `Checked`: 本轮 Git 拉式检查时间。
- `Updated`: 以上有效时间中的最大值，用于统一账单的更新时间。

Freshness badge：

| 状态 | 含义 |
|---|---|
| `fresh` | 最近 30 秒内主动上报 |
| `recent` | 最近 5 分钟内主动上报 |
| `stale` | 主动上报超过 5 分钟，或上报身份与本轮 Git 检查不一致 |
| `unreported` | 从未主动上报，但本轮 Git 仍发现该 worktree |
| `missing` | 有历史状态或上报，但本轮 Git 已找不到该 worktree |
| `invalid` | observation 文件无法通过 schema/digest 校验 |

## 6. Removal Interaction

- 危险动作只出现在选中详情面板，不放在每行常驻主按钮。
- “Remove worktree”先请求预检；阻断项按原因列出。
- 可删除时弹出确认区，明确显示“保留 branch，不使用 force”，并要求输入
  `remove <worktree-name>`。
- 确认按钮在文本完全匹配前禁用。
- 票据过期、状态改变或请求被拒绝后保留详情和错误，允许重新预检。
- 成功后关闭详情、刷新列表并显示结果；partial result 必须指出剩余机器状态清理。
- UI 不提供绕过 blocker、删除 branch、清理未合入提交或批量删除入口。

## 7. Failure And Recovery

- 单个 observation 无效时，其他行仍正常渲染。
- 没有主动上报时，Git discovery 仍提供 branch/HEAD 和 `Checked`。
- Git discovery 失败时保留 registry/declaration/active-work 行，并显示 typed issue。
- 服务源码过期时页面保持只读可用，同时在顶部显示 restart warning。
- 磁盘或 Git 指标失败时只降级对应指标，不隐藏 worktree。
- 治理 API 失败时不乐观移除列表项；服务端成功读回后才更新 UI。
