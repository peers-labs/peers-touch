# Complex Applet Implementation Plan

> **Status**: superseded
> **Date**: 2026-06-06
> **Owner**: Architecture Team
> **Scope**: Task-level plan for reaching `L3 COMPLEX_DESKTOP_READY`
> **Superseded by**: [`2026-06-23-applet-capability-completion-plan.md`](./2026-06-23-applet-capability-completion-plan.md)

> This document is archived as historical context. Do not use it as the active
> execution source for new applet capability work.

---

## 1. Goal

This plan turns the architecture into AI-executable development tasks.

The target is not a hello-world applet. The target is:

```text
L3 COMPLEX_DESKTOP_READY
  → a conforming complex applet package runs in Peers-Touch Desktop
  → Lynx UI renders
  → backend service binding works through Host Gateway
  → skills are discoverable and invokable
  → agent/AI streaming reaches Host UI
  → long-running tasks can start/progress/cancel/finish
  → allowed and denied capability calls are audited
  → session destroy invalidates further work
```

Web, Mobile, HarmonyOS, and Station Store remain required for later platform readiness, but they must not block the first useful Desktop acceptance milestone.

---

## 2. Non-Negotiable Boundaries

- Peers-Touch must not reference any concrete producer repository, source path, package name, business domain, or applet id.
- Host reads only a package directory and package contract.
- Applet code uses only `@peers-touch/applet-sdk` for Host capabilities.
- Applet code never receives service base URLs, Station tokens, model provider keys, raw tool registry, system log access, or audit write access.
- Standalone mode can exist for producer-owned independent operation, but Peers-Touch integrated acceptance must run through Host Gateway.

---

## 3. Workstream Overview

| Workstream | Purpose | Blocks |
|------------|---------|--------|
| C0 Contract Complex Slice | Make package, services, skills, streams, tasks, AI, telemetry machine-checkable | All other workstreams |
| S1 SDK Complex Surface | Give applet code stable public APIs | Runtime and producer acceptance |
| G2 Gateway Minimal Complex Slice | Execute service/network/skill/task/agent/telemetry with policy and audit | Desktop complex acceptance |
| D3 Desktop Runtime Integration | Load complex package and connect Bridge/Gateway/UI events | L3 readiness |
| T4 Tooling and Evidence | Validate, package, test, smoke, and produce evidence bundle | AI verification |
| A5 External Complex Acceptance | Run an external conforming package without reverse coupling | L3 readiness |

Dependency order:

```text
C0 → S1 → G2 → D3 → T4 → A5
```

`T4` may start early, but its final commands must validate the implemented slices.

---

## 4. C0 Contract Complex Slice

### Objective

Make `packages/applet-contract` the single source of truth for complex applet acceptance.

### Write Scope

- `packages/applet-contract/`
- generated schema output owned by `packages/applet-contract`
- consumers may import generated types/schemas, but must not define duplicate schema semantics

### Required Types

- `AppletManifest`
- `AppletEntry`
- `AppletServiceDeclaration`
- `AppletServiceBinding`
- `AppletSkillDeclaration`
- `AppletPermission`
- `CapabilityMethod`
- `BridgeInvokeRequest`
- `BridgeInvokeResponse`
- `BridgeEventEnvelope`
- `AppletError`
- `TaskHandle`
- `TaskSnapshot`
- `TaskEvent`
- `SkillDescriptor`
- `SkillInvokeRequest`
- `SkillInvokeResult`
- `AgentStreamEvent`
- `TelemetryEvent`

### Required Capability Methods

```text
app.getContext
lifecycle.reportReady
network.request
storage.get
storage.set
storage.remove
storage.clear
config.get
system.getInfo
ui.showToast
events.subscribe
skills.register
skills.list
skills.invoke
tasks.start
tasks.get
tasks.cancel
agent.startSession
agent.send
agent.stream
ai.generate
ai.chat
telemetry.track
telemetry.reportError
```

### Manifest Requirements

The schema must support:

- `targets`
- `entries.lynx`
- `permissions`
- `services[]`
- `services[].id`
- `services[].kind`
- `services[].binding`
- `services[].allowedMethods`
- `services[].allowedPaths`
- `services[].streaming`
- `skills[]`
- `skills[].id`
- `skills[].inputSchema`
- `skills[].streaming`
- `integrity`

### Verification

```bash
pnpm applet:contract-test
pnpm applet:validate <valid-complex-package>
pnpm applet:validate <invalid-package>
```

Before the commands exist, this workstream must provide lower-level package scripts and mark the top-level commands as `NOT_IMPLEMENTED` in the evidence bundle.

### Pass Criteria

- Unknown permission fails.
- Missing service binding fails.
- Invalid skill input schema fails.
- Bridge request/response envelopes include stable `requestId`.
- Stream/task events include stable `requestId` or `taskId`.
- Session-destroyed invoke has a typed `INVALID_SESSION` error.

---

## 5. S1 SDK Complex Surface

### Objective

Make `@peers-touch/applet-sdk` sufficient for complex applet code without Host-private access.

### Write Scope

- `packages/applet-sdk/`
- SDK tests under the package
- runtime simulator hooks only if they are SDK-owned

### Public APIs

The SDK must expose:

```typescript
sdk.app.getContext()
sdk.lifecycle.reportReady()
sdk.network.request({ service, path, method, headers?, body?, stream? })
sdk.storage.get/set/remove/clear/getInfo()
sdk.config.get(key)
sdk.system.getInfo()
sdk.ui.showToast/showLoading/hideLoading/showModal()
sdk.events.on/subscribe/unsubscribe()
sdk.skills.register/list/invoke/onStream()
sdk.tasks.start/get/cancel/onEvent()
sdk.agent.startSession/send/stream()
sdk.ai.generate/chat()
sdk.telemetry.track/reportError/mark()
sdk.invoke()
```

### Adapter Rules

- `LynxBridgeAdapter` is the production Desktop/Mobile path.
- `WebHostBridgeAdapter` is the production Web Host path.
- `StandaloneBridgeAdapter` is only for non-integrated standalone operation.
- Applet business code must not import adapters directly.

### Required Tests

- Each public method emits the correct `CapabilityMethod`.
- `requestId` is preserved across success, denial, and error.
- Typed errors are normalized.
- Stream handlers receive ordered events.
- Cancellation calls use the task/stream contract.

### Pass Criteria

- No public SDK method exposes token, base URL, provider key, tool executor, system log, or audit writer.
- Complex surface is testable with fake BridgeAdapter.
- Forbidden access scan has no unexplained applet business-layer hits.

---

## 6. G2 Gateway Minimal Complex Slice

### Objective

Implement the minimum Host Gateway behavior required by complex Desktop acceptance.

### Write Scope

- Desktop Host Gateway modules under `apps/desktop/`
- shared gateway contract adapters if already established
- no applet producer-specific paths or names

### Required Handlers

```text
network.request
config.get
storage.*
system.getInfo
ui.*
skills.register
skills.list
skills.invoke
tasks.start
tasks.get
tasks.cancel
agent.startSession
agent.send
agent.stream
ai.generate
ai.chat
telemetry.track
telemetry.reportError
```

### Service Binding Resolver

The Gateway must resolve service calls through:

```text
appletId + sessionId + serviceId + path + method
  → manifest service declaration
  → dev attach override or installed policy
  → resolved endpoint
  → sanitized upstream request
```

Rules:

- Applet sends `service + path`, not a raw base URL.
- Gateway validates method/path/body/header policy.
- Gateway injects Host/Station credentials when policy allows.
- Gateway never logs sensitive request or response bodies.
- Service binding resolution failure returns typed error.

### Stream and Task Rules

- Stream events must carry `requestId`.
- Task events must carry `taskId`.
- Cancellation must propagate to upstream work when supported.
- After cancellation, no more progress events should be delivered except a final `cancelled` event.
- Session destruction cancels or rejects session-bound work.

### Audit Rules

Audit must record:

- `requestId`
- `appletId`
- `sessionId`
- `method`
- `serviceId?`
- `status`
- `denialReason?`
- `durationMs`

Applet code cannot write audit events.

### Pass Criteria

- Allowed and denied calls are both audited.
- Unknown service fails.
- Disallowed path fails.
- Missing permission fails.
- Quota/policy denial returns typed error.
- Provider credentials and internal executor details never reach applet.

---

## 7. D3 Desktop Runtime Integration

### Objective

Make Desktop run a complex package end to end.

### Write Scope

- Desktop applet package reader
- Desktop Lynx Host integration
- Desktop Bridge dispatcher
- Desktop Host UI surface for skills/tasks/agent stream events

### Required Flow

```text
package path
  → manifest validation
  → integrity validation
  → service binding override/policy load
  → session creation
  → Lynx bundle load
  → SDK reportReady
  → Gateway calls
  → stream/task events to Host UI
  → audit output
  → session destroy
```

### Dev Attach

Desktop must support a local dev attach shape:

```bash
pnpm applet:desktop-smoke <package-dir> \
  --service primary-api=http://127.0.0.1:8088
```

The actual CLI may differ, but the capability must exist: service overrides are passed to Host/Gateway, not baked into applet source.

### Pass Criteria

- Lynx bundle renders.
- `sdk.config.get` can read Host-provided binding metadata without exposing the raw base URL unless explicitly allowed.
- `sdk.network.request({ service, path })` reaches the bound backend through Gateway.
- `sdk.skills.list` returns declared/registered skills after policy filtering.
- `sdk.skills.invoke` can succeed and fail.
- `sdk.agent.stream` can deliver ordered stream events.
- `sdk.tasks.cancel` stops further progress events.
- Destroyed session returns `INVALID_SESSION`.

---

## 8. T4 Tooling and Evidence

### Objective

Make AI and humans prove readiness through commands, not statements.

### Required Commands

```bash
pnpm applet:validate <package-dir>
pnpm applet:contract-test
pnpm applet:desktop-smoke <package-dir>
pnpm applet:forbidden-producer-scan
```

### Evidence Bundle

The smoke command or its wrapper must produce:

```text
applet-readiness-evidence/
├── summary.md
├── contract/
├── sdk/
├── package/
├── desktop/
│   ├── host-load-output.txt
│   ├── service-binding-output.txt
│   ├── skills-output.txt
│   ├── tasks-streaming-output.txt
│   ├── agent-ai-output.txt
│   ├── gateway-allow-deny-output.txt
│   └── audit-output.txt
└── producer-independence/
```

### Pass Criteria

- Missing command means readiness cannot exceed the level stated in `development-runtime-readiness-report.md`.
- Evidence files cannot be empty.
- Unimplemented gates must say `NOT_IMPLEMENTED`.
- Producer-specific terms must not appear in Peers-Touch docs, scripts, or Host code.

---

## 9. A5 External Complex Acceptance

### Objective

Use an external conforming complex package to prove Peers-Touch behavior without reverse coupling.

### Input

A package directory that conforms to `applet-contract` and contains:

- Lynx bundle;
- manifest;
- integrity;
- service declarations;
- skill declarations;
- schemas;
- no dependency on Peers-Touch internal source layout.

### Required Command

```bash
pnpm applet:desktop-smoke <package-dir> \
  --service primary-api=<dev-service-url>
```

### Required Scenarios

- Package validates.
- Desktop loads and renders.
- Service binding resolves.
- Backend request succeeds through Gateway.
- Backend request denied by allowlist fails.
- Skill list works.
- Skill invoke succeeds.
- Skill invoke denied fails.
- Agent/AI stream emits ordered events.
- Task cancellation works.
- Telemetry reports diagnostic event.
- Audit is generated for every allowed/denied capability.
- Session destroy invalidates further invoke.

### Final L3 Claim

Peers-Touch may claim `L3 COMPLEX_DESKTOP_READY` only if all A5 scenarios pass and the evidence bundle is attached.

---

## 10. AI Task Prompt Template

When assigning implementation to AI, use this format:

```markdown
Task: <workstream id + title>

Read first:
- docs/architecture/applet-runtime/README.md
- docs/architecture/applet-runtime/complex-applet-acceptance.md
- docs/architecture/applet-runtime/execution-plans/2026-06-06-complex-applet-implementation-plan.md
- relevant platform agent doc if editing Desktop/Mobile/Station

Write scope:
- <paths>

Do not edit:
- <paths>

Deliver:
- <concrete files / commands / tests>

Acceptance:
- <pass/fail cases>

Forbidden:
- No producer-specific path, name, business domain, or source layout.
- No Host-private API exposed to applet.
- No raw token/base URL/provider key/system log/audit writer exposed.
```
