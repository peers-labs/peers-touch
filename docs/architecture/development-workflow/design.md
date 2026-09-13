# Development Workflow Control Plane - Architecture Design

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-13 | **Updated**: 2026-09-13
> **Owner**: Platform Team

---

## 1. Core Principles

1. **Journey before matrix**: 开发进度先由一个真实用户 Journey 是否闭环决定，不由
   测试数量、Gate 数量或文档数量决定。
2. **Functional before formal proof**: 产品源码先在 exact-source 开发运行时通过
   功能验证，再补齐或执行正式 Acceptance。
3. **One state owner**: Development Workflow 只拥有执行推进状态；产品语义、
   机器资源、正式证据和合并判断仍由各自架构拥有。
4. **Declare before use**: Dev Session 启动前必须把源码写域和资源意图发布到机器级
   公共账本，并完成冲突检查和读回确认。
5. **First failure first**: 每次运行只返回首个可行动失败，修复后回到同一 Journey，
   禁止失败后自动扩展为全量验证。
6. **Bounded execution**: 每个检查、部署、Journey 和清理都有显式预算；无隐式无限
   等待、无静默重试。
7. **No evidence inflation**: 开发诊断不写 Acceptance Evidence Store；仓库计划不追加
   原始运行日志。
8. **Exact runtime identity**: 远端或 Native 功能结论必须绑定已提交 source、resolved
   profile、service binding、client identity 和 live runtime。
9. **One journey implementation**: Dev Runner 与 Acceptance Runner 可以采用不同执行
   策略，但不得复制或分叉同一业务 Journey 的动作与断言。

## 2. Evidence Ledger
| Claim | Class | Evidence | Confidence | Missing Proof |
|---|---|---|---|---|
| 外层流程只定义 `PRODUCT -> DESIGN -> PLAN -> EXECUTE -> DELIVER` | `verified_fact` | `docs/global/workflow.md`; `tooling/skills/pt-dev-workflow/SKILL.md` | high | none |
| `EXECUTE` 没有强制复现、checkpoint、部署、功能通过后才能 Acceptance 的子状态机 | `verified_fact` | `pt-dev-workflow` Stage EXECUTE；`pt-execution-plan-guardian` workflow | high | none |
| 远端 `make station` 只部署当前 Git HEAD，未提交修改不会部署 | `verified_fact` | `docs/global/local-dev-environment.md` §3.2 | high | none |
| Acceptance Framework 是产品证明层，不替代单元测试或产品实现 | `verified_fact` | `docs/architecture/acceptance-framework/README.md` | high | none |
| static/typecheck Gate 不能证明 receiver-visible Native 行为 | `verified_fact` | Acceptance design §4.5、Quality proof model | high | none |
| Local Dev Control Plane 已定义 workspace/profile/slot/lease 的机器级 Owner | `verified_fact` | `docs/architecture/local-dev-control-plane/` | high | runtime migration remains pending |
| 当前长计划和外部 Evidence Store 已积累高数量历史运行记录 | `verified_fact` | NDR plan 5,679 lines；legacy Evidence Store 8,742 run directories at audit time | high | exact retention policy outside this scope |
| 产品优先 Dev Loop 可降低无效 Gate 运行和错误 readiness claim | `proposal` | failure analysis above | medium | Chat pilot and measured cycle comparison |

## 3. System Architecture

```text
PRODUCT / DESIGN / PLAN
           |
           | accepted Journey + architecture + workstream
           v
┌──────────────────────────────────────────────────────────────┐
│              Development Workflow Control Plane              │
│                                                              │
│  Work Item -> Dev Session -> Journey State Machine           │
│       |            |              |                           │
│       |            |              +-> first failure / budget │
│       |            +-> checkpoint + verification ledger      │
│       +-> public work.json + authorization envelope          │
└───────────┬──────────────────┬──────────────────┬─────────────┘
            │                  │                  │
            ▼                  ▼                  ▼
   Product source       Local Dev Control   Domain Journey
   + focused checks     Plane               implementation
                       profile/lease/       real UI/action/
                       deploy/runtime       receiver assertion
            │                  │                  │
            └──────────────────┴──────────────────┘
                               |
                               v
                       FUNCTIONAL_PASS
                               |
              ┌────────────────┴────────────────┐
              ▼                                 ▼
     Acceptance Framework                Quality Framework
     formal product proof                review / delivery
```

## 4. Sources Of Truth And Ownership
| Concern | Owner | Canonical Source | Must Not Own |
|---|---|---|---|
| Product outcome and visible states | Product/domain contract | accepted product docs, prototype and acceptance IDs | runtime allocation |
| Architecture and implementation boundary | Architecture docs | `docs/architecture/**` | progress state |
| Workstream scope and dependency | Execution plan | plan status table | raw logs and process state |
| Development transition and resource intent | Development Workflow | Dev Session + machine `work.json` | runtime allocation or formal proof |
| Source identity | Git | checkpoint commit | deployment endpoint |
| Workspace/profile/slot/lease | Local Dev Control Plane | machine registry + live observation | task completion |
| Runtime deployment and launch | Make/platform runtime owners | resolved runtime manifest | product assertion |
| Journey actions and assertions | Business Domain | shared Journey implementation | provisioning or evidence publication |
| Formal product evidence | Acceptance Framework | Evidence Store | development progress |
| Review and merge judgment | Quality Framework | quality evidence + code review | product implementation |

## 5. Execute-State Machine
```text
DECLARING
  -> BOUND
  -> REPRODUCING
  -> REPRODUCED
  -> IMPLEMENTING
  -> FOCUSED_CHECKING
  -> FOCUSED_PASS
  -> CHECKPOINTING
  -> CHECKPOINTED
  -> DEPLOYING
  -> DEPLOYED
  -> FUNCTIONAL_RUNNING
  -> FUNCTIONAL_PASS
  -> ACCEPTANCE_READY
  -> ACCEPTANCE_UPDATING
  -> FINAL_CHECKPOINTED
  -> ACCEPTANCE_RUNNING
  -> ACCEPTANCE_PASS
  -> DELIVERY_READY

REPRODUCING | FOCUSED_CHECKING | DEPLOYING | FUNCTIONAL_RUNNING
  -> BLOCKED

FOCUSED_CHECKING -> FAILED -> IMPLEMENTING
FUNCTIONAL_RUNNING -> FAILED -> IMPLEMENTING
source/runtime identity drift -> STALE -> earliest invalidated state
cancellation -> CLEANING -> CANCELLED
```

Transition rules:

- `BOUND` requires an atomically published, conflict-free resource declaration
  that is read back from the machine-wide ledger.
- `REPRODUCED` requires a named Journey and one concrete first failure.
- `FOCUSED_PASS` proves only the touched source boundary.
- `CHECKPOINTED` requires a clean, Git-addressable local commit.
- `DEPLOYED` requires observed runtime identity matching the checkpoint.
- `FUNCTIONAL_PASS` requires its work-class boundary; product behavior requires the real product path and receiver perspective.
- `ACCEPTANCE_READY` permits Acceptance injection; it is not Acceptance proof.
- `FINAL_CHECKPOINTED` binds the promoted Journey and its adapters to final
  source. Product/Journey changes return to focused checking; Acceptance-only
  packaging proceeds to formal execution.
- `DELIVERY_READY` requires the execution plan's required Acceptance and Quality
  obligations, not only `FUNCTIONAL_PASS`.
- A failed product Journey returns to implementation. A runtime/provisioning
  failure becomes `BLOCKED` and must not be reported as a product failure.

## 6. Development Loop

```text
Reproduce once
  -> identify owning layer and first failure
  -> implement root-cause correction
  -> run focused source checks
  -> create local checkpoint commit
  -> resolve profile and acquire capabilities
  -> deploy exact checkpoint through Make
  -> run one real Journey
       -> FAIL: return first failure to implementation
       -> BLOCKED: park environment edge
       -> PASS: promote to Acceptance-ready
```

The loop excludes coverage, broad Gate matrices, cross-platform cells, Gap
Detector, Completion Auditor and submit-time review. Unit and contract tests
remain mandatory; only formal Acceptance execution and growth are deferred.

## 7. Shared Journey Contract
A Journey is a business-owned sequence with:

- a stable ID and product acceptance references;
- required actors, clients and service roles;
- visible user actions;
- receiver-perspective assertions;
- negative and recovery assertions;
- explicit runtime class;
- focused and functional budgets;
- promotion targets in Acceptance.

One Journey implementation is consumed by:

```text
Dev Runner
  - current work item only
  - first-failure output
  - machine-local transient artifacts
  - no product readiness publication

Acceptance Runner
  - full provisioning and source attestation
  - immutable Evidence Store output
  - complete cleanup and proof semantics
  - product capability publication
```

The Journey contract exists before implementation. Its first executable adapter
may be built for reproduction and Dev execution, then promoted into the
Acceptance Gate rather than rewritten. Runtime setup, evidence finalization and
reporting remain runner-specific.

## 8. Checkpoint And Authorization Contract
Every execution plan declares one authorization envelope:

```yaml
checkpoint:
  localCommit: allowed
  amend: allowed | denied
delivery:
  push: allowed | denied
  pullRequest: allowed | denied
runtime:
  deployProfiles: [<profile-id>]
  destructiveResetScopes: []
history:
  rewrite: denied
```

Rules:

- `localCommit: allowed` permits bounded checkpoint commits throughout the
  approved workstream without repeated prompts.
- A checkpoint commit is a deployable source identity, not a delivery claim.
- Push, PR, destructive reset and history rewrite remain separate capabilities.
- Deployment still acquires the Local Dev Control Plane's exclusive
  `station.deploy` lease.
- Reset additionally requires a run-scoped `station.reset` authorization.
- Dirty-source overlay, rsync and remote manual edit are forbidden.

## 9. Verification Classes
| Class | Meaning | Can Claim Product Works |
|---|---|---|
| `SOURCE_CHECK` | unit, typecheck, compile or focused contract check passed | no |
| `STRUCTURAL_CHECK` | registry, static source or schema relation passed | no |
| `UX_REVIEW` | prototype or screenshot contract reviewed | no |
| `FUNCTIONAL_CHECK` | exact-source real product Journey passed | only that Journey |
| `ACCEPTANCE_PROOF` | required formal Gate evidence is current and valid | only declared capability scope |

The Development Workflow never translates `SOURCE_CHECK`,
`STRUCTURAL_CHECK`, or `UX_REVIEW` into `FUNCTIONAL_PASS`.

## 10. Budget And Retry Semantics
- Every command has a declared timeout and one purpose.
- Every Journey defines focused-check and functional-run budgets; no implicit
  unbounded default is legal.
- A timeout stops the current action, captures the first failure and enters
  cleanup.
- Idempotent observation may retry once when the Journey contract permits it.
- Deploy, reset and other mutation are never automatically retried.
- The same `(checkpoint, journey, runtime binding, command digest)` result is
  reused within one Dev Session instead of rerun.
- A source, profile, service binding or live runtime identity change invalidates
  the affected result.

## 11. Concurrency And Resource Semantics
- One Dev Session owns one active Journey.
- Product source work may use parallel lanes only for disjoint write sets.
- Checkpoint creation, deployment, shared Fixture mutation and final Journey
  execution have one integrator owner.
- Worktrees may share `station.connect`; deploy/reset remain exclusive.
- Two Journey runs cannot share client storage, local slot or mutable Fixture.
- Cancellation always performs reverse-order client, process, port and lease
  cleanup.

## 12. Allowed And Forbidden Relationships
Allowed:

- Development Workflow publishes source/resource intent to machine `work.json`.
- Development Workflow asks Local Dev Control Plane to resolve and lease
  resources.
- Dev Runner reuses business Journey functions and platform driver primitives.
- Acceptance Runner promotes the same Journey after `FUNCTIONAL_PASS`.
- Quality Framework consumes formal Acceptance evidence at delivery time.

Forbidden:

- Editing or runtime acquisition before the public declaration is confirmed.
- Treating a declaration as proof that a process or runtime lease is active.
- Acceptance planner automatically expands and runs broad Gates inside the red
  development loop.
- A static Gate marks a Dev Session `FUNCTIONAL_PASS`.
- A Gate deploys Station, selects Profile or resets Fixture.
- A page, Harness or API-only shortcut replaces a visible user action required by
  the Journey.
- Plan documents accumulate raw command output or per-attempt narratives.
- One failed Journey launches unrelated platform or Domain Gates.
- Missing authorization falls back to implicit commit, deploy, reset, push or
  history rewrite.

## 13. Architecture Quality Gates
The architecture is successfully implemented only when:

- A synthetic product change cannot enter Acceptance before `FUNCTIONAL_PASS`.
- Two worktrees with overlapping exclusive write/resource declarations cannot
  both enter `BOUND`.
- A backend-only, UI, infrastructure and refactor work item each resolve a valid
  Journey or verification class.
- A remote Journey cannot run before checkpoint commit and runtime source match.
- A static-only pass cannot produce a product-functional claim.
- A product failure reports exactly one first failed Journey step.
- A provisioning failure remains distinct from product failure.
- Duplicate execution of the same run identity is rejected or reused.
- Cancellation and timeout release every acquired lease and process.
- Dev artifacts write only under the machine Dev root.
- The execution plan remains a compact current-state ledger.
- Chat Direct and three-client Group Journeys complete through Dev Runner, then
  the same business assertions complete through Acceptance Runner.
- The Chat pilot records `broadAcceptanceRunsBeforeFunctionalPass=0`,
  `duplicateRunCount=0` and bounded `timeToFirstFailureMs`.
