# Agent LobeHub Fullstack Parity — M6 Memory Projection Parity Spec

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Station + Desktop
> **Plan Step**: PLAN-P4 / M6 pre-execution
> **Evidence**: EVID-011-F-pre
> **Gates**: GATE-006, GATE-008
> **Depends On**: EVID-010, EVID-012, EVID-013, EVID-014, EVID-015, EVID-016

---

## 1. Scope

M6 closes Memory projection parity after contract, runtime shell, provider/model, session/topic/runtime and Agent config/profile batches are ready.

This spec defines:

- Station Memory source-of-truth and contract gaps.
- Desktop Memory runtime projection ownership.
- Chat trace events for memory injected, retrieved, extracted, promoted, skipped, deleted, frozen and rolled back states.
- Memory settings/profile surface alignment with the Agent workbench.
- Recovery, rollback and feedback visibility.

This spec does not:

- Rewrite Station MemoryService before projection gaps are proven.
- Implement LobeHub's server workflows directly.
- Move Memory business truth into Desktop Web.
- Claim Knowledge/File or Tool parity.
- Start product implementation before revised prototype acceptance after EVID-010 `REVISION REQUIRED`.

## 2. Source Basis

### 2.1 LobeHub Source

| Area | Source Path | Relevant Behavior |
| --- | --- | --- |
| Memory service API | `external/lobehub/src/services/userMemory/index.ts` | CRUD/search/query/persona/detail/tags/taxonomy operations for user memories. |
| Chat memory resolution | `external/lobehub/src/services/chat/mecha/memoryManager.ts` | Resolves persona and topic memories from cache before turn execution; send path does not block on network fetch. |
| Memory store selectors | `external/lobehub/src/store/userMemory/selectors.ts` | Active memory cache, fetchedAt markers and params-keyed retrieval results. |
| Topic memory actions | `external/lobehub/src/store/chat/slices/agentRun/actions/state/memory.ts` | Chat history summary supports topic memory retrieval and traceability. |
| Memory toggle | `external/lobehub/src/features/ChatInput/ActionBar/Memory/index.tsx` | Composer-level memory enable/disable control tied to Agent chat config. |
| Memory routes | `external/lobehub/src/routes/(main)/memory/` | Home, identities, contexts, preferences, experiences, activities, detail panel, filters and analysis UI. |
| Settings memory | `external/lobehub/src/routes/(main)/settings/memory/` | Memory system settings are first-class, not hidden debug state. |

### 2.2 Peers-Touch Current Sources

| Area | Source Path | Current State |
| --- | --- | --- |
| Memory domain | `apps/station/app/subserver/agent/domain/memory.go` | Layers, target, trust, relevance, snapshots, persona, stats, events and feedback exist. |
| Memory proto | `model/domain/agent/memory.proto` | Cross-layer MemoryItem, MemorySnapshot, search, persona, events, export/import, embedding and feedback messages exist. |
| Memory service | `apps/station/app/subserver/agent/service/memory_service.go` | CRUD/search/security scan/provider hooks/snapshot/rollback/freeze/growth metrics exist. |
| Memory handler | `apps/station/app/subserver/agent/handler/memory_handler.go` | List/get/delete/search/persona/stats/events endpoints are wired to service. |
| Desktop Rust bridge | `apps/desktop/src-tauri/src/application/memory/mod.rs`, `apps/desktop/src-tauri/src/interface/tauri_commands/memory.rs` | Bridges Station memory proto to Tauri JSON payloads; owns auth/token forwarding only. |
| Desktop API | `apps/desktop/src/services/desktop_api.ts` | list/search/persona/stats/events/export/import/embedding/reembed APIs exist. |
| Memory page | `apps/desktop/src/pages/MemoryPage.tsx` | Browse/search/persona/events tabs exist, but page-owned fetches are not yet the Agent runtime projection. |
| Agent profile memory | `apps/desktop/src/pages/AgentProfilePage.tsx` | Agent-specific memory panel exists with ad hoc dual ID/name fetch and local state. |
| Chat diagnostics | `apps/desktop/src/components/MessageBubble.tsx`, `apps/desktop/src/store/chat.ts` | Diagnostics show memory-enabled as a flag, but not typed memory event lineage. |

## 3. Target Ownership

| Capability | Source Of Truth | Desktop Projection Owner | Notes |
| --- | --- | --- | --- |
| Memory item content/layer/trust/freeze | Station MemoryService | `memoryRuntime` / memory store | Desktop never edits local truth without Station write result. |
| Persona and snapshot | Station MemoryService | Runtime snapshot cache | Snapshot is prompt input evidence, not UI-only summary. |
| Search result and score explanation | Station MemoryService | Runtime query cache | Query cache may expire; score source remains Station. |
| Turn memory injection | Station TurnService / prompt assembly | Chat runtime event projection | Must be tied to turn ID and conversation/session. |
| Extraction/promote/skip/delete/feedback | Station MemoryService events | Memory event projection | Detail JSON must become typed enough for UI and tests. |
| Rollback/freeze | Station MemoryService | Recovery UI projection | UI may request rollback/freeze, but Station validates. |

## 4. Required Contracts

M6 should not invent a second Memory DTO. It should reuse `model/domain/agent/memory.proto` and add only missing event/runtime contract fields from M1.

Required projection shape:

```ts
interface AgentMemoryProjection {
  agentId: string;
  stats?: MemoryStats;
  persona?: MemoryPersona;
  snapshot?: MemorySnapshotSummary;
  itemsByLayer: Record<MemoryLayer, MemoryItemSummary[]>;
  recentEvents: MemoryProjectionEvent[];
  queryState: ProjectionQueryState;
  lastReconciledAt?: string;
  cursor?: string;
}

interface MemoryProjectionEvent {
  eventId: string;
  turnId?: string;
  conversationId?: string;
  agentId: string;
  type:
    | 'retrieval'
    | 'injection'
    | 'extraction'
    | 'promotion'
    | 'dedup_skip'
    | 'deletion'
    | 'feedback'
    | 'freeze'
    | 'rollback'
    | 'persona_update'
    | 'error';
  layer?: MemoryLayer;
  memoryId?: string;
  summary?: string;
  score?: number;
  latencyMs?: number;
  detail?: Record<string, unknown>;
  createdAt: string;
}
```

Runtime event additions must map into the M1 `AgentRuntimeEvent` family rather than bespoke chat-only payloads:

```ts
type AgentRuntimeMemoryEvent =
  | { type: 'memory.retrieved'; turnId: string; items: MemoryProjectionEvent[] }
  | { type: 'memory.injected'; turnId: string; snapshotId?: string; itemCount: number }
  | { type: 'memory.extracted'; turnId: string; items: MemoryProjectionEvent[] }
  | { type: 'memory.skipped'; turnId: string; reason: 'disabled' | 'no_match' | 'dedup' | 'policy' | 'error'; detail?: string }
  | { type: 'memory.feedback'; memoryId: string; helpful: boolean; trustScore?: number }
  | { type: 'memory.reconciled'; agentId: string; cursor?: string };
```

## 5. Implementation Slices

### M6.1 Station Event Semantics

Deliverables:

- Normalize Memory event detail JSON for retrieval, extraction, dedup skip, persona update, feedback, deletion, freeze and rollback.
- Ensure turn-related memory events carry `agent_id`, `session_id` or conversation ID, and `source_turn_id` where available.
- Add test fixtures for event detail shape.

Stop condition:

- Do not add Desktop-specific event types to Station. Station emits business events; Desktop maps them to UI state.

### M6.2 Desktop Memory Runtime Projection

Deliverables:

- Add or extend a runtime/store owning memory projection freshness.
- Reconcile stats/persona/recent events after actor bootstrap, Agent switch and reconnect.
- Replace Agent profile ad hoc dual ID/name memory fetch with a typed agent ID query after M5 config identity is stable.

Stop condition:

- Do not fix stale memory state by only adding page-level `useEffect(...load...)`.

### M6.3 Chat Trace Integration

Deliverables:

- Map Station runtime/memory events into message diagnostics.
- Show memory disabled, no match, retrieval count, injected snapshot, extracted items, dedup skip and error states.
- Keep trace tied to `turnId` and `conversationId`, not only visible message ID.

Stop condition:

- Do not present a static "memory enabled" badge as evidence of Memory parity.

### M6.4 Memory Settings And Profile Surface

Deliverables:

- Memory page remains global browse/search/persona/events surface.
- Agent workbench resource rail shows per-agent Memory summary and recent turn lineage.
- Agent profile memory tab becomes a projection viewer with recovery actions guarded by Station responses.

Stop condition:

- Do not duplicate the full Memory page inside Agent profile.

### M6.5 Recovery, Rollback And Feedback

Deliverables:

- Surface frozen/deleted/rollback states in Memory events and detail panel.
- Add helpful/harmful feedback action wiring to Station MemoryFeedback where available.
- Error recovery shows actionable states: auth denied, provider unavailable, embedding unavailable, rollback failed, reconciliation stale.

Stop condition:

- Recovery UI must not mutate local state optimistically as final truth before Station confirmation.

## 6. Verification Matrix

| Check | Command / Evidence | Required Result |
| --- | --- | --- |
| Desktop typecheck | `pnpm --dir apps/desktop run check` | Pass after M6 product implementation. |
| Station memory tests | `go test ./app/subserver/agent/service -run Memory` from `apps/station` or repo-equivalent targeted command | Pass if Station MemoryService or events touched. |
| Rust bridge tests/checks | Targeted `cargo test` under `apps/desktop/src-tauri` when memory bridge touched | Pass if Rust memory bridge touched. |
| Projection ownership review | Code review over runtime/store/page diffs | Memory projection owned by runtime/store, not page fetch side effects. |
| Runtime evidence | Browser or automated UI evidence | Chat diagnostics show retrieved/injected/extracted/skipped/error memory states for a turn. |
| Reconnect evidence | Runtime reconcile log or test | Memory settings/profile/chat trace agree after refresh/reconnect. |

## 7. Forbidden Relationships

- Desktop Web must not become Memory source-of-truth.
- New Memory event payloads must not bypass proto/model contracts when crossing Station/Desktop boundaries.
- Chat message UI must not infer memory extraction from text content.
- Agent profile must not query by both agent ID and name as a long-term compatibility strategy.
- Memory parity must not be claimed from the standalone Memory page alone.
- M6 must not claim Knowledge/File or Tool parity.
- Product implementation remains blocked until a revised prototype is accepted and prior M1-M5 implementation gates are satisfied.

## 8. Traceability

| Evidence ID | BOM ID | Spec ID | Plan Step | Gate ID | Source Path | Target Path | Owner | Status | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EVID-011-F-pre | BOM-004/BOM-010/BOM-015 | SPEC-004/SPEC-009/SPEC-011/SPEC-013 | PLAN-P4 / M6 pre-execution | GATE-006/GATE-008 | LobeHub `services/userMemory`, `store/userMemory`, `features/ChatInput/ActionBar/Memory`, `routes/(main)/memory`; Peers Station `memory_service.go`, `memory.proto`, Desktop `MemoryPage.tsx`, `MessageBubble.tsx`, `chat.ts` | This spec; future Station Memory event normalization, Desktop memory runtime/store, chat diagnostics, profile/resource rail | Station/Desktop | implemented | Product code unchanged; runtime evidence and GATE-008 remain unproven until PLAN-P5 M6 implementation. |

## 9. Evidence Target

EVID-017 should be recorded after implementation with:

- Station Memory event contract/test evidence.
- Desktop runtime/store projection diff.
- Chat diagnostics evidence for memory retrieved/injected/extracted/skipped/error.
- Reconnect/reconcile evidence.
- Commands run and failures, if any.
