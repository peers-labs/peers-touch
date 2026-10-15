---
name: pt-execution-plan-guardian
description: Evaluates one proposed Peers-Touch action against explicit scope, accepted architecture, real authorization, current source identity, and resource policy. Read-only; not an executor.
stage: cross-stage
requires: ["explicit proposed action", "canonical worktree", "current source", "applicable authorization and resource policy"]
produces: ["ACTION_ALLOWED | ACTION_BLOCKED | ACTION_DECISION_REQUIRED"]
---

# Execution Plan Guardian

This Skill evaluates one concrete action. A Plan or optional task record may
describe scope but never grants authority.

## Inputs

- canonical worktree, branch, and current HEAD;
- exact action, targets, expected side effects, and rollback;
- explicit request scope and applicable accepted product/architecture sources;
- applicable authority: request scope for source work and local commit, Profile
  capability for non-stable development operations, or explicit authorization
  for stable mutation, publish, history rewrite, and destructive delivery;
- actual runtime resource state for operations that need it;
- optional explicit Plan path/taskId as planning context.

Never read OWNER, Action Receipt, declaration, PlanMount, Session, active-work,
or close receipts as permission.

## Decision

Return:

- `ACTION_ALLOWED`: action is within scope and all concrete guards pass.
- `ACTION_BLOCKED`: a factual permission, safety, source, or resource guard
  fails.
- `ACTION_DECISION_REQUIRED`: accepted sources cannot decide a material
  product, architecture, security, privacy, compatibility, or rollout choice.

The decision is action-specific. A blocked deploy does not block independent
source work.

## Checks

1. The canonical worktree is the one explicitly selected by the request.
2. Every write target is inside the allowed source scope.
3. No worktree create/switch/remove/prune occurs without explicit user request.
4. Current source identity matches the action's prepared source.
5. The action follows accepted architecture and platform standards.
6. Local commit is allowed for a coherent verified task-owned change.
   Non-stable development operations derive authority from the reviewed
   Profile and capability; separately governed operations have exact
   authorization.
7. Runtime actions pass Profile, capability, target/scope, stable protection,
   topology, source, and OS-held lease checks at their concrete entrypoint.
8. Verification and cleanup are proportionate to the action.

## Boundaries

The Guardian does not:

- execute commands;
- create or mutate Plans or task records;
- issue runtime leases or delivery permissions;
- weaken a product or Acceptance contract;
- treat Hook availability as authority;
- infer permission from task state, test success, or prior unrelated actions.

## Output

```text
Decision: ACTION_ALLOWED | ACTION_BLOCKED | ACTION_DECISION_REQUIRED
Action:
Source:
Scope:
Authorization:
Resource guards:
Reason:
```

## Verification

- The decision cites current facts, not workflow metadata.
- A Plan or task record alone never changes the result.
- Missing Hook identity never blocks ordinary work.
- Actual resource and delivery guards remain fail-closed.
