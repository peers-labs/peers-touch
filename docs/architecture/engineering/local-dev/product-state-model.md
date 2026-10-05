# Workflow Snapshot - Product State Model

> **Status**: active
> **Version**: v3.0
> **Created**: 2026-09-23 | **Updated**: 2026-10-04
> **Owner**: Platform Team
> **Module**: `tooling/scripts/local-dev/`

---

## 1. Invocation State

```text
requested
  -> reading
  -> emitted
  -> exited

reading
  -> partial     one or more typed source failures
  -> failed      root projection cannot be produced
```

There is no serving, refreshing, connected-client, or resident state.

## 2. Worktree Visibility

| State | Condition | Allowed Claim |
|---|---|---|
| discovered | Current `git worktree list` contains the root | Current Git identity |
| observed-only | Observation exists without registration | Observation freshness only |
| managed | Machine registration exists | Profile and slot binding |
| mounted | One live PlanMount targets the workspace | Plan occupancy |
| historical | Only released/terminal owner records remain | History only |
| missing | Owner history exists but Git no longer discovers the root | Diagnostic only |

## 3. Workflow Consistency

| State | Condition |
|---|---|
| consistent | Mount, snapshot, run, declaration, Session, active-work, and Git identities agree |
| stale | An expiring projection is old but does not claim a live resource |
| blocked | A required owner is absent or malformed |
| conflict | Multiple live owners or identity mismatch |
| unavailable | A bounded read failed |

Snapshot never repairs or infers an owner.

## 4. Environment Health

| State | Condition |
|---|---|
| ready | Required profile and observed runtime state agree |
| warning | Non-authoritative observation is stale or unavailable |
| blocked | Required registration, capability, or topology is absent |
| conflict | Slot, lease, process, or source identity conflicts |
| unregistered | Git worktree has no machine registration |

Environment health cannot change ExecutionRun or Task state.

## 5. Durable Readback

- Git facts are captured per invocation and are not persisted as authority.
- Mount, run, declaration, Session, active-work, registry, and lease owners
  retain their own schemas and stores.
- Workflow Snapshot has no ticket, browser selection, service identity, PID,
  endpoint, lease, or cache owner.
- Output is a disposable redacted projection.
