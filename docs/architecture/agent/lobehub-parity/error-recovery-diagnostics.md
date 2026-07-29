# Agent LobeHub Fullstack Parity — M9 Error Recovery / Diagnostics Spec

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Station + Desktop Rust + Desktop
> **Plan Step**: PLAN-P4 / M9 pre-execution
> **Evidence**: EVID-011-I-pre
> **Gates**: GATE-006, GATE-008
> **Depends On**: EVID-010, EVID-012..EVID-019

---

## 1. Scope

M9 closes the recovery and diagnostics layer after provider/model, runtime, memory, knowledge and tool contracts are specified.

This spec defines:

- Unified recoverable failure taxonomy for provider, stream, context, memory, knowledge, tool, MCP, local bridge and authorization failures.
- Typed Desktop recovery state for stop, retry, regenerate, continue, branch, reconnect and approval resume.
- Turn trace and diagnostics export requirements.
- Fail-closed handling for secrets and actor-scoped data.

This spec does not:

- Add product-code recovery shortcuts before M1-M8 implementation evidence.
- Treat console logs as durable diagnostics.
- Claim runtime parity from only `presentChatRuntimeError` or a generic error toast.
- Implement social Agent behavior.

## 2. Source Basis

| Area | Source Path | Relevant Behavior |
| --- | --- | --- |
| LobeHub runtime source map | `docs/architecture/agent/lobehub-parity/chat-runtime-source-map.md` | Source-backed runtime taxonomy for streaming chunks, client/gateway runtime, parked/terminal states, tool approval resume and transport recovery boundaries. |
| LobeHub generation lifecycle | `external/lobehub/src/features/Conversation/store/slices/generation/action.ts` | stop/cancel/regenerate/continue, operation lifecycle, overload auto-retry, hetero resume reset. |
| LobeHub message data reconciliation | `external/lobehub/src/features/Conversation/store/slices/data/action.ts` | SWR merge, branch switch, stale snapshot protection during streaming. |
| LobeHub tool intervention | `external/lobehub/src/features/Conversation/store/slices/data/pendingInterventions.ts` | Pending tool approvals are derived from message/tool state. |
| LobeHub streaming handler | `external/lobehub/src/store/chat/agents/StreamingHandler.ts` | text/reasoning/tool/grounding/image/stop chunks, trace ID, finish type. |
| LobeHub trace service | `external/lobehub/src/services/trace.ts` | telemetry gate and trace event emission. |
| Peers error classifier | `apps/station/app/subserver/agent/service/error_classifier_service.go` | provider failover classification and recovery flags. |
| Peers TurnService | `apps/station/app/subserver/agent/service/turn_service.go` | provider retry, compression, fallback, tool loop, delegation, growth events and `TurnEvent`. |
| Peers trace model/API | `model/domain/agent/agent.proto`, `apps/station/app/subserver/agent/domain/turn.go`, `handler/turn_handler.go`, `infrastructure/persistence/turn_trace.go` | `TurnTrace`, classified errors, provider calls, tool calls, knowledge chunks and trace read APIs. |
| Desktop chat runtime | `apps/desktop/src/store/chat.ts` | stream events, tool approvals, stop/retry/regenerate/branch and ad hoc error mapping. |
| Desktop diagnostics | `apps/desktop/src/diagnostics/agentTurnDiagnostics.ts`, `apps/desktop/src/store/chatDiagnostics.test.ts` | replay input export and secret redaction test. |

## 3. Target Ownership

| Capability | Source Of Truth | Desktop Projection Owner | Notes |
| --- | --- | --- | --- |
| Error classification | Station `ErrorClassifierService` | Chat runtime diagnostics projection | Desktop may localize, but must not reclassify business recovery semantics. |
| Turn trace | Station TurnService / trace storage | Trace viewer/export projection | Trace IDs bind messages, tool calls, provider calls and recovery actions. |
| Stop/retry/regenerate/continue/branch | Station action lineage once M4 is implemented | Chat runtime store | Desktop dispatches user intent and renders state. |
| Diagnostics export | Desktop projection + Station trace | Diagnostics module | Must redact secrets and actor-scoped data. |
| Reconnect/reconcile | Runtime/store owners | Chat/topic/resource runtimes | Page mount fetch is not recovery ownership. |

## 4. Required Contracts

```ts
type AgentRecoverableFailureKind =
  | 'provider_auth'
  | 'provider_billing'
  | 'provider_rate_limit'
  | 'provider_overloaded'
  | 'provider_timeout'
  | 'context_overflow'
  | 'model_not_found'
  | 'stream_aborted'
  | 'stream_stalled'
  | 'tool_approval_timeout'
  | 'tool_execution_error'
  | 'mcp_connection_error'
  | 'memory_unavailable'
  | 'knowledge_unavailable'
  | 'authorization_denied'
  | 'bridge_unavailable'
  | 'unknown';

interface AgentRecoveryState {
  turnId: string;
  conversationId: string;
  agentId: string;
  failureKind: AgentRecoverableFailureKind;
  owner: 'station' | 'desktop_rust' | 'desktop_web' | 'provider' | 'user';
  retryable: boolean;
  allowedActions: Array<'retry' | 'regenerate' | 'continue' | 'switch_model' | 'reconnect' | 'approve' | 'deny' | 'export_diagnostics'>;
  traceId?: string;
  userMessage: string;
  redactedDetail?: Record<string, unknown>;
}
```

Runtime events must extend the M1 family:

```ts
type AgentRuntimeRecoveryEvent =
  | { type: 'recovery.failure_classified'; state: AgentRecoveryState }
  | { type: 'recovery.action_requested'; turnId: string; action: string; actorId: string }
  | { type: 'recovery.action_completed'; turnId: string; action: string; traceId?: string }
  | { type: 'recovery.action_failed'; turnId: string; action: string; error: AgentRecoveryState }
  | { type: 'diagnostics.exported'; turnId: string; traceId?: string; redaction: 'applied' };
```

## 5. Implementation Slices

### M9.1 Error Taxonomy And Mapping

- Map Station `FailoverReason` to Desktop recovery state.
- Keep provider-specific raw detail in redacted diagnostic payloads only.
- Define bridge/MCP/local errors separately from provider failures.

Stop condition: no Desktop-only regex should become the canonical classifier.

### M9.2 Recovery Action Lineage

- Bind retry/regenerate/continue/branch/stop to turn ID, conversation ID and action ID.
- Persist action outcomes where Station owns lineage.
- Reconcile pending action state after reconnect.

Stop condition: retry must not be a local message replay with no Station trace.

### M9.3 Diagnostics Export And Redaction

- Export replay input, Agent config snapshot, model ref, resource refs, tool calls and trace references.
- Redact token/key/secret/password/session/cookie and actor-private payloads.
- Include command/test evidence for redaction.

Stop condition: raw args/results cannot be exported by default.

### M9.4 UI Recovery States

- Render actionable states for provider unavailable, auth denied, no credentials, stream stalled, tool approval pending, knowledge not indexed, memory unavailable and bridge unavailable.
- Keep loading/empty/disconnected/auth-denied states consistent across Agent workbench rails.

Stop condition: generic toast-only failures are not parity evidence.

### M9.5 Regression Matrix

- Cover normal, loading, empty, error, reconnect, duplicate provider/model ID, approval denial, stream abort, retry and branch flows.
- Browser evidence is required for UI states; unit tests are required for contract mapping and redaction.

## 6. Verification Matrix

| Check | Command / Evidence | Required Result |
| --- | --- | --- |
| Desktop typecheck | `pnpm --dir apps/desktop run check` | Pass after M9 implementation. |
| Desktop diagnostics tests | Targeted Vitest for diagnostics/redaction/recovery state mapping | Pass. |
| Station recovery tests | Targeted Go tests for error classifier, turn trace and retry/fallback paths | Pass if touched. |
| Rust bridge checks | Targeted `cargo test` for bridge unavailable/local failure paths | Pass if touched. |
| Browser evidence | Manual or automated UI evidence | Shows recovery actions and trace/diagnostics export. |
| Redaction evidence | Test output and sample diagnostic | Secrets are redacted. |

## 7. Forbidden Relationships

- Desktop Web must not canonicalize provider recovery semantics.
- Diagnostics must not leak secrets, credentials, cookies or actor-private payloads.
- Retry/regenerate/branch must not bypass Station action lineage after M4.
- Recovery state must not be inferred from localized message text.
- M9 must not claim product migration without GATE-008 checks.

## 8. Traceability

| Evidence ID | BOM ID | Spec ID | Plan Step | Gate ID | Source Path | Target Path | Owner | Status | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EVID-011-I-pre | BOM-007/BOM-015 | SPEC-002/SPEC-009/SPEC-011/SPEC-013 | PLAN-P4 / M9 pre-execution | GATE-006/GATE-008 | LobeHub generation/data/intervention/streaming/trace sources; Peers `error_classifier_service.go`, `turn_service.go`, `agent.proto`, `turn_handler.go`, `chat.ts`, `agentTurnDiagnostics.ts` | This spec; future recovery taxonomy, diagnostics export, UI recovery states and regression matrix | Station/Desktop Rust/Desktop | implemented | Product code unchanged; recovery UI and GATE-008 remain unproven until EVID-020 implementation. |

## 9. Evidence Target

EVID-020 should include recovery contract diffs, redaction tests, targeted Station/Desktop/Rust checks, browser recovery evidence and remaining unproven failure classes.
