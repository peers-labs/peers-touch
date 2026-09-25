# Host-Neutral Goal Slice Review Rubric

Score each dimension from 0 to 2.

| Dimension | Pass condition |
|---|---|
| Source grounding | Every instruction projects an authoritative source or owner decision |
| Stage purity | The Slice stays inside one methodology stage |
| Slice closure | The Slice is dependency-, ownership-, evidence-, recovery-, and scope-closed |
| Queue completeness | Every in-scope action is in the Ready Queue, in progress, Parked Queue, or done |
| Queue liveness | A blocked action enters the Parked Queue while the Ready Queue continues |
| Progress contract | The Slice targets one Task closure with an exact `+1` delta |
| Reporting boundary | Supporting actions cannot end the Slice |
| Dynamic admission | New deliverables return `PLAN_AMENDMENT_REQUIRED` |
| Exhaustion proof | An exhaustion proof requires no ready action or legal remediation |
| Scope fidelity | Work and remainder match the owning source |
| Dependency fidelity | The Goal does not invent or remove semantic dependencies |
| Worktree binding | Explicit shell-safe root, including a root containing whitespace, branch, workspace, Plan, and HEAD are fail-closed |
| Concurrency decision | Mode follows dependency, write, runtime, verification, and integration analysis |
| Worker ownership | Parallel workers have disjoint writes and exact return contracts |
| Worker reconciliation | Only live, addressable, equivalent workers block |
| Host neutrality | Scheduling is complete before any host adapter is selected |
| Adapter boundary | Host tools supply transport only and cannot change permission or evidence |
| Reconciliation | One integrator verifies interfaces, diffs, and combined behavior |
| Failure routing | Every hard stop routes to its owning Skill |
| Claim discipline | Task closure cannot imply stage, Plan, or product completion |

Interpretation:

- `36-40`: executable.
- `30-35`: conditionally executable after named corrections.
- `<30`: reject.

## Mandatory Rejection Conditions

Reject regardless of score when:

- an equivalent live worker already owns overlapping source or runtime;
- stale worker metadata is treated as a live conflict;
- no current stage or current Task can be resolved;
- the worktree binding is incomplete, inferred from a Skill path, or mismatched;
- Plan identity is inferred from branch or repository contents;
- a mutating action lacks the bound root as explicit `workdir`;
- the Goal permits unauthorized branch or worktree topology changes;
- the Goal crosses a stage review boundary;
- an EXECUTE Goal has no approved Plan or matching tracked state;
- the Goal changes product, architecture, or Plan semantics;
- the Goal, scheduler, Guardian, or host adapter writes owner state;
- concurrent writers or mutable runtime resources overlap;
- execution mode is selected from task count, speed preference, or host brand;
- the Goal lacks explicit Ready and Parked queues;
- one blocked action can block the whole Goal without frontier exhaustion;
- Goal completion is possible without closing the target Task;
- the Goal asks the user to continue despite a legal successor;
- a host-specific syntax or tool is required to understand the schedule;
- host detection is inferred from installed directories or binaries;
- host capability failure is promoted to a product failure;
- the scheduler invokes a Host Adapter instead of projecting the request for
  Dev Workflow after Guardian admission;
- host adapter output weakens the required evidence class;
- dynamic admission can change product behavior, ownership, topology,
  version/schema policy, destructive authorization, or proof strength.

When sources are valid but the Goal text is defective, return findings followed
by one corrected host-neutral Goal.
