# Peers Dev 产品状态模型

> **Status**: active
> **Created**: 2026-09-26 | **Updated**: 2026-09-26
> **Owner**: Platform Team
> **Module**: `apps/dev/`

---

## 1. 决策边界

- Worktree lifecycle 由现有 owner state 决定。
- Source invalidation 和受影响 closure 的重开只由 DWF-D24 定义的 Plan owner
  执行。
- DWF-D25 Overlay 不得改变任何状态或转换。
- Execution root 由 DWF-D26 conversation binding 约束。
- Workflow Snapshot、Completion Review 和 Action Receipt 分别由
  DWF-D27、DWF-D28、DWF-D29 定义；accepted 不等于 implemented 或 proven。

## 2. Worktree State

| State | Meaning | Allowed action |
|---|---|---|
| `unregistered` | Source 可被发现，但没有 Local Dev registration | register 或 inspect |
| `idle` | 已注册且没有 active declaration | start work |
| `active` | Declaration 和 current Task 正在执行 | inspect 或 continue |
| `waiting` | 等待已准入的依赖或资源 | inspect owner 和解除条件 |
| `blocked` | Typed hard boundary 阻止进度 | resolve named boundary |
| `stalled` | 在 freshness interval 内没有有效 Action Receipt | inspect agent/session |
| `looping` | 等价 action fingerprint 重复且 Task progress 未改变 | stop loop 并 review |
| `drift` | Source、Plan、Session、declaration、review 或 rollout 不一致 | 修复被点名的 owner |
| `completed` | Plan 已完成且当前 Completion Review 有效 | deliver 或 archive |

`stalled` 和 `looping` 是诊断投影，不是 Plan 或 Task lifecycle 状态。

## 3. Completion Review State

**Decision**：DWF-D28。

```text
MISSING -> PENDING -> PASS
   |          |        |
   +----------+--------+-> STALE -> PENDING
              |
              +-> FAIL -> PENDING
```

| State | Meaning |
|---|---|
| `MISSING` | 当前 closure 没有 review |
| `PENDING` | Review 已创建但没有 terminal verdict |
| `PASS` | 独立 review 对精确 source 和 obligation digest 通过 |
| `FAIL` | 至少一个 required finding 仍为 open |
| `STALE` | 既有 terminal receipt 不再匹配当前 source 或 obligations |

只有当前 `PASS` 可以授权 Task 或 Plan completion。若 `PASS` 因源码失效而变为
`STALE`，重开动作遵循 DWF-D24，Snapshot 和 UI 不得自行修改 lifecycle。

## 4. Agent Activity State

**Decision**：DWF-D29。

Action Receipt reducer 产生：

- `working`：最近存在 admitted action，且没有 hard failure；
- `waiting`：明确等待外部条件或依赖；
- `blocked`：最后一个 terminal action 是 typed hard blocker；
- `stalled`：receipt lease 过期后仍无新 receipt；
- `looping`：等价 action fingerprint 超过有界阈值，且 Task revision 未推进；
- `complete`：没有 active Task，且 Completion Review 仍为 current。

Reducer 不解析日志文案，只使用 receipt kind、fingerprint、result、时间和 Plan
progress revision。

## 5. Workflow Snapshot State

**Decision**：DWF-D27。

Snapshot 从 owner state 只读派生以下 continuation：

| Continuation | Meaning |
|---|---|
| `CONTINUE` | 存在 dependency-ready、已授权且未到 hard boundary 的工作 |
| `HARD_BLOCK` | Ready frontier 已耗尽，且 typed blocker 需要外部解决 |
| `COMPLETE` | Plan lifecycle 完成，且 DWF-D28 Completion Review 为 current `PASS` |

缺失或冲突 owner 产生 typed finding。Snapshot 不修复、不补写、不选择替代
workspace，也不从 branch、目录顺序或聊天内容推断 owner。

## 6. Dev UI State

UI 必须支持：

- PRODUCT、DESIGN、PLAN、EXECUTE、DELIVER 的 worktree stage strip；
- 只由 completed Task closure 派生的 numeric Plan bar；
- 由 Session 和 Completion Review 派生的非数值 current-Task stage strip；
- 保持表格几何稳定的 loading；
- live Snapshot；
- 带 age 的 stale Snapshot；
- 带 typed finding 的 partial owner failure；
- 带 retry 的 disconnected server；
- 纵向 worktree summary 的窄屏布局；
- 带 review source identity 与时间的 terminal completed state。

除非 Plan lifecycle 和 current Completion Review 同时授权，UI 不得显示
`100%`、`complete` 或绿色 terminal state。DWF-D27..DWF-D29 未完成当前源码
证明时，相关 UI 必须显示 `UNPROVEN`，不得借用历史结果填充。
