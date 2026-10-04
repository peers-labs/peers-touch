# Workflow Snapshot - Acceptance Matrix

> **Status**: active
> **Version**: v3.0
> **Created**: 2026-09-23 | **Updated**: 2026-10-04
> **Owner**: Platform Team
> **Module**: `tooling/scripts/local-dev/`

---

| ID | Journey / Risk | Action | Expected Result | Evidence |
|---|---|---|---|---|
| WFS-A01 | WFS-J01 / discovery | Create two unregistered temporary worktrees | Snapshot contains two distinct workspace rows with current Git identity | Workflow Snapshot tests |
| WFS-A02 | owner join | Create one consistent mount, run, declaration, Session, and active-work fixture | Snapshot reports one consistent current Task | Workflow Snapshot tests |
| WFS-A03 | mount conflict | Provide conflicting live mounts for one workspace | Snapshot reports conflict and selects neither | Plan mount + snapshot tests |
| WFS-A04 | stale projection | Expire a declaration while retaining terminal history | History remains visible and contributes no live occupancy | Workflow Snapshot tests |
| WFS-A05 | environment separation | Inject profile or slot failure for an active Task | `environmentHealth` changes while Task state remains unchanged | Workflow Snapshot tests |
| WFS-A06 | partial failure | Corrupt one workspace record | That row is typed invalid; valid rows remain | Workflow Snapshot tests |
| WFS-A07 | redaction | Build a snapshot from real machine paths and profiles | No canonical root, credential, raw profile, log, or product payload appears | Redaction tests |
| WFS-A08 | one-shot lifecycle | Invoke `make workflow-snapshot` | One JSON document is emitted; no listener, browser, PID, or lease remains | Process/port audit |
| WFS-A09 | browser hard cut | Scan commands, Gates, environments, provisioners, and source | No Peers Dev browser UI/server, 4177 resource, or browser Gate exists | Architecture and Acceptance source checks |

## Non-Claims

- Snapshot freshness does not prove a Task is executing.
- Git discovery does not create registration, mount, declaration, or lease.
- Snapshot output does not authorize mutation or satisfy product Acceptance.
- Historical browser evidence does not prove current Desktop behavior.
