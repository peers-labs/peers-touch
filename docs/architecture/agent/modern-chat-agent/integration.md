# Modern Chat Agent — Integration

> **Status**: accepted
> **Version**: v1.3
> **Created**: 2026-07-30 | **Updated**: 2026-10-01
> **Owner**: Peers-Touch Agent Team

---

## 1. Integration Boundary

This design specializes the governing Agent blueprint into one canonical
single-Agent runtime. The referenced benchmark-era source remains an upstream
constraint, not the product identity. This design does not create a second
Agent subsystem.

Upstream constraints retained:

- `docs/global/architecture.md`
- `docs/architecture/agent/agent-lobehub-blueprint.md`
- `docs/architecture/agent/provider-station-ownership/`
- `docs/architecture/agent/agent-memory-architecture.md`
- `docs/architecture/agent/agent-self-growth-architecture.md`
- `docs/client/desktop/runtime-projections.md`

Downstream consumers:

- Modern Chat execution plan.
- Desktop Agent page/runtimes.
- Agent Canvas individual node execution.
- Future Mobile/channel Agent clients.

## 2. Current Assets To Retain

### Station

| Asset | Retained responsibility |
|---|---|
| `service/turn_service.go` | Canonical turn state machine and model-tool-model loop |
| `service/prompt_assembly_service.go` | Context assembly foundation |
| `service/memory_service.go` | Memory retrieval, snapshots, extraction, attribution |
| `service/skill_service.go` and `skills_guard_service.go` | Skill truth, versioning, trust, scan |
| `service/knowledge_retrieval_service.go` | Knowledge retrieval and trace references |
| `service/compression_service.go` | Context compression foundation |
| `service/provider_service.go` | Direct model provider execution |
| `service/credential_pool_service.go` | Actor-scoped credential lease and rotation |
| `service/tool_registry_service.go` | Tool schema/owner resolution |
| `service/local_tool_broker.go` | Transitional client-local capability request/result bridge |
| `service/error_classifier_service.go` | Typed recovery classification foundation |
| `service/growth_*` and `review_service.go` | Feedback, evaluation, and correction foundation |
| `service/cli/` | Station-local registered CLI execution foundation |
| `infrastructure/persistence/` | Station durable Agent entities |

### Desktop Rust

| Asset | Retained responsibility |
|---|---|
| `application/agent_turn/` | Station stream bridge, cancellation forwarding, local tool request handling |
| `application/mcp/` and `application/tools/` | Device-local capability execution |
| `application/agent_orchestration/` | Agent Canvas bridge, downstream of the single-Agent kernel |
| `interface/http_gateway/` | Browser gateway to the same Station business contracts |
| `domain/actor_device_identity.rs` | Existing actor/device Ed25519 identity used to sign terminal recovery proof |
| `infrastructure/station_client.rs` | Typed per-device protobuf transport for lease and receipt APIs |

### Desktop Web

| Asset | Retained responsibility |
|---|---|
| `runtimes/agentTopicRuntime.ts` | Conversation projection lifecycle, after Station rebinding |
| `store/agentTopics.ts` | Conversation projection cache |
| `store/chat.ts` | Transitional message/stream reducer only |
| `services/desktop_api.ts` | Low-level transport adapter |
| `MessageBubble` and chat components | Rendering and user actions |
| Agent capability/tool/skill/knowledge stores | Runtime projections, not truth |

## 3. Current Assets To Replace Or Delete

| Current path/behavior | Target | Disposition after cutover |
|---|---|---|
| Desktop-local CLI turn execution in `application/agent_turn` | Station Direct Model or External Agent runtime | Delete |
| Desktop-local CLI model command execution in provider module | Station runtime/catalog discovery | Delete |
| Desktop in-memory `application/chat::ChatStore` | Station Agent conversation/message APIs | Delete |
| Browser gateway one-shot chat path | Sequenced Station SSE gateway | Remove from interactive Agent chat |
| `workspace_root` and client-submitted execution fields | Station config plus opaque client/Station resource refs | Delete from shared turn authority |
| Raw local path/handle flow without a client resource registry | Encrypted actor/device-scoped opaque resource-ref registry | Delete before C08/C07 proof |
| Desktop-specific local tool names/owner/guidance | Platform-neutral ClientCapabilitySession contract | Replace |
| Local durable Agent definition/config files | Station AgentDefinition | Delete shared-state fields; retain local UI preference only |
| Flat retry/regenerate mutation | Station message lineage and branch selection | Replace |
| Metadata-only attachment turn path | Canonical opaque AttachmentRef | Replace |
| Unsequenced ephemeral stream assumptions | TurnEvent cursor/replay/snapshot | Replace |
| Phase labels that redefine P0-P2 | `MODERN_CHAT_AGENT_V1` capability IDs | Replace in revised plan |
| Web `decideToolApproval` plus direct Rust invocation | `toolRuntime` decision projection plus Station-issued fenced envelope | Delete Web execution authority |
| Rust approval registry/waiter and direct Web-to-waiter command | Client capability envelope consumer plus durable receipt ledger | Deleted in G1-E |
| Station `LocalToolBroker` and `/turn/local-tool-result` continuation | ToolDispatch outbox, receipt/result acceptance, and unique turn continuation | Deleted in G1-E |
| Client-only diagnostic export and feedback state | Station exact-turn redacted replay and immutable feedback/usage | Delete after readback evidence passes |

## 4. Document Reconciliation

### 4.1 `provider-runtime-strategy.md`

Current Desktop-local CLI topology conflicts with this design and Provider
Station Ownership.

After this design is accepted:

- Mark it `superseded`.
- Point to this module and Provider Station Ownership.
- Preserve useful historical CLI output-format notes only as context, not
  current architecture.

### 4.2 `provider-station-ownership/`

Retain Station-sole-executor, actor isolation, credentials, and SSE rules.
Extend it to distinguish:

- Stateless registered model CLI adapter.
- Stateful registered external Agent runtime with conversation binding.

The current statement that Provider Execution Runtime retains no state across
turns remains true for Direct Model Runtime only.

### 4.3 `agent-lobehub-blueprint.md`

Retain it as the broader capability/product architecture. This module becomes
the detailed single-Agent runtime contract it references.

Its existing LobeHub capability ledger remains useful, but completion claims
must satisfy this module's runtime, evidence, and ownership gates.

### 4.4 `agent-canvas-orchestration.md`

Retain as the multi-Agent architecture. Each Agent node invokes the canonical
Modern Chat Agent kernel and inherits:

- Runtime capability resolution.
- Context and budget contracts.
- Turn events and trace.
- Tool policy.
- Feedback and terminal semantics.

Agent Canvas may add task-graph events, but cannot redefine individual turn
completion.

### 4.5 Existing 20260411 Agent Plans

System prompt, memory, skill routing, error recovery, context compression, and
background review plans are implementation foundations. They are not separate
runtime owners.

Their acceptance evidence should map into ContextLedger, TurnTrace, runtime
budget, and evaluation contracts defined here.

### 4.6 `20260730-modern-chat-agent.md`

The current execution plan remains blocked. After design acceptance it must be
rewritten to:

- Trace to `MCA-D01` through `MCA-D18`.
- Prioritize single-Agent context, continuity, budgets, capability, and
  evaluation before collaboration.
- Remove multi-Agent implementation from the plan and use Agent Canvas as a
  downstream readiness consumer.
- Add stateful runtime binding and event replay closures.
- Use the `MODERN_CHAT_AGENT_V1` profile instead of conflicting P0-P2 labels.

## 5. Capability Mapping

| Capability | Existing foundation | Missing architecture closure |
|---|---|---|
| Streaming/cancel | Station SSE, Rust bridge, Web reducer | Sequencing, reconnect, snapshot, browser parity |
| Conversation/history | Station persistence plus Desktop local store | Station CRUD truth, branch lineage, active-turn admission |
| Prompt/context | Prompt assembly, memory, skills, compression, knowledge | Typed ContextLedger and complete budget |
| Direct providers | Provider service and credential pool | Capability snapshot and attempt semantics |
| CLI providers | Station and Desktop CLI implementations | Remove split path; classify stateless vs stateful |
| External Agent runtime | CLI foundations | Conversation binding, external session epoch, runtime home lifecycle |
| Tools/MCP | Tool registry, local broker, Desktop executor | Budgets, loop detection, replay, durable approval evidence |
| Client-local capabilities | Desktop-specific bridge and workspace path | Capability lease, opaque resource refs, Mobile-compatible degradation |
| Attachments | Composer/upload metadata | Opaque durable references, extraction, capability checks |
| Retry/regenerate | Desktop actions | Immutable Station lineage and typed commands |
| Memory/skills | Strong Station services | Context attribution and end-to-end quality evidence |
| Feedback/growth | Growth and review services | Unified terminal outcome, usage, and replay contract |
| Multi-Agent | Orchestration service and Canvas design | Downstream gating on single-Agent readiness |

## 6. Trust And Security Integration

Trust boundaries:

```text
Client Web
  -> Client capability kernel trust boundary
  -> TLS/JWT
  -> Station actor/business boundary
  -> registered provider/runtime boundary
```

Rules:

- JWT actor identity is never taken from request payload.
- Station credentials never return to clients.
- Client-local tools receive least-authority opaque requests.
- Runtime-home references and external session handles are internal metadata.
- Diagnostic exports redact secrets, local paths, and sensitive tool data.
- Stateful runtime homes cannot cross actors or conversations.
- Station accepts only registered runtime adapters and bounded process policy.

## 7. Projection Integration

The Desktop Agent page already declares `agentCapability` and `agentTopic`
runtimes. The target projection split is:

| Runtime | Projection |
|---|---|
| `agentRuntime` / `agentCapability` | Agent definition, bindings, runtime readiness |
| `agentTopicRuntime` | Conversations, branch heads, active/queued turn summaries |
| `chatRuntime` | Messages, sequenced turn events, replay cursor, stream lifecycle |
| `toolRuntime` | Tool registry, approvals, execution/audit status |
| `skillRuntime` | Skill bindings, trust, activation diagnostics |
| `knowledgeRuntime` | Resource/index/retrieval diagnostics |

Every runtime has:

- Typed event consumption.
- Actor-scoped bootstrap.
- Periodic reconciliation.
- Idempotent install/teardown.
- No overlapping ownership.

Under accepted `MCA-D08A`, Desktop message-action cutover is all-or-nothing.
The legacy
`updateMessage`, `deleteMessage`, destructive regenerate, and duplicated-topic
branch construction are removed only when Desktop Web and Rust consume the
canonical Station commands `RetryTurn`, `RegenerateTurn`, `EditAndResend`,
`SelectActiveBranch`, and `TombstoneMessage`.

The client may retain rebuildable message/branch caches and optimistic pending
command state. It must not retain a writable message body, active branch,
tombstone, idempotency result, or conversation revision as independent truth.

Pages render these projections and do not fetch durable business state on mount.

## 8. Compatibility Policy

Compatibility is allowed only as an observable migration mechanism:

- A compatibility adapter may translate old command shapes into canonical
  Station commands.
- It cannot retain independent persistence or execution.
- Every compatibility path has a deletion condition.
- No fallback may execute an Agent turn locally when Station fails.
- Old unsequenced stream events may be consumed during migration only if the
  adapter assigns deterministic canonical semantics.

## 9. Required Acceptance Evidence

Architecture acceptance requires evidence plans for:

- Direct model and registered stateless CLI runtime.
- Stateful external Agent runtime if claimed in `MODERN_CHAT_AGENT_V1`.
- Desktop App, browser gateway, and Mobile contract compatibility.
- Two actors and two conversations.
- Five-turn continuity, compression, memory, skill, and knowledge attribution.
- Tool approval, denial, timeout, loop, and cancellation.
- Queued input, duplicate submission, reconnect, replay, and restart.
- Model capability degradation.
- Usage/feedback/diagnostic replay.
- Cross-actor, credential, runtime-home, and attachment security.

If a runtime kind lacks evidence, the capability profile must mark it
unsupported rather than silently partial.

### 9.1 C07 Fenced Execution Cutover

The `MCA-D19` core and `MCA-D19A` recovery semantics are accepted.
`MCA-D19B` device-possession proof was accepted after G1-A verified that JWT
binds actor only and `X-Device-ID` is an ordinary header. Until D19A/B are
implemented proto-first through Station, G1-C, C07/C09, and G-F remain blocked
or `UNPROVEN`.

The cutover is atomic at the authority boundary:

1. Model proto defines decision command/ack, targeted execution envelope,
   Station-resolved replay policy, lease renew/revoke, signed recovery proof,
   signed capability command proof, split deadlines, and receipt/result
   identities from `data-model.md §8.9`.
2. Station `TurnService` routes every client-owned ToolCall through
   `ToolDispatchService`; it cannot execute a device-local tool directly.
3. Station commits decision revision, claim, dispatch sequence, and outbox
   envelope plus one recovery credential/nonce record before delivery.
4. Desktop Rust consumes only Station-issued targeted envelopes, persists
   `PREPARED`, resolves opaque refs locally, executes according to the pinned
   replay policy, and submits the typed receipt/result.
5. Station commits each immutable ToolCall result once. The final successful
   member of a provider-response batch atomically creates the single
   `(turn_id, attempt_id, tool_batch_id)` continuation.
6. Desktop Web `toolRuntime` projects proposal/decision/result and submits only
   user decision commands.
7. A durable Station continuation worker claims and completes that continuation;
   restart reclaims only pre-emission or provider-idempotent work.
8. A matching PREPARED attempt may submit a device-signed terminal recovery
   after lease loss or execution deadline, but only before reconciliation
   deadline. Recovery cannot execute, pull, renew, or continue.
9. Externally idempotent PREPARED work may execute after restart only after
   Station CAS-takes over the existing claim, increments its fence, binds a
   current matching lease, invalidates the prior recovery credential, and
   emits a new targeted envelope with the exact original idempotency key.
   Original execution deadline remains authoritative; resource-bearing
   takeover fails closed until cross-session resource rebind is designed.
10. Only after the new path passes duplicate, stale, crash, replay, cancel,
   revoke, restart, and readback checks are the old Web/Rust/Station paths
   deleted.

Required negative evidence:

- duplicate/stale decision cannot dispatch;
- duplicate execution envelope cannot create a second side effect;
- mismatched actor/device/session/lease revision/claim/fence/payload/execution
  deadline rejects before side effects;
- expired/revoked lease cannot pull or begin PREPARED; renew requires
  same-scope CAS and cannot mutate capabilities or signing key;
- lease registration cannot choose actor, device, lease/session ID, revision,
  or expiry; Station derives/issues them and caps TTL;
- actor JWT plus `X-Device-ID` is insufficient for device authority; every
  capability command verifies the current actor-device signature before lease,
  pull, outbox, or result access;
- active receipt and terminal recovery use separate endpoints and proof modes;
  neither endpoint may downgrade to the other's authority;
- recovery remains available after actor JWT/capability-session revoke, but
  only through persisted credential scope and the current unrevoked device key;
- identical signed write replay returns the same durable outcome, while nonce
  reuse with another command/body rejects;
- post-deadline terminal settlement requires matching PREPARED, valid
  credential scope/nonce/device signature, and live reconciliation deadline;
- Desktop restart cannot execute from a persisted PREPARED row or recovery
  credential; external-idempotency replay requires a new Station-issued fence
  under a current matching lease;
- takeover reuses the exact external idempotency key, never extends the
  execution deadline, invalidates prior recovery authority, and rejects
  resource-bearing replay without an accepted cross-session rebind contract;
- duplicate signed recovery returns the original acknowledgement while a
  conflicting digest consumes no second result;
- late valid APPLIED recovery records the side-effect fact but cannot reopen a
  cancelled/expired Turn or blocked ToolBatch;
- device signing-key revoke invalidates recovery and settles unresolved work as
  unknown without redispatch;
- client cannot upgrade replay policy or substitute an external idempotency key;
- duplicate result cannot append another continuation;
- multiple ToolCalls from one provider response create one continuation only
  after every member is `APPLIED`;
- denied, expired, cancelled, failed, or unknown-side-effect batches create no
  automatic continuation;
- ambiguous non-idempotent post-emission continuation crashes require
  reconciliation and are not replayed automatically;
- non-idempotent crash after `PREPARED` becomes `UNKNOWN_SIDE_EFFECT`;
- no portable contract or Station record contains a local path;
- opaque refs resolve only through the Desktop encrypted actor/device registry
  and are deleted after settlement/expiry;
- no Web-to-native execution command remains;
- old-path scanner reports zero unresolved C07/C09 matches.

Operational defaults for the current v1 implementation are a five-minute
capability lease, two-minute default execution deadline, ten-minute
reconciliation window after execution deadline, and 60-second command-proof
clock-skew allowance. Station owns these bounded policies; clients cannot
extend them.

The cutover is fail-closed:

- pre-D19B active leases are revoked and clients must register again with
  device proof;
- the old `deadline` value becomes `execution_deadline`;
- historical terminal results remain immutable;
- historical PREPARED work without a persisted recovery credential settles as
  `UNKNOWN_SIDE_EFFECT` without redispatch or continuation;
- no recovery credential or signing proof is synthesized during migration.

### 9.2 Conditional Runtime Non-Advertisement Proof

MCA-D19D integrates through production read-only paths:

```text
Desktop/Browser receiver
  -> Station effective runtime profile snapshot
  -> Station runtime activity snapshot
  -> Desktop Rust local activity snapshot (Desktop cell only)
  -> before/after identity and monotonic-delta validation
```

Station handlers derive the actor from authentication and return the effective
profile/readiness snapshot plus actor-scoped activity counters. Desktop Rust
returns only its current actor/device/boot-scoped local counters through the
controlled BFF. Web may display or forward these projections but cannot mutate
counters or synthesize advertisement state.

The Browser Gate provisions a distinct browser profile, storage root, port set,
and session. It reads the same Station snapshots and proves selector absence
from its own DOM. It does not borrow Native DOM or Desktop-local process
counters.

Cutover requirements:

1. Proto contracts land before Station, Rust, Web Harness, or Acceptance
   adapters.
2. Station executes one-shot CLI Providers as `DIRECT_MODEL` adapters only
   when the command is available and the complete prompt context is supplied.
   Stateful CLI runtimes remain P12 and `NOT_ADVERTISED` under the frozen
   profile.
3. Station and Desktop counter owners increment at the actual side-effect
   boundaries, never inside Acceptance code.
4. The XR-4 adapter captures immutable before/after snapshots and rejects
   identity, revision, epoch, or counter regression.
5. Old provider-list and TurnTrace-only proof code is deleted rather than kept
   as a fallback.
6. P12 is conditionally advertised under MCA-D29 only when a complete
   session-capable adapter is configured and healthy. Stateless CLI Provider
   activation remains governed by MCA-D28 and does not imply external-session
   resume or reset support.

### 9.2 Stateful External Runtime Integration

The Station `externalruntime.Manager` is the only process/session owner:

```text
RuntimeAdmissionResolver
  -> ConversationRuntimeBinding(epoch, opaque home, opaque session)
  -> externalruntime.Manager start | resume
  -> bounded JSONL event translation
  -> TurnService durable events/messages/trace

ResetConversationRuntime
  -> durable reset fence
  -> manager cleanup
  -> binding epoch advance
  -> Conversation readback + runtime_reset event
```

Provider catalog entries may select this runtime through
`runtime_kind=external-agent` and `protocol=session-cli-v1`. Deployment-owned
argv configuration is required for advertisement. Browser uses the same
Station routes and receives no process, filesystem, credential, or session
mutation authority.

The cutover is atomic: external providers are rejected until manager health,
binding persistence, reset recovery, client confirmation, and P12 Acceptance
are present. No Direct Model code path is repurposed as external-session truth.

## 10. Resolved Integration Policies

1. Direct Model is required. Stateful external Agent runtime remains
   optional-advertised and cannot block the required profile.
2. Semantic events and terminal snapshots remain durable under their owning
   Turn retention. Text deltas may compact after terminal snapshot; replay uses
   snapshot plus retained semantic tail. No fixed time window may discard the
   only reconstructable state.
3. Provider-reported usage/cost is authoritative. Missing provider cost remains
   `unknown`; estimates are optional labeled projections, never billing truth.
4. Destructive writes, external side effects, credential/secret access,
   privilege expansion, and high-risk local capabilities always require policy
   approval. Read-only bounded calls may use an accepted allow-list policy.
5. Message branches, traces, Evaluation results, runtime homes, bindings,
   manifests, and Connector resources follow `data-model.md §6` lifecycle,
   tombstone, and deletion rules.
6. Privileged local work requires explicit device/session selection. The
   selected capability session is pinned in the readiness snapshot and
   ToolCall/operation. Low-risk work may auto-select only when exactly one
   compatible session exists and policy explicitly allows it.
7. Package discovery consumes publisher-signed catalog snapshots. Desktop Rust
   verifies and caches snapshots, while Agent/Skill installation reads back
   Station truth and MCP installation reads back the actor-scoped Desktop Rust
   MCP store. The legacy arbitrary URL JSON source path is retired.
8. Catalog revocation blocks new install/update and remains visible for an
   installed snapshot. Cleanup is an explicit uninstall through the target
   authority; catalog synchronization never silently deletes user resources.
9. MCA-D20A separates catalog trust from transport. The built-in source fetches
   exact signed bytes from the authenticated Station catalog endpoint;
   user-pinned sources use explicit public GitHub repository/branch/manifest
   semantics. Station authentication and transport digest never become
   publisher trust.
10. `packages/agent-catalog` is the sole manually maintained official envelope.
    Desktop bootstrap consumes it directly, and Station serves a generated
    projection guarded by a drift check. The old Desktop-local envelope is
    deleted in the same cut.

## 11. Measurement Protocol

Every runtime evidence report records:

- Commit, Station profile, Desktop mode, provider/runtime/model, capability
  snapshot, network path, machine, and cold/warm state.
- Raw event timestamps, terminal state, persisted readback, and diagnostic
  export path.
- Infrastructure failures separately from product failures.

Required sample policy:

| Claim | Workload |
|---|---|
| Stream bridge latency | 30 successful turns per App/browser and runtime cell; report P50/P95/P99 without dropping cold samples |
| Cancellation cleanup | 20 cancellations per runtime kind at text, tool, and approval boundaries; all must reach bounded terminal cleanup |
| Replay/reconciliation | 20 forced disconnects at varied event sequences plus Desktop restart; terminal projection must equal Station snapshot |
| Context budget | Fixed short, long, attachment-heavy, and tool-heavy cases at 50%, 80%, and near-limit context usage |
| Queue/idempotency | Concurrent duplicate submissions and capacity overflow under one conversation and two actors |
| Quality | Versioned fixed cases for continuity, memory, skill procedure, knowledge citation, tool completion, and unsupported-claim rejection |

The evidence report includes every failed sample. Missing raw evidence, an
unknown runtime identity, or an unverified capability snapshot fails closed.

## 12. Architecture Acceptance Mapping

The product-level source is `acceptance-matrix.md`. These architecture
scenarios map its receiver-perspective outcomes to runtime and persistence
proof. A plan may add cases but cannot remove or weaken them without accepted
product and architecture amendments.

| ID | Receiver-perspective scenario | Required result |
|---|---|---|
| MCA-A01 | Configure Agent and Direct Model | Station persists versioned Agent/runtime config; client shows readiness |
| MCA-A02 | First real turn | Progressive response, durable messages/turn/trace, no synthetic stream |
| MCA-A03 | Ten-turn continuity | Earlier facts remain correct; ContextLedger explains history/compression |
| MCA-A04 | New topic and restart | Topic isolation and active branch survive Desktop/Station restart |
| MCA-A05 | Memory and skill use | Correct recall/procedure with exact memory/skill attribution |
| MCA-A06 | Knowledge use | Answer cites the actual retrieved resource chunks; disabled resource is absent |
| MCA-A07 | Tool approve/deny/timeout | Tool executes once only after policy; denial/timeout remains durable |
| MCA-A08 | Attachment | Authorized image/file works on compatible model; unsupported/oversized input rejects early |
| MCA-A09 | Cancel/reconnect/replay | Upstream work stops; reconnect reconstructs the Station terminal projection |
| MCA-A10 | Retry/regenerate/branch | Original response remains; active branch and usage attribution are correct |
| MCA-A11 | Capability degradation | Missing vision/tool/reasoning/local capability is disclosed before execution |
| MCA-A12 | Usage/feedback/diagnostics | Usage and feedback persist; redacted export reconstructs the turn |
| MCA-A13 | Actor/device isolation | Two actors and two devices cannot cross-read state, credentials, runtime homes, or resource refs |
| MCA-A14 | Future Mobile contract | Mobile can use all Station capabilities and cleanly reject unsupported Desktop-only local capabilities |
| MCA-A15 | Home Chat/Task/restart | Home submits canonical Chat/Task commands and restores the same accepted work after restart |
| MCA-A16 | Capability bind/reject | Binding reads back one manifest version; incompatible runtime rejects before execution |
| MCA-A17 | MCP lifecycle | Install/test/invoke/cancel/reconnect cleans process, port, and secret state |
| MCA-A18 | Connector invocation | OAuth resource becomes a manifest, binding, ToolCall, result, and expiry recovery |
| MCA-A19 | Governed Tool loop | Decision/execution/result are exactly once under duplicate delivery and replay |
| MCA-A20 | Evaluation lifecycle | Dataset/run/cancel/retry/result/metrics survive restart and remain actor-isolated |
| X3-P4-3 | Trusted package discovery | Default signed source, verified sync, cursor pagination, Agent/Skill/MCP browse/detail/install, target-authority readback, revocation, uninstall, and cleanup |

Surface evidence must include the visible interaction, Station readback, and
trace/runtime evidence. A screenshot alone is not a pass.

## 13. Canonical Completion Locator

This is the authoritative starting point for the next planning job.

| Capability ID | Architecture decisions | Contract root | Owning runtime/module | Verified foundation | Remaining closure | Deletion obligation | Completion evidence |
|---|---|---|---|---|---|---|---|
| MCA-C01 Agent/config truth | D01, D12 | `AgentDefinition` | Station Agent config | Agent/config services exist | Versioned shared Agent truth and projection | Local durable Agent truth | A01, A04, A13 |
| MCA-C02 Conversation/message truth | D01, D06, D08 | `Conversation`, `AgentMessage` | Station conversation/turn | Persistence models exist | CRUD, branches, queue, idempotency | Desktop `ChatStore` | A02-A04, A09-A10 |
| MCA-C03 Runtime execution | D02, D03, D05 | `RuntimeSnapshot`, runtime binding | Station runtime resolver/direct/external | Provider and CLI foundations exist | Runtime classification, binding, resume/reset | Desktop AI CLI execution | A02, A11, A13 |
| MCA-C04 Context intelligence | D04 | `ContextLedger` | Station prompt/memory/skill/knowledge | Services exist | Deterministic ledger and complete token budget | Untyped prompt-only attribution | A03, A05-A06 |
| MCA-C05 Stream/recovery | D06, D07 | `Turn`, `TurnEvent` | Station turn/event plus client chat runtime | SSE bridge exists | Sequence, cursor, replay, snapshot, queue | Browser one-shot path | A02, A09 |
| MCA-C06 Model capability | D05, D09 | capability snapshot, budget | Station runtime resolver | Model metadata partially exists | Fresh provenance, degradation, hard limits | Client/provider-name inference | A08, A11 |
| MCA-C07 Tool/MCP policy | D09, D10, D13 | `ToolCall`, capability request/result | Station registry plus client executor | Tool loop/approval bridge exists | Loop budget, durable audit, portable owner | Desktop-specific tool contract | A07, A09, A13-A14 |
| MCA-C08 Attachments/resources | D04, D05, D13 | attachment/resource refs | Station storage/context plus client capability kernel | Upload/composer foundations exist | Opaque refs, extraction, auth, model gate | Metadata/local-path payload | A08, A13-A14 |
| MCA-C09 Evaluation/evidence | D10, D12 | usage, feedback, diagnostic export | Station trace/evaluation | Trace/growth foundations exist | Unified outcomes, fixed cases, replay export | Screenshot-only claims | A12 |
| MCA-C10 Client portability | D01, D05, D07, D13 | client capability session | Shared client contract plus platform kernels | Desktop and Mobile Tauri kernels exist | Portable bridge, platform capability registry, Mobile contract test | `desktop-rust` shared semantics | A11, A13-A14 |
| MCA-C11 Home work projection | D14 | `HomeWorkProjection` | Station Home Projection + Desktop `homeRuntime` | Home pinned/recent UI and Station topic/task services exist | Revisioned partial/stale projection and canonical Chat/Task handoff | Page-derived recents/Brief truth | A15 |
| MCA-C12 Capability manifest/binding | D15 | `CapabilityManifest`, `AgentCapabilityBinding`, readiness snapshot | Station capability catalog/binding/admission | Tool registry and source-specific stores/bindings exist | One versioned catalog, compatibility and atomic consumer cutover | Tool/MCP/Connector split inventories and config JSON truth | A16, A19 |
| MCA-C13 Capability operation/MCP | D13, D16 | `CapabilityOperation`, client capability request/result | Station operation + Desktop capability manager | Desktop MCP CRUD/test/execute exists | Durable operation, leases, cancel/reconnect and cleanup | Client-only operation terminal state | A17, A19 |
| MCA-C14 Connector resource tools | D15, D17 | `ConnectorResourceManifest`, Tool manifest/binding | OAuth owner + Station Connector Manifest/Tool services | OAuth mount/sync lifecycle exists | Scoped resource/version manifests, invocation and expiry recovery | enabled tool names as readiness | A18-A19 |
| MCA-C15 Evaluation aggregate | D10, D18 | benchmark/dataset/case/run/attempt/result | Station Evaluation + canonical TurnService | Station dataset CRUD and Desktop Evaluation UI exist | Durable run/result/cancel/retry/metrics/restart | localStorage and `quickCompletion` Evaluation | A20 |
| MCA-X3 Trusted package catalog | D20, D20A, P4-3 | `peers.package-catalog.v1` signed snapshot + proto Station distribution response | Publisher signature + Desktop Rust verifier; Station transports official bytes; target install authorities remain Station Agent/Skill and Desktop MCP | Signed verifier/cache and authority-specific install dispatch exist; private GitHub built-in transport is unreachable | Station-distributed official source, neutral canonical asset, derived policy, cursor pagination, authority readback, revocation and native Journey | Private-GitHub built-in source, arbitrary unsigned JSON source, duplicate envelope copies and ledger-only installed truth | X3-P4-3 |

### 13.1 V2 Deletion And Retention Closure

| Closure | Delete/retire | Retain/replace |
|---|---|---|
| C11 | `HomePage`-owned durable recents/Brief/readiness aggregation | `homeRuntime` projection backed by Station revision |
| C12 | Embedded Tool/Skill/Knowledge/MCP/Connector binding arrays as authoritative config; parallel readiness selectors | Versioned manifests, Agent bindings, readiness snapshots |
| C13 | Client-only operation terminal/progress state and unleased executor dispatch | Station `CapabilityOperation`; local MCP configuration/process remains client-owned |
| C14 | Connector `enabledTools`/labels as readiness or binding identity | OAuth connection owner + Connector resource manifests + Agent bindings |
| C15 | Evaluation localStorage datasets/runs/results and Evaluation `quickCompletion` execution | Station Evaluation aggregate using canonical Turn/Trace |

Accepted C12 Knowledge closure (`MCA-D15K`):

1. Import legacy Agent Knowledge JSON into actor-scoped descriptor revisions;
   the legacy data is read-only migration input.
2. Publish one immutable Knowledge manifest version per descriptor revision and
   create/reconcile bindings with exact Agent version and binding revision.
3. Switch Profile, package, prompt assembly, retrieval, and trace attribution
   to descriptor/manifest/binding/readiness contracts.
4. Reject non-empty request-supplied Knowledge fields before provider or
   retrieval work.
5. Delete legacy Knowledge binding routes, config writes, request fields, and
   Station local-path/turn-time URL retrieval.
6. Prove disabled-resource omission, actor isolation, stale revision rejection,
   local-resource session fencing, package dependency failure, and restart
   readback before removing the migration reader.

Entity deletion, tombstone, historical snapshot, and cleanup rules are governed
by `data-model.md §6`; implementation plans must prove both tree-wide consumer
cutover and runtime resource cleanup.

Locator rules:

1. The execution plan creates at least one internally complete closure for
   every `MCA-C01` through `MCA-C15` row.
2. Every task cites its `MCA-Cxx`, `MCA-Dxx`, target owner, deletion obligation,
   deterministic gate, and evidence path.
3. Work not mapped to a locator row is out of scope or requires a design
   amendment.
4. A row is complete only when its acceptance scenarios pass and its deletion
   obligation is proven by tree-wide search.
5. The Agent module is complete only when all required `MCA-C01` through
   `MCA-C15` rows are
   complete; file counts or “code exists” do not count.

## 14. Planning Handoff Query

The next planning job must begin by reading:

1. `README.md`
2. `decisions.md`
3. `data-model.md §7`
4. This document §12-13
5. The blocked execution plan

It must output a traceability report answering:

```text
For each MCA-C01 through MCA-C15:
  current repository assets
  target execution closure
  dependency predecessors
  deletion closure
  deterministic commands
  Surface Gate cases
  evidence path
  status and blockers
```

If any row cannot be mapped without inventing architecture, planning returns
`DESIGN_AMENDMENT_REQUIRED`.

## 15. MCA-D21 Formal Evidence Integration

The reviewed runtime matrix is the only source for tuple scope, attestation
profile, and role applicability. Journey adapters execute one tuple and return
typed observations; they do not expand the matrix or promote proof.

The cutover replaces the legacy J01-J06 fallback in one source transition:

```text
implicit legacy direct-runtime profile
  -> explicit profile on every matrix row

all roles apply to every tuple
  -> reviewed disjoint role policy per row

composite Journey capture
  -> one unique scenarioExecutionId per expanded tuple

registration-only candidate checks
  -> shared semantic assembler + full validator tests
```

Required integration boundaries:

1. Acceptance Core owns schemas, matrix expansion, exact coverage, immutable
   evidence assembly, and the separate validator process.
2. Agent business Acceptance owns J01-J06 tuple adapters and production
   Journey observations.
3. J01 gains a repository-owned Home Journey and Home provisioner allocation;
   historical manual JSON is not imported.
4. J02-J06 reuse production Journey logic but execute tuple-specific adapters;
   a composite development result cannot be relabelled across tuples.
5. Mobile contract rows emit contract evidence only. Browser unavailable MCP
   rows emit unavailable-state and zero-execution evidence. Station-owned
   executors never masquerade as client leases.
6. MCA-A01 replaces the old matrix identity, schema pins, implicit legacy
   profile fallback, and registration-only proof assumptions. MCA-A07 replaces
   and deletes the shallow J06 candidate writer with its tuple-aware adapter.
7. Final proof runs every required Gate again after the last source checkpoint;
   an earlier Journey candidate cannot prove a later commit.

Completion requires tree-wide absence of implicit legacy profile fallback for
J01-J06 and full semantic validation of every produced candidate.

## 16. MCA-D22-D25 Agent Scenario Control Integration

The J02-J06 adapters may use one Acceptance-only Station scenario controller
to prepare deterministic inputs and barriers. The controller is not an
evidence source and must not bypass these production paths:

```text
reviewed tuple -> one run/actor-scoped scenario handle
  -> canonical Capability / ToolDispatch / MCP / Connector / Evaluation owner
  -> real Desktop Rust or Station executor when applicable
  -> Desktop/Browser receiver or Mobile contract adapter
  -> runtime-truthful role observations
  -> candidate producer
```

Integration requirements:

1. Model defines one typed scenario-family setup/wait/release/clock/cleanup
   contract and activates the existing typed error enums.
2. Station registers scenario-control routes only in an explicitly enabled
   Acceptance environment and scopes every handle to run plus actor.
3. Scenario setup calls canonical services; it cannot directly write product
   tables, receipts, results, metrics, terminal states, or evidence.
4. Desktop Rust registers executor/MCP scenario hooks only in an
   Acceptance-capable build bound to the active run; release builds omit them.
5. Provider fixtures accept only server-selected reviewed response classes and
   never accept or return credentials.
6. Desktop and Browser adapters execute one named cell, observe real DOM/API
   state, read canonical runtime facts, and perform idempotent cleanup.
7. Station-executor rows never create a Browser client lease. Browser/Mobile
   unavailable-MCP rows create no process, operation claim, or ToolCall.
8. J03-J05 barriers cover the accepted decision/outbox/receipt/effect,
   business/cleanup lease, timeout/reconnect, OAuth disconnect/provider revoke,
   and manifest/binding deletion boundaries.
9. J06 barriers cover scheduler duplication, cancel/completion CAS,
   retry/metrics ordering, cancellation-ack deadline, evaluator availability,
   and actual Station restart.
10. The J02 provisioner supplies one primary actor, one secondary actor, and
   distinct Native/Browser device sessions.
11. Mobile runs one marker-bound generated-protobuf test process per tuple.
12. The Custom Plugin retirement adapter runs scoped inventory, storage purge,
   Station migration, and redaction checks without claiming a runtime turn.
13. Production builds and deployments reject or omit scenario-control
    commands.
14. J03 tuples that terminate before executor receipt creation use
    `station_turn`, require zero-execution evidence, and mark
    `executor-receipts` not applicable; executed J03 tuples retain their
    client- or Station-capability profile.
15. J03 `ERR-O06` expires the ToolCall receipt-recovery credential. J04
    `ERR-O06` remains the CapabilityOperation cleanup-lease case.

MCA-A03 already incorporated the J02 boundary. MCA-A04 through MCA-A07 must
incorporate the J03-J06 extensions before emitting their reviewed candidates.
