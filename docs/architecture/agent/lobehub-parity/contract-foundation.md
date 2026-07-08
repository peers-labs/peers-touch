# Agent LobeHub Fullstack Parity — M1 Contract Foundation Spec

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Model + Station + Desktop
> **Module**: `model/domain/agent/`, `model/domain/ai_chat/`, `apps/station/app/subserver/agent/`, `apps/desktop/src/`, `apps/desktop/src-tauri/`
> **Plan Step**: PLAN-P4 / M1 pre-execution
> **Evidence**: EVID-011-A-pre

---

## 1. Purpose

This document turns the M1 batch in `migration-plan.md` into a contract-first implementation specification.

It is a pre-execution spec, not a product implementation. It defines which contracts must be added, which existing manual DTOs must be adapted, which generated outputs are expected, and which checks prove the contract foundation is ready for PLAN-P5.

## 2. Current Contract Inventory

| Area | Current Source | Current Shape | Gap |
| --- | --- | --- | --- |
| Agent identity/config | `model/domain/agent/agent.proto` | `Agent` has `provider_id`, `model_name`, `visibility`, `owner_actor_id`, `config_json` | No canonical `AgentModelRef`; model field name differs across Desktop/Station (`model`, `model_name`, `selectedModel`). |
| Turn execution | `model/domain/agent/agent.proto` | `ExecuteTurnRequest` has optional `model`, optional `provider`, knowledge resources and effort | Provider/model pair is loose strings; no typed runtime event contract. |
| Turn trace | `model/domain/agent/agent.proto`, Station domain structs | `TurnTrace`, `ToolCallRecord`, `ProviderCallRecord`, `KnowledgeChunkReference` | Trace exists, but realtime stream events are Go JSON structs, not proto-owned event semantics. |
| Runtime stream events | `apps/station/app/subserver/agent/service/turn_service.go` | `TurnEvent` struct with `Type`, `Stage`, `Text`, `ToolCallID`, `ToolName`, `Result`, `Error` | Event type/stage strings are not canonical; Desktop must infer event semantics. |
| Provider config | `model/domain/ai_chat/provider.proto` | Provider has `runtime_kind`, `cli_command`, `protocol`, settings/config JSON | Provider model ref is not shared with Agent turn request and Desktop selector. |
| Memory | `model/domain/agent/memory.proto` | Memory item/snapshot/search/event/feedback contracts exist | Memory events are separate from Agent runtime event union; Desktop trace projection still manual. |
| Knowledge | `model/domain/agent/agent.proto` | `KnowledgeResource`, `KnowledgeChunkReference` exist | Missing common resource ref/lifecycle envelope for local file handles and retrieval diagnostics. |
| Tool/skill/MCP binding | `model/domain/agent/agent_config.proto` | Binding messages exist | No shared tool call risk/approval/result event contract. |
| Actor#agent reserved | `model/domain/agent/agent.proto` | `owner_actor_id`, private/workspace visibility | No explicit binding role, visibility scope, capability exposure or event subscription scope. |
| Desktop generated TS | `apps/desktop/src/gen/proto/domain/agent/*` | Generated TS exists for current proto | M1 must regenerate from proto source; generated files must not be edited manually. |
| Station generated Go | `apps/station/app/subserver/agent/model/*.pb.go` | Generated Go exists for current proto | M1 must regenerate from proto source; generated files must not be edited manually. |

## 3. Contract Additions

### 3.1 `AgentModelRef`

Target source:

- `model/domain/agent/agent.proto`

Required shape:

```proto
message AgentModelRef {
  string provider_id = 1;
  string model_id = 2;
  string display_name = 3;
  repeated string capability_tags = 4;
}
```

Usage targets:

- `Agent` should retain old `provider_id` / `model_name` fields during compatibility, but M1 must introduce a forward path to `AgentModelRef`.
- `Conversation` should gain a forward-compatible model ref path or compatibility mapping.
- `ExecuteTurnRequest` should gain `AgentModelRef model_ref`, while keeping optional `model` and `provider` as compatibility fields during staged migration.
- Desktop stores should migrate from `selectedModel + selectedProviderId` string pair to a single model ref value in M3.

Invariant:

- `model_id` alone is never valid as a cross-provider identity.

### 3.2 `AgentRuntimeEvent`

Target source:

- Prefer `model/domain/agent/agent.proto` unless split into a new `runtime_event.proto` is required by generation/lint constraints.

Required event taxonomy:

| Event | Required Fields | Maps From Current Station Stage |
| --- | --- | --- |
| `TURN_STARTED` | `turn_id`, `conversation_id`, `agent_id` | `turn_started` |
| `TEXT_DELTA` | `turn_id`, `message_id`, `delta` | `provider_delta` |
| `THINKING_DELTA` | `turn_id`, `message_id`, `delta` | future thinking stage |
| `KNOWLEDGE_RETRIEVED` | `turn_id`, `resource_id`, `chunk_id`, `score` | `knowledge_retrieved` |
| `TOOL_CALL_REQUESTED` | `turn_id`, `tool_call_id`, `tool_name`, `arguments`, `risk_level` | current tool call event |
| `APPROVAL_REQUESTED` | `turn_id`, `tool_call_id`, `policy`, `reason` | local tool approval path |
| `TOOL_RESULT` | `turn_id`, `tool_call_id`, `status`, `result`, `error` | current tool result event |
| `MEMORY_EVENT` | `turn_id`, `memory_id`, `action`, `layer` | memory event / future trace join |
| `ERROR` | `turn_id`, `code`, `message`, `recoverable` | provider/tool/turn errors |
| `DONE` | `turn_id` | `turn_completed` |
| `ABORTED` | `turn_id`, `reason` | cancel/interrupted path |
| `RECONCILE_REQUIRED` | `conversation_id`, `since_event_id` | reconnect/missed-event path |

Compatibility:

- Station can continue emitting current SSE JSON while adding a typed mapping layer.
- Desktop Web must not invent new event names outside this contract during migration.

### 3.3 `AgentResourceRef`

Target source:

- `model/domain/agent/agent.proto` or a new agent resource proto.

Required resource classes:

- `MEMORY`
- `KNOWLEDGE_DOCUMENT`
- `KNOWLEDGE_FOLDER`
- `KNOWLEDGE_URL`
- `LOCAL_FILE_HANDLE`
- `LOCAL_FOLDER_HANDLE`
- `TOOL`
- `SKILL`
- `MCP_SERVER`
- `ARTIFACT`

Required fields:

- `resource_id`
- `resource_type`
- `owner_agent_id`
- `title`
- `source`
- `status`
- `opaque_ref`
- `error`

Invariant:

- Desktop Web must never use a raw local file path as durable cross-end business truth.

### 3.4 Tool Policy And Approval Contract

Target source:

- `model/domain/agent/agent.proto` or a new agent tool proto.

Required objects:

- `AgentToolRef`
- `AgentToolRiskPolicy`
- `AgentToolApprovalRequest`
- `AgentToolResult`

Minimum semantics:

- Tool identity.
- Server/source.
- Risk level.
- Approval requirement.
- Arguments redaction.
- Result/error.
- Trace link to `turn_id` and `tool_call_id`.

Invariant:

- Desktop Web can render approval but cannot execute local tools directly.

### 3.5 Actor#Agent Reserved Contracts

Target source:

- `model/domain/agent/agent.proto` or a new social-reserved proto under agent domain.

Required objects:

- `ActorAgentBinding`
- `AgentVisibilityPolicy`
- `AgentCapabilityExposure`
- `AgentSocialEventScope`
- `AgentInvocationGrant`

Compatibility:

- Existing `Agent.owner_actor_id` and private/workspace `AgentVisibility` remain valid.
- New reserved scopes must not expose product UI or social behavior in this round.

## 4. Compatibility Mapping

| Current Field / Struct | Target Contract | Compatibility Rule |
| --- | --- | --- |
| `Agent.provider_id` + `Agent.model_name` | `AgentModelRef` | Keep existing fields; populate model ref in new paths; eventually derive old fields from model ref during response mapping. |
| `Conversation.provider_id` + `Conversation.model_name` | `AgentModelRef` | Same staged compatibility as Agent. |
| `ExecuteTurnRequest.provider` + `ExecuteTurnRequest.model` | `ExecuteTurnRequest.model_ref` | New clients send `model_ref`; Station accepts both and rejects ambiguous conflict. |
| Desktop `selectedModel` + `selectedProviderId` | Agent model ref store value | M3 migrates UI/store; M1 only defines contract and compatibility test cases. |
| Station `TurnEvent.Type/Stage` strings | `AgentRuntimeEvent` enum/message | Add mapping table and tests before replacing SSE payload. |
| Knowledge resource enum mapping in `agent-runtime-config.ts` | Generated proto enum usage | Replace hand mapping only after generated TS contract is available. |
| `owner_actor_id` + private/workspace visibility | Actor#agent reserved contracts | Keep current semantics; add explicit future binding/visibility model without product exposure. |

## 5. Generation And Check Commands

M1 implementation must discover and run the current project-supported model generation path. Current evidence shows:

- `packages/model/buf.yaml`
- `packages/model/buf.gen.yaml`
- `apps/desktop/src/gen/proto/domain/agent/*`
- `apps/station/app/subserver/agent/model/*.pb.go`
- review tooling expects proto profile command `./model/build.sh` in `tooling/scripts/review/route-change.sh`

Required implementation checks:

```bash
./model/build.sh
pnpm --dir apps/desktop run check
```

If Station generated Go or Station domain adapters are touched:

```bash
go test ./app/subserver/agent/... 
```

from the Station app root currently used by the repository.

If Desktop Rust Tauri contracts are touched:

```bash
cargo test
```

from `apps/desktop/src-tauri`, or a narrower targeted Rust test command recorded in Evidence.

## 6. M1 Test Matrix

| Test Class | Required Case |
| --- | --- |
| Provider/model identity | Two providers expose the same `model_id`; Agent selection resolves only by `provider_id + model_id`. |
| Turn request compatibility | Old `provider/model` request still works; new `model_ref` request works; conflicting old/new fields fail with a typed error. |
| Runtime event mapping | Each current Station stage maps to one canonical `AgentRuntimeEvent` or an explicit `UNMAPPED_*` compatibility event. |
| Tool approval | Local tool call cannot be represented as completed without approval/result event pair. |
| Knowledge resource | Local file handle remains opaque and does not become raw Web durable truth. |
| Actor#agent reserved | Reserved fields are serializable but do not expose social product behavior. |
| Generated output | Generated Go/TS changes trace back to proto source changes only. |

## 7. Stop Conditions

Stop M1 implementation if:

1. The change edits generated files without proto source changes.
2. The change introduces another manual cross-layer DTO for Agent model refs or runtime events.
3. Any new Agent model selection path uses `model_id` alone.
4. Station and Desktop define different event taxonomies.
5. Local file/tool execution capability leaks into Desktop Web.
6. Actor#agent fields imply social visibility beyond current private/workspace semantics.
7. `./model/build.sh` is missing or fails and no supported replacement command is identified.

## 8. Evidence Target

The implementation batch should append an evidence row like:

| Evidence ID | BOM ID | Spec ID | Plan Step | Gate ID | Artifact | Result | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EVID-012 | BOM-013/BOM-014/BOM-015 | SPEC-003/SPEC-009/SPEC-011/SPEC-012/SPEC-013 | PLAN-P5 / M1 | GATE-005/GATE-006/GATE-007/GATE-008 | proto files, generated outputs, Station/Desktop adapters, command logs | Contract foundation implemented and generated consumers compile | Product shell, Memory/Knowledge/Tool UI migration remains for later batches |

## 9. Current M1 Readiness

| Requirement | Status | Evidence |
| --- | --- | --- |
| Existing proto inventory known | implemented | `model/domain/agent/*.proto`, `model/domain/ai_chat/provider.proto` inspected |
| Generated consumer locations known | implemented | Station `model/*.pb.go`, Desktop `src/gen/proto/domain/agent/*` inspected |
| Provider/model contract gap identified | implemented | `agent.proto`, `provider.proto`, Desktop `agent.ts` and `ChatInput.tsx` references |
| Runtime event contract gap identified | implemented | Station `TurnEvent` string-based JSON stream inspected |
| Actor#agent reserved gap identified | implemented | Current `owner_actor_id` and private/workspace visibility inspected |
| Product implementation allowed | blocked | Pending revised prototype acceptance after EVID-010 `REVISION REQUIRED` |
