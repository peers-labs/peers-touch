---
kind: invariant
title: Project execution semantics are independent of the agent host
status: active
owns:
  - AGENTS.md
  - docs/global/workflow.md
  - docs/architecture/development-workflow/
  - tooling/skills/pt-goal-orchestrator/
  - tooling/skills/pt-dev-runtime-handoff/
  - tooling/skills/pt-trae-host-adapter/
  - tooling/skills/pt-cursor-host-adapter/
  - tooling/skills/pt-codex-host-adapter/
  - tooling/skills/pt-defect-closure/
referenced-by:
  - docs/architecture/development-workflow/decisions.md
related:
  - docs/knowledge/invariants/continuous-plan-run.md
  - docs/knowledge/invariants/dev-resource-declaration-before-write.md
detected: 2026-09-19
---

# Project execution semantics are independent of the agent host

## What must hold

Peers-Touch owns scheduling, authorization, product Journeys, verification
classes, Development Session state, formal evidence, and cleanup semantics.
TRAE, Cursor, Codex, and future agent hosts may provide worker, browser,
desktop UI, or diagnostic tools only through a detected host adapter.

Repository-native Make, Harness, WebDriver, Appium, accessibility, and browser
drivers take priority and determine proof strength. Host identity comes from
explicit current-runtime metadata, corroborated by the exposed tool inventory
or host-injected environment markers. Installed directories and binaries are
not current-host identity.

A missing host capability degrades only that transport. It does not block a
safe serial schedule or a project-native Journey. A deterministic
`FUNCTIONAL_CHECK/PASS` must be committed to `FUNCTIONAL_PASS` before Task
closure; a host debugger confirmation gate cannot replace that state owner.
Runtime Handoff reports a missing capability and native-attempt state;
`pt-goal-orchestrator` alone projects the Host Capability Request, and only Dev
Workflow invokes an adapter after Guardian admission. Adapters never execute
repository-native fallback. Dev Workflow persists one immutable unavailable
request and may unblock it only after a new `HOST_CAPABILITY_AVAILABLE`
observation. A failed cleanup is represented once as a bounded
`HOST_CLEANUP_QUARANTINED` lease; it cannot recursively request cleanup or stop
independent ready Tasks. One post-expiry `inspect-quarantine` observation may
commit `HOST_CLEANUP_RELEASED`; a still-live side effect becomes
`HOST_CLEANUP_ESCALATION_REQUIRED`, never a second cleanup attempt. Repeated,
identity-changing, and pre-expiry blocked observations fail closed.

Host-specific debuggers run only in an adapter-owned isolated diagnostic
sidecar, never in the Dev Workflow or Runtime Handoff owner turn. Once the
project oracle closes, Session and Task progression precede host cleanup. A
confirmation-retained diagnostic returns immediately as
`HOST_DIAGNOSTIC_RETAINED` with `blocksPlanRun=false`,
`cleanup=retained-bounded`, and a concrete `leaseExpiresAt`; it is a transient
host observation, not a Session state, Task blocker, or Plan Run boundary.

The canonical flow is developed and distributed from `peers-dev-workflow`, but
the installed implementation executes in each consuming worktree. It derives
that consumer's canonical root, `workspaceId`, Plan binding, Session, and
machine-local active-work record. Host neutrality must never introduce a
central runtime-state dependency on the workflow source repository.

## Why this is non-negotiable

Developers use different agent hosts. If the project names one host as its
scheduler, debugger, product operator, or proof owner, the same accepted Plan
changes meaning across environments. Host-specific confirmation and retention
policies can also create split-brain where runtime evidence says PASS while the
Development Session remains blocked.

Adapters preserve access to useful host tools without making those tools part
of the project architecture.

## How to verify

- `tooling/scripts/review/skill-check.sh` passes.
- `rg -n "pt-trae-goal-orchestrator|use \`TRAE-debugger\` workflow" AGENTS.md docs/global docs/architecture/development-workflow tooling/skills` returns no live contract references.
- `pt-goal-orchestrator` requires no named host runtime.
- `pt-dev-runtime-handoff` contains `HOST_CAPABILITY_UNAVAILABLE`,
  `SESSION_PROJECTION_STALE`, and repository-native driver priority.
- TRAE, Cursor, and Codex adapter Skills exist and state that they cannot own
  scheduling, proof, or Session mutation.
- Adapter outputs contain no project-native fallback path, and cleanup failure
  has one bounded quarantine terminal state.
- TRAE diagnostics require an isolated diagnostic sidecar, while Runtime
  Handoff and Dev Workflow require the non-blocking
  `HOST_DIAGNOSTIC_RETAINED` return fields and never name a host debugger.
- Agent integration verification executes the installed copy from at least two consuming
  roots and proves distinct workspace IDs and active-work paths.
- `make agent-integration-audit ROOT=<worktree-root>` passes after semantic source
  integration and `make skills IDE=<host>`; active sessions restart from
  durable state rather than hot-swapping their Skill catalog.

## Crosswalks

- DWF-D21 defines the host-neutral owner and adapter boundary.
- DWF-D20 defines the continuous Plan Run that consumes the scheduler output.
- DWF-D22 separates workflow source distribution from runtime-state ownership.
- DWF-D26 binds IDE enforcement to one immutable conversation execution root
  and treats each hook target as a separate subject root.
