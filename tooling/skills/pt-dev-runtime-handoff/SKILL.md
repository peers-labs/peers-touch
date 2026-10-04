---
name: pt-dev-runtime-handoff
description: Owns host-neutral Peers-Touch runtime launch, interaction, exact-source verification, Session projection, and cleanup. Use after code changes need a real product Journey or formal Acceptance.
---

# Dev Runtime Handoff

> Environment source: `docs/global/local-dev-environment.md`

## Goal

Prepare the required Station/Desktop runtime under one of two policies:

- `development`: run one exact-source product Journey, report the first failure,
  and write only Development diagnostics.
- `acceptance`: run formal Native Tauri Acceptance and publish source-bound
  Evidence Store artifacts.

Both policies consume the same business Journey. They must not duplicate or
weaken product actions and assertions.

This Skill is the project owner for runtime verification. TRAE, Cursor, Codex,
and future hosts are optional tool transports. They never own the Journey,
PASS/FAIL interpretation, Development Session transition, or cleanup policy.

## Control Layers

```text
pt-dev-workflow
  -> pt-dev-runtime-handoff
       -> repository-native runtime and Journey driver
       -> deterministic Journey oracle
       -> Development Session result commit
       -> scoped cleanup
       -> missing Host Capability Need
  -> pt-goal-orchestrator projects Host Capability Request
  -> Guardian-admitted Host Capability Request
       -> selected host transport adapter
       -> observation returned to pt-dev-runtime-handoff
```

Use this priority order:

1. Repository-owned Make targets and runtime control plane.
2. Repository-owned Acceptance Harness, embedded WebDriver, Appium, native
   driver, accessibility driver, or an independently owned Web-product driver
   required by the Journey.
3. A detected host adapter only for an interaction the project driver cannot
   perform.
4. User interaction only when the remaining assertion is inherently
   subjective or a DWF-D20 external authorization/destructive boundary applies.

Host tools can perform actions and collect observations. Only the
project-defined oracle can classify the Journey.

## Native Desktop Verification Architecture

```text
Python Journey gate
  -> Selenium W3C client
  -> embedded WebDriver server
  -> native macOS Tauri WKWebView
  -> Desktop Rust BFF
  -> Station
```

The WebDriver plugin and `window.__TAURI__` are enabled only in the
`acceptance-webdriver` build. Browser shells, coordinate automation, mocks, and
API-only receiver proof are forbidden substitutes.

The same native driver may run under the non-publishing `development` policy or
the formal `acceptance` policy. Host UI automation is not a third proof policy.

## Host Capability Need

When a project-native path lacks a required interaction:

1. Return one typed capability need plus whether the repository-native attempt
   already ran; do not create a `HostCapabilityRequest`.
2. Dev Workflow asks `pt-goal-orchestrator`, the sole request projector, to bind
   the need to one approved action, request ID, host and adapter.
3. Dev Workflow invokes the adapter only after `ACTION_ALLOWED`.
4. If no adapter or capability is available, Dev Workflow persists
   `HOST_CAPABILITY_UNAVAILABLE` with the scheduler-owned immutable request
   identity and continues any remaining project-native verification. Block the
   current Task only when that missing interaction is mandatory for the Journey
   and no repository driver can perform it; do not reissue the unchanged
   request.

An unknown future host follows the same capability contract. Add a new child
adapter without changing Journey or Session semantics.

## Runtime Selection

- `make desktop`: interactive development runtime.
- `make acceptance-driver-build`: build the feature-gated native Acceptance
  binary.
- `make acceptance-driver-smoke`: verify native URL, DOM, global Tauri API,
  process teardown, and port release.

Restart Station when changes touch Station, schema, or generated protocol code.
Rebuild the Acceptance binary when changes touch Desktop Rust, Desktop UI, the
Acceptance harness, or driver feature wiring.

Before either policy:

```bash
make dev-check WORK_ITEM=<id>
```

The public declaration must name the Profile, local slot, client storage and
Station capability intent. The declaration does not replace Local Dev leases.

## Agent Station Safety Gate

Local and compose-managed Station modes are human-developer-only capabilities.
Agents MUST NOT start, access, or test against a Station on `127.0.0.1`,
`localhost`, or another loopback address.

Before any command that may ready or access Station, including `make station`,
`make desktop`, `make mobile`, restart targets, or an
environment-backed Acceptance Gate:

1. Run `make config`.
2. Verify `PT_STATION_MODE=remote`.
3. Verify `PT_STATION_DEPLOY_ENV` is non-empty and user-approved.
4. Verify `PT_STATION_URL` is non-loopback and matches the approved node.

Fail closed on missing, local, compose, loopback, defaulted, or mismatched
values. After this preflight, `make station` is the correct command for the
remote deploy/restart/health closure. Do not replace it with ad hoc SSH or
local process commands.

## Development Policy

Use after focused checks and an authorized checkpoint:

```text
make config
  -> verify approved remote profile
make station                # only when Station source changed
make desktop                # interactive Native development runtime
run one declared Journey
  -> PASS: FUNCTIONAL_CHECK for that Journey
  -> FAIL: first actionable product failure only
  -> BLOCKED: environment/driver/authorization owner
reverse-order cleanup
```

Development policy:

- does not allocate an Acceptance Evidence Store run;
- does not run coverage, Gap Detector, broad Gate bundles or cross-platform
  matrices;
- persists transient logs/screenshots under the workspace Development path;
- cannot publish `PROVEN`;
- must use the product runtime required by the Journey.
- drives available interactions itself; it does not ask the user to reproduce
  a deterministic Journey that repository or host tools can operate.

## Acceptance Policy

```bash
make config
# Verify remote mode, approved deploy env, and non-loopback PT_STATION_URL.
make station

python3 -m pip install -r tooling/acceptance/requirements.txt
make acceptance-driver-build
make acceptance-driver-smoke

CHAT_ACCEPTANCE_RESET=1 \
CHAT_DESKTOP_DOM_STATION_URL="${PT_STATION_URL}" \
make acceptance-chat-desktop-dom

CHAT_ACCEPTANCE_RESET=1 \
CHAT_NATIVE_STATION_URL="${PT_STATION_URL}" \
make acceptance-chat-native-two-client
```

Native Chat gates use the committed disposable dev-account fixture from
`apps/station/app/conf/actor.yml`; do not require a separate password
environment variable for these public test accounts.

The two-client Gate must prove Alice send, Bob receiver DOM with the same
message ID/body, unread badge increment/clear, and receiver restart recovery.

## Evidence Contract

Require:

- runner and validator JSON;
- native screenshots and DOM snapshots;
- redacted app logs;
- Station live build metadata;
- per-client WebDriver/gateway/profile/storage metadata;
- bounded step timing;
- secret scan;
- native process and port release audit.

Do not claim Acceptance from a smoke check, API result, browser render, or
manual screenshot.

## Functional Result Commit

The runtime result and Development Session must not diverge:

1. Before the Journey, transition the Session through the legal source,
   checkpoint, deploy, and `FUNCTIONAL_RUNNING` states owned by
   `pt-dev-workflow`.
2. Bind the runner result to the same work item, Plan, Task, Journey, source
   commit/tree, runtime binding, and artifact root.
3. On deterministic PASS, persist `FUNCTIONAL_CHECK/PASS` and
   `FUNCTIONAL_PASS` in the same owner-controlled result-commit slice.
4. On deterministic FAIL, persist the first actionable failure and return to
   the owning implementation loop.
5. On environment or driver failure, persist a typed runtime blocker without
   classifying product behavior.
6. Reject stale, substituted, or out-of-order evidence with
   `SESSION_EVIDENCE_OUT_OF_SEQUENCE`.

Use the owner command for PASS:

```bash
make dev-functional-result \
  WORK_ITEM=<id> \
  REASON='<run and commit current closure>' \
  [RUNTIME_CELL=<cell>]
```

The owner command starts the Acceptance Development runner itself for the
current Task closure; it accepts no caller-selected Gate or result path. The
runner returns one private aggregate manifest reference containing every
required Gate. The Session owner verifies canonical run manifests and every
referenced source/runtime/cleanup artifact, seals a self-contained evidence
bundle, and only then derives the Session verification and runtime binding
digest.

A report that says PASS while the Session remains `CHECKPOINTING`,
`CHECKPOINTED`, `DEPLOYING`, `DEPLOYED`, or `FUNCTIONAL_RUNNING` is
`SESSION_PROJECTION_STALE`. Dev Workflow repairs the projection from the
source-bound runner result before Task closure; Context Anchor only reports the
mismatch.

## Debug Lifecycle

Debug instrumentation and host diagnostic tools are subordinate to this
runtime owner:

- Store transient artifacts under the workspace Development session root, not
  the repository.
- Use a bounded lease and idle timeout; `--idle 0` is forbidden.
- Request host diagnostics only through the admitted adapter's isolated
  diagnostic sidecar. Never enter a host debugger workflow in this owner turn.
- Commit the deterministic project result and Session transition before any
  host diagnostic cleanup or confirmation wait; Task progression remains with
  Dev Workflow.
- After that commit, remove runtime-owned instrumentation and stop
  runtime-owned processes automatically.
- A host tool's optional confirmation or retention workflow is host-local
  state. It cannot overwrite a deterministic Journey result or become a Task
  blocker.
- Consume `HOST_DIAGNOSTIC_RETAINED` only with `blocksPlanRun=false`,
  `cleanup=retained-bounded`, and a concrete `leaseExpiresAt`.
  Return to Dev Workflow immediately; leave bounded sidecar cleanup outside the
  project result-commit path.
- Ask the user only when the remaining oracle is manual/subjective or the next
  UI action crosses the host's external-side-effect confirmation policy.

## Failure Inspection

1. Runner's first failed bounded step.
2. Native app logs and WebDriver process liveness.
3. Rust messaging engine and queue lifecycle.
4. `messagingProjection` and owning runtime.
5. projection store.
6. stable DOM selector and component rendering.
7. Host adapter result only when the repository-native driver lacked the
   interaction.

Fix state at its owning layer. Do not add page-mount refreshes or polling to
mask a missing runtime transition.

## Handoff Report

Report:

- policy: `development` or `acceptance`;
- Station URL and live commit;
- exact Gate commands and PASS/FAIL;
- conversation/message IDs;
- evidence paths;
- process/port/storage cleanup result;
- selected host adapter or `none`;
- Session result-commit status;
- explicit unproven scope.

For development policy, report only verification class, Journey, first failure,
runtime identity and cleanup. For Acceptance policy, include immutable evidence
references and proof state.

## Anti-Patterns

Never:

- Run without a current public Development declaration.
- Use Acceptance policy to diagnose the first product failure.
- Publish Development diagnostics as Acceptance proof.
- Maintain separate Dev and Acceptance Journey implementations.
- Replace Native actions with browser, coordinate-only, Harness-only or
  API-only shortcuts.
- Require TRAE, Cursor, Codex, or another host for a project-native Journey.
- Let a host adapter decide PASS, write Session state, or weaken the required
  runtime.
- Ask the user to perform a deterministic interaction available to a project
  driver or exposed host adapter.
- Leave a deterministic PASS in a non-functional Session state.
- Let host debugger confirmation or cleanup policy block Task progress.
- Start an unbounded debug server or leak an owned runtime resource.
