# Complex Applet Acceptance Profile

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-06-06 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Scope**: Minimum Peers-Touch platform capabilities required to run a complex applet, not only a hello-world applet

---

## 1. Purpose

Peers-Touch applet runtime is useful only if it can run a complex applet with real product value.

The first acceptance target is therefore not a static UI bundle. The platform must support a conforming applet package that contains:

- a Lynx / TypeScript UI;
- a declared Peers-Touch SDK dependency;
- a declared backend service endpoint or managed service binding;
- multiple declared capabilities;
- registered skills;
- streaming agent or long-running task output;
- local storage and user/session context;
- network calls through Host Gateway;
- diagnostics and audit;
- optional file/media import as a deferred but explicitly modeled capability.

This document intentionally describes a **generic complex applet profile**. Peers-Touch must not encode the name, source path, directory layout, or business model of any producer package.

---

## 2. Non-Negotiable Acceptance Principle

The platform is not acceptable if it only proves:

```text
manifest loads
  → bundle renders
  → reportReady succeeds
```

The platform is acceptable only when it proves:

```text
complex package validates
  → Host creates governed session
  → UI renders through Lynx
  → SDK registers capability surface
  → skills are discoverable and invokable
  → network/service calls route through Gateway
  → streaming or long-running output reaches Host UI
  → denied capability fails safely
  → allowed capability succeeds
  → audit and diagnostics are emitted
  → session teardown invalidates further work
```

---

## 3. Required Complex Applet Capabilities

| Capability | Required | Peers-Touch Owner | First Acceptance Requirement |
|------------|----------|-------------------|------------------------------|
| Package contract | Yes | `applet-contract` | Manifest declares entries, targets, permissions, services, skills, integrity |
| Lynx UI runtime | Yes | Runtime Host | Desktop loads and renders Lynx bundle without DOM/iframe dependency |
| SDK public API | Yes | `applet-sdk` | Applet depends only on SDK, not Host private objects |
| Config binding | Yes | SDK + Gateway | Applet reads declared config keys through `config.get`, not environment variables |
| Network proxy | Yes | Gateway | Applet service calls go through `network.request` with allowlist, size, header, and audit policy |
| Service binding | Yes | Station + Host Gateway | Manifest can declare service dependencies and base endpoint binding resolved by Host |
| Skill registration | Yes | SDK + Skill Gateway | Applet can register or declare skills with input schema and display metadata |
| Skill invocation | Yes | SDK + Gateway | Host can invoke a skill and receive typed success/failure |
| Streaming output | Yes | SDK + Gateway | Skill/agent emits progress, tool events, partial output, final result, and error |
| Long-running task | Yes | Gateway + Station | Applet can start, observe, cancel, and receive completion/error for task-like work |
| Agent / LLM capability | Yes | AI Gateway + Station | Applet can request governed AI/agent work without provider tokens or internal runtime access |
| Storage | Yes | SDK + Gateway | Per-applet local state is available with quota and namespace isolation |
| UI feedback | Yes | SDK + Host UI | Toast/loading/modal/action sheet can be driven by Host UI |
| Diagnostics | Yes | SDK + Telemetry Gateway | Applet can report diagnostic errors and performance markers |
| Audit | Yes | Gateway + Station | Host writes allowed/denied invoke audit; applet cannot forge audit |
| File/media import | Deferred but modeled | File/Media Gateway | Contract has future-safe permission and sandbox model; first release may deny with typed error |
| Cross-platform parity | Deferred after Desktop | Runtime Hosts | Desktop is first hard gate; Web/Mobile parity follows contract tests |

---

## 4. SDK Surface Required For Complex Applets

The basic SDK MVP is insufficient. Complex applet acceptance requires this minimum public surface:

```typescript
export interface PeersAppletSDK {
  readonly app: AppRuntimeAPI
  readonly lifecycle: LifecycleAPI
  readonly navigation: NavigationAPI
  readonly network: NetworkAPI
  readonly storage: StorageAPI
  readonly config: ConfigAPI
  readonly system: SystemAPI
  readonly ui: UIAPI
  readonly events: EventAPI
  readonly skills: SkillAPI
  readonly tasks: TaskAPI
  readonly agent: AgentAPI
  readonly ai: AIAPI
  readonly telemetry: TelemetryAPI
  invoke<T>(method: CapabilityMethod, params?: unknown): Promise<T>
}
```

### 4.1 Skill API

```typescript
export interface SkillAPI {
  register(spec: SkillSpec): Promise<void>
  list(): Promise<SkillDescriptor[]>
  invoke<TInput, TOutput>(skillId: string, input: TInput, options?: SkillInvokeOptions): Promise<SkillResult<TOutput>>
  onStream(skillId: string, handler: (event: SkillStreamEvent) => void): Unsubscribe
}
```

Rules:

- Skill input schema must be declared.
- Skill invocation must produce typed success/failure.
- Streaming events must have request/task identifiers.
- Host may hide or deny skills by policy even if manifest declares them.

### 4.2 Task API

```typescript
export interface TaskAPI {
  start<TInput>(input: TaskStartInput<TInput>): Promise<TaskHandle>
  get(taskId: string): Promise<TaskSnapshot>
  cancel(taskId: string): Promise<void>
  onEvent(taskId: string, handler: (event: TaskEvent) => void): Unsubscribe
}
```

Rules:

- Long-running analysis, batch evaluation, import, and agent work must not be modeled as a single blocking request.
- Task lifecycle must include `queued`, `running`, `progress`, `completed`, `failed`, `cancelled`.
- Task events are auditable and session-bound.

### 4.3 Agent / AI API

```typescript
export interface AgentAPI {
  startSession(input: AgentSessionInput): Promise<AgentSession>
  send(input: AgentMessageInput): Promise<AgentMessageResult>
  stream(input: AgentMessageInput, handler: (event: AgentStreamEvent) => void): Promise<AgentMessageResult>
}

export interface AIAPI {
  generate(input: GenerateInput): Promise<GenerateResult>
  chat(input: ChatInput): Promise<ChatResult>
}
```

Rules:

- Applet never receives provider keys, model credentials, raw tool registry, or internal prompt templates.
- Tool calls inside agent work are represented as sanitized stream events.
- Quota, permission, model access, and station policy are enforced by Gateway/Station.

### 4.4 Telemetry API

```typescript
export interface TelemetryAPI {
  track(event: TelemetryEvent): Promise<void>
  reportError(error: DiagnosticError): Promise<void>
  mark(input: PerformanceMark): Promise<void>
}
```

Rules:

- Telemetry is applet diagnostics, not Host system logs.
- Audit remains Host-authored only.
- Payloads are schema-validated and redacted.

---

## 5. Manifest Requirements

Complex applet manifest must support these declarations:

```json
{
  "id": "example.complex.applet",
  "version": "1.0.0",
  "targets": ["desktop"],
  "entries": {
    "lynx": "main.lynx.bundle"
  },
  "permissions": [
    "network.request",
    "storage.read",
    "storage.write",
    "skills.register",
    "skills.invoke",
    "tasks.run",
    "agent.invoke",
    "ai.chat",
    "telemetry.write"
  ],
  "services": [
    {
      "id": "primary-api",
      "kind": "http",
      "binding": "host-resolved",
      "allowedMethods": ["GET", "POST"],
      "allowedPaths": ["/api/v1/*"]
    }
  ],
  "skills": [
    {
      "id": "example-skill",
      "inputSchema": "schemas/example-skill.input.json",
      "streaming": true
    }
  ]
}
```

Rules:

- `services.binding` is resolved by Host or Station, not hardcoded by Peers-Touch.
- `allowedPaths` is a policy input, not a trust guarantee.
- Skills can be declared in manifest and registered at runtime, but both paths must converge into the same Skill Registry.
- Manifest is an upper bound; Station and Host policy can still deny.

---

## 6. Complex Acceptance Sandbox

### Scenario A: Package Validation

```text
Host receives package
  → validate manifest schema
  → verify bundle integrity
  → verify skill descriptors
  → verify service declarations
  → reject unknown permissions
```

Pass:

- Invalid skill schema fails.
- Unknown capability fails.
- Missing integrity fails.
- Producer path/name is not read.

### Scenario B: UI + Lifecycle

```text
Host creates session
  → loads Lynx bundle
  → SDK reports ready
  → Host emits show/hide/destroy
  → applet observes lifecycle through SDK
```

Pass:

- No DOM/iframe/postMessage dependency.
- Destroyed session rejects all invokes with `INVALID_SESSION`.

### Scenario C: Skill Invocation

```text
Host opens skill panel
  → lists declared/registered skills
  → user invokes skill
  → Gateway checks permission/policy/quota
  → service call executes through network/service binding
  → SDK returns typed result
```

Pass:

- Missing permission fails.
- Denied policy fails.
- Allowed invocation returns typed result.
- Allowed and denied cases are audited.

### Scenario D: Streaming Agent Work

```text
Applet starts agent stream
  → Gateway creates task/request id
  → agent emits thinking/tool_call/tool_result/final/error
  → Host UI receives stream events
  → final result closes stream
```

Pass:

- Stream events are ordered per request id.
- Cancellation terminates upstream work.
- Provider credentials and raw internal tool runtime never cross to applet.

### Scenario E: Long-running Task

```text
Applet starts long-running job
  → receives task id
  → subscribes to task events
  → progress emits
  → user cancels or task completes
```

Pass:

- Task survives short UI navigation if session remains valid.
- Task cancels on explicit cancel.
- Task is denied after session destroy unless policy explicitly allows background work.

### Scenario F: Diagnostics and Audit

```text
Applet reports diagnostic event
  → telemetry schema validates
  → payload redacts sensitive fields
Gateway writes audit for every capability call
```

Pass:

- Applet cannot write audit.
- Applet diagnostics cannot include secrets.
- Host audit includes request id, applet id, method, status, duration, denial reason.

---

## 7. Readiness Reclassification

The earlier "Desktop POC" target is not enough.

Readiness levels for applet platform work are now:

| Level | Meaning |
|-------|---------|
| `L1 DESIGN_READY` | Boundaries and capability domains are documented |
| `L2 HELLO_RUNTIME_READY` | A trivial applet package renders and basic SDK calls work |
| `L3 COMPLEX_DESKTOP_READY` | A complex applet package runs on Desktop with skills, streaming/task work, service binding, Gateway allow/deny, audit |
| `L4 COMPLEX_DEVELOPMENT_READY` | Third-party producers can build, validate, and test complex packages against SDK/contract without Peers-Touch internals |
| `L5 COMPLEX_PLATFORM_READY` | Desktop/Web/Mobile/Station Store support complex applets with parity gates |

The first meaningful milestone is **`L3 COMPLEX_DESKTOP_READY`**, not `L2`.

---

## 8. Current Verdict

Current design verdict: **directionally sufficient, but not implementation-ready without the task plan and evidence gates**.

Reasons:

- The complex acceptance surface now includes `skills`, `tasks`, `agent`, `ai`, `telemetry`, service binding, streaming, and audit.
- Manifest requirements include services and skill descriptors.
- The remaining gap is implementation execution: contract, SDK, Gateway, Desktop runtime, tooling, and evidence commands must be built in dependency order.
- Web/Mobile parity can remain deferred, but Desktop complex acceptance cannot.

Required execution source:

- `execution-plans/2026-06-06-complex-applet-implementation-plan.md`

Peers-Touch may not claim `L3 COMPLEX_DESKTOP_READY` until that plan's C0/S1/G2/D3/T4/A5 workstreams pass their evidence gates.
