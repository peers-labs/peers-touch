# Development Workflow 产品状态模型

> **Status**: active
> **Created**: 2026-09-26 | **Updated**: 2026-10-01
> **Owner**: Platform Team
> **Module**: `tooling/scripts/local-dev/workflow-snapshot.mjs`

---

## 1. 决策边界

- Worktree lifecycle 由现有 owner state 决定。
- Source invalidation 和受影响 closure 的重开只由 DWF-D24 定义的 Plan owner
  执行。
- DWF-D25 Overlay 不得改变任何状态或转换。
- Execution root 由 DWF-D33 OWNER-rooted BindingProjection 约束。
- Workflow Snapshot、Completion Review 和 Action Receipt 分别由
  DWF-D27、DWF-D28、DWF-D29 定义；accepted 不等于 implemented 或 proven。
- DWF-D32 的 Resource Plan 只投影跨模块 target 和资源准备状态，不替代
  Plan/Task lifecycle 或物理 Runtime Owner 状态。

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

## 6. Resource Plan State

**Decision**：DWF-D32。

| Projection | Meaning |
|---|---|
| `allocationState=READY` | 所有 target 已获得完整声明 claims |
| `allocationState=PARTIALLY_READY` | 至少一个 target ready，至少一个 target 因容量或依赖 park |
| `allocationState=PARKED` | 没有 target 可执行，且没有部分 target claim |
| `runtimeState=PENDING` | Runtime Owner 尚未完成 build/restart/provision |
| `runtimeState=READY` | 所有可执行 target 的资源已有 manifest-bound READY 结果 |
| `runtimeState=QUARANTINED` | 至少一个资源被 owner 隔离，不能复用 |

相同 request 和 source 保留 fencing token；request、source 或 allocation 改变
都会推进 token。旧 token 的 Runtime Owner 结果不得改变当前状态。

## 7. Snapshot Projection State

Workflow Snapshot projects:

- PRODUCT、DESIGN、PLAN、EXECUTE、DELIVER stage;
- numeric Plan progress derived only from completed Task closures;
- current Task source/functional/acceptance/review state;
- activity freshness and typed partial-owner failures;
- review source identity and terminal timestamp.

Unless ExecutionRun lifecycle and current Completion Review both authorize it,
Snapshot cannot emit `COMPLETE` or `100%`. DWF-D27..DWF-D29 proof must come
from current source; historical browser results cannot populate the projection.
