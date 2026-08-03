# Modern Chat Agent — Architecture Design

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-07-30 | **Updated**: 2026-07-30
> **Owner**: Peers-Touch Agent Team
> **Module**: `model/domain/agent/`, `apps/station/app/subserver/agent/`, `apps/desktop/`, `apps/mobile/`

---

## 1. Evidence Ledger

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| Station already owns turn persistence, prompt assembly, provider execution, tool iteration, messages, and TurnTrace | `verified_fact` | `TurnService`, persistence models, handlers | high | Full production E2E |
| Station already has memory, skill, knowledge, compression, error recovery, growth, and review foundations | `verified_fact` | Agent service tree and architecture sources | high | Cross-capability E2E |
| Desktop App has a Station SSE bridge while browser gateway mode still uses a one-shot turn path | `verified_fact` | Desktop Rust `agent_turn`; Web `streamAgentTurn` | high | Browser runtime trace |
| Desktop retains local CLI execution and in-memory Agent chat state that conflict with Station truth | `verified_fact` | Desktop `agent_turn`, provider, and chat modules | high | Consumer deletion audit |
| A working turn alone is insufficient for a dependable Agent | `inference` | Benchmark runtime contracts plus current architecture goals | high | Owner acceptance of target quality |
| Stateful Codex/Claude-like runtimes require conversation-scoped runtime identity separate from model-provider identity | `verified_fact` for benchmark behavior; `proposal` for Peers-Touch | AgentBox thread-owned runtime and external session contract | medium-high | Peers runtime product decision |
| Multi-Agent orchestration should consume, not define, the single-Agent runtime | `proposal` | Separation between Agent Canvas and turn kernel | high | Architecture review |

## 2. Scope And Quality Outcome

This architecture defines a single-Agent runtime that is:

- **Coherent**: deterministic context construction and multi-turn continuity.
- **Capable**: explicit model/runtime capability negotiation and degradation.
- **Agentic**: bounded model-tool-model iteration with policy and approval.
- **Persistent**: Station-owned Agent, conversation, message, turn, and trace.
- **Recoverable**: ordered events, idempotent commands, cancellation, reconnect,
  replay, retry, and restart behavior.
- **Inspectable**: context attribution, tool audit, usage, feedback, and replay.
- **Safe**: actor isolation, credential isolation, bounded resources, no
  unregistered execution, and no hidden client truth.

Non-goals:

- Multi-Agent plan construction or reduction.
- Offline provider execution on clients.
- Arbitrary user-supplied CLI commands.
- Voice/video, Mobile UI, marketplace, sharing, or visual redesign.
- Unreviewed automatic self-modification.

## 3. Core Principles

1. **Station owns Agent intelligence and durable truth.**
2. **Model proto owns shared contract semantics.**
3. **A client capability kernel executes only device-local capabilities requested by Station.**
4. **Client Web renders runtime projections and user decisions.**
5. **One canonical turn state machine drives every supported runtime.**
6. **Context is a typed, budgeted, attributable build product.**
7. **Every runtime action is bounded, observable, and replayable.**
8. **Unsupported capabilities degrade explicitly before execution.**
9. **Single-Agent reliability precedes multi-Agent orchestration.**

## 4. System Architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Client Web (Desktop now; Mobile later)                              │
│ Agent profile, conversation, composer, stream projection, approval, │
│ context/usage diagnostics, feedback, artifacts                      │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ typed Tauri commands/events
                                │ or browser HTTP/SSE gateway
┌───────────────────────────────▼─────────────────────────────────────┐
│ Client Capability Kernel (Desktop Rust / Mobile Rust + plugins)     │
│ Station API/SSE bridge, local MCP/builtin execution, local file      │
│ handles, device policy, local audit projection                       │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ JWT + protobuf-aligned HTTP/SSE
┌───────────────────────────────▼─────────────────────────────────────┐
│ Station Agent Kernel                                                 │
│                                                                      │
│ Admission -> Context Build -> Runtime Resolve -> Agent Loop           │
│     -> Tool/Approval Bridge -> Persist -> Evaluate -> Project         │
│                                                                      │
│ Agent/Conversation/Turn/Message/ContextLedger/Trace/Feedback truth    │
└──────────────┬─────────────────────────────┬─────────────────────────┘
               │                             │
               ▼                             ▼
┌──────────────────────────┐   ┌──────────────────────────────────────┐
│ Direct Model Runtime     │   │ Registered External Agent Runtime   │
│ Stateless HTTP/model CLI │   │ Conversation-bound runtime home,    │
│ Station supplies context │   │ external session, resume/reset      │
└──────────────────────────┘   └──────────────────────────────────────┘
               │                             │
               └──────────────┬──────────────┘
                              ▼
                    Provider / Agent process
```

## 5. Sources Of Truth

| State/capability | Source of truth | Mutation authority | Projection/executor |
|---|---|---|---|
| Agent definition, persona, bindings, policy | Station | Client through version-gated Station API | Agent runtime projection |
| Conversation and runtime binding | Station | Station plus authorized user commands | Chat runtime projection |
| Messages and branch lineage | Station | Turn kernel and authorized message commands | Chat runtime projection |
| Turn, attempts, events, trace, usage | Station | Turn kernel | Chat/diagnostic projections |
| Provider/model catalog and capability facts | Station | Station catalog/discovery | Provider projection |
| Credentials | Station | Client submission; Station runtime state | Status projection only |
| Memory, skills, knowledge bindings | Station | Station services and authorized user/Agent actions | Capability projections |
| Device-local endpoint/file handle | Owning client capability kernel | Authenticated local user | Station receives opaque capability/result |
| Composer draft, selection, layout | Client Web | Local user | Local only |
| Multi-Agent task graph | Station orchestration | Agent Canvas runtime | Separate orchestration projection |

Durable Agent state must not be duplicated in client stores or files. Client
caches are projections and lose conflicts to Station.

## 6. Runtime Kinds

### 6.1 Direct Model Runtime

A Direct Model Runtime is stateless across turns. Station:

- Builds the full context.
- Selects and revalidates provider/model/credential.
- Calls HTTP, embedded, or a registered stateless model CLI adapter.
- Owns retry, fallback, tool iteration, persistence, and trace.

The provider receives only the context supplied by Station. It does not own an
independent conversation.

### 6.2 Stateful External Agent Runtime

A Stateful External Agent Runtime is a registered runtime such as a
Codex/Claude-style Agent that owns private session state.

Station owns:

- The `ConversationRuntimeBinding`.
- The pinned executor/provider/model capability snapshot.
- The runtime-home identity.
- The authoritative external session handle.
- Resume/reset decisions and lifecycle cleanup.

The runtime binding is conversation-scoped. Two conversations cannot share a
writable runtime home or external session. Changing executor or provider
requires a new conversation or an explicit destructive reset.

An external Agent runtime is not modeled as a stateless provider adapter.

### 6.3 Local Capability Runtime

An authenticated client capability session advertises device-local abilities.
Station dispatches only compatible typed requests; the client kernel enforces
permissions and returns results without owning the turn. Missing capabilities
degrade or reject before execution.

## 7. Canonical Turn Lifecycle

```text
SUBMITTED -> QUEUED | ADMITTED -> CONTEXT_BUILDING -> RUNNING
RUNNING -> WAITING_APPROVAL | WAITING_LOCAL_TOOL | COMPRESSING
        -> RETRYING | FALLING_BACK
        -> COMPLETED | FAILED | CANCELLED | INTERRUPTED
```

Rules:

1. `SubmitTurn` requires a client idempotency key.
2. One conversation has one active turn and a bounded FIFO queue.
3. Transitions are monotonic and emit sequenced typed events.
4. Cancellation propagates to provider/process/tool/approval waiters.
5. Retry creates an attempt; regenerate creates an immutable message branch.
6. Stateful resume/reset records an external-session epoch change.

The full state machine is defined in `data-model.md`.

## 8. Context Assembly Contract

Station builds one `ContextLedger` per attempt in this order: identity/policy,
model facts, frozen memory, skill index and activated skills, selected branch
history/summary, knowledge, workspace references, attachments, tool schemas,
and current input.

Every segment records source references, hash/version, token estimate,
inclusion/truncation decision, and trust/policy metadata. The budget includes
text, reasoning replay, images/files, tool schemas, and completion reserve.
Compression preserves branch semantics and source attribution.

Memory describes learned user/Agent experience; knowledge supplies external
facts; skills supply procedures; tools supply executable capabilities. These
types cannot substitute for one another.

## 9. Capability Negotiation

Station resolves an immutable `RuntimeCapabilitySnapshot` before admission,
covering input/output modalities, streaming, reasoning, prompt cache, tools,
external resume, and limits. Each requested capability resolves to `native`,
`bridged`, `degraded`, or `rejected`.

Clients cannot infer capability from provider names. Degradation is disclosed
before execution and the per-turn snapshot is authoritative.

## 10. Tool Policy And Runtime Budgets

Every turn has an immutable budget for attempts, Agent steps, tool calls,
repeat/ping-pong detection, delegation depth, wall time, tokens, payloads,
queue capacity, and optional cost. Exhaustion, unresolved tools, approval
timeout, and retry/fallback exhaustion produce typed terminal or escalation
outcomes, never silent success.

## 11. Ordering, Replay, And Reconciliation

Station persists semantic `TurnEvent`s with a monotonic per-turn sequence.
Delivery is at least once; clients deduplicate, reconnect with a cursor, replay
retained events, then reconcile from a snapshot. Text deltas may compact into
checkpoints; tool, approval, error, usage, context, fallback, and terminal
events remain durable. App and browser use the same vocabulary.

Page switching, hidden windows, restart, and dropped SSE do not change Station
lifecycle.

## 12. Message Lineage And Conversation Semantics

Messages form a tree. Regenerate creates a sibling assistant branch;
edit-and-resend creates a user branch; delete is never retry semantics. Active
branch selection is separate from message existence.

Agent binding is durable. Direct-model selection changes explicitly while each
turn keeps its snapshot. Stateful runtime config is pinned for an
external-session epoch; destructive reset closes and audits that epoch.

## 13. Observability, Feedback, And Evaluation

Terminal evidence records runtime/capability snapshot, context attribution,
attempts, tools, fallbacks, errors, usage/cost, timing, and completion reason.
Feedback binds to an immutable turn/branch; growth attribution uses only
recorded resources.

Redacted diagnostic export reconstructs the turn without hidden UI state.
Evaluation combines deterministic contracts, receiver-perspective Surface
Gates, and fixed quality cases for completion, context, tools, and unsupported
claims.

## 14. Component Relationships

| Component | Responsibility | Reads/mutates | Must not |
|---|---|---|---|
| Turn Admission Service | Idempotency, active-turn lock, bounded queue | Conversation/turn truth | Execute providers |
| Context Assembly Service | Build and budget `ContextLedger` | Agent, memory, skills, history, knowledge | Persist client-local paths |
| Runtime Resolver | Resolve runtime kind and capability snapshot | Provider/model/runtime catalog | Trust client capability claims |
| Agent Loop | Drive model/tool/model state machine and budgets | Turn/attempt/tool state | Own provider credentials |
| Provider Runtime | Execute stateless model request | Leased credential and context | Retain conversation state |
| External Agent Runtime Manager | Own conversation runtime home/session epoch | Runtime binding | Share writable state across conversations |
| Tool Policy/Registry | Resolve owner, schema, risk, approval | Agent policy/tool catalog | Execute device APIs in Station |
| Client Capability Executor | Execute authorized device-local capability | Opaque request/local policy | Decide turn completion |
| Trace/Evaluation Service | Persist evidence, usage, feedback attribution | Turn facts | Infer unrecorded resource use |
| Chat Runtime Projection | Consume/replay/reconcile Station state | Read-only Station projections | Become durable truth |

## 15. Allowed And Forbidden Relationships

Allowed:

- Client Web -> client capability kernel -> Station for authenticated Agent APIs.
- Browser Web -> Desktop gateway -> Station for the same business contracts.
- Station -> registered provider or external Agent runtime.
- Station -> a leased client capability session for an explicitly typed local request.
- Agent Canvas -> Modern Chat Agent kernel for individual Agent turns.

Forbidden:

1. Desktop/Mobile executing providers or AI CLI runtimes.
2. Desktop durable stores owning Agent definitions, conversations, or messages.
3. Client-submitted provider commands, binary paths, credentials, or capability
   assertions controlling Station execution.
4. Two conversations sharing a writable stateful runtime home/session.
5. Tool execution bypassing owner resolution, schema validation, policy, and
   audit.
6. Unbounded queues, attempts, tool loops, context, attachments, or processes.
7. Reporting `completed` when budgets, tools, or acceptance requirements failed.
8. Replaying provider reasoning when the capability policy forbids it.
9. Memory, skill, or knowledge attribution without recorded source IDs.
10. Multi-Agent orchestration bypassing the canonical single-Agent turn kernel.

## 16. Quality Gates

| Outcome | Required evidence |
|---|---|
| Basic usefulness | Fixed five-turn factual continuity case passes on one Direct and one CLI/runtime cell |
| Context correctness | ContextLedger accounts for all included segments and stays within advertised model budget |
| Capability correctness | Unsupported vision/tool/reasoning cases degrade or reject before provider execution |
| Streaming correctness | P95 bridge overhead from Station event receipt to Web projection is <=250 ms; no synthetic streaming |
| Ordering/replay | No duplicate mutation under repeated delivery; reconnect reconstructs identical terminal projection |
| Cancellation | Station reaches terminal cancellation within 2 s; CLI/process cleanup completes within 5 s |
| Safety | Zero cross-actor reads, credential leaks, unregistered binaries, or approval bypasses |
| Loop control | Repeat, ping-pong, step, time, and tool budgets terminate deterministically |
| Persistence | Conversation, branch, runtime binding, terminal turn, and trace survive Station/Desktop restart |
| Stateful runtime isolation | Two conversations never share runtime home or external session |
| Observability | Diagnostic export reconstructs context sources, attempts, tools, usage, and terminal reason |
| Quality | Required fixed cases pass with no unsupported completion claim; failures remain visible and attributable |

Measurement covers App/browser, Mobile contract compatibility, and every runtime kind.
## 17. Review Boundary

This document is `DESIGN_READY_FOR_REVIEW`, not accepted architecture.
Planning stays blocked until all proposed decisions are accepted or revised.
