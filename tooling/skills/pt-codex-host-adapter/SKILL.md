---
name: pt-codex-host-adapter
description: Binds approved Peers-Touch worker or UI actions to Codex tools. Use only after a host-neutral owner detects Codex and repository-native automation cannot complete the action.
stage: cross-stage
requires: ["approved host-neutral action", "explicit Codex host identity", "current tool inventory"]
produces: ["host transport result", "typed capability failure"]
---

# Codex Host Adapter

This Skill translates an already-approved project action into capabilities
exposed by the current Codex host. It owns no product semantics, scheduling,
proof, or durable workflow state.

## Invoke When

- Invoked only by `pt-dev-workflow` after `ACTION_ALLOWED` with one approved
  `HostCapabilityRequest`.
- Explicit runtime metadata identifies the current host as Codex.

`CODEX_HOME`, `TERM_PRODUCT`, and the active tool namespace may corroborate
runtime metadata. An `.agents` directory or installed `codex` binary is not
host identity.

## Required Discipline

1. Accept only an admitted `HostCapabilityRequest` from `pt-dev-workflow`.
   Project-native execution is resolved before adapter invocation and is never
   performed by this adapter.
2. Inspect the current tool registry for Codex capabilities before selecting
   one.
3. Use exposed multi-agent tools only for lanes already approved by
   `pt-goal-orchestrator`.
4. Use only an exposed Codex browser/computer-use capability for the admitted
   UI request. Project Playwright remains owned by Runtime Handoff and is never
   invoked from this adapter. Do not assume Codex provides native desktop
   control.
5. Preserve the approved binding, `workdir`, write set, verification, and
   integrator return contract.
6. If the capability is absent, return `HOST_CAPABILITY_UNAVAILABLE` with
   `host=codex`; the owner may continue serially or through project-native
   automation.

## UI Interaction

- Prefer DOM/accessibility identifiers and observable postconditions.
- Browser Playwright is valid only for a browser Journey.
- A required native Tauri or mobile Journey stays with the repository
  WebDriver/Appium/native driver.
- Host screenshots and clicks are diagnostics unless the accepted Journey
  explicitly defines them as assertions.
- External side effects remain governed by the current host's confirmation
  policy and the Plan authorization envelope.

## Worker Transport

When the requested capability is `worker`, map each approved lane to the
currently exposed Codex multi-agent or subagent tool. Preserve the Goal
objective, binding, write set, verification, and return contract. If no
addressable worker API is exposed, return `HOST_CAPABILITY_UNAVAILABLE`; the
parent recomputes serial execution.

Do not turn Codex task metadata into Plan, Task, or Session state.

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
- `host=codex`;
- requested capability;
- unchanged `nativeAttempted` and `adapterAttempted=true`;
- actual exposed Codex tool used;
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

- make Codex a repository dependency;
- infer capability from `.agents`, `$CODEX_HOME`, or an installed CLI alone;
- invent a Codex tool that is absent from the current registry;
- let browser evidence substitute for required native proof;
- invoke repository-native fallback from inside the adapter;
- recursively request cleanup after cleanup has failed;
- change the host-neutral schedule, authorization, or evidence requirement;
- ask the user to execute an interaction that an available project driver can
  perform.
