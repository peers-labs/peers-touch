# Peers Dev Worktree 治理 - 产品状态模型

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-09-23 | **Updated**: 2026-09-24
> **Owner**: Platform Team
> **Module**: `apps/dev/`

---

## 1. Worktree Visibility State

| 状态 | 进入条件 | 允许动作 | 禁止推断 |
|---|---|---|---|
| discovered | 本轮 `git worktree list` 存在 | 查看 Git 身份和关联状态 | 已注册、正在运行 |
| observed-only | 有主动上报但未注册 | 查看 freshness | 拥有 profile/slot |
| managed | 有显式 machine registration | 查看环境绑定 | 当前 active |
| historical | 仅有 declaration/active-work 历史 | 查看旧状态和更新时间 | worktree 仍存在 |
| missing | 历史存在但本轮 Git 未发现 | 查看诊断 | 自动删除机器状态 |

## 2. Observation State

```text
unreported
  -> fresh
  -> recent
  -> stale

fresh|recent|stale
  -> fresh       on a valid new self-report
  -> invalid     on schema/digest failure
  -> missing     when Git discovery no longer contains workspaceId
```

Dev UI 的周期性检查只更新 `checkedAt` 和 Git 事实，不伪造 `reportedAt`。

## 3. Server Source State

| 状态 | 条件 | 用户可见结果 |
|---|---|---|
| current | 启动 branch/HEAD/dirty 与当前服务源码 worktree 相同 | 正常 |
| restart-required | HEAD 或 dirty 状态变化 | 顶部 warning，继续提供只读状态 |
| source-unavailable | 无法重新读取服务源码 Git 身份 | typed warning |

Dev UI 不自行杀死或替换 4177 listener。

## 4. Governance Activity State

| 状态 | 进入条件 | 删除资格 |
|---|---|---|
| active | live conversation、live declaration、active-work 或 live lease 任一存在 | 禁止 |
| idle | 已注册但无 live owner | 继续检查 Git 安全条件 |
| unmanaged | 仅由 Git discovery 发现 | 继续检查 Git 安全条件 |
| missing | Git 已不存在但仍有历史 Owner 记录 | 不执行 Git 删除，只允许独立诊断 |

`fresh` observation、文件 mtime、最近 commit 或浏览器选中都不能把 worktree
判定为 active。浏览器选中是页面状态，不是资源租约。

## 5. Metric State

```text
checking
  -> available
  -> unavailable

available|unavailable
  -> checking   on explicit refresh or cache expiry
```

`createdAt` 必须附带 `source=filesystem-birthtime`。磁盘占用附带
`checkedAt`。Git 距离附带实际 `baseRef`；缺失 base 时为 unavailable。

## 6. Removal State

```text
not-requested
  -> blocked             preflight returns blockers
  -> confirmation-ready  preflight returns one short-lived ticket

confirmation-ready
  -> removing            exact text + ticket accepted
  -> expired             ticket expires
  -> stale               source fingerprint changed

removing
  -> removed
  -> partial
  -> failed
```

删除预检必须拒绝：

- main worktree、服务源码 worktree或受保护分支；
- detached 或 locked worktree；
- live conversation、live declaration、active-work 或 live lease；
- dirty worktree；
- HEAD 未合入本地比较 ref；
- 缺失或无法验证的 Git/文件系统身份。

票据绑定 `workspaceId + root identity + branch + HEAD + dirty + baseRef +
ahead/behind + Owner state`，一次性且短时有效。执行阶段必须重新计算并比较。
删除只调用非 force `git worktree remove`，不删除 branch。

## 7. Durable Readback

- 主动上报读取自 workspace 独占文件。
- Git 检查每次 snapshot 重新执行，不持久化为 authority。
- `updatedAt` 是 projection，取已验证时间源中的最大值。
- registration、declaration、active-work 和 lease 的 Owner 语义保持不变。
- removal ticket 只存在于当前 Peers Dev 进程内，不是授权或可恢复状态。
- 成功退役后清理该 workspace 的 registration 和 workspace-local machine
  state；Acceptance Evidence 和 Git branch 不在删除范围。
