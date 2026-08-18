# Modern Chat Agent — Design Decisions

> **Status**: approved
> **Version**: v1.0
> **Created**: 2026-07-30 | **Updated**: 2026-08-17
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
| MCA-D09 | Enforce runtime budgets and loop detection | approved |
| MCA-D10 | Make feedback, usage, and diagnostic replay part of the kernel | approved |
| MCA-D11 | Keep multi-Agent orchestration downstream of single-Agent readiness | approved |
| MCA-D12 | Use one product capability profile instead of reusing conflicting P0-P2 labels | approved |
| MCA-D13 | Route device-local work through a platform-neutral client capability session | approved |
| MCA-D14 | Project Home from Station-owned work state | approved |
| MCA-D15 | Use one versioned capability manifest and Agent binding contract | approved |
| MCA-D16 | Model MCP lifecycle as Station operations executed by client capability managers | approved |
| MCA-D17 | Separate Connector OAuth/resources from Agent tool manifests and bindings | approved |
| MCA-D18 | Make Evaluation a Station aggregate using the canonical Turn kernel | approved |

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

One kernel prevents divergent behavior across Desktop App, browser gateway,
Mobile, and future channels.

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

### Rationale

Mid-turn capability surprises cause data loss and misleading UX.

### Alternatives Considered

- Infer capabilities from provider names: rejected as stale and untyped.
- Try and catch provider errors: rejected because it fails too late.

### Consequences

- Capability discovery requires freshness and provenance.
- Some models will be rejected for specific turns.

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

## MCA-D16: Station Capability Operations, Client MCP Execution

**Status**: approved

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
