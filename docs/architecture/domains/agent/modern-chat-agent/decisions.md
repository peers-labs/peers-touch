# Modern Chat Agent — Design Decisions

> **Status**: approved
> **Version**: v1.5
> **Created**: 2026-07-30 | **Updated**: 2026-10-03
> **Owner**: Peers-Touch Agent Team

---

## Decision Index

| ID | Decision | Status |
|---|---|---|
| MCA-D01 | Station owns the canonical single-Agent kernel | approved |
| MCA-D02 | Separate stateless model adapters from stateful external Agent runtimes | approved |
| MCA-D03 | Bind stateful runtime identity to the conversation | approved |
| MCA-D04 | Build every attempt from a typed ContextLedger | approved |
| MCA-D05 | Negotiate capabilities before turn admission | approved |
| MCA-D06 | Use one active turn plus a bounded per-conversation queue | approved |
| MCA-D07 | Deliver sequenced, replayable, at-least-once turn events | approved |
| MCA-D08 | Preserve retry/regenerate as immutable message lineage | approved |
| MCA-D08A | Close immutable message revision commands | approved |
| MCA-D09 | Enforce runtime budgets and loop detection | approved |
| MCA-D10 | Make feedback, usage, and diagnostic replay part of the kernel | approved |
| MCA-D11 | Keep multi-Agent orchestration downstream of single-Agent readiness | approved |
| MCA-D12 | Use one product capability profile instead of reusing conflicting P0-P2 labels | approved |
| MCA-D13 | Route device-local work through a platform-neutral client capability session | approved |
| MCA-D14 | Project Home from Station-owned work state | approved |
| MCA-D15 | Use one versioned capability manifest and Agent binding contract | approved |
| MCA-D15K | Make Knowledge resources versioned capability dependencies | approved |
| MCA-D16 | Model MCP lifecycle as Station operations executed by client capability managers | superseded by MCA-D16A |
| MCA-D16A | Make MCP configuration Station-owned and execution-location explicit | approved |
| MCA-D17 | Separate Connector OAuth/resources from Agent tool manifests and bindings | approved |
| MCA-D18 | Make Evaluation a Station aggregate using the canonical Turn kernel | approved |
| MCA-D19 | Dispatch device-local ToolCalls through a Station-issued fenced execution envelope | approved |
| MCA-D19A | Separate execution authority from signed terminal receipt recovery | approved |
| MCA-D19B | Require actor-device proof for every capability control-plane command | approved |
| MCA-D19C | Re-authorize external-idempotency replay through Station fenced takeover | approved |
| MCA-D19D | Prove conditional runtimes through production advertisement and activity snapshots | approved |
| MCA-D19E | Attest Browser direct execution without fabricated local capabilities | approved |
| MCA-D20 | Verify publisher-signed package catalogs and read installation state from target authorities | approved |
| MCA-D20A | Distribute the official signed catalog through Station without moving publisher trust | approved |
| MCA-D21 | Require runtime-truthful profiles and unique execution identity for formal Agent V2 evidence | approved |
| MCA-D22 | Add a Station-owned acceptance scenario control plane for capability failure evidence | approved |
| MCA-D23 | Extend the single scenario control plane across governed ToolCall, MCP, and Connector evidence | approved |
| MCA-D24 | Extend the single scenario control plane across Evaluation race and failure evidence | approved |
| MCA-D25 | Make governed ToolCall role applicability follow the executed boundary | approved |
| MCA-D26 | Make Connector evidence follow OAuth-owner execution | approved |
| MCA-D27 | Make client permission denial a typed lease fact | approved |
| MCA-D29 | Run stateful external Agents through a Station-owned session lifecycle | approved |

---

## MCA-D01: Station Owns The Canonical Single-Agent Kernel

**Status**: approved
**Date**: 2026-07-30

### Context

Station already persists turns, messages, memory, skills, knowledge, and traces.
Desktop still contains duplicate conversation and CLI execution paths.

### Decision

Station owns Agent definitions, conversations, messages, turn state, runtime
binding, context assembly, provider/runtime selection, Agent loop, persistence,
trace, usage, and feedback. Each client capability kernel is a bridge and
device-local executor. Client Web is a projection and interaction surface.

### Rationale

One kernel prevents divergent behavior across Native Desktop, Mobile, and
future channels.

### Alternatives Considered

- Desktop-owned runtime: rejected because it splits cross-device truth.
- Hybrid provider execution: rejected because it creates two turn semantics.

### Consequences

- Duplicate Desktop truth must be deleted.
- Station availability is required for Agent turns.
- Local capabilities need a request/result bridge.

### Reversal Trigger

Only an accepted offline-Agent architecture with an explicit reconciliation
protocol may replace this decision.

## MCA-D02: Separate Stateless Model Adapters From Stateful External Agent Runtimes

**Status**: approved  
**Date**: 2026-07-30

### Context

An OpenAI-compatible model call is stateless. Codex/Claude-like Agent runtimes
may own private transcripts, caches, tool state, and resume handles.

### Decision

Define two runtime contracts:

- `DIRECT_MODEL`: Station supplies complete context on every attempt.
- `EXTERNAL_AGENT`: Station owns a conversation-bound runtime binding and
  external-session epoch.

A stateful external Agent must not masquerade as a stateless provider adapter.

### Rationale

This makes resume, reset, isolation, capabilities, and cleanup explicit.

### Alternatives Considered

- Treat all CLI providers as stdin/stdout models: rejected for stateful agents.
- Let each adapter decide silently: rejected because semantics become invisible.

### Consequences

- Registry metadata must declare runtime kind.
- Existing provider ownership docs require an explicit stateful-runtime
  extension.
- Supporting an external Agent runtime is more expensive than adding a model.

### Review Condition

Revisit when a claimed external Agent can prove stateless behavior under the
same context, isolation, and replay contract as `DIRECT_MODEL`.

## MCA-D28: Treat One-Shot CLI Providers As Direct Model Adapters

**Status**: approved
**Date**: 2026-09-29

### Context

The existing CLI Provider implementations invoke a configured command once per
request and can receive the complete Station-owned prompt context. They do not
require a reusable external session to provide a useful first response.

### Decision

A CLI Provider is a `DIRECT_MODEL` adapter when every invocation:

- receives the complete prompt context from Station;
- returns normalized text or typed failure events;
- owns no resumable external session;
- persists user, Assistant, Turn, and terminal state through Station.

CLI runtimes that retain an external session remain `EXTERNAL_AGENT` and must
still satisfy MCA-D02 and MCA-J10.

### Rationale

Execution transport does not determine runtime semantics. This restores the
existing non-rate-limited CLI path without weakening the stateful external
Agent contract.

### Consequences

- Station owns one-shot CLI execution and persistence.
- Built-in CLI adapters may be advertised only when their command is available.
- Missing binaries and failed commands produce typed terminal failures.
- Desktop-local conversation truth remains forbidden.

### Alternatives Considered

- Keep all CLI providers disabled until P12: rejected because it removes an
  already implemented direct-provider path and blocks the first usable journey.
- Execute and persist CLI turns only in Desktop: rejected because restart
  recovery would diverge from Station truth.

## MCA-D03: Bind Stateful Runtime Identity To The Conversation

**Status**: approved  
**Date**: 2026-07-30

### Context

Agent identity, actor identity, provider identity, process identity, and
external session identity have different lifetimes.

### Decision

`conversation_id` owns one active stateful runtime binding. The binding owns
runtime home, pinned runtime config, process reuse identity, external session
handle, and cleanup lifecycle. Different conversations never share writable
runtime state.

Changing executor/provider requires a new conversation or explicit destructive
reset.

### Rationale

This prevents transcript, cache, MCP, skill, and credential-state leakage.

### Alternatives Considered

- Agent-scoped runtime home: rejected because topics contaminate each other.
- External-session ID as owner: rejected because it rotates across epochs.

### Consequences

- Runtime homes require bounded lifecycle and garbage collection.
- Reset must be audited and may lose external runtime history.

### Review Condition

Revisit if an external runtime provides verifiable per-conversation namespace
isolation without a separate writable home.

## MCA-D04: Build Every Attempt From A Typed ContextLedger

**Status**: approved  
**Date**: 2026-07-30

### Context

History, memory, skills, knowledge, attachments, tools, and model limits all
consume context. A message list alone cannot explain why a model saw something.

### Decision

Every attempt persists a `ContextLedger` describing ordered segments, source
references, hashes, token estimates, policy, and inclusion/truncation result.
Prompt assembly is deterministic for the same immutable inputs.

### Rationale

This makes context overflow, incorrect recall, prompt drift, and attribution
testable.

### Alternatives Considered

- Store only prompt hash: rejected because it cannot explain composition.
- Log full prompts: rejected because of privacy and secret exposure.

### Consequences

- Segment schemas and redaction policy become shared contracts.
- Token accounting must include tool schemas and attachments.

### Review Condition

Revisit ledger retention detail after measuring privacy and storage cost; source
attribution and budget accounting remain mandatory.

## MCA-D05: Negotiate Capabilities Before Turn Admission

**Status**: approved  
**Date**: 2026-07-30

### Context

Providers differ in vision, tools, reasoning, streaming, structured output,
prompt caching, context limits, and resume behavior.

### Decision

Station resolves an immutable `RuntimeCapabilitySnapshot` before execution.
Each requested capability is classified as native, bridged, degraded, or
rejected. Degradation is visible before execution.

The resolved runtime facts are committed before the provider call:

- the first accepted runtime for a conversation installs its durable
  `ConversationRuntimeBinding`;
- every `TurnAttempt` persists the complete immutable `RuntimeSnapshot`;
- a later attempt whose runtime kind, provider, model, profile, capability
  snapshot, or config snapshot differs from the conversation binding rejects
  instead of overwriting the binding;
- retries of the same resolved tuple are idempotent.

Snapshot hashes use UTF-8 JSON with recursively lexicographically sorted object
keys and no insignificant whitespace. `capability_snapshot_hash` covers the
complete `RuntimeCapabilitySnapshot`; `config_snapshot_hash` covers exactly
`agentConfigVersion` and `providerConfigVersion`; the attempt snapshot hash
covers the complete `RuntimeSnapshot`.

### Rationale

Mid-turn capability surprises cause data loss and misleading UX.

### Alternatives Considered

- Infer capabilities from provider names: rejected as stale and untyped.
- Try and catch provider errors: rejected because it fails too late.

### Consequences

- Capability discovery requires freshness and provenance.
- Some models will be rejected for specific turns.
- Conversation and attempt persistence must retain the resolved snapshots
  across Station restart; readback must never reconstruct them from current
  mutable configuration.

### Review Condition

Revisit resolution policy when provider capability discovery becomes stale
enough to cause measurable false rejection.

## MCA-D06: One Active Turn Plus A Bounded Per-Conversation Queue

**Status**: approved  
**Date**: 2026-07-30

### Context

Users can submit while streaming or waiting for tools. Parallel mutation of one
conversation creates ordering and context ambiguity.

### Decision

One conversation has one active turn. Additional submissions enter a bounded
FIFO queue with explicit position, cancellation, and admission status. Capacity
is Station policy and overflow returns `TURN_QUEUE_FULL`.

Conversation lifecycle mutations use the same authority:
`ACTIVE <-> ARCHIVED` is versioned and recoverable, while permanent deletion
returns `ACTIVE_DEPENDENCY` until the active Turn and pending queue are settled.

### Rationale

This preserves natural conversation order without an unbounded queue.

### Alternatives Considered

- Reject all concurrent input: simpler but poor UX.
- Run turns concurrently: rejected because history and tool results race.
- Unbounded queue: rejected because it permits overload.

### Consequences

- Queued input is not injected into the active turn unless an explicit
  interrupt command is accepted later.
- Clients must render queue state.

### Review Condition

Revisit after receiver testing determines whether explicit interrupt should be
a separate command in addition to FIFO submission.

## MCA-D07: Sequenced Replayable At-Least-Once Turn Events

**Status**: approved  
**Date**: 2026-07-30

### Context

SSE disconnects, hidden windows, browser reloads, and Desktop restarts can lose
ephemeral events.

### Decision

Station assigns monotonic sequences per turn and persists semantic events
before projection. Delivery is at least once. Clients deduplicate by
`(turn_id, sequence)`, reconnect with a cursor, replay retained events, then
reconcile from a turn snapshot.

Normal recovery replays the current Attempt. A read-only replay may explicitly
pin a retained `attempt_id` when validating retry lineage or immutable terminal
evidence; Station verifies that the Attempt belongs to the Turn and fences both
events and snapshot to that exact Attempt. Selecting a retained Attempt never
changes the Turn's active Attempt.

### Rationale

Exactly-once network delivery is unnecessary; idempotent projection is
testable and recoverable.

### Alternatives Considered

- Ephemeral SSE only: rejected because errors/tools disappear after reload.
- WebSocket as a second transport: rejected because it duplicates semantics.

### Consequences

- Event retention and text checkpoint compaction are required.
- Clients need cursor persistence and projection reducers.

### Review Condition

Revisit retention and compaction thresholds when measured event volume is
known; ordering and replay semantics remain unchanged.

## MCA-D08: Preserve Retry And Regenerate As Immutable Message Lineage

**Status**: approved  
**Date**: 2026-07-30

### Context

Deleting a previous response before regeneration destroys evidence and makes
feedback/usage attribution ambiguous.

### Decision

Regenerate creates a sibling assistant branch linked by
`replaces_message_id`. Edit-and-resend creates a user branch. Active branch
selection is separate from message persistence. Retry of a failed attempt stays
under the same turn; user-triggered regenerate creates a new turn.

### Rationale

Immutable lineage supports comparison, rollback, feedback, and replay.

### Alternatives Considered

- Destructive replacement: rejected because it loses evidence.
- Flat append-only history without branch selection: rejected because context
  becomes ambiguous.

### Consequences

- Conversation rendering needs branch-aware projection.
- Storage grows faster and needs retention policy.

### Review Condition

Revisit branch retention after storage and product-use measurements; destructive
replacement remains forbidden while feedback or audit references exist.

## MCA-D08A: Close Immutable Message Revision Commands

**Status**: approved
**Date**: 2026-08-18

### Context

MCA-D08 defines immutable lineage, but the canonical proto has no commands for
the existing Desktop retry, regenerate, edit/resend, branch selection, and
delete actions. Deleting Desktop `ChatStore` without those commands would
either drop accepted product behavior or preserve destructive local authority.

### Decision

| Command | Result |
|---|---|
| `RetryTurn` | New attempt under the same failed/cancelled/interrupted Turn |
| `RegenerateTurn` | New Turn and sibling assistant branch |
| `EditAndResend` | Revised user sibling plus new Turn |
| `SelectActiveBranch` | Conversation branch-head CAS only |
| `TombstoneMessage` | Projection/context removal while retained evidence stays immutable |

All commands require actor ownership, client idempotency key, expected
conversation version, and an immutable source identifier. Identical replay
returns the original result; key reuse with another payload returns
`IDEMPOTENCY_CONFLICT`. `SubmitTurn` projects that domain conflict as the
user-facing `ADMISSION_DUPLICATE_CONFLICT` typed error with a hashed
idempotency key and the existing command ID.

`TombstoneMessage` records actor/time/reason, excludes the message from normal
projection/context, and preserves retained Turn/Trace/usage/feedback/tool/audit
lineage. Active dependencies return `ACTIVE_DEPENDENCY`.

### Rationale

This is the smallest command set that preserves MCA-J08 while deleting
destructive client truth.

### Alternatives Considered

- Keep Desktop mutation authority: rejected because it preserves split truth.
- Remove actions during cutover: rejected because it drops accepted journeys.
- Delete then submit for retry/regenerate: rejected because it destroys
  evidence.

### Consequences

- Station stores command-idempotency results and tombstone metadata.
- Conversation version advances for branch and tombstone mutations.
- Source messages and retained evidence increase storage usage.

## MCA-D09: Enforce Runtime Budgets And Loop Detection

**Status**: approved  
**Date**: 2026-07-30

### Context

Model/tool loops can consume unbounded time, tokens, money, or local resources.

### Decision

Each turn receives an immutable budget covering attempts, Agent steps, tool
calls, repeat/ping-pong detection, delegation depth, wall time, tokens, output,
attachments, queue capacity, and optional cost. Exhaustion is a typed terminal
or human-escalation outcome.

### Rationale

Cancellation alone does not protect unattended or hidden runs.

### Alternatives Considered

- Provider timeout only: rejected because tools and retries remain unbounded.
- UI-side limits: rejected because clients are not runtime authority.

### Consequences

- Some long tasks terminate before completion.
- Budget policy must be visible and attributable.

### Review Condition

Revisit default thresholds from production evidence without removing hard
bounds or typed exhaustion outcomes.

## MCA-D10: Make Feedback, Usage, And Diagnostic Replay Part Of The Kernel

**Status**: approved  
**Date**: 2026-07-30

### Context

A persisted answer does not establish quality or explain failures.

### Decision

Station records per-turn usage, attempts, context sources, tools, fallbacks,
terminal reason, and user feedback. Diagnostic export reconstructs the turn
without hidden UI state and applies security redaction.

### Rationale

Evaluation, growth, and regression detection require durable evidence.

### Alternatives Considered

- Logs only: rejected because logs are incomplete product state.
- Screenshots only: rejected because they cannot prove runtime ownership.

### Consequences

- Trace schema and retention grow.
- Sensitive evidence requires strict access and redaction.

### Review Condition

Revisit evidence retention and export fields after privacy review; immutable
turn outcome and attribution remain required.

## MCA-D11: Keep Multi-Agent Orchestration Downstream Of Single-Agent Readiness

**Status**: approved  
**Date**: 2026-07-30

### Context

The existing plan places collaboration alongside foundational single-Agent
work, while Agent Canvas already owns collaboration architecture.

### Decision

This module defines only the single-Agent kernel. Agent Canvas may invoke it
after the single-Agent readiness gate passes. Collaboration cannot bypass turn,
context, budget, trace, or capability contracts.

### Rationale

Multi-Agent systems multiply single-Agent defects and evidence gaps.

### Alternatives Considered

- Include collaboration in this design: rejected because ownership becomes
  duplicated and scope obscures the core runtime.

### Consequences

- Collaboration delivery may move later.
- Existing orchestration tests remain valuable but do not prove this design.

### Review Condition

Revisit only after the single-Agent readiness gate passes across all claimed
runtime cells.

## MCA-D12: Use One Product Capability Profile

**Status**: approved  
**Date**: 2026-07-30

### Context

The LobeHub blueprint and Modern Chat execution plan both use P0-P2 labels for
different capability sets.

### Decision

Define a named `MODERN_CHAT_AGENT_V1` capability profile containing required,
optional, and unsupported capabilities. Execution plans trace to stable
decision/capability IDs rather than redefining priority labels.

### Rationale

Stable IDs prevent two plans from claiming incompatible meanings for “P2.”

### Alternatives Considered

- Rename only one set of phases: rejected because future plans can repeat the
  collision.

### Consequences

- Existing execution plans need traceability updates after acceptance.
- Capability completeness becomes explicit rather than inferred from phase
  names.

### Review Condition

Replace this profile only through an explicitly accepted successor profile;
do not mutate the meaning of `MODERN_CHAT_AGENT_V1`.

## MCA-D13: Platform-Neutral Client Capability Sessions

**Status**: approved  
**Date**: 2026-07-30

### Context

The current local-tool bridge names Desktop Rust as executor and passes
`workspace_root` as a client filesystem path. A remote Station cannot safely
open that path, and Mobile cannot execute Desktop shell, clipboard, filesystem,
or stdio MCP contracts.

### Decision

Device-local work is routed through a short-lived
`ClientCapabilitySession`. The session binds actor, device, platform,
connection, advertised typed capabilities, permission state, and expiry.
Station dispatches a local request only to a compatible leased session.

Shared contracts use opaque `ClientResourceRef` and `AttachmentRef` values.
They never use an arbitrary client filesystem path. The client kernel resolves
the opaque reference inside its own permission boundary.

Desktop and future Mobile implement the same request/result protocol but expose
different capability sets. Missing capability resolves to `degraded` or
`rejected` before model execution.

### Rationale

The Station Agent kernel remains portable while device-specific behavior stays
inside the correct client runtime.

### Alternatives Considered

- Keep a Desktop-only bridge and add Mobile later: rejected because shared tool
  schemas and prompt guidance would preserve Desktop assumptions.
- Send local paths to Station: rejected because paths are neither portable nor
  authoritative across devices.
- Require Mobile to emulate all Desktop tools: rejected because shell and
  stdio MCP are not valid universal mobile capabilities.
- Move all local tools to Station: rejected because clipboard, camera, file
  picker, and device permissions are inherently local.

### Consequences

- Tool schemas must describe capability requirements rather than
  `desktop-rust` ownership.
- Client capability leases require authentication, expiry, disconnect cleanup,
  and explicit target selection when multiple devices are online.
- Mobile can use Station tools and its native capabilities without supporting
  Desktop shell or stdio MCP.
- Existing `workspace_root`, Desktop-specific tool names/guidance, and
  `executionOwner: desktop-rust` contracts require replacement.

### Review Condition

Revisit transport and lease lifetime after Mobile implementation evidence, but
retain opaque references, typed capabilities, and platform-neutral Station
semantics.

## MCA-D14: Station-Owned Home Work Projection

**Status**: approved

### Context

Home combines Agent readiness, topics, tasks, Brief/Needs You, and capability
status. Deriving these independently in a page creates stale and contradictory
work state.

### Decision

Station owns actor-scoped Home work facts. Desktop `homeRuntime` reconciles one
revisioned projection; `HomePage` is a pure renderer.

### Rationale

Home can survive restart/account switch and expose partial/stale failure without
becoming a second source of truth.

### Alternatives Considered

- Aggregate stores in `HomePage`: rejected because page lifetime cannot own
  durable freshness.
- Persist a Desktop Home cache as truth: rejected because Browser/Mobile and
  multi-device state diverge.

### Consequences

- A Home projection contract and runtime descriptor are required.
- Partial source failures need slice-level freshness.
- Chat/Task commands remain canonical services, not Home-specific writes.

### Review Condition

Revisit projection batching only with measured payload/latency evidence.

## MCA-D15: Unified Capability Manifest And Binding

**Status**: approved

### Context

Builtin tools, Skills, MCP, Connectors, and local capabilities currently expose
different stores, IDs, readiness, and binding paths.

### Decision

Station owns one versioned `CapabilityManifest` catalog and one
`AgentCapabilityBinding`/policy contract. Admission resolves an immutable
`CapabilityReadinessSnapshot`.

### Rationale

One catalog prevents UI labels, installed records, or `config_json` from being
misrepresented as executable readiness.

### Alternatives Considered

- Keep source-specific inventories and merge in Web: rejected due to
  split-brain readiness.
- Treat all capabilities as MCP: rejected because ownership, secrets, and
  transport differ.

### Consequences

- Existing Tool/MCP/Connector/Skill/Knowledge consumers migrate atomically.
- Manifest IDs and versions become trace and binding references.
- Unknown/stale compatibility fails before execution.
- ToolCall execution uses one decision/claim/result plus a fenced durable
  PREPARED/APPLIED receipt; non-idempotent ambiguity becomes
  `UNKNOWN_SIDE_EFFECT`, never automatic replay.

### Review Condition

Adding a source type requires manifest schema and owner semantics, not a new
parallel registry.

## MCA-D15K: Versioned Knowledge Resource Descriptor

**Status**: approved
**Date**: 2026-08-28

### Context

W8a removed embedded Knowledge binding rows, but `ExecuteTurnRequest` can still
carry resource source, type, policy, and status. Station therefore cannot prove
that retrieval used an actor-owned resource revision pinned by the immutable
readiness snapshot.

| Claim | Class | Evidence | Missing proof |
|---|---|---|---|
| Turn callers currently choose Knowledge source/policy | verified_fact | `agent.proto#ExecuteTurnRequest`, `turn_handler.go` | none |
| Station retrieval can open caller-provided paths/URLs | verified_fact | `knowledge_retrieval_service.go` | none |
| Existing W1 snapshots cannot identify a Knowledge descriptor revision | verified_fact | `capability.proto`, `capability_readiness_authority_service.go` | none |
| One descriptor revision per manifest version closes the lineage gap | proposal | D15 manifest/version contract | runtime and migration gates below |

### Decision

Station owns a versioned, actor-scoped `KnowledgeResourceDescriptor`. Each
descriptor revision publishes one Knowledge `CapabilityManifest` version.
Actor-owned manifests carry the descriptor `owner_ptid`; catalog reads,
binding mutations, retirement, and invalidation fan-out enforce that owner.
`AgentCapabilityBinding` owns enablement and approval policy. Turn admission
pins the manifest version, binding revision, and readiness state; the request
may not supply a Knowledge locator, policy, or content.

Descriptor locators have exactly two forms:

- `station_content_ref`: immutable Station content/index revision.
- `client_resource_ref`: opaque device resource identity resolved only through
  the selected capability session and governed execution.

Raw local paths, mutable URLs, credentials, and unversioned client content are
forbidden in Turn and package contracts. A URL is ingested into a Station
content revision before it can become READY.

### Rationale

This preserves Station business authority without moving device-local files or
secrets across the trust boundary. Manifest versioning supplies the immutable
identity already consumed by readiness and trace lineage.

### Alternatives Considered

- Keep `knowledge_resources` on `ExecuteTurnRequest`: rejected because the
  caller becomes retrieval authority.
- Store local paths on Station: rejected because local resources and secrets
  belong to the selected client capability manager.
- Use the legacy Agent Knowledge binding table: rejected because it restores a
  second binding authority without manifest or readiness lineage.

### Consequences

- Knowledge CRUD becomes a Station resource API that creates descriptor and
  manifest revisions transactionally.
- Descriptor tombstone retires every manifest revision and blocks all new
  admission while preserving immutable historical records.
- Local Knowledge retrieval is a governed client capability; Station-hosted
  retrieval reads immutable Station content/index refs.
- Package export includes portable descriptors and declares unresolved
  client-local dependencies instead of copying paths.
- Existing embedded descriptors remain historical migration input only.

### Review Condition

Accept only with actor isolation, immutable revision, deletion/tombstone,
package dependency, and local-resource negative-control tests.

## MCA-D16: Station Capability Operations, Client MCP Execution

**Status**: superseded by MCA-D16A

### Context

Desktop Rust correctly owns local MCP processes and secrets, but client-only
operation state cannot support replay, cancellation, or cross-device control.

### Decision

Station owns `CapabilityOperation` lifecycle and idempotency. The selected
client capability manager executes local MCP work and reports typed progress,
terminal intent, and cleanup. Every outcome settles cleanup before Station
commits terminal state. Lease takeover uses attempt fencing; unknown
non-idempotent side effects forbid automatic repeat execution.

### Rationale

This preserves the local security boundary while making product state durable
and auditable.

### Alternatives Considered

- Move stdio MCP to Station: rejected because device-local process/resources
  may not exist remotely.
- Keep all lifecycle state in Desktop: rejected because disconnect/restart
  loses authority.

### Consequences

- Operation lease, attempt sequence, cancel acknowledgement, timeout, and
  reconnect/cleanup settlement contracts are required.
- Every outcome passes through cleanup settlement. Cleanup uses an independent
  takeover fence and deadline so an unreachable executor cannot hang forever.
- Process/port/secret leak canaries become acceptance evidence.

### Review Condition

Remote MCP may use a Station executor, but must preserve the same operation
contract.

## MCA-D16A: Station-Owned MCP Configuration With Explicit Execution Location

**Status**: approved

### Context

MCP transport and MCP execution location are independent. A stdio server can be
local to Desktop Rust or local to a remote Station runtime. The prior design
collapsed all MCP work into one Desktop-owned `mcp.invoke` capability, forcing
a Station-owned Agent loop to depend on a Desktop round trip even when the
server belongs beside the Agent runtime.

The existing ToolCall contract already supports concrete
`STATION` and `CLIENT_CAPABILITY` execution owners. The missing contract is a
Station-owned MCP Server catalog that resolves one owner before admission.

### Decision

Station owns actor-scoped MCP Server identity, sanitized configuration,
immutable revisions, enabled state, discovered Tool manifests, Agent bindings,
readiness, idempotent mutation commands, ToolCalls, results, and audit. Every
Server declares exactly one execution owner:

- `STATION`: stdio executes inside the Station runtime; HTTP/SSE originates
  from Station.
- `CLIENT_CAPABILITY`: stdio executes inside Desktop Rust; HTTP/SSE originates
  from that Desktop runtime and requires the pinned capability session.

Transport never selects or overrides execution owner. Every discovered MCP
Tool is published as its own immutable `CapabilityManifest`, inheriting the
Server execution owner and Server revision. A Turn pins that manifest,
binding, readiness snapshot, and concrete owner before provider execution.

Raw secrets and process state remain local to the declared executor. Station
stores secret references and redacted projections. Desktop persists only the
secret material and runtime state required by `CLIENT_CAPABILITY` Servers; it
does not maintain a second MCP catalog.

Station-owned configuration mutations use idempotent `McpServerCommand`
revisions. Station-owned invocations use the existing Station
ToolCall claim/receipt/continuation path. Client-owned invocations use the
existing device-authenticated capability request/receipt path.

### Rationale

This keeps Agent business truth and routing decisions next to the Station Agent
kernel, preserves device-local security boundaries, and allows Station-local
MCP to continue while Desktop is offline. Reusing the existing two-owner
ToolCall machinery avoids a third MCP-specific dispatch protocol.

### Alternatives Considered

- Keep every MCP in Desktop: rejected because it creates a
  Station-to-Desktop-to-Station dependency and makes remote Agent execution
  depend on an online UI device.
- Move every MCP to Station: rejected because Desktop files, credentials, and
  device processes are not Station resources.
- Infer owner from `stdio` versus HTTP/SSE: rejected because either transport
  can be local to either runtime.
- Let the model pass an owner in Tool arguments: rejected because model output
  cannot override manifest, binding, readiness, or policy.

### Consequences

- The generic Desktop-only `local_mcp` manifest and guidance are removed.
- MCP Server mutations publish/retire per-Tool manifests transactionally.
- Desktop startup no longer injects a private MCP tool inventory into Turn
  requests.
- Station-local MCP discovery and invocation do not create a client lease,
  target device, or client receipt.
- Owner changes create a new Server revision and invalidate old readiness;
  in-flight ToolCalls retain their pinned owner.

### Review Condition

Acceptance must prove Desktop-local stdio, Station-local stdio, owner-pinned
dispatch, secret redaction, and Station-local success while the Desktop
executor is offline.

## MCA-D17: Connector Resource To Tool Manifest

**Status**: approved

### Context

OAuth connection, resource discovery, tool synchronization, Agent binding, and
turn invocation are distinct states but are currently compressed into
Connector config labels.

### Decision

OAuth subsystem owns credentials/connection. A Connector adapter publishes
scope-bound `ConnectorResourceManifest` entries into the capability catalog.
Agent binding references resulting manifest IDs without storing tokens.

### Rationale

This makes expiry, scope loss, resource removal, and tool-version change
explicit and recoverable.

### Alternatives Considered

- Store enabled tool names in Agent JSON: rejected due to stale scopes and no
  version identity.
- Copy OAuth tokens into Agent config: rejected as a secret boundary violation.

### Consequences

- Resource/version/scope changes invalidate readiness snapshots.
- Connector invocation uses normal ToolCall policy and trace lineage.
- Disconnect linearizes by connection revision; force security revoke has
  stricter fencing than normal user disconnect.

### Review Condition

Provider-specific metadata stays behind the adapter; shared manifests remain
provider-neutral.

## MCA-D18: Station Evaluation Aggregate

**Status**: approved

### Context

Peers has Station dataset CRUD but Desktop still owns run/result and calls
`quickCompletion`; this cannot provide authoritative cancellation, retry,
metrics, or restart recovery.

### Decision

Station Evaluation Service owns benchmarks, datasets, cases, runs, attempts,
results, and metrics. Every case executes through canonical Turn admission,
runtime, tool policy, trace, and cancellation.

### Rationale

Evaluation becomes reproducible, actor-isolated, and comparable to production
behavior rather than a parallel completion path.

### Alternatives Considered

- Keep local Evaluation and upload results later: rejected because terminal
  truth and cancellation remain client-inferred.
- Build a second evaluator runtime: rejected because it can diverge from the
  Agent kernel being measured.

### Consequences

- Existing localStorage/run state and `quickCompletion` Evaluation path are
  deleted at cutover.
- Retry creates a linked child run; terminal parent status/metrics remain
  immutable. Metrics use transactionally frozen terminal results only.
- Cancel-intent CAS blocks completion before cancellation fanout; child retry
  records exact source attempt/result lineage.

### Review Condition

Experiment orchestration and import formats can be added later without changing
run authority.

## MCA-D19: Station-Issued Fenced Client Execution Envelope

**Status**: approved
**Date**: 2026-08-21

### Context

The accepted architecture requires one durable ToolCall decision, claim,
receipt, result, and continuation. The current implementation has three
conflicting paths: Station can execute local tools directly inside the turn
loop, Desktop Web can approve and invoke Rust, and Desktop Rust can block on an
in-memory approval waiter. The current `ClientCapabilityRequest` does not carry
the committed decision revision or execution claim/fence needed to distinguish
an authoritative dispatch from a replayed or fabricated local request.

### Decision

Station is the only authority allowed to convert an approved ToolCall into an
executable client request. In one transaction it commits the decision or
validates the existing decision, commits one execution claim and dispatch
sequence, and writes one outbox envelope. The typed envelope binds:

- request, turn, attempt, ToolCall, capability session, capability, and target
  device identity;
- approval ID, decision ID, and decision revision;
- execution claim ID, executor lease ID, fencing token, dispatch sequence,
  payload hash, and deadline;
- opaque resource references and bounded arguments.

The selected client capability kernel consumes the targeted outbox stream. It
validates the full envelope and durably records a matching `PREPARED` receipt
before any side effect. It then reports `APPLIED`, a typed failure, or
`RECONCILED_UNKNOWN`. Station accepts acknowledgements and results only when
the actor/device/session/lease/claim/fence/revision/payload/deadline tuple
matches its committed state.

Desktop Web may submit a user decision and project Station events. It never
claims or executes a ToolCall. `toolRuntime` is the sole Web projection owner
for proposal and decision state, not an execution or policy authority.

Station assigns one `tool_batch_id` to all ToolCalls parsed from one provider
response. Every terminal receipt carries an immutable `result_id`; one
ToolCall accepts at most one terminal result. The transaction that accepts the
final `APPLIED` member of a fully successful batch also creates the unique
continuation key `(turn_id, attempt_id, tool_batch_id)`.

A batch containing a denied, expired, cancelled, failed, or unknown-side-effect
member creates no automatic continuation. "Continue without tool" is a
separate explicit recovery command. A Station worker owns continuation
execution through a durable lease. Restart may reclaim a pre-emission claim or
an emitted claim protected by provider idempotency; an ambiguous
non-idempotent post-emission crash becomes `reconciliation_required`.

### Rationale

This preserves Station truth while keeping device-local side effects inside the
client kernel. The committed envelope and durable receipt make duplicate
delivery distinguishable from a new execution and prevent Web state from
authorizing native work.

### Alternatives Considered

- Let Web approve, claim, and invoke Rust: rejected because Web becomes a
  second policy and execution authority.
- Keep the Rust approval waiter: rejected because restart loses the decision
  and duplicate delivery can create another side effect.
- Dispatch an unfenced local-tool event and let the client query Station:
  rejected because delivery identity and the side-effect authorization are not
  atomically bound.
- Execute every local capability in Station: rejected because filesystem,
  clipboard, camera, and local MCP resources belong to the selected device.

### Consequences

- `ClientCapabilityRequest` and acknowledgement/result contracts require the
  complete decision, claim, fence, payload, target, and deadline identity.
- Station needs a durable targeted outbox and exactly-once continuation key.
- Client Rust needs a durable receipt ledger; an in-memory dedupe map is
  insufficient.
- Duplicate identical envelopes return the existing receipt/result. A stale or
  mismatched envelope is rejected before side effects.
- Duplicate terminal receipts return the original result acknowledgement;
  different result identities for the same ToolCall conflict.
- Multiple ToolCalls from one provider response create at most one next-model
  continuation, after the whole batch is successfully applied.
- A crash after `PREPARED` for a non-idempotent capability becomes
  `UNKNOWN_SIDE_EFFECT`; it is never automatically redispatched.
- A crash after a non-idempotent provider continuation is emitted but before
  its response is durably committed requires reconciliation and is never
  blindly replayed.
- The Web approval store, Rust waiter registry, unfenced local-tool ingress,
  and direct Station local-tool continuation are deleted at cutover.

### Review Condition

Accept only after the proto fields, targeted delivery contract, acknowledgement
state machine, continuation transaction, replay/takeover rules, and old-path
deletion conditions are mutually consistent in `design.md`, `data-model.md`,
and `integration.md`.

## MCA-D19A: Signed Terminal Receipt Recovery

**Status**: approved
**Date**: 2026-08-22

### Context

The G1-C entry audit found four gaps in the accepted D19 core:

- `ClientCapabilityRequest` does not carry Station-resolved external
  idempotency/replay semantics.
- The accepted `ReceiptRecoveryCredential` has no typed wire or persistence
  contract.
- Capability leases have registration but no explicit renew/revoke lifecycle.
- Station applies the business execution deadline to every receipt, so a
  client that persisted `PREPARED` cannot safely settle after lease loss or
  execution-deadline expiry.

Desktop already owns an actor/device Ed25519 signing identity, and Station
already resolves active verified device signing keys. These are verified
foundations, not new trust roots.

### Decision

Keep execution and recovery as separate authorities.

Station resolves an immutable replay policy from the pinned capability
manifest/readiness snapshot:

- `NO_REPLAY_AFTER_PREPARED`;
- `REPLAY_WITH_EXTERNAL_IDEMPOTENCY`, requiring a non-empty Station-issued
  `external_idempotency_key`.

The envelope carries that policy and key. A client receipt cannot select or
upgrade either value.

Before dispatch, Station persists a single-purpose recovery record and places a
typed `ReceiptRecoveryCredential` descriptor in the envelope. The persisted
record binds credential ID, actor, device, verified signing-key ID, request,
ToolCall, execution claim, fence, payload hash, replay policy, nonce, scope
hash, and expiry. The first accepted terminal receipt binds its `result_id`
through the nonce/result CAS. The descriptor is not a bearer token and never
authorizes execution.

Envelope hashing is explicitly two-stage: deterministic execution-request bytes
exclude both the `payload_hash` field and recovery credential; Station then
binds the resulting hash into the credential scope. This avoids a circular
hash while preserving independent verification of executable payload and
recovery authority.

Normal execution may enter `PREPARED` and start a side effect only while the
targeted lease and `execution_deadline` are valid. After a matching PREPARED
row exists, a terminal `APPLIED|FAILED|RECONCILED_UNKNOWN` receipt may settle
until `reconciliation_deadline`. If the lease is no longer valid or the
execution deadline passed, the receipt must include a recovery proof signed by
the bound actor-device Ed25519 key.

The signature input is deterministic protobuf serialization of the credential
ID, nonce, canonical terminal receipt digest, actor/device-derived scope hash,
and domain separator `peers-touch/agent/tool-receipt-recovery/v1`. The
signature field itself is excluded. Station loads actor/device from the
persisted credential, resolves the active verified device key, verifies all
bindings and deadlines, then consumes the nonce with the terminal-result CAS.

The first valid digest consumes the nonce. An identical replay returns the
stored acknowledgement; a different digest returns a typed conflict. Device
trust-key revoke/rotation invalidates the credential. Capability-session revoke
does not erase settlement authority for already-PREPARED work and cannot
broaden it.

Capability leases gain explicit renewal and revocation:

- registration accepts a capability advertisement only; Station derives actor
  and device from transport and issues lease/session IDs, revision, and
  policy-capped expiry;
- renewal is a same actor/device/session CAS over expected lease revision and
  may extend only expiry within Station policy TTL;
- capability-set hash, connection identity, and signing-key ID remain pinned;
- changed capabilities or signing key require a new session;
- revoke/expiry prevents pull, new dispatch, and pre-PREPARED execution;
- logout, Station switch, and client worker shutdown request revoke, while
  Station expiry remains authoritative if the client disappears.

Desktop Rust owns an encrypted actor/device-scoped opaque resource-ref
registry. Raw paths and native handles never leave that registry. Entries pin
capability, permission grant, integrity metadata, and expiry; entries required
for declared-idempotent replay survive only through reconciliation settlement.

### Rationale

The split allows Station to learn the outcome of a side effect that was
authorized before expiry without restoring the right to perform another side
effect. Existing device keys provide proof of the reporting device, while the
persisted nonce and result CAS provide exactly-once settlement and replay-safe
acknowledgement.

### Alternatives Considered

- Accept any late receipt from the old lease: rejected because an expired or
  revoked execution credential would retain broad business authority.
- Extend the execution deadline until receipt settlement: rejected because it
  permits new side effects during what should be reconciliation-only time.
- Use the recovery credential as a bearer token: rejected because token theft
  would be sufficient to forge a terminal result.
- Automatically replay every PREPARED request: rejected because non-idempotent
  side effects can duplicate.
- Store local paths in Station for restart recovery: rejected because paths are
  device-local authority and violate the portable contract.

### Consequences

- Proto requires replay policy, external idempotency, recovery descriptor/proof,
  lease revision/renew/revoke, and separate deadline fields.
- Station requires durable recovery credential/nonce state and device-key
  verification in the terminal receipt transaction.
- Desktop Rust requires durable receipts, actor-device signing, and an
  encrypted opaque resource-ref registry.
- Recovery becomes unavailable after device trust-key revoke; unresolved
  PREPARED work settles as `UNKNOWN_SIDE_EFFECT`.
- A late valid APPLIED receipt records the side-effect fact but cannot reopen a
  cancelled/expired Turn or blocked ToolBatch.
- Credential and local resource retention increase bounded local/Station state
  until terminal settlement or reconciliation expiry.
- G1-A/B formal closure and G1-C execution remain blocked until this proposal is
  accepted and implemented proto-first.

### Review Condition

Accept only if `design.md`, `data-model.md`, and `integration.md` agree on the
canonical signed bytes, nonce replay behavior, lease CAS, deadline split,
replay-policy ownership, opaque resource lifecycle, and deterministic
revocation/race evidence.

## MCA-D19B: Device-Possession Proof For Capability Commands

**Status**: approved
**Date**: 2026-08-22

### Context

The G1-A entry audit verified that Station JWT claims identify the actor but do
not bind a device. Current capability handlers read `X-Device-ID` as an
ordinary header. Therefore an actor-authenticated caller can assert another
device ID unless the capability protocol independently proves possession of
that device's private key. D19A signs late terminal recovery only and does not
protect registration, pull, renewal, revocation, or active-lease receipts.

The existing actor-device Ed25519 identity and Station verified-key registry
already provide the required trust root.

### Decision

Every capability control-plane request carries a typed
`ClientCapabilityCommandProof`, except a D19A late terminal recovery that
already carries its narrower recovery proof.

The proof signs a deterministic `ClientCapabilityCommandSigningPayload`
containing command-specific domain, authenticated actor PTID, device ID,
command ID, deterministic body hash with proof absent, nonce, and issued-at.
Station requires the signed device ID to equal `X-Device-ID`, but the header is
never authority.

Station resolves the active verified key by actor, device, and signing-key ID.
It allows at most 60 seconds of clock skew and persists a nonce/digest command
ledger before any write mutation. Identical write replay returns the same
durable outcome; nonce reuse with a different command or body conflicts.
Read-only pull may re-read the same cursor for an identical digest.

Registration signs the complete capability advertisement. Renew/revoke sign
lease identity and expected revision. Pull signs session/device/cursor/limit.
An active receipt signs its full typed body. Terminal recovery uses a dedicated
recovery-receipt endpoint and cannot use generic command proof. Recovery does
not depend on a still-live actor JWT after logout; Station derives actor,
device, and key solely from the persisted credential scope and verifies the
current unrevoked key. Both endpoints share one terminal-result CAS and reject
the other endpoint's proof mode.

Current v1 policy bounds are five minutes for a capability lease, two minutes
for the default execution deadline, ten minutes after execution deadline for
reconciliation, and 60 seconds of command-proof clock skew.

### Rationale

Actor authentication and device authentication are different boundaries.
Reusing the existing device key avoids another secret or trust root while
binding every execution ingress and result mutation to actual device
possession.

### Alternatives Considered

- Trust `X-Device-ID` under actor JWT: rejected because the header is
  caller-controlled and the JWT contains no device claim.
- Treat lease/session IDs as bearer device credentials: rejected because those
  identifiers are persisted and transported as routing identities.
- Require actor JWT on terminal recovery: rejected because logout/session
  revoke would destroy the explicitly independent settlement authority.
- Issue a second opaque session secret: rejected because it creates another
  secret lifecycle and still requires device proof at bootstrap.
- Sign only registration: rejected because a later stolen actor token plus
  leaked lease identity could pull or mutate the lease.

### Consequences

- Proto adds one command-proof message, one canonical signing-payload message,
  command IDs/proofs on capability requests, and typed proof errors.
- Station adds a bounded command nonce/digest ledger and verifies device proof
  before all capability reads/writes.
- Desktop Rust signs every capability command; Web never receives signing
  material or command proof.
- Device-key revoke immediately blocks normal capability commands and D19A
  recovery.
- Clock skew becomes an explicit fail-closed operational dependency.
- Pre-D19B leases are revoked at cutover; historical PREPARED rows without
  recovery credentials settle unknown and are never upgraded by migration.
- G1-A remains blocked until this amendment is accepted.

### Review Condition

Accept only if all capability entry points require proof, canonical body
hashing excludes the proof without ambiguity, identical retry behavior is
defined, header identity is non-authoritative, and device-key revoke races have
deterministic evidence.

## MCA-D19C: Station-Authorized External-Idempotency Restart Takeover

**Status**: approved
**Date**: 2026-08-22

### Context

The G1-C completion audit verified that Desktop can reopen a durable
`PREPARED` receipt and can pass the exact Station-issued external idempotency
key to a supporting adapter. The production restart path cannot safely perform
that replay: it reconstructs terminal-only recovery authority after the old
capability lease may have expired or been revoked. MCA-D19A correctly forbids
using a recovery credential to start another side effect.

### Decision

Station is the only authority that may re-authorize execution after restart.
When a new matching capability lease exists, Station may CAS-take over an
unresolved `PREPARED` ToolCall only when:

- replay policy is `REPLAY_WITH_EXTERNAL_IDEMPOTENCY`;
- the original execution deadline has not expired;
- actor, device, signing key, capability, schema, decision, claim, immutable
  arguments, and external idempotency key still match;
- the new lease advertises the required capability and schema;
- no resource reference requires an undefined cross-session rebind.

The takeover transaction keeps the logical ToolCall and execution claim,
increments the fencing token, binds the current lease/session/revision,
creates a new request/outbox row and recovery credential, and invalidates the
previous recovery credential. The new envelope reuses the exact original
external idempotency key. Desktop executes only that new Station-issued
envelope; it never resumes work from the persisted receipt alone.

If no eligible lease is available before the original execution deadline, if
the tool is non-idempotent, or if resource authority cannot be rebound without
broadening scope, Station does not redispatch. The existing reconciliation
path settles `UNKNOWN_SIDE_EFFECT` by the reconciliation deadline.

### Rationale

This preserves the D19A separation between execution and settlement authority
while making restart replay operational. A new fence rejects late old-worker
business results, and the unchanged external idempotency key makes repeated
external invocation safe according to the pinned capability contract.

### Alternatives Considered

- Restore the old lease from Desktop storage: rejected because Desktop cannot
  prove the lease was not revoked while offline.
- Let the recovery credential authorize replay: rejected because it would
  broaden terminal-only authority into execution authority.
- Replay directly from the local receipt ledger: rejected because it bypasses
  Station policy, current lease state, and target-device selection.
- Extend the execution deadline during takeover: rejected because restart
  cannot enlarge the original business authorization window.

### Consequences

- Station needs a deterministic takeover scan/CAS tied to lease registration
  and periodic reconciliation.
- Desktop restart recovery remains terminal-only until a newly fenced envelope
  arrives through the normal authenticated pull path.
- Existing protobuf fields are sufficient for resource-free takeover:
  `tool_call_id` and execution claim remain stable while request ID, lease
  binding, fence, dispatch sequence, payload hash, and recovery credential are
  reissued.
- Cross-session replay with opaque resource refs remains fail-closed until an
  explicit resource-rebind contract is accepted.
- G1-C and G1-D remain blocked until this proposal is reviewed and accepted.

### Review Condition

Accept only if the design, data model, integration flow, Station CAS, old-fence
receipt behavior, deadline handling, credential invalidation, and resource-ref
failure behavior are mutually consistent and preserve Station-only execution
authority.

## MCA-D19D: Production Runtime Advertisement And Activity Snapshots

**Status**: approved
**Date**: 2026-08-25

### Context

The XR-4 evidence audit found that provider/model list filtering cannot prove
that conditional P12 `EXTERNAL_AGENT` or stateless CLI runtimes are absent from
the effective product profile. Existing TurnTrace records also cannot prove
that no runtime home, external session, workspace, or local process was created.
Acceptance-only counters would make the Gate self-proving instead of observing
production behavior.

### Decision

Station exposes an actor-authorized, read-only effective runtime advertisement
snapshot. The snapshot binds the active product profile and readiness revision,
evaluates every known conditional runtime candidate, and reports one of:
`READY`, `DEGRADED`, `NOT_ADVERTISED`, or `BLOCKED`. Registry presence is not
advertisement. A runtime is selectable only when the effective snapshot says
`READY`.

Station also exposes monotonic actor-scoped runtime activity counters for
runtime binding, external session, and workspace creation. Desktop Rust owns a
monotonic boot-scoped local activity snapshot for process starts, runtime-home
creation, external-session opening, and workspace creation. Neither interface
accepts reset or mutation commands.

Non-advertisement proof takes before/after snapshots under the same actor,
profile revision, Station runtime identity, and Desktop boot identity. The Gate
passes only when:

- P12/CLI are explicitly `NOT_ADVERTISED`;
- no corresponding selector is visible in an isolated Desktop or Browser
  client;
- all relevant Station and Desktop counter deltas are zero;
- no Turn attempt or runtime binding is created for the candidate.

Browser receives an isolated client lifecycle and consumes the same Station
snapshot. It cannot use Desktop-local process counters as its own evidence;
Browser proof combines its receiver DOM with Station counters and the absence
of any Desktop dispatch correlated to the scenario.

### Rationale

The contract makes absence falsifiable without enabling the optional runtimes.
Production owners emit the evidence, while Acceptance only samples and compares
it. Explicit `NOT_ADVERTISED` avoids inferring product support from catalog
registration or provider filtering.

### Alternatives Considered

- Infer absence from provider/model lists: rejected because filtering does not
  identify the effective profile or readiness authority.
- Count TurnTrace rows only: rejected because local process and runtime-home
  side effects can occur without a complete trace.
- Add Acceptance-only probes or resettable counters: rejected because the Gate
  would own the fact it claims to verify.
- Enable P12/CLI to test them positively: rejected because both remain outside
  the frozen product profile.

### Consequences

- Shared snapshot contracts are proto-first.
- Station maintains process-epoch monotonic activity counters in the Agent
  authority boundary; a Station restart rotates the epoch and invalidates an
  in-flight comparison.
- Desktop Rust keeps local counters for the lifetime of one process boot and
  exposes them through the controlled BFF.
- Snapshot payloads contain no command, local path, credential, PID, or secret.
- Counter wrap, profile revision changes, Station restart, Desktop restart, or
  missing Browser isolation invalidate a comparison instead of producing zero.
- XR-4 may implement its eight non-advertisement tuples against these production
  readbacks; all other Foundation tuples remain independently unproven.

### Review Condition

Revisit only if P12 or CLI enters an accepted product profile. Promotion then
requires positive runtime lifecycle evidence and cannot reinterpret historical
`NOT_ADVERTISED` snapshots as readiness proof.

## MCA-D19E: Browser Direct Runtime Without Local Capability Fabrication

**Status**: approved
**Date**: 2026-08-25

### Context

The reviewed `direct_runtime` attestation requires a non-empty client
capability lease and a ToolCall binding to one leased capability. Browser
direct-model turns correctly use a Browser-owned capability session with zero
device-local execution capabilities and create no ToolCall. Reusing
`direct_runtime` would require fabricated capability and ToolCall facts.

### Decision

Define `direct_runtime_no_local_capability` as the runtime attestation profile
for the `foundation-browser-direct` row. It retains actor identity,
conversation runtime binding, runtime snapshot, TurnAttempt, Browser capability
session identity, readiness linkage, Station profile, network path, machine,
and cold/warm state.

The profile requires:

- `clientSession.platform == browser`;
- `clientSession.capabilities == []`;
- no `toolCallBinding`;
- production evidence that no local capability execution occurred.

The existing `direct_runtime` profile remains unchanged for Desktop rows that
bind a real local capability and ToolCall.

### Rationale

Evidence must describe the production path rather than synthesize fields only
to satisfy a schema. Row-level assignment matches the reviewed runtime matrix:
every Browser Foundation tuple shares the same Browser session authority, while
cell assertions independently determine whether a ToolCall was expected.

### Consequences

- The runtime matrix identity advances to `2026-08-25.1`.
- The Agent V2 proof contract and runtime-attestation schema advance to version
  `3`.
- Foundation tuple count and product assertions remain unchanged.
- Existing evidence under the prior matrix/schema identity is stale and cannot
  be promoted.

### Review Condition

Revisit only if Browser gains a production local-capability execution path.
That path must advertise a real capability lease and emit its own fenced
ToolCall evidence before using `direct_runtime`.

## MCA-D20: Publisher-Signed Package Catalogs And Authority Readback

**Status**: approved
**Date**: 2026-09-17

### Context

P4-3 requires curated Agent, Skill, and MCP discovery without creating a hosted
commercial marketplace. The existing Desktop market accepts arbitrary URL JSON,
stores source-provided trust/risk labels, ignores the configured branch, and
uses its install ledger as the visible installed state. A new profile can
therefore be empty, an unsigned source can claim `verified`, and a stale ledger
can disagree with the Agent, Skill, or MCP authority.

The accepted blueprint already assigns package trust, scan, and version policy
to governed owners while allowing Desktop Rust to cache discovery data and own
device-local MCP configuration. X3 closes that contract without adding social,
commercial, rating, or public publishing behavior.

### Decision

Package discovery consumes versioned `peers.package-catalog.v1` snapshots. A
snapshot is an envelope containing exact payload bytes, an Ed25519 signature,
and a signing-key ID. Source registration pins publisher identity, repository,
branch, manifest path, key ID, and public key. Verification uses the pinned key;
an envelope cannot supply or replace its own trust root.

The shipped Peers source is built in and includes a verified last-known
snapshot so first use works without a network round trip. Synchronization uses
real Git repository, branch, and manifest-path semantics. User-added sources
must provide an explicit public key and are classified `user-pinned`; legacy
arbitrary JSON sources become disabled migration records and are never treated
as trusted input.

Desktop Rust verifies signature, schema version, source/publisher binding,
package identity/version, artifact hash, and bounded payload size before
publishing a cache snapshot. Trust is derived from the pinned source class,
risk and scan verdict are derived from verified artifact bytes, and install
policy is derived from those facts. Source-provided trust, risk, scan, or policy
labels are ignored.

Installation is authority-specific:

- Agent packages decode the canonical protobuf package and use Station atomic
  package import, followed by Station Agent readback.
- Skills use Station install/scan and Skill readback.
- MCP packages use the actor-scoped Desktop Rust MCP authority and MCP
  readback.

The local install ledger records catalog revision, artifact digest, target
authority, target ID, and observed readback. It is a reconciliation cache, not
installed-state authority.

A signed source or package revocation blocks new install/update immediately.
Existing user-owned installed snapshots are marked revoked and require an
explicit uninstall; revocation never silently deletes user resources. High-risk
packages require an explicit confirmation before mutation. Invalid signatures,
hashes, schemas, unsupported encodings, blocked scans, and revoked packages
fail closed.

### Rationale

Signed immutable snapshots make publisher provenance and revocation
falsifiable. Key pinning prevents a source from self-asserting trust. Derived
scan/risk policy prevents signed metadata from being confused with independent
review. Authority readback prevents the Desktop ledger from becoming a second
Agent, Skill, or MCP source of truth.

Repository/branch semantics retain a simple distributable catalog while
avoiding the previous ambiguity where a repository URL was fetched as if it
were an index document. The embedded verified snapshot provides deterministic
first-use behavior and remains subject to the same verifier as synchronized
snapshots.

### Alternatives Considered

- Keep arbitrary JSON URLs and display source labels: rejected because the
  source can self-assert trust and branch has no meaning.
- Move installed Agent/Skill/MCP truth into the catalog ledger: rejected
  because it duplicates existing target authorities.
- Auto-delete installed resources on catalog revocation: rejected because
  publisher policy must not silently destroy user-owned state.
- Add hosted publishing, ratings, or Community: rejected as outside the
  accepted X3 product boundary.

### Consequences

- The old unsigned JSON source path is retired in one cutover.
- Catalog list/detail APIs expose cursor pagination, verification provenance,
  revocation, derived scan/risk, and install policy.
- Default catalog material and its public verification key ship with Desktop;
  signing private keys do not.
- Source sync may retain the last verified snapshot when the network is
  unavailable, but must visibly report stale/error state and never substitute
  unverified bytes.
- Native proof must cover default-source bootstrap, signed sync, pagination,
  browse/detail, all three target authorities, explicit high-risk
  confirmation, revocation, uninstall, and cleanup.

### Review Condition

Revisit if catalog publication becomes federated or hosted. That expansion must
define publisher admission, key rotation, moderation, replication conflict,
and commercial policy before changing this local curated-source contract.

## MCA-D20A: Station-Distributed, Publisher-Signed Official Catalog

**Status**: approved
**Date**: 2026-09-17

### Context

Execution proved that the built-in source configured by MCA-D20 cannot perform
a fresh product synchronization: `peers-labs/peers-touch` is private, its
default branch is `master` rather than the configured `main`, and anonymous raw
fetches return HTTP 404. Embedding the verified snapshot still satisfies first
use, but reloading those bytes cannot establish fresh synchronization.

### Decision

The built-in source uses an authenticated, versioned Station endpoint to
distribute the exact Peers publisher-signed envelope. Station is transport
only. Desktop Rust retains the pinned publisher key, validates signature,
source/publisher identity, artifact hashes, timestamps, revision reuse, and
rollback, then atomically publishes the verified cache.

Trust and transport are separate:

- `official_station` fixes the Station endpoint and Peers trust root in product
  code.
- `user_pinned_github` requires an explicit public GitHub repository, branch,
  manifest path, publisher, and user-pinned key.

The sole manually maintained envelope lives under
`packages/agent-catalog/`. Desktop bootstrap consumes it directly. Station
serves a deterministic generated byte projection whose drift check is part of
the source Gate. The previous Desktop-local envelope copy is deleted in the
same cut.

The Station/Desktop wire contract is proto-first and returns bounded envelope
bytes, media type, distribution identity, and a diagnostic SHA-256. The digest
checks transport integrity only; Ed25519 verification remains the trust root.

### Rationale

Station is already the authenticated deployment-bound service available to
every supported Desktop profile. Serving opaque signed bytes makes catalog
availability independent of GitHub visibility without letting Station assert
publisher trust or installed-state truth.

A neutral catalog asset prevents Desktop-to-Station source dependency. The
generated Station projection is mechanically derived and cannot become a
second manually edited catalog.

### Alternatives Considered

- Private GitHub with a Desktop token: rejected because it distributes a
  developer credential and couples product availability to repository access.
- Historical public Station repository: rejected because it is not the current
  source/deployment mirror and would create another release truth.
- Embedded-byte sync fallback: rejected because it cannot prove fresh network
  synchronization.
- Hosted marketplace service: rejected as outside X3 and the accepted product
  non-goals.

### Consequences

- `model/domain/agent/package_catalog.proto` adds one read-only response
  contract.
- `packages/agent-catalog` becomes the sole signed-asset source and must enter
  the X3 Plan/declaration write set.
- Old Stations without the endpoint produce a visible stale verified state.
- Catalog publication follows Station release cadence.
- Key rotation requires coordinated Station asset and Desktop key-pin releases.
- Agent/Skill Station truth and actor-scoped Desktop MCP truth remain unchanged.

### Review Condition

Revisit if the official catalog moves to a separately operated public
distribution service. That service must preserve exact signed bytes, bounded
transport, rollback protection, and independence from installed-state
authority.

## MCA-D21: Runtime-Truthful Formal Evidence Profiles

**Status**: approved
**Date**: 2026-09-18

### Context

The J01-J06 reviewed matrix rows omit explicit attestation profiles and role
policies. The validator therefore requires legacy direct-runtime fields and
every Gate role for contract-only, control-plane, unavailable, Station-executor,
and Evaluation paths. Those paths do not create a client capability lease or a
client-bound ToolCall. Filling those fields would violate MCA-D19E.

The current Journey runners also execute one composite development flow. They
do not provide one independently identified execution for every reviewed
platform/cell/locale/ordering/sample tuple.

### Decision

Every Agent V2 matrix row declares a runtime-truthful attestation
profile and complete role-policy partition. Every expanded tuple receives one
unique `scenarioExecutionId`; command, Turn, ToolCall, operation, Evaluation
run, and contract-run identities cannot be relabelled across tuples.

The profile and role contract is defined in:

`proposals/20260918-mca-d21-runtime-truthful-formal-evidence.md`.

The active Plan Package must incorporate this decision before any matrix,
schema, validator, runner, or proof-set implementation begins.

### Rationale

Formal evidence must describe the production path that ran. The matrix owns
scope, Journey adapters own observations, a shared producer owns immutable
assembly, and the separate validator owns `PROVEN` promotion.

### Alternatives Considered

- Keep legacy direct-runtime shape: rejected because it requires fabricated
  entities.
- Relabel one composite Journey across all tuples: rejected because it claims
  executions that did not occur.
- Remove Mobile, Browser, negative, or race tuples: rejected because it weakens
  accepted scope.

### Consequences

- Matrix and schema identity advance and invalidate older
  candidates.
- J01 requires a repository-owned exact-source Journey.
- J02-J06 require tuple-aware adapters and full semantic-validator tests.
- MCA-A01 remains `UNPROVEN` until final exact-source proof.

### Review Condition

Accept only if tuple scope remains unchanged, every profile maps to real
production entities, identity reuse is rejected, and the runner/validator
separation remains intact.

The Owner accepted MCA-D21 on 2026-09-18.

## MCA-D22: Station-Owned Capability Scenario Control Plane

**Status**: approved
**Date**: 2026-09-18

### Context

MCA-D21 requires every J02 tuple to execute independently. The current product
surface cannot deterministically create several reviewed catalog, binding,
taxonomy, and actor-isolation states. Capability error enums are declared but
unused, manifest registration has no generic product endpoint, and the
existing composite Native Journey cannot be relabelled as 69 executions.

### Decision

Add a protobuf-defined, Station-owned scenario control plane that is available
only in an explicitly enabled Acceptance environment. It owns deterministic
fixture setup, barriers, and cleanup. Canonical capability services continue to
own every manifest, binding, readiness, revision, and typed failure fact;
Desktop and Browser continue to own receiver observation.

The accepted contract is defined in:

`proposals/20260918-mca-d22-capability-scenario-control-plane.md`.

### Rationale

The J02 Gate needs reproducible state transitions without adding a production
generic manifest-registration API or creating browser-local authority. A
setup-only control plane makes those preconditions deterministic while keeping
the product action and evidence on canonical paths.

### Alternatives Considered

- Relabel the composite Journey: rejected as fabricated evidence.
- Downgrade runtime cells to static/unit evidence: rejected because receiver
  and Station control-plane facts are required.
- Expose generic manifest registration in production: rejected because source
  owners own manifest mutation.
- Remove unsupported tuples: rejected because it weakens accepted scope.

### Consequences

- Model, Station, Desktop, Mobile contract tests, provisioner, and J02 adapter
  change together.
- Production must omit or reject every scenario-control route.
- J02 keeps all 69 tuples and remains `UNPROVEN` until exact-source semantic
  validation succeeds.

### Review Condition

Accept only if scenario control cannot emit verdicts or evidence, canonical
services remain the sole product authority, production cannot enable the
control accidentally, and all tuple identities remain independently executed.

The Owner accepted MCA-D22 on 2026-09-18.

## MCA-D23: Capability Operation Scenario Control Plane

**Status**: approved
**Date**: 2026-09-19

### Context

MCA-D21 requires 164 independently executed J03-J05 tuples. Existing runners
execute one Native composite each and cannot deterministically reach the
reviewed decision/outbox/receipt/effect/cleanup, lease, timeout/reconnect,
OAuth disconnect, provider revoke, or deletion race boundaries. Relabeling
those composites would fabricate execution identity.

### Decision

Extend the single MCA-D22 Station-owned scenario controller across governed
ToolCall, MCP lifecycle, and Connector invocation. It coordinates only
reviewed setup, barriers, executor/provider lifecycle actions, fixture time,
and cleanup. Canonical ToolDispatch, receipt, recovery, MCP, Connector, and
Turn owners remain the only product-state writers.

The accepted contract is defined in:

`proposals/20260919-mca-d23-governed-tool-scenario-control-plane.md`.

### Rationale

J03-J05 need deterministic runtime ordering and real executor/provider effects
without adding a second authority or general production failpoint API.

### Alternatives Considered

- Relabel existing composites: rejected as fabricated evidence.
- Add Harness-only state injection: rejected because it bypasses canonical
  Station and Desktop Rust owners.
- Create separate Tool/MCP/Connector fixture services: rejected because they
  duplicate the D22 lifecycle and trust boundary.
- Downgrade races to unit tests: rejected because required receiver/runtime
  evidence would remain absent.

### Consequences

- Model, Station, Desktop Rust/Web, Mobile contracts, provisioning, fixtures,
  and J03-J05 producers change together.
- Production Station and release Desktop builds cannot activate scenario
  control.
- J03-J05 remain `UNPROVEN` until their exact-source candidates pass semantic
  validation.

### Review Condition

Revisit if a production-safe external fault-injection platform can provide the
same actor/run/tuple isolation without becoming product truth. It must still
preserve one controller and the accepted no-verdict boundary.

The Owner delegated approval authority and accepted MCA-D23 on 2026-09-19.

## MCA-D24: Evaluation Scenario Control Plane

**Status**: approved
**Date**: 2026-09-19

### Context

MCA-D21 requires 57 independently executed J06 tuples. The current runner
leaves `cell-results` empty, its tests construct synthetic passing tuple rows,
and no Station runtime controller exists for the reviewed scheduler,
cancel/completion, retry/metrics, cancellation-ack deadline, or evaluator
availability boundaries.

### Decision

Extend the same MCA-D22 scenario controller to J06. It may coordinate
allowlisted Evaluation barriers, reviewed duplicate delivery, a run-scoped
clock milestone, and actual runtime restart. Evaluation Service, worker,
repository, and Turn Service remain the only owners of Evaluation product
truth and race outcomes.

The accepted contract is defined in:

`proposals/20260919-mca-d24-evaluation-scenario-control-plane.md`.

### Rationale

Deterministic CAS orderings and restart evidence are required to prove J06
without timing races, direct database mutation, or synthetic `cell-results`.

### Alternatives Considered

- Populate tuple rows from the composite Journey: rejected as fabricated
  execution.
- Race live workers without barriers: rejected as nondeterministic.
- Add an Evaluation-only fixture service: rejected as a second scenario
  authority.
- Use unit tests as formal product evidence: rejected because receiver,
  runtime, restart, and cleanup proof would remain absent.

### Consequences

- The shared scenario contract, Station Evaluation services, Desktop/Browser
  adapters, Mobile contract tests, provisioning, and J06 producer change
  together.
- Actual Station restart materially increases formal run time.
- J06 remains `UNPROVEN` until all 57 unique tuples validate on one exact
  source.

### Review Condition

Revisit if Evaluation scheduling moves to a different canonical runtime. Any
replacement must preserve Station-owned truth, deterministic CAS evidence, and
the no-verdict scenario boundary.

The Owner delegated approval authority and accepted MCA-D24 on 2026-09-19.

## MCA-D25: Tool Zero-Execution Evidence

**Status**: approved
**Date**: 2026-09-19

### Context

MCA-D23 includes governed ToolCall cells that terminate before dispatch or
executor receipt creation, while the J03 matrix row requires
`executor-receipts` for every tuple. J03 also reused the MCP
`CapabilityOperation` cleanup-lease meaning for `ERR-O06`, even though the
canonical architecture explicitly keeps turn-time ToolCalls outside
`CapabilityOperation`.

### Decision

Split J03 matrix rows by executed versus zero-execution semantics while
preserving all 86 tuples. Zero-execution tuples use `station_turn`, require
`zero-execution`, and mark `executor-receipts` not applicable. J03 `ERR-O06`
uses ToolCall receipt-recovery credential expiry; J04 retains
CapabilityOperation cleanup-lease expiry.

The accepted contract is defined in:

`proposals/20260919-mca-d25-tool-zero-execution-evidence.md`.

### Rationale

Evidence applicability must describe facts that can exist on the production
path. A missing executor cannot emit a receipt, and a ToolCall cannot own a
CapabilityOperation cleanup lease.

### Alternatives Considered

- Fabricate executor receipts: rejected.
- Remove the affected tuples: rejected.
- Convert ToolCalls into CapabilityOperations: rejected because it collapses
  two canonical lifecycle authorities.

### Consequences

- Matrix and proof-contract identities advance.
- J03 producers emit zero-execution evidence for pre-execution outcomes.
- Existing candidates under the prior matrix identity are stale.

The Owner's delegated authority accepted MCA-D25 on 2026-09-19.

## MCA-D26: Connector Evidence Follows OAuth-Owner Execution

**Status**: approved
**Date**: 2026-09-21

### Context

MCA-D21 assigned every Desktop and Browser Connector tuple to
`station_capability_turn`, but the accepted MCA-D17 secret boundary and the
production manifest both keep Connector effects in the OAuth-owning client
capability executor. J05 also includes failures and race orderings that reject
before dispatch and therefore cannot emit an executor receipt.

### Decision

Split J05 matrix rows by executed versus zero-execution semantics while
preserving all 37 tuples. Executed Connector tuples use
`client_capability_turn` and bind the real OAuth-owner client session, lease,
ToolCall, fence, and receipt. `ERR-CON01` through `ERR-CON04`, `R-06/A`, and
`R-07/A` use `station_turn`, require `zero-execution`, and do not fabricate an
executor identity.

The accepted contract is defined in:

`proposals/20260921-mca-d26-connector-execution-evidence.md`.

### Rationale

OAuth credentials must remain in their owner, and formal evidence must report
the executor that actually performed the effect. Pre-dispatch rejection is a
Station-owned Turn outcome, not an executor receipt.

### Alternatives Considered

- Move OAuth credentials into Station: rejected because it changes the secret
  boundary and creates a second OAuth owner.
- Label the client capability executor as Station: rejected as false evidence.
- Require receipts for zero-dispatch outcomes: rejected because no executor
  ran.

### Consequences

- Matrix and proof-contract identities advance.
- Prior candidates under the old matrix identity are stale and must be
  regenerated by MCA-A08 on the final source.
- J05 producers emit explicit zero-execution evidence for pre-dispatch
  outcomes and client-capability evidence for executed Connector effects.

The Owner's delegated authority accepted MCA-D26 on 2026-09-21.

## MCA-D27: Typed Client Capability Permission Authority

**Status**: approved
**Date**: 2026-09-25

### Context

`ClientCapability` currently carries a permission state but no permission
category. Desktop also advertises every local capability as granted. Station
therefore cannot distinguish a denied local permission from an absent,
incompatible, or unavailable capability and cannot emit the accepted
`CLIENT_PERMISSION_DENIED` payload with the safe
`capability_id,permission_kind` detail pair.

The Browser Foundation row must continue to satisfy MCA-D19E: its own
capability session advertises no local capabilities and creates no ToolCall.
Browser may nevertheless submit against a separately selected Desktop
capability session and render the Station-owned denial outcome.

### Decision

Add a closed `CapabilityPermissionKind` enum to the shared Agent proto and add
`permission_kind` to each advertised `ClientCapability`. The client capability
kernel is the sole owner of the permission kind and state. Station validates,
hashes, persists, and reads those values from the signed advertisement; it
never derives a permission category from `capability_id`.

When a selected lease contains the exact capability/schema with
`permission == DENIED`, Station rejects before ToolCall persistence, provider
continuation, or local dispatch and emits:

```text
CLIENT_PERMISSION_DENIED
locale_key = agent.errors.clientPermissionDenied
retryable = false
terminal = true
details = { capability_id, permission_kind }
```

`PROMPT` and `UNAVAILABLE` remain readiness states and do not masquerade as a
denial. A denied or prompt capability must carry a non-unspecified permission
kind. Capabilities without an OS/application permission boundary may retain an
unspecified kind only while granted.

The `Open permission settings` recovery action opens the Agent Profile
capability detail for the selected executor and permission category. It does
not grant permission, issue a remote OS command, or automatically resend the
Turn. Desktop may later offer a platform-specific settings affordance from
that detail surface. Browser remains an observer/controller and does not
advertise a local capability to satisfy this error cell.

Acceptance may replace the native executor's signed lease with a denied
capability advertisement through an acceptance-only local permission adapter.
The resulting lease, Station rejection, receiver projection, zero execution,
replay, and restoration remain production-path facts. The fixture cannot
write Station Turn or error state directly.

### Rationale

Permission state and category originate at the device boundary, while Station
owns admission and terminal Turn truth. A typed proto field preserves that
split and makes the accepted safe error payload reproducible on Desktop and
Browser without fabricating browser-local execution.

### Alternatives Considered

- Derive `permission_kind` from capability IDs in Station: rejected because it
  duplicates device policy and silently misclassifies new capabilities.
- Carry an arbitrary string: rejected because cross-platform permission
  semantics require a closed, versioned contract.
- Let the client emit the final error after dispatch: rejected because it
  creates a ToolCall/receipt path despite a known pre-dispatch denial.
- Advertise a denied Browser capability: rejected because it violates
  MCA-D19E and would fabricate a Browser executor.
- Open remote OS settings from Browser: rejected because it introduces a new
  privileged cross-device command and hidden side effect.

### Consequences

- Proto generators and all capability-advertisement consumers must be updated
  atomically.
- Capability-set hashes now include permission kind as well as state.
- Desktop capability snapshots expose the typed permission kind for
  diagnostics and Acceptance, without local paths or grant secrets.
- The Foundation Browser tuple uses the selected native executor's denied
  lease while retaining the Browser row's empty local session and no ToolCall.
- Existing evidence produced before this contract change is stale.

### Review Condition

Revisit only when a platform adds a permission category not represented by the
closed enum or when the product accepts a privileged remote settings command.
Neither case may fall back to capability-ID parsing.

The agent-led findings-first architecture review passed on 2026-09-25.

## MCA-D29: Station-Owned Stateful External Runtime Lifecycle

**Status**: approved
**Date**: 2026-10-01

### Context

The runtime contract already distinguishes `DIRECT_MODEL` from
`EXTERNAL_AGENT` and persists conversation runtime bindings, but production
execution currently hard-codes Direct Model snapshots. The Foundation matrix
therefore reaches `BASE-RESUME_UNAVAILABLE` without an executable external
session path.

The Owner selected full MCA-P12 implementation on 2026-10-01. This supersedes
the prior frozen-profile decision to keep P12 permanently `NOT_ADVERTISED`;
P12 remains optional and is advertised only when a complete session adapter is
healthy.

### Decision

Station owns a provider-neutral External Runtime Manager with a closed session
CLI protocol:

- one Conversation and external-session epoch own one opaque runtime home;
- the first Turn starts a session and persists its opaque handle before
  forwarding runtime output;
- later Turns and Station restarts resume exactly that handle;
- resume failure emits `RUNTIME_RESUME_UNAVAILABLE` with only
  `runtime_profile_id` and `reason_code`;
- no automatic fallback or replacement session is allowed;
- `ResetConversationRuntime` is actor-scoped, version-fenced, idempotent, and
  requires explicit destructive confirmation;
- reset persists a durable fence before external cleanup, then atomically
  advances the epoch and clears the session handle;
- cleanup failure remains durable and blocks new Turn admission;
- cancellation terminates the active process group but preserves the session;
- Conversation deletion uses the same cleanup owner.

Deployment configuration supplies shell-free start, resume, and reset argv
templates. A runtime is `READY` only when all commands and the executable are
available. Vendor-specific event formats are translated behind the adapter;
the canonical product ID remains `external-agent`.

Desktop and Browser only project Station state and submit reset intent.
Neither client receives a filesystem path, owns the external session, starts a
runtime process, or increments the epoch.

### Rationale

This activates the already accepted P12 Journey without weakening the
Station-only truth boundary. Durable reset fencing prevents a crash or
duplicate command from creating two epochs, while conditional advertisement
keeps deployments without a configured external runtime honest.

### Alternatives Considered

- Reuse one-shot CLI execution: rejected because it rebuilds context and owns
  no resumable session.
- Let the client host the external runtime: rejected because Browser and
  restart behavior would diverge.
- Auto-create a replacement session after resume failure: rejected because it
  destroys private runtime continuity without consent.
- Hold a database transaction open during process cleanup: rejected because
  external execution is unbounded and would couple locks to process latency.
- Remove `BASE-RESUME_UNAVAILABLE`: rejected because P12 is now explicitly
  selected for implementation.

### Consequences

- Shared proto adds runtime binding state and reset command/receipt messages.
- Station adds an external runtime process/session owner and durable reset
  command record.
- Provider admission and execution must preserve external session identity.
- Desktop adds a typed `Confirm reset` recovery and exposes only safe binding
  metadata.
- Foundation adds real create/resume/restart/failure/reset/isolation/cleanup
  evidence for Desktop and Browser.
- Evidence before the D29 cutover cannot prove P12.

### Review Condition

Revisit when another adapter requires a non-CLI transport or when process-local
sessions move to a remote runtime service. The Station binding, epoch,
confirmation, idempotency, and cleanup semantics remain unchanged.
