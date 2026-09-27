---
name: pt-trae-host-adapter
description: Binds approved Peers-Touch worker or UI actions to TRAE tools. Use only after a host-neutral owner detects TRAE and repository-native automation cannot complete the action.
stage: cross-stage
requires: ["approved host-neutral action", "explicit TRAE host identity", "current tool inventory"]
produces: ["host transport result", "typed capability failure"]
---

# TRAE Host Adapter

This Skill translates an already-approved project action into TRAE capabilities.
It owns no product semantics, scheduling, proof, or durable workflow state.

## Invoke When

- Invoked only by `pt-dev-workflow` after `ACTION_ALLOWED` with one approved
  `HostCapabilityRequest`.
- Explicit runtime metadata identifies the current host as TRAE.

Do not invoke from directory names, installed binaries, or the presence of
`~/.trae*`.

## Required Discipline

1. Accept only an admitted `HostCapabilityRequest` from `pt-dev-workflow`.
   Project-native execution is resolved before adapter invocation and is never
   performed by this adapter.
2. Inspect the current tool registry before naming a TRAE tool.
3. For macOS desktop UI interaction, load and follow
   `TRAE-computer-use-ptc` when it is available in the current host.
4. Prefer a purpose-built browser, WebDriver, or MCP capability over coordinate
   automation.
5. Use TRAE worker tools only for lanes already approved by
   `pt-goal-orchestrator`; preserve their binding, write set, and return
   contract.
6. If a required capability is not exposed, return
   `HOST_CAPABILITY_UNAVAILABLE` with `host=trae` and the missing capability.

## Debugging Boundary

`TRAE-debugger` is an optional diagnostic collector, not the Peers-Touch debug
owner. Invoke it only when its own trigger conditions apply and only inside an
isolated diagnostic sidecar or subagent owned by this adapter. Never enter its
workflow in the Dev Workflow or Runtime Handoff owner turn. If the current host
cannot isolate that lifecycle, return `HOST_CAPABILITY_UNAVAILABLE` for the
diagnostic capability.

Its artifacts, confirmation workflow, and cleanup policy cannot:

- determine `FUNCTIONAL_CHECK`;
- mutate Task or Session state;
- block a project-native deterministic PASS;
- require an unbounded Debug Server lease.

Give the sidecar a bounded idle timeout and lease before invocation. When the
project oracle has already closed but TRAE policy retains diagnostics pending
confirmation, return to Dev Workflow immediately without waiting for that
confirmation:

```text
status=HOST_DIAGNOSTIC_RETAINED
blocksPlanRun=false
cleanup=retained-bounded
resourceId=<host-local-resource>
cleanupHandle=<idempotent-handle>
leaseExpiresAt=<concrete-RFC3339-UTC-expiry>
observationRef=<host-local-observation>
```

These are transient adapter-return fields, not a Development Session state or
Task blocker. The sidecar may retain its host-local confirmation workflow only
until `leaseExpiresAt`; project progression remains owned by Dev Workflow.

## Worker Transport

When the requested capability is `worker`, translate the host-neutral Goal
Slice into TRAE's currently exposed Goal or subagent tool:

- preserve Objective, Progress Contract, binding, lane ownership, and
  completion boundary exactly;
- add `/goal` syntax only when the active TRAE tool requires it;
- reconcile live agents through the current registry before spawning;
- return `HOST_CAPABILITY_UNAVAILABLE` when no Goal/subagent tool is exposed so
  the parent can schedule serial execution.

The translated TRAE Goal is ephemeral transport, not a second project plan.

## Output

Return exactly one:

```text
HOST_ADAPTER_READY
HOST_CAPABILITY_UNAVAILABLE
HOST_TOOL_CALL_FAILED
HOST_DIAGNOSTIC_RETAINED
HOST_CLEANUP_QUARANTINED
HOST_CLEANUP_ESCALATION_REQUIRED
```

For `HOST_TOOL_CALL_FAILED`, also return `retryable: true|false`, the bounded
cleanup result, and whether any worker/UI side effect may still be live. The
adapter never retries or falls back by itself; `pt-dev-workflow` owns that loop.

Include:

- unchanged `requestId` and `actionId` from the admitted request;
- unchanged Session, Plan, Task, workspace, Journey, source-commit, and runtime
  binding tuple;
- `host=trae`;
- requested capability;
- unchanged `nativeAttempted` and `adapterAttempted=true`;
- actual exposed TRAE tool used;
- observed postcondition;
- artifact paths owned by the host adapter;
- `resourceId` for any possibly live host side effect;
- `cleanupHandle` for any possibly live host side effect;
- `cleanupAttempt=1` for cleanup and post-cleanup observations;
- cleanup result or bounded retention state.

For a cleanup request, release only the named `cleanupHandle`, make the
operation idempotent, and return `cleanup=released`. A cleanup request itself
must never emit another cleanup request. If release cannot complete within the
single admitted cleanup attempt, return `HOST_CLEANUP_QUARANTINED` with
`cleanup=retained-bounded`, the same handle, a concrete `leaseExpiresAt`, and
an observation reference. Retry, fallback, quarantine reconciliation, and
parking decisions remain with Dev Workflow.

For `operation=inspect-quarantine`, perform one read-only post-expiry
observation. Return `HOST_ADAPTER_READY` with `cleanup=released` when the side
effect is gone, otherwise return `HOST_CLEANUP_ESCALATION_REQUIRED`. Never
invoke cleanup from that observation.

## Anti-Patterns

Never:

- treat TRAE as a repository dependency;
- call Computer Use without its active Skill contract;
- let a coordinate click establish product PASS;
- ask the user to reproduce a Journey the available project driver can run;
- convert a TRAE tool failure into a product failure;
- keep an idle-zero diagnostic service alive;
- invoke repository-native fallback from inside the adapter;
- recursively request cleanup after cleanup has failed;
- change the host-neutral schedule or evidence requirement.
