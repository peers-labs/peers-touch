---
name: pt-cursor-host-adapter
description: Binds approved Peers-Touch worker or UI actions to Cursor developer tools. Use only after a host-neutral owner detects Cursor and repository-native automation cannot complete the action.
stage: cross-stage
requires: ["approved host-neutral action", "explicit Cursor host identity", "current tool inventory"]
produces: ["host transport result", "typed capability failure"]
---

# Cursor Host Adapter

This Skill translates an already-approved project action into Cursor
capabilities. It owns no product semantics, scheduling, proof, or durable
workflow state.

## Invoke When

- Invoked only by `pt-dev-workflow` after `ACTION_ALLOWED` with one approved
  `HostCapabilityRequest`.
- Explicit runtime metadata identifies the current host as Cursor.

`CURSOR_TRACE_ID`, `TERM_PRODUCT`, and the active tool namespace may corroborate
runtime metadata. A `.cursor` directory or installed `cursor-agent` binary is
not host identity.

## Required Discipline

1. Accept only an admitted `HostCapabilityRequest` from `pt-dev-workflow`.
   Project-native execution is resolved before adapter invocation and is never
   performed by this adapter.
2. Inspect the current tool registry for Cursor capabilities before selecting
   one.
3. Use Cursor browser/devtools/computer-use capabilities only when actually
   exposed; do not invent stable tool names from documentation or memory.
4. Use Cursor worker/background-agent capabilities only for lanes already
   approved by `pt-goal-orchestrator`.
5. Preserve the approved binding, `workdir`, write set, verification, and
   integrator return contract.
6. If the capability is not exposed, return
   `HOST_CAPABILITY_UNAVAILABLE` with `host=cursor`; the owner may continue
   serially or through project-native automation.

## UI Interaction

- Prefer DOM/accessibility identifiers and observable postconditions.
- Re-observe after navigation or state-changing actions.
- Coordinate-only actions are transport hints and cannot establish
  `FUNCTIONAL_CHECK`.
- Browser-only automation cannot substitute for a required native Tauri,
  Appium, or physical-device Journey.
- Any external side effect remains governed by the current host's confirmation
  policy and the Plan authorization envelope.

## Worker Transport

When the requested capability is `worker`, map each approved lane to Cursor's
currently exposed background-agent or subagent tool. Preserve the Goal
objective, binding, write set, verification, and return contract. If Cursor
does not expose an addressable worker API in the current session, return
`HOST_CAPABILITY_UNAVAILABLE`; the parent recomputes serial execution.

Do not turn Cursor task metadata into Plan, Task, or Session state.

## Output

Return exactly one:

```text
HOST_ADAPTER_READY
HOST_CAPABILITY_UNAVAILABLE
HOST_TOOL_CALL_FAILED
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
- `host=cursor`;
- requested capability;
- unchanged `nativeAttempted` and `adapterAttempted=true`;
- actual exposed Cursor tool used;
- observed postcondition;
- artifact and cleanup result;
- `resourceId` for any possibly live host side effect;
- `cleanupHandle` for any possibly live host side effect.
- `cleanupAttempt=1` for cleanup and post-cleanup observations.

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

- make Cursor a repository dependency;
- infer capability from `.cursor` configuration;
- invent a Cursor tool that is absent from the current registry;
- let a browser or coordinate action establish native product PASS;
- invoke repository-native fallback from inside the adapter;
- recursively request cleanup after cleanup has failed;
- change the host-neutral schedule, authorization, or evidence requirement;
- ask the user to execute an interaction that an available project driver can
  perform.
