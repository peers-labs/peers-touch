# Agent Delivery Recovery

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-08 | **Updated**: 2026-09-16
> **Owner**: Peers-Touch Agent Team
> **Approval**: OWNER_APPROVED 2026-09-16
> **Parent plan**: [Modern Chat Agent execution](./20260817-modern-chat-agent-v2-execution.md)

## 1. Approved Decision

Implement W2 and extract C11 Home
activation/deletion from W8b into a concern-atomic Home delivery. Allow that
delivery to progress while G-F stabilization remains open. Retain the complete
419-cell Foundation Gate, 33-cell Home Gate, seven-Gate source-bound final
proof set, and W9 readiness requirements unchanged.

The Owner approved this amendment on 2026-09-16. The parent plan now makes W2
the current product slice, removes complete G-F as its entry condition, and
requires W2 to own the complete C11 production cutover.

## 2. Evidence And Reason

- Before this amendment, the parent plan blocked W2/W4/W5/W7 on complete G-F
  proof.
- Before this amendment, Home activation was bundled into W8b with MCP,
  Connector, and Evaluation, so W2 alone could not deliver visible Home.
- Accepted MCA-D14 defines a Station-owned Home projection and a pure-renderer
  Home page; it does not require MCP, Connector, or Evaluation implementation.
  Their unavailable states must remain truthful.
- Repeated whole-Gate runs and Desktop rebuilds delayed product delivery.
  Intermittent lifecycle failures changed the first failing step without
  establishing a stable root cause. More elapsed time is not more evidence.
- `3/16` is a count of complete workstreams, not an estimate of product
  completeness or remaining effort. `39/45` historical atomic alignment does
  not prove complete user journeys; the nine combined capabilities remain
  unproven.

## 3. Home Closure

Sources: `modern-chat-agent/decisions.md` MCA-D14,
`modern-chat-agent/design.md` C11/A15,
`modern-chat-agent/experience-contract.md` V2-J01,
`modern-chat-agent/data-model.md`, and parent plan W2/W8b.
All paths are relative to `docs/architecture/agent/`.

| Order | Deliverable | Verification |
|---|---|---|
| 1 | Reconcile existing `model/domain/agent/home.proto` with accepted Agent-version, readiness, attachment, Chat admission, and Task-run contracts | Proto-first contract checks; no invented semantics |
| 2 | Station actor-scoped revisioned Home projection; atomic Chat creation/admission and idempotent Task creation/start through canonical owners | Focused success, duplicate/conflict, stale readiness, failure, and actor-isolation tests |
| 3 | Desktop Rust/Browser transport plus `homeRuntime`; Home reads one projection | Transport/runtime tests, restart, stale/partial slices, actor/Station switch reset |
| 4 | Atomically activate C11 and remove Home-owned aggregation/navigation-only submission; synchronize prototype and UI Identity | Add missing C11 old-path inventory; zero live old-authority references |
| 5 | Exercise accepted Home journeys and its unchanged 33-cell Gate | Receiver DOM, Station readback, command IDs, R-11 both orders, English/Chinese, Mobile contract, replay and cleanup |

User-visible result: select an Agent/model, submit Chat or Task from Home,
resume the accepted conversation/task, and recover it after restart. Rejected
input leaves the draft editable. This is not a cosmetic Home refresh.

Current implementation gaps:

- `home.proto` exists, but Home projection/command production wiring and
  `homeRuntime` are absent.
- `HomePage.tsx` derives recents/counts from client stores; its recent-topic
  action navigates to the Agent surface rather than the exact conversation.
- Current Chat creation precedes admission with compensating archival;
  current Task creation persists a pending record. Neither establishes the
  accepted atomic Home command contract.
- `tooling/acceptance/fixtures/agent_v2_old_paths.json` has no C11 entry.

## 4. Preserved Boundaries

- Station remains the single business authority. No live dual reads/writes,
  fallback, new compatibility layer, or client-side terminal truth.
- G-F remains `PARTIAL / UNPROVEN`; Home evidence cannot substitute for it.
- No G1 Image or G2 Video generation. Neither is deferred Peers-Touch work.
- No MCP/Connector/Evaluation activation or rejected-plugin retirement is
  silently moved into the Home closure. W8b retains those responsibilities.
- D11 and all existing runtime guards remain unchanged.
- No push/PR, worktree/branch switch, shared Station reset, or access to
  `station-two:18080`.
- Undefined contract semantics return to DESIGN; lower test thresholds,
  skipped matrix cells, stale cross-commit proof, and mock product APIs remain
  prohibited.

## 5. Immediate Execution Method

Execute one W2 vertical increment at a time: freeze the minimum contract, land
Station ownership through Desktop projection/UI, run focused checks, then run
the exact-source V2-J01 Journey. Do not run or expand the G-F matrix as a W2
precondition and do not build a new general Acceptance framework.

## 6. Independent Review Prompt

Review this approved delta and the parent plan, then read the accepted
MCA-D14/C11/A15 sources and the current Home proto, Station command owners,
Desktop Home page, runtime registry, and C11 deletion fixture.

Check actual prerequisites, atomic Chat/Task semantics, complete C11 consumer
deletion, unavailable downstream capability states, and the unchanged 33/419
cell proof requirements. Verify that separating C11 activation from W8b does
not create parallel authority or imply final readiness.

Return `passed`, `conditionally passed`, or `changes required`, with exact
source references and blocking decisions. Do not edit files or weaken the
approved product-first sequencing.
