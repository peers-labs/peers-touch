# Agent LobeHub Parity - Tool / Plugin / Knowledge / File Source Map

> **Status**: implemented-for-design
> **Version**: v0.1
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Station + Desktop Rust + Desktop Web
> **BOM**: BOM-005, BOM-010, BOM-015
> **Spec**: SPEC-006, SPEC-007, SPEC-009, SPEC-011, SPEC-013
> **Plan Step**: PLAN-P0 / PLAN-P4
> **Gates**: GATE-001, GATE-002, GATE-006, GATE-008
> **Evidence**: EVID-011-V-pre

---

## 1. Purpose

This document closes the BOM-005 design gap by mapping LobeHub's Tool / Plugin / Skill / Knowledge / File source system to Peers-Touch Station, Desktop Rust and Desktop Web ownership.

It unifies two implementation batches:

- M7 `knowledge-files-parity.md`: durable resource and retrieval lifecycle.
- M8 `tool-plugin-skill-parity.md`: tool/skill/MCP manifest, policy, approval and execution lifecycle.

It is source audit and migration design evidence only. It does not implement product code and does not satisfy GATE-008.

## 2. LobeHub Source Map

| Domain | LobeHub source | Responsibility observed |
| --- | --- | --- |
| Resource service/store | `external/lobehub/src/services/resource/index.ts`, `external/lobehub/src/store/file/slices/resource/action.ts`, `external/lobehub/src/types/resource.ts` | Unified `ResourceItem` surface, folder hierarchy, file/page content, optimistic create/update/delete state, sync queue and error state. |
| Knowledge base service | `external/lobehub/src/services/knowledgeBase.ts` | Knowledge base CRUD, visibility, workspace transfer/copy/publish and file binding. |
| RAG service | `external/lobehub/src/services/rag.ts` | Parse, chunk, embedding task creation/retry, semantic search, chat retrieval and message query cleanup. |
| Agent knowledge binding | `external/lobehub/src/store/agent/slices/knowledge/action.ts` | Add/remove/toggle files and knowledge bases per active agent; refresh Agent config and knowledge SWR surfaces after mutation. |
| Working resources/files UI | `external/lobehub/src/routes/(main)/agent/features/Conversation/WorkingSidebar/ResourcesSection/`, `WorkingSidebar/Files/`, `external/lobehub/src/hooks/useFetchAgentDocuments.ts` | Agent-bound documents, project files, local/remote boundary, search and panel-gated fetch. |
| Tool store composition | `external/lobehub/src/store/tool/store.ts`, `initialState.ts`, `selectors/tool.ts` | Builtin, plugin, Composio MCP, LobeHub skill and agent skill inventory are merged for discovery/manifest/render lookup. |
| Builtin tools | `external/lobehub/src/store/tool/slices/builtin/`, `external/lobehub/packages/builtin-tool-*/src/manifest.ts` | Builtin manifest, render display controls, runtime-managed tools and custom inspector/render surfaces. |
| Plugin settings | `external/lobehub/src/store/tool/slices/plugin/action.ts`, `selectors.ts` | Installed plugin refresh, settings update with abort controller, JSON schema validation and install loading state. |
| MCP install/connect | `external/lobehub/src/store/tool/slices/mcpStore/action.ts` | Manifest fetch, cloud/local manifest conversion, install/test/cancel progress, config schema, resume and STDIO error handling. |
| Tool engine | `external/lobehub/packages/context-engine/src/engine/tools/ToolsEngine.ts`, `ToolResolver.ts`, `SelectedToolInjector.ts` | Provider/model function-call check, manifest filtering, default/selected tool merge, operation tool set generation. |
| Skill engine | `external/lobehub/packages/context-engine/src/engine/skills/SkillEngine.ts`, `SelectedSkillInjector.ts` | Operation-level skill set assembled from enabled skills and plugin IDs. |
| Tool-call processor | `external/lobehub/packages/context-engine/src/processors/ToolCall.ts` | Converts internal tool calls/messages to provider function-call format and downgrades tool messages when model lacks function calling. |
| Human intervention | `external/lobehub/src/store/user/slices/settings/selectors/toolIntervention.ts`, `external/lobehub/src/features/Conversation/store/slices/data/pendingInterventions.ts` | Approval mode and pending intervention derivation for tool/human resume states. |

## 3. LobeHub Capability Taxonomy

| Capability family | Representative behavior | Peers-Touch target semantics |
| --- | --- | --- |
| Resource identity | `ResourceItem` captures source type, folder parent, file/page metadata and optimistic status. | Station owns durable resource identity and index status; Desktop Rust owns local file handles; Desktop Web receives opaque refs and status projection. |
| Resource mutation/reconcile | Resource store uses optimistic engine, sync queue, pending IDs, retry count and sync error. | Peers resource UI must expose pending/syncing/error/retry/reconciled states instead of treating local optimistic state as durable truth. |
| Knowledge lifecycle | KnowledgeBase service supports visibility, workspace transfer/copy/publish and file binding. | Knowledge assets need durable owner/visibility/workspace authorization; Agent profile only binds refs, not asset truth. |
| RAG lifecycle | RAG service separates parse, chunk, embedding, retry, semantic search and chat retrieval. | Station must expose parse/chunk/embedding/retrieval lifecycle and diagnostics; chat trace records retrieved/skipped/error states. |
| Agent resource binding | Agent knowledge slice adds/removes/toggles files and KBs, then refreshes config and knowledge cache. | Agent config owns binding refs and policies; resource catalog/indexing remains base-resource/Station owned. |
| Tool inventory | Tool selector merges builtins, installed plugins, Composio MCP and LobeHub skills while filtering environment availability. | Peers needs one manifest projection for builtin/plugin/skill/MCP/Desktop-local sources with explicit source and compatibility. |
| Tool compatibility | ToolsEngine checks provider+model function-call support, filters not-found/disabled/incompatible manifests and builds uniform tools. | Tool availability must derive from provider+model capability projection, not visible buttons or provider names. |
| Plugin settings | Plugin settings update aborts previous write and validates against manifest JSON schema. | Tool/plugin settings need schema validation, abort/retry state, redaction and Station/Desktop ownership by source. |
| MCP install/test | MCP action tracks fetch manifest, dependency/config checks, progress, cancel/resume and connection test errors. | MCP install/test must be an auditable operation with progress, cancellation, local/cloud boundary and sanitized error logs. |
| Skill operation set | SkillEngine filters skills with enable checker and passes enabled plugin IDs downstream. | Skill enablement must be policy-aware and auditable; installation/security remains SkillsGuard/Station owned. |
| Tool-call conversion | ToolCallProcessor strips/downgrades tool calls when function calling is unsupported and sanitizes arguments before provider call. | Peers runtime must preserve tool trace while preventing unsupported provider calls; sanitized args/results are required in diagnostics. |
| Human/tool intervention | Pending interventions are derived from messages/tool results and resume state. | Approval-required, denied, resumed, async tool and parked states must be action-lineage events, not local card toggles. |

## 4. Required Peers-Touch Ownership Mapping

| Capability | Source of truth | Desktop Rust responsibility | Desktop Web responsibility |
| --- | --- | --- | --- |
| Knowledge/file metadata | Station resource domain | Local handle authorization and upload/download bridge. | Render resource rail/status and submit binding/retry actions. |
| Index/retrieval status | Station retrieval/indexing domain | Local file read boundary when authorized. | Render indexing/error/skipped/retrieved trace projection. |
| Agent resource binding | Station Agent config | None except local handle ref resolution. | Render binding UI and policy/status projection. |
| Tool/skill/MCP manifest | Station policy + Desktop Rust local capability snapshot | Provide device-local MCP/tool inventory and execution bridge. | Render merged manifest projection and compatibility state. |
| Plugin/MCP/skill settings | Owning platform domain by source | Store/test local MCP settings; protect secrets. | Render schema forms and redacted validation errors. |
| Tool execution | Station turn/action lineage; Desktop Rust for local tools only | Execute approved local/MCP calls by turn/call ID. | Render approval/result/error/retry states; cannot execute local tools directly. |
| Tool audit | Station TurnService trace | Return local execution result metadata. | Display trace IDs, source, status, redacted args/results. |

## 5. Contract Implications

| Requirement | Contract implication |
| --- | --- |
| Knowledge and tools are separate but meet in runtime | `AgentResourceRef` and `AgentToolManifestRef` must be distinct refs that can both appear in a turn trace. |
| Agent config stores refs, not catalog truth | Agent profile stores enabled resource/tool/skill refs and policies; catalogs and lifecycle state live in resource/tool domains. |
| Provider/model affects tool availability | Tool compatibility must consume M3 `AgentModelRef` and provider+model capability selectors. |
| Local paths/secrets are never Web truth | Desktop Web cannot persist raw file paths, MCP env vars or plugin secrets as portable business truth. |
| Optimistic state must reconcile | Pending resource or MCP install state needs an owner-confirmed terminal state before success claim. |
| Approval is a runtime event | Tool approval/rejection/resume is tied to turn ID, call ID, actor and source; UI buttons are projection only. |
| RAG diagnostics must be explainable | Retrieved/skipped/error chunks need resource ID, status reason, score/metadata where available and retryability. |

## 6. Mapping To Migration Batches

| Batch | This map contributes |
| --- | --- |
| M1 Contract Foundation | Defines resource/tool refs, event trace identity and source enum requirements. |
| M3 Provider/model Correctness | Tool compatibility and function-call support depend on provider+model identity. |
| M5 Agent Config/Profile | Agent profile binds resource/tool/skill refs without owning catalogs. |
| M7 Knowledge/Files | Source-backed resource lifecycle, RAG lifecycle, binding and diagnostics semantics. |
| M8 Tool/Plugin/Skill | Source-backed manifest, compatibility, settings, MCP install/test, approval and audit semantics. |
| M9 Recovery/Diagnostics | Resource indexing/retrieval/MCP/tool failures need owner/retryability/action-lineage diagnostics. |
| M10 Actor#agent Reserved | Future exposed capabilities must be permissioned projections of these manifests/resources, not raw execution access. |

## 7. Forbidden Relationships

1. Desktop Web must not execute local tools, MCP or filesystem operations directly.
2. Agent profile must not become the source of truth for resources, tools, skills, MCP servers or plugin settings.
3. Raw local paths, MCP secrets and plugin credentials must not be persisted in chat diagnostics or Station Agent config.
4. Tool availability must not be inferred from rendered buttons alone.
5. Knowledge parity must not be claimed from prompt injection or retrieval text without resource lifecycle/status evidence.
6. MCP install/test success must not be fabricated when the source was live-unresolved or tool-limited.
7. Product implementation must not copy LobeHub source code.

## 8. Current Claim

BOM-005 is implemented for design as a source-backed Tool / Plugin / Skill / Knowledge / File map.

M7 and M8 product implementation remain blocked until Owner confirmation and their respective evidence targets, `EVID-018` and `EVID-019`.
