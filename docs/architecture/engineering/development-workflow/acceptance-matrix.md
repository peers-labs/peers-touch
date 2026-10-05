# Development Workflow Acceptance Matrix

> **Status**: active
> **Created**: 2026-09-26 | **Updated**: 2026-10-05
> **Owner**: Platform Team
> **Module**: `tooling/scripts/local-dev/`, `tooling/scripts/plan/`

---

| ID | Capability / Journey | Decision | Action | Observable Result | Evidence |
|---|---|---|---|---|---|
| DEV-A01 | DEV-J01 integration | DWF-D33/D35/D36 | Install without an existing Hook grant | Canonical integration projects and callback proof passes | Integration audit |
| DEV-A02 | Owner lineage | DWF-D33 | OWNER assigns worker/reviewer children across roots | One execution root; exact lineage; cross-root write denied | Binding/Kernel tests |
| DEV-A03 | Host fail-closed | DWF-D33 | Omit root identity, blocking hook, or child assignment | Typed denial with no mutation | Host-adapter negative tests |
| DEV-A04 | Completion review | DWF-D28 | Complete without current review | ExecutionRun transition is rejected | Plan/run tests |
| DEV-A05 | Review drift | DWF-D24/D28 | Change source or obligations after PASS | Receipt becomes stale; completion remains open | Review invalidation tests |
| DEV-A06 | Forbidden legacy | DWF-D28 | Review source contains declared forbidden path | Review fails with the residue | Completion fixtures |
| DEV-A07 | DEV-J02 snapshot | DWF-D27/D29/D38 | Run `make workflow-snapshot` during an active run | Mount, run, Task, activity, review, and health are joined read-only | Snapshot contract tests |
| DEV-A08 | Loop activity | DWF-D29 | Repeat terminal action fingerprint without progress | Snapshot marks looping; progress does not change | Reducer tests |
| DEV-A09 | Stall activity | DWF-D29 | Stop heartbeat receipts | Snapshot marks stalled with last activity time | Injected-clock tests |
| DEV-A10 | One-shot projection | DWF-D27/LDCP-D19 | Invoke Workflow Snapshot | One bounded document; no listener/browser/PID/lease | Process and port audit |
| DEV-A11 | Operating guide | DWF-D30 | Run documented commands from clean source | Commands exist and return documented typed state | README truth audit |
| DEV-A12 | Doctor failure | DWF-D30 | Break Hook, mount, run, or review freshness | Doctor exits non-zero and names the failed promise | Doctor tests |
| DEV-A13 | Doctor healthy | DWF-D30 | Run Doctor against consistent owner state | All required owners resolve from machine state | Doctor end-to-end |
| DEV-A14 | Review handoff | DWF-D28/D37 | Prepare/submit independent review | Exact capability and immutable request produce one receipt | Review capability tests |
| DEV-A15 | Partial snapshot | DWF-D27 | Make one owner unreadable | Other owners remain; typed partial finding appears | Snapshot tests |
| DEV-A16 | Continuation | DWF-D27 | Evaluate active, terminal, and exhausted runs | Only owner state produces CONTINUE/COMPLETE/HARD_BLOCK | Reducer tests |
| DEV-A17 | Source reopen | DWF-D24/D28 | Stale a completed Task receipt | Invalidation owner reopens the earliest affected Task closure | Reopen tests |
| DEV-A18 | Overlay isolation | DWF-D25/D33 | Overlay expands scope/lineage/authorization | Kernel ignores policy influence and denies action | Overlay tests |
| DEV-A19 | Plan mount | DWF-D38 | Mount a frozen Plan authored in another worktree | Snapshot binds selected workspace without editing Plan source | Plan mount tests |
| DEV-A20 | Mount conflict | DWF-D38 | Concurrently mount two live Plans to one workspace | Exactly one succeeds; the other gets `PLAN_MOUNT_CONFLICT` | Concurrency tests |
| DEV-A21 | Explicit unmount | DWF-D38 | Agent tries to change/unmount an unfinished run | No mutation; explicit owner action required | Authorization tests |
| DEV-A22 | Resource aggregation | DWF-D32 | Multiple modules request shared/exclusive resources | One all-or-none fenced PlanResourcePlan selects resources and parks conflicts | Resource-plan tests |
| DEV-A23 | Native Desktop only | DWF-D39/D-18 | Scan Desktop commands, runtime schemas, Gates, provisioners, and matrices | Native Tauri is the only Desktop runtime/proof path | Native-only source gate |
| DEV-A24 | Native proof | DWF-D39/D-18 | Execute Desktop product Journey | Real Tauri window/input/screenshot and receiver-visible evidence pass | Native runtime-cell Gate |
| DEV-A25 | Close resume | DWF-D41 | Interrupt after one owner release and retry exact `dev-close` selector | Same receipt advances without duplicate owner state | Development close tests |
| DEV-A26 | Exact close ownership | DWF-D38/D41 | Cancel/release with wrong mount owner or orphan selector | Typed denial with no state mutation | Plan mount/run tests |
| DEV-A27 | Standalone close | DWF-D40/D41 | Close explicit no-Plan work | Declaration releases; Session/active-work/mount remain not applicable | Development close tests |
| DEV-A28 | Close readiness | DWF-D41 | Audit before and after coordinated close | Only exact CLOSED receipt with no pending resource passes | Completion audit fixtures |

## Acceptance Rules

- Static checks do not substitute for native Desktop product proof.
- Workflow Snapshot output does not authorize mutation or satisfy product
  Acceptance.
- Completion proof binds current source, obligations, snapshot, run, and
  evidence digests.
- Historical browser results and completed browser Plans remain audit history
  only.
- Declaration release alone is not close evidence; `close-ready` consumes the
  exact `DevelopmentCloseReceipt`.
- Output must not expose credentials, raw conversation identifiers, canonical
  roots, or user-home paths.
