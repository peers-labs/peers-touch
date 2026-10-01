# Completion Review 产品合同

> **Status**: active
> **Created**: 2026-09-26 | **Updated**: 2026-10-01
> **Owner**: Platform Team

---

## 1. Scope

Completion Review 是成功实现证据与 Task/Plan completion 之间的独立、
current-source Gate。它必须识别遗漏义务、残留 forbidden path、stale evidence
和 overclaim。

它不替代 focused check、functional verification、Acceptance 或 PR review。

本能力由 canonical 决策 DWF-D28 定义。决策接受不构成实现落地或当前 proof。

## 2. Ownership

| Concern | Owner |
|---|---|
| Required completion obligations | Plan 和 Task |
| Current source identity | Git workspace inspector |
| Review request/receipt | Completion Review owner |
| Task lifecycle mutation | `planctl` |
| Source invalidation and reopen | DWF-D24 Plan-declared invalidation owner |
| Review projection | DWF-D27 Workflow Snapshot |
| Human merge judgment | PR reviewer |

Implementation Session 不能签发关闭自身 Task 的 receipt。Review owner 必须从
DWF-D33 OWNER binding 预先签发 REVIEWER assignment；reviewer child claim
必须携带同一 assignment、root/parent lineage 和 Development Session identity。
调用者不能提供或覆盖 reviewer binding digest。

## 3. Request And Receipt

内部 Development Workflow 遵循 DWF-D23，不发布产品化的 `vN` 阶段。下述
machine record 的 `schemaVersion` 仅是 closed-shape 完整性字段，不是 workflow
release label。

```ts
interface CompletionReviewRequest {
  schemaVersion: 1;
  kind: 'peers-touch-completion-review-request';
  reviewId: string;
  scope: 'task' | 'plan';
  planId: string;
  taskId: string | null;
  workItemId: string;
  implementationSessionIds: string[];
  executorContextDigests: string[];
  ownerBindingDigest: string;
  reviewerAssignmentDigest: string;
  source: {
    branch: string;
    commit: string;
    tree: string;
    workspaceDigest: 'clean' | `sha256:${string}`;
  };
  obligationsDigest: string;
  candidatePlanDigest: string;
  evidenceDigest: string;
  createdAt: string;
  requestDigest: string;
}

interface CompletionReviewReceipt {
  schemaVersion: 1;
  kind: 'peers-touch-completion-review-receipt';
  reviewId: string;
  requestDigest: string;
  reviewerContextDigest: string;
  rootBindingDigest: string;
  parentBindingDigest: string;
  assignmentDigest: string;
  verdict: 'PASS' | 'FAIL';
  findings: Array<{
    id: string;
    blocking: boolean;
    status: 'OPEN' | 'RESOLVED';
    evidenceRefs: string[];
  }>;
  reviewedAt: string;
  receiptDigest: string;
}
```

Request 和 receipt 都是 create-once。`obligationsDigest` 覆盖 Task 的
`doneWhen`、`failureBehavior`、checks、read/write set、Acceptance closure
以及 Plan-level deletion/quality obligations。

`prepare` 只接受当前 `completion-review-prepare` Action Receipt 指向的 OWNER
projection，并据此创建 REVIEWER assignment。`submit` 只接受当前
`completion-review-submit` Action Receipt 指向的、与 request assignment
精确相同且仍 live 的 REVIEWER child。任一路径缺少精确 receipt 都 fail
closed；禁止回退为枚举 worktree 下所有未 release binding。

Reviewer 提交 owner-only assessment。至少包含以下 mandatory finding：

- `plan-task-schema`
- `declared-evidence`
- `changed-file-containment`
- `forbidden-reference-inventory`
- `docs-source-consistency`
- `required-check-results`
- `generated-evidence-trust`

Review owner 从 blocking finding state 派生 `PASS` 或 `FAIL`。调用者提交的
verdict 只能与派生结果一致，不能覆盖结果。

## 4. State And Invalidation

```text
MISSING -> PENDING -> PASS
                  \-> FAIL
PASS|FAIL -- source/obligation drift --> STALE
STALE -> PENDING
```

Receipt 仅在以下条件全部成立时为 current：

- Plan、Task、work item 和 implementation Session identity 匹配；
- Reviewer context 与 request 覆盖的所有 implementation context 不同；
- Reviewer role、assignment、root/parent lineage 和 Development Session
  identity 与 request 完全匹配，且 child lease 未过期、未 terminal；
- Branch、commit、tree 和 workspace digest 与当前 Git state 匹配；
- Obligation digest 与当前 Plan/Task/Acceptance source 匹配；
- Implementation source 和 obligation digest 与 reviewed request 匹配；
- Closure transaction 的 post-transition candidate Plan、Session 和 evidence
  digest 与 request 精确匹配；
- 所有 blocking finding 已关闭。

Source digest 只能排除 Plan lifecycle 文件及其 transient lock；
`candidatePlanDigest` 覆盖精确 post-transition Plan bytes。后续正常 Task
transition 不追溯性地使已关闭 Task 的 immutable Session evidence stale；
implementation source 或 obligation drift 会使其 stale。

Closure owner 必须拒绝没有 current `PASS` receipt 的 done transition。已完成
Task 或 Plan 的 receipt 失效后，projection 不得继续显示完成；只有需要 source
invalidation 时，lifecycle 重置才通过 DWF-D24 的 invalidation owner 完成。

当前 Task 完成后若没有 dependency-ready successor、但已有 blocked Task，
Completion Review 必须审查同一个 fixed-point blocked 候选状态。该候选的
`recordedAt` 取成功 Session 的最终更新时间，`decisionRefs` 取 Plan 已声明架构
决策，`evidenceRefs` 取现有 Task blocker；`planctl advance` 必须使用相同字段，
否则候选摘要不匹配并拒绝关闭。prepare 输出同时返回该
`candidateTransition`，调用方不得再次实现候选状态推导。

## 5. Review Checks

每次 review 包含：

- Plan/Task schema 和 dependency closure；
- 已声明的 focused、functional 和 Acceptance evidence；
- Changed-file containment；
- Target-state deletion 和 forbidden-reference search；
- Docs 与 implementation consistency；
- 不存在 hidden skipped 或 failed required check；
- 不使用 untracked generated output 作为证据。

Domain Plan 可以增加 review check 和 forbidden-path fixture，但不能删除通用检查。

## 6. Required Regression

必须覆盖以下 omission regression：

1. Plan 声明某项 consolidation 已完成；
2. 一个被声明禁止的 legacy source 仍存在，但旧 search scope 未覆盖；
3. 其他 Session evidence 均成功；
4. Completion Review 返回 `FAIL`；
5. Closure owner 拒绝 done transition 且不修改 manifest。

Fixture 必须由当前 Plan 声明 forbidden inventory，不得依赖其他 worktree 的领域
路径、branch、workspace identity 或历史执行结果。Generated、test、script 和
显式 deletion inventory 不得被静默排除；任何 exclusion 都是 Plan-owned 且必须
经过 review 的规则。
