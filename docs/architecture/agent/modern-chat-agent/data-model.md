# Modern Chat Agent — Data Model

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-07-30 | **Updated**: 2026-07-30
> **Owner**: Peers-Touch Agent Team
> **Proto Root**: `model/domain/agent/`

---

## 1. Contract Rules

1. Shared contracts are defined in `model/domain/agent/*.proto`.
2. JSON and Rust/TypeScript/Go types are generated or adapter representations,
   not independent domain models.
3. IDs are opaque and actor-scoped where applicable.
4. Secrets, raw credentials, arbitrary local paths, and private runtime-home
   paths never appear in client-facing contracts.
5. Every mutation carries an idempotency or version rule.
6. Every streamed semantic event is typed and sequenced.

## 2. Canonical Entities

### 2.1 AgentDefinition

Durable Station-owned Agent configuration.

| Field | Meaning |
|---|---|
| `agent_id` | Stable Agent identity |
| `actor_id` | Owner |
| `name`, `description`, `avatar_ref` | Presentation metadata |
| `identity_prompt`, `agent_config_prompt` | Prompt layers |
| `default_runtime_ref` | Default provider/runtime/model profile |
| `tool_policy` | Allowed/denied tools and approval policy |
| `memory_policy` | Retrieval/extraction effort and scope |
| `skill_bindings` | Enabled skill IDs and versions |
| `knowledge_bindings` | Resource IDs and retrieval policies |
| `runtime_budget_policy` | Default bounded execution policy |
| `version` | Optimistic concurrency version |

Local selected-Agent and layout preferences are not fields of this entity.

### 2.2 Conversation

| Field | Meaning |
|---|---|
| `conversation_id` | Durable conversation and runtime owner |
| `actor_id`, `agent_id` | Ownership and Agent binding |
| `title`, `status` | User-visible lifecycle |
| `active_branch_message_id` | Selected message lineage head |
| `runtime_binding` | Direct or external runtime binding |
| `queued_turn_count` | Projection of bounded pending work |
| `version` | Mutation conflict protection |
| `created_at`, `updated_at` | Audit timestamps |

Conversation status:

```text
ACTIVE -> ARCHIVED -> DELETED
```

`DELETED` may be represented as tombstone or hard deletion according to the
accepted retention policy, but deletion cannot leave runtime resources active.

### 2.3 ConversationRuntimeBinding

```protobuf
message ConversationRuntimeBinding {
  RuntimeKind runtime_kind = 1;
  string provider_id = 2;
  string model_id = 3;
  string runtime_profile_id = 4;
  string external_session_id = 5;
  uint64 external_session_epoch = 6;
  string runtime_home_ref = 7;
  string capability_snapshot_hash = 8;
  string config_snapshot_hash = 9;
  google.protobuf.Timestamp bound_at = 10;
}
```

Rules:

- `DIRECT_MODEL` does not use `external_session_id` or `runtime_home_ref`.
- `EXTERNAL_AGENT` uses an opaque Station-private runtime-home reference.
- External session epoch increments after destructive reset or confirmed
  resume-unavailable recovery.
- Client cannot mutate opaque runtime identifiers directly.

### 2.4 Message

```protobuf
message AgentMessage {
  string message_id = 1;
  string conversation_id = 2;
  string turn_id = 3;
  MessageRole role = 4;
  MessageStatus status = 5;
  string content = 6;
  string parent_message_id = 7;
  string replaces_message_id = 8;
  repeated AgentAttachmentRef attachments = 9;
  google.protobuf.Timestamp created_at = 10;
}
```

Message status:

- `PENDING`
- `STREAMING`
- `COMPLETED`
- `PARTIAL`
- `FAILED`
- `CANCELLED`

Tool and reasoning data are typed turn events/trace records. UI projections
may render them beside an assistant message without flattening their domain
semantics into untyped message text.

### 2.5 Turn

```protobuf
message AgentTurn {
  string turn_id = 1;
  string conversation_id = 2;
  string actor_id = 3;
  string agent_id = 4;
  string client_idempotency_key = 5;
  TurnStatus status = 6;
  string user_message_id = 7;
  string assistant_message_id = 8;
  uint32 active_attempt = 9;
  RuntimeSnapshot runtime_snapshot = 10;
  RuntimeBudget budget = 11;
  string terminal_reason = 12;
  google.protobuf.Timestamp submitted_at = 13;
  google.protobuf.Timestamp started_at = 14;
  google.protobuf.Timestamp ended_at = 15;
}
```

Turn status:

```text
SUBMITTED
  -> QUEUED | ADMITTED
QUEUED
  -> ADMITTED | CANCELLED | REJECTED
ADMITTED
  -> CONTEXT_BUILDING
CONTEXT_BUILDING
  -> RUNNING | FAILED | CANCELLED
RUNNING
  -> WAITING_APPROVAL | WAITING_LOCAL_TOOL | COMPRESSING
  -> RETRYING | FALLING_BACK
  -> COMPLETED | FAILED | CANCELLED | INTERRUPTED
WAITING_* / COMPRESSING / RETRYING / FALLING_BACK
  -> RUNNING | FAILED | CANCELLED | INTERRUPTED
```

Terminal states never transition.

### 2.6 TurnAttempt

One provider/runtime execution attempt within a turn.

| Field | Meaning |
|---|---|
| `attempt_id`, `turn_id`, `index` | Identity and ordering |
| `runtime_snapshot` | Immutable provider/model/runtime facts |
| `context_ledger_id` | Exact context build used |
| `started_at`, `ended_at` | Timing |
| `status`, `error_code` | Outcome |
| `usage` | Attempt token/cost facts |
| `provider_request_ref` | Redacted diagnostic reference |

Retry creates a new attempt. Regenerate creates a new turn.

### 2.7 RuntimeSnapshot

```protobuf
message RuntimeSnapshot {
  RuntimeKind runtime_kind = 1;
  string provider_id = 2;
  string model_id = 3;
  string runtime_profile_id = 4;
  RuntimeCapabilitySnapshot capabilities = 5;
  string provider_config_version = 6;
  string agent_config_version = 7;
  string external_session_id = 8;
  uint64 external_session_epoch = 9;
}
```

This snapshot preserves what actually executed even if configuration changes
later.

### 2.8 RuntimeCapabilitySnapshot

| Category | Fields |
|---|---|
| Input | text, image, file, audio |
| Output | text, image, structured |
| Runtime | streaming, reasoning, prompt cache, external resume |
| Agentic | native tools, parallel tools, local bridge |
| Limits | context tokens, output tokens, attachment count/bytes |
| Resolution | per-capability native, bridged, degraded, rejected |
| Provenance | discovery source, source version, observed timestamp |

### 2.9 ContextLedger

```protobuf
message ContextLedger {
  string context_ledger_id = 1;
  string turn_id = 2;
  string attempt_id = 3;
  repeated ContextSegment segments = 4;
  uint64 estimated_input_tokens = 5;
  uint64 reserved_output_tokens = 6;
  uint64 model_context_window = 7;
  string prompt_hash = 8;
  string prompt_version = 9;
}

message ContextSegment {
  string segment_id = 1;
  ContextSegmentType type = 2;
  repeated string source_refs = 3;
  string content_hash = 4;
  uint64 estimated_tokens = 5;
  ContextSegmentDecision decision = 6;
  string decision_reason = 7;
  string trust_metadata_ref = 8;
}
```

Segment types include identity, policy, model facts, memory, skill index, skill
body, history, summary, knowledge, workspace reference, attachment, tool
schema, and current input.

Content bodies follow their owning storage and access policy. The ledger stores
hashes/references unless full content is explicitly safe and required.

### 2.10 RuntimeBudget

```protobuf
message RuntimeBudget {
  uint32 max_attempts = 1;
  uint32 max_agent_steps = 2;
  uint32 max_tool_calls = 3;
  uint32 max_identical_tool_calls = 4;
  uint32 max_delegation_depth = 5;
  uint64 wall_time_ms = 6;
  uint64 max_input_tokens = 7;
  uint64 max_output_tokens = 8;
  uint64 max_attachment_bytes = 9;
  optional double max_cost = 10;
}
```

Budget values are resolved from Station policy and Agent overrides. A client
may request a lower budget but cannot exceed its authority.

Large-payload admission validates attachment count, aggregate bytes, extracted
content budget, and provider limits before persistence or provider execution.
Rejected payloads return a typed error and leave no partial runtime binding.

### 2.11 ToolCall

| Field | Meaning |
|---|---|
| `tool_call_id`, `turn_id`, `attempt_id` | Identity |
| `tool_name`, `schema_version` | Typed capability |
| `execution_owner` | Station or a leased client capability session |
| `arguments_hash`, `redacted_arguments` | Audit-safe request |
| `risk`, `approval_policy` | Policy |
| `approval_id`, `decision` | Human decision |
| `status`, `result_ref`, `error_code` | Outcome |
| `started_at`, `ended_at` | Timing |

### 2.12 AttachmentRef And ArtifactRef

`AgentAttachmentRef` is input provenance:

- Opaque object/storage reference.
- MIME type, size, checksum, filename.
- Authorization scope and expiry policy.
- Extracted-content or image-derivative reference.

`AgentArtifactRef` is generated output provenance:

- Type, title, MIME/language.
- Storage or deterministic message-range reference.
- Generating turn/message/tool.
- Integrity hash and export policy.

Neither may carry an arbitrary client filesystem path as shared truth.

### 2.13 TurnUsage And Feedback

Usage records:

- Input, output, cache, image, reasoning, and tool-definition tokens.
- Provider/model and tool call counts.
- Tool and provider latency.
- Optional provider/tool cost and currency.

Feedback records:

- Immutable `turn_id` and assistant branch.
- Actor/rater, source, rating, optional categories/comment.
- Created/updated timestamp.

Feedback attribution uses ContextLedger and ToolCall references, not inference
from current Agent configuration.

### 2.14 ClientCapabilitySession

```protobuf
message ClientCapabilitySession {
  string capability_session_id = 1;
  string actor_id = 2;
  string device_id = 3;
  ClientPlatform platform = 4;
  repeated ClientCapability capabilities = 5;
  google.protobuf.Timestamp expires_at = 6;
  string connection_id = 7;
}

message ClientCapability {
  string capability_id = 1;
  string schema_version = 2;
  CapabilityPermissionState permission = 3;
  CapabilityConstraints constraints = 4;
}
```

Rules:

- Station authenticates actor/device and issues the session lease.
- Capabilities describe typed operations, not arbitrary commands.
- The lease expires on timeout, disconnect, logout, Station switch, or explicit
  revocation.
- Multiple devices require explicit target selection or deterministic policy;
  Station never broadcasts a privileged request.
- Mobile and Desktop may advertise different capabilities.

`ClientResourceRef` is an opaque reference scoped to one actor, device,
capability session, permission grant, and expiry. Only the owning client kernel
may resolve it to a local path or native handle.

`ClientCapabilityRequest` and `ClientCapabilityResult` carry turn/tool IDs,
capability/schema IDs, opaque resource references, bounded arguments/results,
approval evidence, sequence, and typed error. A result from another session or
expired lease is rejected.

## 3. Turn Event Contract

```protobuf
message TurnEvent {
  string event_id = 1;
  string turn_id = 2;
  uint64 sequence = 3;
  TurnEventType type = 4;
  google.protobuf.Timestamp occurred_at = 5;
  oneof payload {
    TurnStateChanged state_changed = 10;
    TextDelta text_delta = 11;
    TextCheckpoint text_checkpoint = 12;
    ThinkingDelta thinking_delta = 13;
    ToolCallRequested tool_call = 14;
    ApprovalRequested approval = 15;
    ToolCallResult tool_result = 16;
    ContextBuilt context = 17;
    RuntimeFallback fallback = 18;
    UsageUpdated usage = 19;
    TurnError error = 20;
    TurnCompleted completed = 21;
  }
}
```

Delivery:

- Monotonic sequence per turn.
- At-least-once.
- Client deduplication by `(turn_id, sequence)`.
- Cursor reconnect with retained replay and current snapshot.
- `error` and `completed` are terminal and mutually exclusive.
- Text deltas may be compacted after a durable checkpoint.

## 4. Command Contracts

### SubmitTurn

Required:

- Conversation ID.
- Client idempotency key.
- User input or attachments.
- Optional explicit runtime/model selection intent.
- Optional lower runtime budget.
- Optional client capability session selected for device-local work.

Same actor, conversation, and idempotency key returns the original turn.
Different payload with the same key returns `IDEMPOTENCY_CONFLICT`.

The request must not carry Agent identity/system prompt, retry authority,
arbitrary CLI command, runtime backend, allowed filesystem roots, or a local
workspace path. Station resolves these from Agent, conversation, runtime,
provider, and capability-session truth.

### CancelTurn

Idempotent. Returns current terminal status if already terminal. Cancellation
propagates to current attempt, provider process, approval/tool waiter, and
queued children.

### RegenerateTurn

Requires source assistant message. Creates a new turn and sibling branch. It
does not delete the source response.

### ResetConversationRuntime

Valid only for a stateful external runtime. Requires expected conversation
version and explicit destructive confirmation. It terminates the current
external-session epoch, cleans runtime state, increments epoch, and clears the
resume handle.

## 5. Typed Errors

Required categories:

- Admission: queue full, duplicate conflict, active mutation conflict.
- Ownership/auth: forbidden actor, unauthorized resource.
- Runtime: unavailable, incompatible capability, resume unavailable.
- Client capability: executor unavailable, lease expired, permission denied,
  target disconnected, invalid resource reference.
- Provider: credential missing, rate limit, model unavailable, timeout.
- Context: overflow, invalid reference, attachment rejected.
- Tool: unknown tool, approval denied/expired, loop/budget exhausted.
- Lifecycle: cancelled, interrupted, stale version, terminal mutation.

Every typed error has stable code, locale key, retryability, terminality, and
safe structured arguments.

## 6. Persistence And Retention

- Conversation, messages, turns, attempts, semantic events, traces, feedback,
  and runtime bindings are durable Station state.
- Runtime homes and external sessions are Station-private runtime assets with
  conversation lifecycle cleanup.
- Text event chunks may be compacted after completion.
- Diagnostic exports are generated views, not a second source of truth.
- Deletion must remove or tombstone dependent runtime assets according to
  policy and must never leave active provider/tool processes.

## 7. `MODERN_CHAT_AGENT_V1` Capability Profile

Required:

- Station-owned Agent definition, conversation, messages, turns, and trace.
- Direct Model Runtime with true streaming and cancellation.
- Deterministic ContextLedger covering history, memory, skills, knowledge,
  attachments, and tools.
- Multi-turn continuity, compression, branch-aware regenerate, and restart
  recovery.
- Model capability negotiation with explicit degradation/rejection.
- Bounded attempts, steps, tools, queue, time, tokens, and payloads.
- Policy-controlled builtin/MCP tool loop with approval and audit.
- Platform-neutral client capability session with opaque local resource refs.
- Sequenced replay plus App/browser reconciliation.
- Usage, feedback, diagnostic export, and fixed quality cases.
- Actor, credential, attachment, and local-capability isolation.

Optional and separately advertised:

- Registered stateless model CLI adapter under `DIRECT_MODEL`.
- Stateful `EXTERNAL_AGENT` runtime. When advertised, all runtime binding,
  external-session epoch, isolation, reset, and cleanup contracts are required.
- Structured/image output artifacts.

Excluded from this profile:

- Multi-Agent orchestration, voice/video, marketplace, and Mobile UI.

Mobile UI is excluded from delivery, but Mobile-compatible shared contracts
and capability degradation are required.

No runtime may claim profile support when a required capability is absent or
implemented only through an unapproved local fallback.
