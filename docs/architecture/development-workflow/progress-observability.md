# Progress And Agent Activity Observability 产品合同

> **Status**: active
> **Created**: 2026-09-26 | **Updated**: 2026-10-01
> **Owner**: Platform Team
> **Module**: `apps/dev/`

---

## 1. Scope

本文定义让人类无需解释原始日志即可理解 worktree、Plan、Task 和 Agent execution
的只读投影。

它不拥有或修改任何 source state。

Workflow Snapshot 与 Action Receipt 分别由 canonical 决策 DWF-D27 和
DWF-D29 定义；DWF-D33 提供 binding projection 输入，DWF-D28 提供
Completion Review 输入。决策接受不构成实现或 proof 声明。

## 2. Owner Join

```text
Git + BindingProjection + Plan binding + Plan Package + current Task
    + Development Session + Completion Review + resource declaration
    + runtime registration/leases + Action Receipts
                              |
                              v
                     Workflow Snapshot
                              |
                  CLI / Context Anchor / Peers Dev
```

Snapshot 独立读取每个 upstream owner。缺失或冲突状态产生 typed finding；
Snapshot 不修复 owner，不选择替代 workspace，也不从 branch 或聊天推断状态。

## 3. Action Receipt

```ts
interface ActionReceipt {
  schemaVersion: 1;
  kind: 'peers-touch-workflow-action';
  sequence: number;
  actionId: string;
  actor: {
    host: string;
    bindingDigest: string;
    role: 'OWNER' | 'WORKER' | 'REVIEWER';
    rootBindingDigest: string;
    parentBindingDigest: string | null;
    assignmentDigest: string | null;
  };
  binding: {
    workspaceId: string;
    workItemId: string | null;
    planId: string | null;
    taskId: string | null;
    sessionId: string | null;
  };
  event: 'STARTED' | 'HEARTBEAT' | 'FINISHED';
  result:
    | 'RUNNING'
    | 'WAITING'
    | 'PASS'
    | 'FAIL'
    | 'BLOCKED'
    | 'DENIED'
    | 'CANCELLED';
  operation: {
    family: string;
    label: string;
    targetRef: string | null;
  };
  fingerprint: string;
  progressStamp: string;
  at: string;
  leaseUntil: string | null;
  durationMs: number | null;
  previousDigest: string | null;
  digest: string;
}
```

依据 DWF-D23，`schemaVersion` 只是 machine record 的 closed-shape 完整性
字段，不是 workflow release label。Receipt 排除原始工具参数、prompt、
stdout、secret 和 raw conversation identifier；记录按 conversation 有界，并
原子写入 machine Dev root。

Action Receipt store 按 root binding lineage 有界。Child lease 过期或 terminal
只影响 activity projection，不改变 OWNER authority。Rollout 删除旧 Action
Receipt store；reader 只接受当前 actor shape，不做兼容解析。

## 4. Reducer

每个 worktree 的 reducer 必须：

1. 只从 Task lifecycle 派生 Plan progress。
2. 从 Session 和 Completion Review 派生 current Task stage，不虚构
   intra-Task percentage。
3. 按 sequence 和时间校验并排序 Action Receipt。
4. 在十分钟内出现四个等价 terminal fingerprint 且 `progressStamp` 不变时，
   标记 `looping`。
5. Active action 每十秒产生 heartbeat；receipt lease 过期三十秒后标记
   `stalled`。
6. 让显式 `blocked` 和 cross-owner `drift` 优先于 heuristic state。

Loop 和 stall 仅为诊断投影。Effective-state precedence 为：

```text
drift -> blocked -> completed -> looping -> stalled -> waiting -> working -> idle
```

阈值属于 DWF-D29 目标合同；实现必须通过 injected clock 测试，历史运行数据
不能替代该证明。

## 5. UI Contract

每个 worktree row 展示：

- project/worktree identity 和 source status；
- PRODUCT、DESIGN、PLAN、EXECUTE、DELIVER 的 project stage；
- Plan title、status 和 closure progress bar；
- current Task title，以及 source/functional/acceptance/review segmented state；
- 当前 Agent state、last action、age 和 result；
- Completion Review state 和 reviewer timestamp；
- typed blocker 和 drift finding；
- profile、Station、Relay 和 live lease summary。

布局以一个无嵌套卡片的 worktree band 表达一个项目，不显示用户主目录绝对路径。

目标刷新合同为：

- 可用时通过 server-sent events 推送；
- 断开后回退到有界 polling；
- server 端同一时刻最多构建一个 Snapshot；
- 按 digest 去重并合并到最新值；
- payload 上限 512 KiB，连接数有上限；
- 初始发送完整 Snapshot，变化后最多每两秒发送一次；
- 每十秒发送 keep-alive comment；
- browser visible 时每五秒 fallback polling，hidden 时每三十秒；
- request timeout 为四秒；
- browser 不合并 owner state，也不发明 progress。

这些值是待实现和验收的产品约束，不表示当前 server 已满足。

## 6. Quality Gates

- Reducer 使用 injected clock 的 deterministic test。
- Invalid、oversized、symlinked 或 foreign receipt 被拒绝。
- 仅 Action Receipt 更新时，worktree/Plan/Task progress 保持稳定。
- Worktree stage、Plan closure percentage 和 Task lifecycle 视觉上可区分；
  只有 Plan 使用 numeric percentage。
- Desktop 和 narrow viewport 无重叠或裁字。
- Disconnect 保留最后 Snapshot 并显示其 age。
- Completed Plan 在 Completion Review missing/stale 时不得显示绿色 terminal。
- 所有 proof 必须从当前目标源码重新生成，不得引用来源 worktree 的端口、
  screenshot、test count、branch、commit 或 completion state。
