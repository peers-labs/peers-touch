# Workflow Snapshot - Acceptance Matrix

> **Status**: active
> **Version**: v4.0
> **Updated**: 2026-10-13
> **Owner**: Platform Team

| ID | Journey / Risk | Action | Expected Result | Evidence |
|---|---|---|---|---|
| WFS-A01 | ordinary work | Read a temporary Git root with no task records | Current source is returned and no task state is created | Workflow Snapshot tests |
| WFS-A02 | explicit tasks | Store two task IDs | Both are listed; neither is inferred as current | Task progress tests |
| WFS-A03 | recovery | Interrupt after event append and before snapshot replacement | Journal recovers the snapshot | Task progress tests |
| WFS-A04 | irrecoverable corruption | Tamper snapshot bytes without updating checksum | Selected task returns a typed failure | Task progress tests |
| WFS-A05 | source freshness | Commit source after evidence was recorded | Old task evidence is invalidated | Task progress tests |
| WFS-A06 | partial failure | Corrupt one task record | Valid tasks remain visible | Snapshot tests |
| WFS-A07 | workspace isolation | Read one valid and one unavailable workspace | Valid row remains and unavailable row is typed | Snapshot tests |
| WFS-A08 | one-shot lifecycle | Invoke `make workflow-snapshot` | One JSON document is emitted; no task, listener, PID, process, or lease is created | Process and filesystem assertions |

## Non-Claims

- Snapshot freshness does not prove a task is executing.
- Task progress does not create registration or runtime ownership.
- Snapshot output does not authorize mutation or satisfy product Acceptance.
