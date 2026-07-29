# Agent LobeHub Fullstack Parity — M8 Tool / Plugin / Skill Parity Spec

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Station + Desktop Rust + Desktop
> **Plan Step**: PLAN-P4 / M8 pre-execution
> **Evidence**: EVID-011-H-pre
> **Gates**: GATE-006, GATE-008
> **Depends On**: EVID-010, EVID-012, EVID-013, EVID-014, EVID-015, EVID-016, EVID-017, EVID-018

---

## 1. Scope

M8 closes Tool/Plugin/Skill parity after Agent resource contracts and runtime events are ready.

This spec defines:

- Unified manifest and compatibility contract for built-in tools, plugin tools, skills and MCP tools.
- Agent-level enablement and binding semantics.
- Tool policy, approval and risk display.
- Desktop Rust execution boundary for local tools and MCP.
- Chat rendering for progress, approval, result, error and retry.
- Audit and trace linkage for every tool call.

This spec does not:

- Implement arbitrary shell execution.
- Let Desktop Web execute local tools directly.
- Claim Knowledge/File parity; M7 owns resources.
- Claim social Actor#agent tool exposure; M10 owns reserved social boundary.
- Start product implementation before revised prototype acceptance after EVID-010 `REVISION REQUIRED` and M1-M7 implementation evidence.

## 2. Source Basis

### 2.1 LobeHub Source

Canonical source map: `tool-knowledge-source-map.md`.

| Area | Source Path | Relevant Behavior |
| --- | --- | --- |
| Tool store composition | `external/lobehub/src/store/tool/store.ts`, `initialState.ts` | Tool store composes builtin, plugin, MCP, LobeHub skills, agent skills and document skills slices. |
| Tool discovery selectors | `external/lobehub/src/store/tool/selectors/tool.ts` | Merges discoverable builtins, plugins, Composio MCP and LobeHub skills; exposes manifest/UI/render control. |
| Builtin execution | `external/lobehub/src/store/tool/slices/builtin/action.ts`, `executors/` | Builtin executor invocation, loading state, install/uninstall scoped to user/workspace settings. |
| Plugin settings | `external/lobehub/src/store/tool/slices/plugin/action.ts` | Installed plugin refresh, settings update and JSON schema validation. |
| MCP install/connect | `external/lobehub/src/store/tool/slices/mcpStore/action.ts` | MCP install/test/cancel progress, config schema, cloud/local manifest conversion and error handling. |
| Tool engine | `external/lobehub/packages/context-engine/src/engine/tools/ToolsEngine.ts`, `ToolResolver.ts` | Filters by model/provider/function-call support and resolves operation/step tool sets. |
| Skill engine | `external/lobehub/packages/context-engine/src/engine/skills/SkillEngine.ts` | Builds operation-level skill set with enable checker. |
| Selected injections | `SelectedToolInjector.ts`, `SelectedSkillInjector.ts` | Injects user-selected tools/skills with dedupe against mentions. |
| Tool call processor | `external/lobehub/packages/context-engine/src/processors/ToolCall.ts` | Converts internal tool calls to provider-specific function-call format. |
| Human intervention | `external/lobehub/src/store/user/slices/settings/selectors/toolIntervention.ts` | Manual/allow-list/auto-run approval modes. |
| Builtin manifests/UI | `external/lobehub/packages/builtin-tool-*/src/manifest.ts`, `client/Render`, `client/Inspector` | Tool manifests include API schemas plus custom render/inspector surfaces. |

### 2.2 Peers-Touch Current Sources

| Area | Source Path | Current State |
| --- | --- | --- |
| Tool domain | `apps/station/app/subserver/agent/domain/tool.go` | Tool definition, call meta and result types exist. |
| Tool registry | `apps/station/app/subserver/agent/service/tool_registry_service.go` | Registers memory, skills, delegate, local_mcp and Desktop-local builtins. |
| Local broker | `apps/station/app/subserver/agent/service/local_tool_broker.go` | Waits for Desktop-local execution results by turn/call ID. |
| Skill domain/service | `apps/station/app/subserver/agent/domain/skill.go`, `service/skill_service.go` | Skill CRUD, progressive disclosure, versioning, rollback, toggle and growth events exist. |
| Skill guard | `apps/station/app/subserver/agent/service/skills_guard_service.go` | Security scanning and verdict/policy classification exist. |
| Skill proto | `model/domain/agent/skill.proto` | Skill manifest, scan result, install/update/delete/patch messages exist. |
| Desktop tools | `apps/desktop/src/services/tool-service.ts`, `store/tool.ts` | Tool list and MCP/plugin execution adapters exist; builtin execution is intentionally unsupported in Web. |
| Desktop MCP | `apps/desktop/src/services/mcp-service.ts`, `store/mcp.ts` | MCP CRUD/toggle/test with optimistic UI state exists. |
| Desktop skills | `apps/desktop/src/services/skill-service.ts`, `store/skill.ts` | Skill list/search/get/import/toggle/delete plus store-level optimistic updates exist. |
| Chat approvals | `apps/desktop/src/store/chat.ts`, `components/MessageBubble.tsx` | Tool call, result, approval required/decision, error and cancellation states exist. |
| Rust bridge | `apps/desktop/src-tauri/src/application/{tools,mcp,skills}/`, `interface/tauri_commands/{tools,mcp,skills}.rs` | Device-local tool, MCP and skill APIs are bridged through Tauri. |

## 3. Target Ownership

| Capability | Source Of Truth | Desktop Projection Owner | Notes |
| --- | --- | --- | --- |
| Tool/skill/MCP manifest | Station for durable policy; Desktop Rust for local capability snapshot | Tool/skill/MCP runtime stores | Manifest identity must be stable and versioned. |
| Agent binding | Station Agent config | Agent config projection | Enables builtins, plugins, skills and MCP servers per Agent. |
| Compatibility | Station policy + Model capabilities | Runtime projection | Provider/model function-call support must filter tools before turn execution. |
| Approval policy | Station policy | Chat runtime projection | Desktop Web renders/decides through Station approval API; no direct bypass. |
| Local execution | Desktop Rust | Chat/runtime event projection | Rust executes local MCP/file/clipboard/OAuth only through audited requests. |
| Tool result/audit | Station TurnService/trace | Chat diagnostics | Every result links to turn ID, call ID, source, decision and duration. |

## 4. Required Contracts

```ts
interface AgentToolManifestContract {
  toolId: string;
  source: 'builtin' | 'plugin' | 'skill' | 'mcp' | 'desktop_local';
  displayName: string;
  description: string;
  version?: string;
  api: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    riskLevel?: 'low' | 'medium' | 'high' | 'critical';
    renderMode?: 'collapsed' | 'expanded' | 'hidden';
  }>;
  compatibility: {
    requiresFunctionCalling?: boolean;
    providers?: string[];
    models?: string[];
    platforms?: string[];
  };
  policy: {
    defaultEnabled: boolean;
    requiresApproval: boolean;
    approvalMode?: 'auto-run' | 'allow-list' | 'manual' | 'headless';
    allowedActors?: string[];
  };
}

interface AgentToolCallTrace {
  turnId: string;
  callId: string;
  toolId: string;
  apiName: string;
  source: AgentToolManifestContract['source'];
  argumentsRedacted: Record<string, unknown>;
  status: 'queued' | 'approval_required' | 'approved' | 'denied' | 'running' | 'success' | 'error' | 'timeout' | 'cancelled';
  approvalId?: string;
  approvedBy?: string;
  resultPreview?: string;
  error?: { code: string; message: string; retryable: boolean };
  durationMs?: number;
}
```

Runtime events must be mapped into the M1 `AgentRuntimeEvent` family:

```ts
type AgentRuntimeToolEvent =
  | { type: 'tool.call_started'; trace: AgentToolCallTrace }
  | { type: 'tool.approval_required'; trace: AgentToolCallTrace; riskSummary?: string }
  | { type: 'tool.approval_decided'; trace: AgentToolCallTrace }
  | { type: 'tool.result'; trace: AgentToolCallTrace }
  | { type: 'tool.error'; trace: AgentToolCallTrace }
  | { type: 'tool.reconciled'; agentId: string; cursor?: string };
```

## 5. Implementation Slices

### M8.1 Manifest And Compatibility Contract

Deliverables:

- Normalize builtins, skills, plugins, MCP and Desktop-local tools into one manifest surface.
- Record provider/model/function-call compatibility before turn execution.
- Preserve existing Station registry and Desktop Rust snapshots as upstream capability providers.

Stop condition:

- Do not hard-code tool availability in Desktop Web components.

### M8.2 Agent Binding And Policy

Deliverables:

- Agent config owns enabled tools/skills/MCP servers and approval mode.
- Settings surfaces can manage global tool/MCP/skill inventory, but Agent binding remains Station-owned.
- Allow-list/manual/auto-run/headless modes are explicit and auditable.

Stop condition:

- Do not let Settings toggles silently mutate Agent-specific bindings without Station writes.

### M8.3 Local Execution Boundary

Deliverables:

- Desktop Rust executes local MCP and Desktop-local builtins only through approved requests with call ID and turn ID.
- Local tool broker timeout/cancel/duplicate-waiter cases produce typed events.
- Secret-like arguments/results are redacted before Desktop diagnostics export.

Stop condition:

- Desktop Web must not call local MCP or local file/clipboard APIs as an execution bypass.

### M8.4 Chat Rendering And Recovery

Deliverables:

- Message UI renders queued, approval required, approved, denied, running, success, error, timeout and cancelled states.
- Tool inspector/result surfaces distinguish builtin/plugin/skill/MCP/Desktop-local sources.
- Retry action replays through Station turn/action lineage, not direct local execution.

Stop condition:

- A visual tool card without linked turn trace is not parity evidence.

### M8.5 Audit And Tests

Deliverables:

- Turn trace records tool call source, approval decision, duration, redacted args/result and error class.
- Tests cover approval cannot be bypassed, denied tool does not execute, timeout is visible, and MCP errors recover.
- Skill guard/scan verdict and install policy remain enforced.

Stop condition:

- Do not claim M8 if audit trail is only console logs.

## 6. Verification Matrix

| Check | Command / Evidence | Required Result |
| --- | --- | --- |
| Desktop typecheck | `pnpm --dir apps/desktop run check` | Pass after M8 product implementation. |
| Station tool tests | Targeted Go tests for `tool_registry_service`, `local_tool_broker`, turn tool loop | Pass if Station tool paths touched. |
| Station skill tests | Targeted Go tests for `SkillService` / `SkillsGuardService` | Pass if skill install/update/policy touched. |
| Rust bridge tests | Targeted `cargo test` under `apps/desktop/src-tauri` for tools/MCP/skills | Pass if local execution bridge touched. |
| Approval bypass evidence | Test or browser evidence | Direct Web execution cannot bypass Station approval. |
| Chat UI evidence | Browser or automated UI evidence | Approval/result/error/retry states render with turn/call IDs. |
| Audit evidence | Trace/API output | Tool call trace records source, decision, redacted args/result and duration. |

## 7. Forbidden Relationships

- Desktop Web must not execute local tools directly.
- Tool enablement must not be inferred from visible buttons alone.
- Skill install/update must not bypass `SkillsGuardService`.
- MCP connection secrets must not enter chat diagnostics, logs or exported traces.
- Tool result retry must not skip Station action lineage.
- M8 must not claim Actor#agent public tool exposure.
- Product implementation remains blocked until a revised prototype is accepted and prior M1-M7 implementation gates are satisfied.

## 8. Traceability

| Evidence ID | BOM ID | Spec ID | Plan Step | Gate ID | Source Path | Target Path | Owner | Status | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EVID-011-H-pre | BOM-005/BOM-010/BOM-015 | SPEC-007/SPEC-009/SPEC-011/SPEC-013 | PLAN-P4 / M8 pre-execution | GATE-006/GATE-008 | LobeHub `store/tool`, `context-engine/src/engine/tools`, `context-engine/src/engine/skills`, `SelectedToolInjector`, `SelectedSkillInjector`, `ToolCall`, builtin manifests; Peers Station `tool_registry_service.go`, `local_tool_broker.go`, `skill_service.go`, `skills_guard_service.go`, `skill.proto`; Desktop `tool-service.ts`, `mcp-service.ts`, `skill-service.ts`, `chat.ts`, Rust tools/MCP/skills bridge | This spec; future manifest/policy contract, approval/audit flow, Desktop Rust local execution boundary and chat tool rendering | Station/Desktop Rust/Desktop | implemented | Product code unchanged; approval/audit and GATE-008 remain unproven until PLAN-P5 M8 implementation. |

## 9. Evidence Target

EVID-019 should be recorded after implementation with:

- Manifest/policy compatibility contract diff and generation evidence.
- Station tool/skill/local broker tests.
- Desktop Rust tools/MCP/skills bridge tests.
- Browser/UI evidence for approval, denial, result, error, timeout and retry.
- Trace/audit evidence with redacted args/results.
