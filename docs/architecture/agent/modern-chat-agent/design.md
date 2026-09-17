# Modern Chat Agent — Architecture Design

> **Status**: accepted
> **Version**: v1.1
> **Created**: 2026-07-30 | **Updated**: 2026-09-17
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
| Current client execution envelopes omit trusted replay policy and receipt-recovery authority | `verified_fact` | `model/domain/agent/agent.proto#ClientCapabilityRequest`; G1-C entry audit | high | None |
| Current Station receipt validation rejects all receipts after the execution deadline | `verified_fact` | `ToolDispatchService.validateReceiptTuple` | high | Recovery-path implementation |
| Current lease registration accepts a client-selected future expiry without a Station maximum TTL | `verified_fact` | `ToolDispatchService.RegisterCapabilityLease` | high | D19A lease implementation |
| Current Agent capability routes authenticate actor JWT but take device identity from `X-Device-ID` without device-possession proof | `verified_fact` | core JWT claims; `serverwrapper.DeviceID`; ToolDispatch handlers | high | D19B implementation evidence |
| Desktop and Station already possess actor-device Ed25519 signing and verified-key resolution | `verified_fact` | `ActorDeviceIdentity`; `DeviceStore.ResolveSigningKey` | high | Native recovery acceptance |
| A one-purpose signed recovery path can settle PREPARED work without restoring execution authority | `accepted_decision` | MCA-D19A in this document and `decisions.md` | high | G1-A/B implementation evidence |
| One canonical device-signed command proof can bind every capability control-plane request without a second trust root | `accepted_decision` | MCA-D19B in this document and `decisions.md` | high | G1-A/B implementation evidence |
| Production restart cannot replay externally idempotent PREPARED work because the restored context has terminal-only authority | `verified_fact` | G1-C audit of `desktop_executor_worker/supervisor.rs` and `fenced_executor.rs` | high | None |
| A new Station-fenced takeover can restore execution authority without broadening the recovery credential | `accepted_decision` | MCA-D19C in `decisions.md` | high | Deterministic takeover race evidence |
| Provider/model filtering and TurnTrace cannot prove P12/CLI non-advertisement or zero local runtime side effects | `verified_fact` | XR-4 source audit and rejected weak adapter | high | Production snapshot implementation |
| Production-owned advertisement and monotonic activity snapshots make conditional-runtime absence falsifiable without enabling the runtime | `accepted_decision` | MCA-D19D in `decisions.md` | high | XR-4 Native/Browser evidence |
| Desktop Marketplace currently accepts arbitrary unsigned JSON, ignores branch semantics, and trusts source labels | `verified_fact` | `application/skills_market/mod.rs` source parser/store | high | None |
| Publisher-signed snapshots plus target-authority readback close X3 without a hosted marketplace | `accepted_decision` | MCA-D20 in `decisions.md` | high | X3 native evidence |
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
- Voice/video, Mobile UI, hosted commercial marketplace/community, sharing, or
  visual redesign.
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
| Package catalog snapshot | Verified publisher signature and pinned source registration | Desktop Rust verifier/cache | Desktop Marketplace projection |
| Installed Agent/Skill state | Station | Station package/Skill services | Desktop Agent/Skill projections |
| Installed MCP configuration | Actor-scoped Desktop Rust MCP store | Desktop Rust MCP service | Desktop MCP projection |
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

Thinking mode and reasoning effort are separate inputs. Agent configuration
owns the default thinking mode; a Turn may explicitly override it. Station
normalizes an unspecified value to `auto`, validates an explicit
`enabled`/`disabled` request against the selected provider/model catalog
capability before execution, and pins the effective mode in the Turn runtime
snapshot. Provider adapters map the portable mode to provider-specific
payloads. They must not infer mode from reasoning effort, provider display
names, URL patterns, or response deltas. A client must not advertise this
control until the resolved model capability declares it. When a provider marks
reasoning effort inapplicable for `disabled`, its adapter omits that wire field;
the product controls remain independent even when one has no effect in the
selected mode.

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

Accepted command closure (`MCA-D08A`): all five revision mutations are Station
commands:

- `RetryTurn` adds one `TurnAttempt` under the same failed/cancelled/interrupted Turn.
- `RegenerateTurn` creates a new Turn and sibling assistant branch from one
  immutable source assistant message.
- `EditAndResend` creates a revised user sibling and a new Turn; it never
  overwrites the source user message.
- `SelectActiveBranch` changes only the conversation branch head.
- `TombstoneMessage` removes a message from normal projection/context without
  rewriting lineage or deleting retained Turn/Trace/feedback evidence.

Every mutation is actor-scoped, idempotent, and fenced by expected conversation
version. Clients may optimistically project a pending command, but they may not
mutate durable message content, branch selection, or tombstone state locally.

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
| Tool Dispatch Service | Commit decision/claim/outbox/result/batch continuation | Station ToolCall and continuation truth | Execute device APIs or trust client replay claims |
| Receipt Recovery Service | Issue scoped credential, verify device signature, consume nonce with terminal CAS | Recovery rows and verified device keys | Authorize execution, lease renewal, pull, or continuation |
| Client Capability Executor | Execute authorized device-local capability | Opaque request/local policy | Decide turn completion |
| Client Receipt Ledger | Persist PREPARED and terminal attempts | Device-local encrypted storage | Become Station result truth |
| Client Resource Registry | Resolve opaque refs to local paths/handles | Device-local encrypted storage | Expose raw paths/handles to Station or Web |
| Package Catalog Verifier | Pin source keys, verify signed snapshots, derive scan/risk/install policy, and cache the last verified revision | Publisher snapshot plus local policy | Trust source-provided labels or become installed-state authority |
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

Independent DESIGN review passed on 2026-08-17. D14-D18 and C11-C15 are
accepted planning inputs. Production implementation and Gates remain
`UNPROVEN`.

## 18. V2 Ownership Reconciliation

| Concern | Durable authority | Runtime projection/executor | Forbidden duplicate |
|---|---|---|---|
| Home work projection | Station Agent/topic/task/capability services | Desktop `homeRuntime` | Page-derived durable recents/Brief truth |
| Capability catalog | Station Capability Manifest Registry | Desktop capability projection | Separate Tool/MCP/Connector inventories claiming readiness |
| Agent binding/policy | Station Agent Capability Binding Service | Desktop configuration UI | `config_json` or local store as portable binding truth |
| Runtime compatibility | Station admission snapshot plus active client capability lease | Client reports signed/typed local capability facts | Provider-name or UI-label inference |
| MCP operation | Station operation/turn lineage | Owning client capability manager | Client-only terminal operation state |
| Connector resource tools | Station Connector Manifest Projection | OAuth owner/resource adapter | Connector display label as tool readiness |
| Evaluation | Station Evaluation Service | Desktop Evaluation projection | localStorage dataset/run/result and `quickCompletion` terminal truth |

## 19. Home Projection Contract

Home reads one actor-scoped `HomeWorkProjection` containing:

- pinned/favorite Agent references;
- accepted recent topics and tasks;
- selected Agent/model readiness;
- Brief/Needs You items derived from durable Task/approval state;
- Connector/Tool readiness summaries;
- projection revision and freshness state.

Desktop `homeRuntime` owns subscription, reconciliation, and store projection.
The page renders only. Chat/Task submission uses canonical Station commands and
retains the local draft until acceptance.

Failure semantics:

- stale keeps the last accepted projection and disables new commitments;
- partial source failure identifies the missing slice without erasing valid
  slices;
- reconnect reloads by revision and must not overwrite newer local projection;
- account/Station switch clears the prior actor scope before rendering ready.

## 20. Unified Capability Contract

`CapabilityManifest` is the sole catalog entry for builtin, Skill, MCP,
Connector, and client-local capabilities. It includes:

- stable capability ID and version;
- source type and source instance;
- input/output schema references;
- execution owner and required client/runtime capabilities;
- risk, approval default, secret boundary, and availability.

`AgentCapabilityBinding` refers to the manifest ID/version and owns enabled
state, approval policy, expected Agent version, and binding revision.

`CapabilityReadinessSnapshot` is immutable for one admission decision and
combines manifest, Agent binding, model/runtime compatibility, connection state,
and selected client capability lease. Unknown or stale facts reject or degrade
before provider/tool execution.

Accepted Knowledge refinement (`MCA-D15K`):

- Station owns an actor-scoped, versioned Knowledge resource descriptor.
- Station-hosted resources reference immutable content/index revisions.
- Device-local resources expose only opaque client resource refs and require
  the selected capability session.
- Turn requests never supply Knowledge locators, policy, or content; context
  assembly consumes only READY Knowledge bindings from the pinned snapshot.

```text
Knowledge source mutation
  -> Station KnowledgeResourceDescriptor revision
  -> immutable Knowledge CapabilityManifest version
  -> AgentCapabilityBinding CAS
  -> CapabilityReadinessSnapshot
  -> ContextLedger source record
  -> provider prompt
```

The descriptor API owns create/update/list/tombstone and returns the manifest
identity published by the mutation. Station content ingestion must complete
and produce a content hash/index revision before readiness becomes `READY`.
Client-local descriptors remain `UNAVAILABLE` until the selected capability
session proves the opaque resource and can execute bounded retrieval.

Forbidden relationships:

- `ExecuteTurnRequest` must not carry Knowledge source, path, URL, policy, or
  content.
- Web/desktop-rust must not infer Knowledge readiness from a selected file,
  stored label, or legacy Agent JSON.
- Station retrieval must not open a client-local path or fetch a mutable URL at
  turn time.
- Package import must not create the Agent until all portable descriptors and
  manifest versions resolve; unresolved local refs return a dependency plan.

ToolCall side-effect protocol:

1. Station commits one decision and one execution claim.
2. Executor durably records a fenced `PREPARED` receipt before side effects.
3. Externally idempotent tools use `tool_call_id` as the idempotency key.
4. Executor records `APPLIED` and reports the unique result.
5. If a non-idempotent tool crashes after `PREPARED`, state becomes
   `UNKNOWN_SIDE_EFFECT`; automatic redispatch/takeover is forbidden.
6. Cancel/revoke/delete linearizes against `dispatch_committed_at`; old-fence
   reports are audit-only except scoped cleanup acknowledgement.

## 21. MCP And Connector Operation Semantics

Install, configure, test, connect, reconnect, and cancel are represented by a
Station-owned `CapabilityOperation`. Desktop Rust executes local steps and
reports typed progress/results with operation ID and attempt sequence.

Turn-time invocation is not a capability operation. It is a canonical
`ToolCall` pinned to manifest/binding/readiness snapshots. This keeps install/
connection lifecycle idempotency separate from exactly-once model tool
execution.

Rules:

- idempotency key prevents duplicate lifecycle mutations;
- operation idempotency covers install/configure/test/connect/reconnect/
  uninstall; ToolCall ID covers turn-time invoke;
- cancellation is requested at Station and acknowledged by the executor;
- process/port/secret cleanup is owned by the client capability manager;
- terminal result is not inferred from process exit or Web state;
- disconnect leaves the operation reconcilable, never silently successful;
- actor/device/session/lease/payload mismatch rejects executor events;
- first committed cancellation/result/timeout fence wins;
- success commits only after required cleanup; cleanup failure commits failure;
- late old-fence terminal/progress events are audit-only.

Connector OAuth connection remains owned by the OAuth subsystem.
`ConnectorResourceManifest` maps an authorized resource and scopes to versioned
tool manifests. Agent binding never stores OAuth tokens.

## 22. Fenced Client Tool Execution

This section contains the accepted `MCA-D19` core and accepted `MCA-D19A`
receipt-recovery amendment. G1-C remains blocked until D19A is represented in
proto and implemented in Station.

The authoritative device-local execution path is:

```text
Station creates one ToolBatch for one provider response
  -> ToolCall policy/decision transaction
  -> execution claim + targeted outbox envelope
  -> selected client capability kernel
  -> durable PREPARED receipt
  -> local side effect
  -> APPLIED / FAILED / RECONCILED_UNKNOWN result
  -> Station result transaction
  -> all batch members APPLIED
  -> unique batch continuation transaction
  -> next model step
```

Ownership:

- Station owns policy, decision revision, execution claim, dispatch identity,
  result acceptance, and turn continuation.
- Desktop Rust owns envelope validation, opaque resource resolution, local
  permission enforcement, durable receipt attempts, and device-local execution.
- Desktop Web owns only user decision intent and the projection rendered by
  ToolCallCard/AgentProfile.
- `toolRuntime` is the sole Web projection owner. It cannot classify policy,
  claim execution, invoke Rust, or continue a turn.

Delivery is targeted to one authenticated capability session/device and is
at-least-once. The envelope binds decision ID/revision, claim/lease/fence,
dispatch sequence, payload hash, execution deadline, capability schema,
Station-resolved replay policy, bounded arguments, and opaque resource
references. The client rejects any stale, mismatched, expired, untargeted, or
unfenced envelope before side effects.

MCA-D19A separates three authorities:

1. **Execution authority** exists only while the targeted capability lease and
   `execution_deadline` are valid. It permits entering `PREPARED` and starting
   the side effect.
2. **Terminal receipt authority** exists after a matching `PREPARED` row and
   until `reconciliation_deadline`. It can report only
   `APPLIED|FAILED|RECONCILED_UNKNOWN`; it cannot start or repeat work.
3. **Continuation authority** remains Station-only and is never restored by a
   client receipt or recovery credential.

Before dispatch, Station persists a single-purpose
`ReceiptRecoveryCredential` record and includes its opaque ID, nonce,
device-signing-key ID, scope hash, and expiry in the envelope. The record is
bound to actor, device, ToolCall, request, claim, fence, payload hash, replay
policy, and reconciliation deadline. The first accepted terminal receipt binds
its `result_id` through the nonce/result CAS. The credential is not a bearer
execution token.

Station computes the execution `payload_hash` over deterministic request bytes
with both `payload_hash` and `recovery_credential` absent. It then derives the
credential `scope_hash` from that payload hash and the persisted authority
tuple. This two-stage construction is canonical across Station and Rust and
forbids a self-referential envelope hash.
Recovery authenticates the device through an Ed25519 signature from the bound
verified key over deterministic protobuf bytes with the domain separator
`peers-touch/agent/tool-receipt-recovery/v1`. Station loads actor/device identity
from the persisted credential and resolves the current verified key itself;
request/header identity is never trusted.

The recovery nonce is consumed by compare-and-swap on the first valid terminal
receipt digest. Replaying the same credential, nonce, and digest returns the
original acknowledgement; another digest conflicts. Revoking the capability
lease does not invalidate settlement for already-PREPARED work, but revoking or
rotating the bound device trust key does. Missing, expired, mismatched, or
invalidly signed recovery evidence settles the ToolCall as
`UNKNOWN_SIDE_EFFECT` after the reconciliation deadline and never redispatches
it.

Replay policy is Station-resolved from the pinned capability manifest and
readiness snapshot:

- `NO_REPLAY_AFTER_PREPARED`: restart does not execute again and submits
  `RECONCILED_UNKNOWN`.
- `REPLAY_WITH_EXTERNAL_IDEMPOTENCY`: the envelope carries a non-empty
  `external_idempotency_key`; the executor must pass that exact key to the
  external system on every attempt.

Clients cannot advertise or upgrade replay policy in a receipt.

Capability leases have explicit register, renew, and revoke semantics. Renewal
registration accepts a capability advertisement only; Station derives
actor/device and issues lease/session identity, revision, and bounded expiry.
Renewal is an actor/device/session-bound CAS that advances lease revision and
expiry without changing capability-set hash or device signing key. A changed
capability set or key requires a new session. Station policy caps every renewal
TTL. Revoke and expiry stop pulls, new dispatch, and pre-PREPARED execution
immediately. Logout, Station switch, and worker shutdown request revoke;
Station TTL remains the fail-closed owner when the client disappears.

Desktop Rust owns an encrypted actor/device-scoped resource-ref registry. Each
entry binds opaque ref ID, capability, permission grant, integrity metadata,
and expiry to a local path or native handle. Station and Web receive only the
opaque ref and bounded metadata. Entries needed for an idempotent PREPARED
replay remain available through the reconciliation deadline; terminal
settlement or expiry schedules local deletion.

### 22.1 Station-Authorized Restart Takeover

A persisted receipt is evidence, not execution authority. On restart, Desktop
may use its recovery credential only to report a terminal receipt. It must not
execute an externally idempotent PREPARED request until Station emits a newly
fenced envelope under a current authenticated capability lease.

For a ToolCall whose pinned policy is
`REPLAY_WITH_EXTERNAL_IDEMPOTENCY`, Station may CAS-take over the PREPARED
attempt while the original execution deadline remains live. The transaction:

1. verifies the current lease matches actor, device, signing key, capability,
   and schema;
2. keeps the ToolCall, decision, execution claim, bounded arguments, and exact
   external idempotency key immutable;
3. increments the fence and binds the new lease/session/revision;
4. creates a new request ID, dispatch sequence, payload hash, targeted outbox
   row, and recovery credential;
5. invalidates the previous recovery credential so old-fence terminal
   submissions are audit-only rejects.

Desktop consumes the takeover through the ordinary signed pull path and treats
it as a new fenced receipt attempt. It does not infer takeover from local
storage. The execution deadline is never extended. If no eligible lease exists
before that deadline, the capability is non-idempotent, or opaque resources
would require an undefined cross-session rebind, Station does not redispatch
and the existing reconciliation path settles `UNKNOWN_SIDE_EFFECT`.

This contract is accepted as `MCA-D19C`.

### 22.2 Device-Possession Boundary

Accepted MCA-D19B closes the normal-path device-authentication gap. Actor JWT proves the
actor only. `X-Device-ID` is routing metadata and a consistency assertion; it
is never device authority.

Every capability control-plane request that can register, renew, revoke, pull,
or submit an active-lease receipt carries a `ClientCapabilityCommandProof`
signed by the current verified actor-device Ed25519 key. Station constructs the
canonical signing payload from:

- a command-specific domain separator;
- authenticated actor PTID;
- device ID resolved from the request/lease and required to equal the header;
- command ID;
- deterministic request-body hash with the proof absent;
- 256-bit nonce;
- issued-at timestamp.

Station resolves the signing key from its verified device registry. It rejects
unknown, unverified, rotated, or revoked keys, clock skew beyond 60 seconds,
nonce reuse with a different digest, actor/device/header mismatch, and any body
hash or signature mismatch before lease lookup, outbox pull, or receipt
mutation.

A durable command ledger keys `(actor_id, device_id, signing_key_id, nonce)`.
The first valid write command binds command ID and body digest. An identical
retry reconstructs the same durable response; a different command or digest is
a typed conflict. Pull is read-only and may re-read from the same
`after_sequence`, but nonce reuse with a different digest still rejects.
Command-ledger retention covers the longer of lease expiry and the configured
anti-replay window, followed by bounded cleanup.

Registration signs the capability advertisement itself. Renewal and revoke
sign the lease identity and expected revision. Pull signs session, device,
cursor, and limit. Active-lease receipt submission signs the entire receipt.
Late terminal recovery uses a dedicated recovery-receipt endpoint and its
narrower D19A proof. That endpoint does not require a still-valid actor JWT
after logout: Station loads actor/device/key identity only from the persisted
credential scope and verifies the current unrevoked device key. It ignores
header identity. The active and recovery endpoints share one terminal-result
CAS but cannot fall back to each other's proof mode.

Current v1 policy bounds are a five-minute capability lease, two-minute default
execution deadline, ten-minute reconciliation window after execution deadline,
and 60-second command-proof clock skew. Station owns all four values.

Forbidden:

- treating an actor JWT as proof of a particular device;
- treating `X-Device-ID`, `capability_session_id`, or `lease_id` as a bearer
  device credential;
- accepting an unsigned capability advertisement, pull, lease mutation, or
  active receipt;
- allowing generic command proof to replace recovery scope/nonce after lease
  loss or execution-deadline expiry;
- requiring a live actor JWT for credential-bound terminal recovery, or
  accepting JWT/header identity as recovery authority;
- logging proof signatures, nonces, or canonical signing bytes.

Receipt and continuation rules:

1. Rust records `PREPARED` durably before the side effect.
2. Identical duplicate delivery returns the existing receipt or terminal
   result without executing again.
3. A mismatched payload under an existing request/fence is a typed conflict.
4. Lease takeover increments the fence. Old-fence business results are audit
   only.
5. A non-idempotent crash after `PREPARED` becomes
   `UNKNOWN_SIDE_EFFECT`; automatic redispatch is forbidden.
6. Each terminal result carries an immutable `result_id` and is unique by
   `(tool_call_id, result_id)`; one ToolCall accepts at most one terminal
   result.
7. All ToolCalls parsed from one provider response share a Station-issued
   `tool_batch_id`. The final `APPLIED` result transaction creates exactly one
   continuation keyed by `(turn_id, attempt_id, tool_batch_id)` only when every
   batch member is `APPLIED`.
8. A batch containing denial, expiry, cancellation, failure, or unknown side
   effect creates no automatic continuation. Continuing without that tool is a
   new explicit recovery command.
9. Replayed result submission returns the original acknowledgement and cannot
   append another model continuation.
10. A Station worker claims the continuation with a durable lease. Restart
    reclaims only work that is known not to have emitted a provider request, or
    work whose provider supports the same continuation idempotency identity.
    Ambiguous post-emission crashes become `reconciliation_required`.
11. A terminal receipt after lease revoke or `execution_deadline` is accepted
    only for a matching pre-deadline `PREPARED` row, valid recovery proof, and
    unexpired `reconciliation_deadline`.
12. Recovery proof never authorizes `PREPARED`, resource resolution for new
    work, lease renewal, another dispatch, or continuation.
13. A late valid `APPLIED` receipt records the side-effect fact, but cannot
    reopen a cancelled/expired Turn or a blocked ToolBatch.

Forbidden relationships:

- Web -> direct native tool execution.
- Web -> execution claim or result submission.
- Rust -> approval decision mutation.
- Station turn loop -> direct device-local side effect.
- Portable request/result -> arbitrary local filesystem path.
- Result endpoint -> persistence without canonical turn continuation.
- One ToolCall result -> one independent model continuation inside a
  multi-ToolCall provider response.
- Restart -> blind provider continuation replay after an ambiguous emission.
- Client receipt -> replay-policy selection or external-idempotency key change.
- Recovery credential -> new execution, lease restoration, or capability
  discovery.
- Station/Web -> resolution or persistence of a raw local path/native handle.

The typed fields and state transitions are defined in `data-model.md §8.9`.

### 22.3 Conditional Runtime Proof Boundary

MCA-D19D separates product advertisement from implementation registration:

```text
provider/runtime catalog registration
  -> Station effective profile evaluation
  -> explicit runtime advertisement state
  -> readiness projection
  -> client selector projection
```

Only the Station effective snapshot may claim that a runtime is advertised or
ready. Catalog records, provider protocol metadata, Desktop binaries, and local
configuration are inputs, not product advertisement.

Production proof uses two read-only authorities:

- Station owns the actor-scoped effective runtime advertisement/readiness
  snapshot and monotonic counters for runtime bindings, external sessions, and
  workspaces.
- Desktop Rust owns boot-scoped monotonic counters for local process starts,
  runtime-home creation, external-session opening, and workspace creation.

Snapshots carry owner identity, profile/readiness revision, observation time,
and monotonic counter epoch. They expose no local paths, commands, PIDs,
credentials, or reset operation. Acceptance compares before/after snapshots
only when all identities and revisions are unchanged; restart, counter
regression, missing owner, or unknown state fails closed.

For Desktop non-advertisement, receiver DOM, Station snapshot, and Desktop
activity snapshot must agree. For Browser, an isolated Browser lifecycle
provides receiver DOM and the same Station snapshot; Browser cannot claim a
Desktop-local counter as its own. Any correlated Desktop dispatch or Station
counter increase fails the Browser cell.

Forbidden:

- deriving readiness from provider/model list presence or absence;
- treating a missing row as `NOT_ADVERTISED`;
- resetting counters for an Acceptance run;
- exposing an Acceptance-only endpoint or instrumentation branch;
- using TurnTrace alone as process/runtime-home/session/workspace evidence;
- promoting P12/CLI because the proof contract exists.

## 23. Evaluation Authority

Station Evaluation Service owns benchmark, dataset, test case, run, case
attempt/result, target Agent/runtime/config snapshot, cancellation, and metrics.
Evaluation invokes the canonical Turn kernel with an evaluation context; it
does not bypass admission, tool policy, trace, or actor isolation.

Run semantics:

- create allocates a durable run in `pending`;
- start transitions to `running` and schedules bounded case attempts;
- cancel transitions through `cancelling` to authoritative `cancelled`, or to
  typed `partial` when cancellation/cleanup acknowledgement misses its deadline;
- retry creates a child run containing selected failed/incomplete cases and
  never transitions or overwrites the terminal parent;
- final metrics derive only from terminal case results;
- restart/readback reconstructs the same state from Station.

## 24. V2 Architecture Gates

| Gate | Architecture assertion |
|---|---|
| `agent-v2-home-command-center-e2e` | Home projection revision, duplicate Chat/Task submission idempotency, stale/partial/restart recovery, actor/account isolation |
| `agent-v2-capability-binding-e2e` | One manifest/binding/readiness source; expected-version conflict; incompatible/stale requests reject before execution; manifest/Agent deletion behavior |
| `agent-v2-mcp-lifecycle-e2e` | All-state settlement, lease/session takeover fencing, duplicate event replay, timeout/cancel race, late result rejection, secret/process/port cleanup and cleanup-failure visibility |
| `agent-v2-connector-invocation-e2e` | OAuth resource→manifest→binding→turn result, scope/version expiry, disconnect/resource removal, actor isolation |
| `agent-v2-governed-tool-loop-e2e` | Unique decision/claim/result, PREPARED/APPLIED crash points, signed one-time recovery, idempotent replay or UNKNOWN_SIDE_EFFECT, lease renew/revoke, timeout/cancel/revoke and replay equality |
| `agent-v2-evaluation-lab-e2e` | Durable run/case attempt/result/metrics, duplicate scheduler/mutation idempotency, cancel propagation/ack, retry uniqueness, restart, deletion/retention and actor isolation |
| `agent-marketplace-catalog-e2e` | Default signed source, verified sync, cursor pagination, browse/detail, Agent/Skill/MCP install and authority readback, high-risk confirmation, revocation, uninstall, and cleanup |

All gates fail closed when receiver DOM, Station readback, or required runtime
evidence is missing.

### 24.1 Mandatory Race And Revocation Cells

| Race/revocation | Deterministic barrier | Required oracle |
|---|---|---|
| MCP lease takeover vs old result | Pause after PREPARED and after lease expiry | New fence accepts no old business result; old cleanup-only receipt allowed; side-effect count <=1; unknown side effect blocks repeat |
| Cleanup lease expiry vs settlement | Pause in `settling_cleanup`, expire cleanup lease | Same-scope cleanup takeover increments cleanup fence; old cleanup rejected; deadline yields `cleanup_failed`, never hangs |
| Capability cancel vs result | Pause before each fence CAS | Winner is deterministic by committed fence; every ordering settles cleanup exactly once |
| Capability timeout vs reconnect | Pause before timeout fence and reconnect CAS | Timeout-first never returns running; reconnect-first still respects deadline/cleanup |
| Device revoke vs ToolCall | Pause before/after outbox commit and PREPARED/APPLIED; revoke session and optionally trust key | Before dispatch: 0 side effects; after dispatch: APPLIED/cancelled/UNKNOWN only; recovery credential scope/expiry/nonce/signature enforced; APPLIED CAS globally unique |
| Execution deadline vs terminal receipt | Persist PREPARED before execution deadline; submit terminal receipt before/after each deadline | No new side effect starts after execution deadline; valid signed terminal recovery may settle before reconciliation deadline; later or invalid proof becomes UNKNOWN without continuation |
| Lease renew/revoke vs outbox pull | Pause before renew/revoke CAS and request claim | Only the committed lease revision may pull; revoke-first yields zero new execution; renew-first does not change capability-set hash or signing key |
| Recovery nonce replay vs terminal conflict | Pause after signature verification and before nonce/result CAS; submit identical and conflicting digests concurrently | One digest consumes the nonce and commits at most one terminal result; identical replay returns original ack; conflicting digest rejects |
| Actor JWT plus forged device header | Use actor-valid JWT with another enrolled device ID; omit or forge command proof across register/pull/renew/revoke/receipt | Every command rejects before lease/outbox/result mutation; the real device remains unaffected |
| Capability command replay | Replay identical signed command, then reuse nonce with changed cursor/revision/body | Identical write returns the same durable outcome; same read may re-read the same cursor; changed digest rejects with no mutation |
| Device key revoke vs active capability command | Pause after key resolution and revoke before command-ledger CAS | Revoked-key command rejects; no lease revision, pull claim, or receipt mutation commits |
| OAuth disconnect vs Connector invoke | Pause around connection-revision/outbox commit; inject provider revoke reject/timeout | Disconnect-first: 0 dispatch; dispatch-first: pinned revision may finish; local stays disabled when provider revoke unconfirmed; retries reuse idempotency key |
| Manifest/binding delete vs active ToolCall | Pause before/after dispatch commit | New admission count 0; prior claim either settles or explicitly cancels; historical snapshots unchanged |
| Evaluation duplicate scheduler | Pause after scheduler claim and Turn create | One attempt, one Turn, one result; duplicate returns existing IDs |
| Evaluation cancel vs case completion | Pause before cancel-intent/completion CAS; drop one cancellation ACK and advance deadline | Cancel-intent-first blocks completion; completion-first freezes metrics; missing ACK yields bounded partial/CANCEL_ACK_TIMEOUT, never hangs |
| Evaluation retry vs metrics | Pause after parent terminal transaction and child creation | Parent status/metrics/revision unchanged; child has new ID and exact source attempt/result lineage |
| Home duplicate Chat/Task submit | Pause after idempotency claim and object creation | Same payload returns original IDs with count 1; mismatch returns conflict |

Each corresponding Gate must inject both orderings of the race and prove
Station state, executor side-effect count, cleanup outcome, and replay equality.

## 25. Trusted Package Catalog

The X3 package catalog is an external discovery input, not an installed-state
authority and not a hosted marketplace.

```text
Pinned trust root + explicit transport
  -> official_station | user_pinned_github
  -> signed peers.package-catalog.v1 envelope
  -> Desktop Rust signature/schema/hash verification
  -> derived trust + scan + risk + install policy
  -> cursor-paginated Desktop projection
  -> authority-specific install
       Agent package -> Station atomic package import -> Station readback
       Skill         -> Station install/scan         -> Station readback
       MCP           -> Desktop Rust MCP store       -> MCP readback
  -> projection ledger reconciliation
```

The built-in Peers source carries a pinned Ed25519 public key and an embedded
last-known signed snapshot. It is available to every new profile before first
network sync. MCA-D20A makes its transport an authenticated Station read-only
endpoint that serves the exact publisher-signed envelope; Station neither
signs nor classifies it. User-pinned sources retain explicit public GitHub
repository, branch, and fixed manifest-path semantics. A repository URL is
never fetched directly as JSON.

The sole manually maintained official envelope lives under
`packages/agent-catalog`. Desktop embeds that asset for first use; Station
serves a deterministic generated byte projection. Source validation fails if a
second manually maintained copy appears or the generated projection drifts.
The verifier accepts only bounded version-1 envelopes signed by the pinned key
and matching the registered source and publisher.

Catalog package state is:

```text
verified -> installable | confirmation_required | revoked | blocked
```

- `installable`: verified source, valid artifact hash/schema, passing scan, and
  low/medium policy.
- `confirmation_required`: same guarantees, but derived high risk.
- `revoked`: a valid signed snapshot revokes the package or source.
- `blocked`: signature, schema, identity, hash, encoding, or scan validation
  failed.

Revocation blocks new install/update. Existing installed snapshots remain
visible with a revocation warning until the user explicitly uninstalls them.
The catalog ledger never reports installed state without successful target
authority readback.

Allowed:

- last-known verified snapshot during a visible network-sync failure;
- authenticated Station distribution of exact official signed bytes;
- user-pinned sources with explicit publisher/key identity;
- deterministic cursor pagination over one immutable source revision.

Forbidden:

- source-provided trust, risk, scan, or install-policy authority;
- accepting a signing key from the same envelope it verifies;
- treating Station authentication or transport digest as publisher trust;
- private-repository credentials in Desktop, Station, profile, or evidence;
- arbitrary URL-to-JSON sync or ignored repository branch fields;
- embedded-byte fallback reported as fresh synchronization;
- local-ledger-only Agent, Skill, or MCP installation success;
- silent installation of high-risk or revoked packages;
- silent deletion of installed user resources after source revocation.
