# Modern Chat Agent — Data Model

> **Status**: accepted
> **Version**: v1.4
> **Created**: 2026-07-30 | **Updated**: 2026-10-01
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
| `ptid` | Owner |
| `name`, `description`, `avatar_ref` | Presentation metadata |
| `identity_prompt`, `agent_config_prompt` | Prompt layers |
| `default_runtime_ref` | Default provider/runtime/model profile |
| `memory_policy` | Retrieval/extraction effort and scope |
| `runtime_budget_policy` | Default bounded execution policy |
| `version` | Optimistic concurrency version |

Tool, Skill, Knowledge, MCP, and Connector relationships are not embedded
fields. They are `AgentCapabilityBinding` rows referencing versioned
`CapabilityManifest` entries. Existing embedded arrays/JSON are migration
sources only and are deleted after C12 cutover.

Local selected-Agent and layout preferences are not fields of this entity.

### 2.1A KnowledgeResourceDescriptor

Station-owned resource identity used by Knowledge capability manifests.

| Field | Meaning |
|---|---|
| `resource_id`, `ptid` | Stable actor-scoped identity |
| `revision` | Monotonic descriptor revision |
| `resource_kind`, `title` | Resource class and user-facing label |
| `locator` | Oneof immutable `station_content_ref` or opaque `client_resource_ref` |
| `content_hash`, `index_revision` | Immutable retrieval provenance where Station-hosted |
| `availability`, `reason_code` | Typed source/index readiness |
| `created_at`, `updated_at`, `tombstoned_at` | Lifecycle and deletion evidence |

Rules:

- Every accepted descriptor revision publishes a Knowledge
  `CapabilityManifest` version whose `owner_ptid` equals the descriptor owner.
  Global catalog manifests keep `owner_ptid` empty; actor-owned manifests are
  visible, bindable, and mutable only by that actor.
- Binding policy lives only in `AgentCapabilityBinding`.
- A Turn pins descriptor identity through manifest version plus binding
  revision; `ExecuteTurnRequest` does not carry Knowledge descriptors.
- `client_resource_ref` requires the selected capability session and never
  exposes a raw path to Station.
- Package import either resolves each portable descriptor before Agent
  creation or returns an unresolved dependency plan; partial binding import is
  forbidden.
- Tombstoning a descriptor retires every published manifest revision so no
  historical revision can receive new admission.

### 2.2 Conversation

| Field | Meaning |
|---|---|
| `conversation_id` | Durable conversation and runtime owner |
| `ptid`, `agent_id` | Ownership and Agent binding |
| `title`, `status` | User-visible lifecycle |
| `active_branch_message_id` | Selected message lineage head |
| `runtime_binding` | Direct or external runtime binding |
| `queued_turn_count` | Projection of bounded pending work |
| `version` | Mutation conflict protection |
| `created_at`, `updated_at` | Audit timestamps |

Conversation status:

```text
ACTIVE <-> ARCHIVED -> DELETED
```

Archive and restore are versioned, actor-scoped mutations. `DELETED` first
creates an actor-inaccessible tombstone and fences new admission. Deletion
rejects with `ACTIVE_DEPENDENCY` while a Turn is running/waiting or a queue
entry is pending; hard deletion occurs only after active turns/operations are
terminal and runtime cleanup is acknowledged. Trace/evidence snapshots follow
the explicit rules in §6.

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
  ExternalRuntimeBindingState state = 11;
  string last_error_code = 12;
  google.protobuf.Timestamp updated_at = 13;
}
```

Rules:

- `DIRECT_MODEL` does not use `external_session_id` or `runtime_home_ref`.
- `EXTERNAL_AGENT` uses an opaque Station-private runtime-home reference.
- A newly installed external binding starts at epoch `1`; Direct Model remains
  epoch `0`.
- External session epoch increments after destructive reset or confirmed
  resume-unavailable recovery.
- Client cannot mutate opaque runtime identifiers directly.
- `RESET_PREPARED` and `CLEANUP_FAILED` block Turn admission.

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
  string ptid = 3;
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
  -> FALLING_BACK
  -> COMPLETED | FAILED | CANCELLED | INTERRUPTED
WAITING_* / COMPRESSING / RETRYING / FALLING_BACK
  -> RUNNING | FAILED | CANCELLED | INTERRUPTED
FAILED / CANCELLED / INTERRUPTED
  -> RETRYING  # actor-scoped RetryTurn only
```

Attempt terminal states never transition. `RetryTurn` may reopen the aggregate
Turn through `RETRYING`, but it appends a new Attempt and leaves every prior
Attempt and terminal TurnEvent immutable.

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

Turn-event recovery defaults to the current Attempt so an older terminal event
cannot close a reopened Turn. Immutable lineage readback may provide
`attempt_id`; Station then returns only that retained Attempt's events and
snapshot. Unbound legacy events remain available only through the default
current-attempt compatibility fence and are never inferred into an explicitly
selected historical Attempt.

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
  string thinking_mode = 10;
}
```

`TurnAttempt` pins `capability_readiness_snapshot_id`. Every `ToolCall` pins
`capability_id`, `capability_version`, `binding_id`, `binding_revision`, and
`readiness_snapshot_id`; replay and diagnostics never resolve these from the
current Agent configuration.

This snapshot preserves what actually executed even if configuration changes
later.

`ThinkingMode` is provider-portable and independent from reasoning effort:

```text
THINKING_MODE_AUTO
THINKING_MODE_ENABLED
THINKING_MODE_DISABLED
```

Agent configuration owns the durable default. A Turn may override it. Missing
or unspecified values normalize to `AUTO`; an explicit mode unsupported by the
selected provider/model catalog capability rejects before provider execution.
Provider adapters translate the effective mode to their wire format and must
not infer it from effort, display names, URL patterns, or observed thinking
deltas. Historical snapshots without the field migrate to `AUTO` and receive a
new canonical runtime snapshot hash.

Station persists `ConversationRuntimeBinding` and `RuntimeSnapshot` as the
generated protobuf contracts. The first successfully resolved attempt installs
the conversation binding; subsequent attempts must match it or fail before a
provider call. A `TurnAttempt` stores its full snapshot before execution and
diagnostic replay returns that stored value rather than rebuilding it from the
current provider or Agent configuration.

The portable hash representation is canonical UTF-8 JSON with recursively
sorted object keys and no insignificant whitespace:

- `capability_snapshot_hash` hashes the complete `capabilities` object from the
  portable `RuntimeSnapshot`;
- `config_snapshot_hash` hashes exactly `agentConfigVersion` and
  `providerConfigVersion`, both encoded as strings;
- `TurnAttempt.runtime_snapshot_hash` hashes the complete portable
  `RuntimeSnapshot`.

Direct-model bindings leave external-session and runtime-home values empty and
use epoch `0`; consumers hash the empty runtime-home value rather than receiving
a local path.

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
| `manifest_id`, `manifest_version` | Immutable capability contract |
| `binding_id`, `binding_revision`, `readiness_snapshot_id` | Admission facts |
| `approval_id`, `decision_id`, `decision` | Unique human/policy decision |
| `execution_claim_id`, `executor_lease_id`, `fencing_token` | Side-effect ownership |
| `side_effect_receipt_id` | Crash-safe execution receipt identity |
| `dispatch_sequence`, `dispatch_committed_at`, `payload_hash` | Deduplication and linearization |
| `execution_deadline`, `reconciliation_deadline` | Side-effect admission versus terminal settlement |
| `replay_policy`, `external_idempotency_key` | Station-pinned restart semantics |
| `status`, `result_id`, `result_ref`, `error_code` | Unique outcome |
| `cancel_requested_at`, `cancel_ack_at`, `cleanup_outcome` | Cancellation/cleanup |
| `started_at`, `ended_at` | Timing |

Constraints:

- unique `(tool_call_id)` decision and terminal result;
- unique active execution claim and one logical receipt ledger per ToolCall;
- receipt attempts are unique by `(tool_call_id, fencing_token)`;
- at most one receipt attempt may transition to `APPLIED`;
- lease takeover increments a fencing token;
- Station commits the execution claim before dispatch;
- the same Station transaction writes one unique outbox envelope and
  `dispatch_committed_at`; network delivery is at-least-once from that outbox;
- executor durably records `PREPARED(tool_call_id, fence, payload_hash)` before
  side effects and `APPLIED` after the side effect;
- executor validates claim, lease revision, fence, payload hash, and
  `execution_deadline` before side effects;
- replay policy is resolved by Station from the pinned capability
  manifest/readiness snapshot;
- external calls use the exact Station-issued `external_idempotency_key` only
  when replay policy permits;
- duplicate dispatch returns the existing claim/result;
- a `PREPARED` crash may replay only when the tool advertises external
  idempotency; otherwise it becomes `UNKNOWN_SIDE_EFFECT` and cannot be
  redispatched/taken over automatically;
- after `dispatch_committed_at`, revoke/cancel prevents a new dispatch but the
  existing claim must reconcile `APPLIED`, cancelled, or
  `UNKNOWN_SIDE_EFFECT`;
- late old-fence results are rejected audit evidence;
- success commits only after required cleanup succeeds.

`SideEffectReceiptAttempt` is append-only:

```text
tool_call_id, fencing_token, device_id, payload_hash
status=PREPARED|APPLIED|RECONCILED_UNKNOWN
external_idempotency_key?, applied_result_hash?, updated_at
```

`ToolCallDispatchEnvelope` is unique by `(tool_call_id, fencing_token)`. The
claim and envelope are committed atomically; an outbox worker may redeliver the
same envelope but cannot create another claim/fence. `dispatch_committed_at`
means this transaction committed, not that network delivery occurred.

Receipt reconciliation is not an old-lease business result. Before dispatch,
Station issues a short-lived, single-purpose `ReceiptRecoveryCredential` bound
to actor, device attestation key, ToolCall, fence, payload hash, nonce, and
expiry. It can only submit a signed receipt and cannot execute or request new
work. Capability-session revoke does not grant or broaden it; device trust-key
revoke invalidates it. Station consumes its nonce exactly once and CAS-applies
one receipt attempt. If no valid signed receipt is available, Station commits
`UNKNOWN_SIDE_EFFECT`; no automatic redispatch is allowed.

The first valid terminal digest consumes the nonce and stores its
acknowledgement. An identical retry returns that acknowledgement; a different
digest conflicts. The credential is usable only after a matching PREPARED row
and before `reconciliation_deadline`. It never authorizes PREPARED or a side
effect after `execution_deadline`.

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
enum CapabilityPermissionKind {
  CAPABILITY_PERMISSION_KIND_UNSPECIFIED = 0;
  CAPABILITY_PERMISSION_KIND_CLIPBOARD = 1;
  CAPABILITY_PERMISSION_KIND_FILESYSTEM = 2;
  CAPABILITY_PERMISSION_KIND_CAMERA = 3;
  CAPABILITY_PERMISSION_KIND_MICROPHONE = 4;
  CAPABILITY_PERMISSION_KIND_NOTIFICATIONS = 5;
  CAPABILITY_PERMISSION_KIND_SCREEN_CAPTURE = 6;
}

message ClientCapabilityLease {
  string capability_session_id = 1;
  string ptid = 2;
  string device_id = 3;
  ClientPlatform platform = 4;
  repeated ClientCapability capabilities = 5;
  google.protobuf.Timestamp expires_at = 6;
  string connection_id = 7;
  string lease_id = 8;
  uint64 lease_revision = 9;
  string capability_set_hash = 10;
  string device_signing_key_id = 11;
}

message ClientCapability {
  string capability_id = 1;
  string schema_version = 2;
  CapabilityPermissionState permission = 3;
  CapabilityConstraints constraints = 4;
  CapabilityPermissionKind permission_kind = 5;
}
```

Rules:

- Station authenticates actor/device and issues the session lease.
- Registration accepts only the client capability advertisement, connection
  identity, and device signing-key ID. Station ignores or rejects
  client-selected actor, lease/session ID, revision, or expiry and applies its
  own maximum TTL.
- Capabilities describe typed operations, not arbitrary commands.
- Permission kind and state are reported by the client capability owner in the
  signed advertisement. Station must not derive a permission kind from a
  capability ID.
- `DENIED` and `PROMPT` require a non-unspecified permission kind.
  Permissionless capabilities may use an unspecified kind only while granted.
- A selected exact capability/schema with `DENIED` produces terminal
  `CLIENT_PERMISSION_DENIED` before ToolCall persistence or dispatch, with
  only `capability_id` and the enum wire name in `permission_kind`.
- Renewal requires the same authenticated actor/device/session, active lease,
  expected lease revision, capability-set hash, connection identity, and device
  signing-key ID. It advances revision and expiry only.
- Capability or signing-key changes require a new session, never an in-place
  renewal.
- The lease expires on timeout, disconnect, logout, Station switch, or explicit
  revocation. Revoke/expiry stops pull, dispatch, and pre-PREPARED execution.
- Multiple devices require explicit target selection or deterministic policy;
  Station never broadcasts a privileged request.
- Mobile and Desktop may advertise different capabilities.

`ClientResourceRef` is an opaque reference scoped to one actor, device,
capability session, capability, permission grant, integrity hash, and expiry.
Only the owning client kernel may resolve it to a local path or native handle.
Desktop Rust persists that mapping encrypted in an actor/device-scoped local
registry. Station and Web persist only opaque identity and bounded metadata.
An entry may survive session expiry only when a matching PREPARED receipt and
declared-idempotent recovery require it, and never beyond reconciliation
settlement or expiry.

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
- Optional explicit thinking-mode override.
- Optional lower runtime budget.
- Optional client capability session selected for device-local work.

Same actor, conversation, and idempotency key returns the original turn.
Different payload with the same key retains the Station
`IDEMPOTENCY_CONFLICT` domain classification and projects the user-facing
`ADMISSION_DUPLICATE_CONFLICT` typed error with only
`idempotency_key_hash` and `existing_command_id`.

The request must not carry Agent identity/system prompt, retry authority,
arbitrary CLI command, runtime backend, allowed filesystem roots, or a local
workspace path. Station resolves these from Agent, conversation, runtime,
provider, and capability-session truth.

### CreateConversationAndSubmitTurn

Used by Home Chat when no conversation exists. Required:

- Actor-scoped client idempotency key and payload hash.
- Agent ID and expected Agent version.
- User input/attachments and readiness snapshot ID.

The mutation atomically creates one conversation and submits its first Turn.
Duplicate same-payload delivery returns the original conversation/Turn.
Different payload under the same key returns `IDEMPOTENCY_CONFLICT`. No empty
conversation remains when admission fails before acceptance.

### CancelTurn

Idempotent. Returns current terminal status if already terminal. Cancellation
propagates to current attempt, provider process, approval/tool waiter, and
queued children.

### Revision Commands (`MCA-D08A`)

#### RegenerateTurn

Requires source assistant message. Creates a new turn and sibling branch. It
does not delete the source response.

Request:

- `conversation_id`
- `source_assistant_message_id`
- `client_idempotency_key`
- `expected_conversation_version`
- optional lower `requested_budget`

Response returns the existing or newly created Turn, sibling assistant message,
and updated Conversation. The source message must be terminal, visible, owned
by the actor, and part of the named conversation.

#### RetryTurn

Requires one failed, cancelled, or interrupted `source_turn_id`. It creates a new
`TurnAttempt` under that same Turn and does not create a message branch.
Request carries conversation ID, source Turn ID, idempotency key, and expected
conversation version. Retry is rejected for non-terminal, completed, or
superseded Turns.

#### EditAndResend

Requires a visible source user message. Request carries conversation ID, source
user message ID, revised text/attachments, idempotency key, expected
conversation version, and optional lower runtime budget.

One transaction creates:

1. A user sibling with `parent_message_id` equal to the source parent and
   `replaces_message_id` equal to the source user message.
2. A new Turn rooted at that sibling.
3. A new active branch head and incremented conversation version.

The source message and all prior descendants remain immutable and selectable.

#### SelectActiveBranch

Request carries conversation ID, visible target message ID, idempotency key,
and expected conversation version. Station verifies that the target belongs to
the same conversation and is a valid branch head. The transaction changes only
`active_branch_message_id`, increments conversation version, and emits a
revision event. It never creates, edits, or deletes a message.

#### TombstoneMessage

Request carries conversation ID, message ID, idempotency key, expected
conversation version, and explicit destructive confirmation.

The transaction sets immutable tombstone metadata (`tombstoned_at`,
`tombstoned_by_ptid`, reason), increments conversation version, and removes the
message from normal timeline/context projection. It does not rewrite content,
lineage, Turn, Trace, usage, feedback, approval, or tool evidence.

If the active branch points at the tombstoned message or one of its
descendants, Station atomically selects the nearest visible ancestor; if no
valid visible branch remains, the active branch becomes empty. Active Turns,
queued intents, unresolved approvals/tools, or retention locks return
`ACTIVE_DEPENDENCY`.

#### Shared Revision Command Semantics

All five commands:

- derive `ptid` from authenticated context, never request payload;
- require `expected_conversation_version > 0`;
- deduplicate by `(ptid, command_kind, client_idempotency_key)`;
- return the original result for identical replay;
- return `IDEMPOTENCY_CONFLICT` for payload mismatch;
- return `VERSION_CONFLICT` for stale conversation revision;
- return `NOT_FOUND` for missing or foreign resources;
- return `INVALID_SOURCE_STATE` for incompatible source role/status;
- commit message/turn/attempt/branch/version/event changes atomically.

### ResetConversationRuntime

Valid only for a stateful external runtime. Requires expected conversation
version and explicit destructive confirmation. It terminates the current
external-session epoch, cleans runtime state, increments epoch, and clears the
resume handle.

```protobuf
enum ExternalRuntimeBindingState {
  EXTERNAL_RUNTIME_BINDING_STATE_UNSPECIFIED = 0;
  EXTERNAL_RUNTIME_BINDING_STATE_READY = 1;
  EXTERNAL_RUNTIME_BINDING_STATE_RESUME_UNAVAILABLE = 2;
  EXTERNAL_RUNTIME_BINDING_STATE_RESET_PREPARED = 3;
  EXTERNAL_RUNTIME_BINDING_STATE_CLEANUP_FAILED = 4;
}

message ResetConversationRuntimeRequest {
  string conversation_id = 1;
  uint64 expected_conversation_version = 2;
  string client_idempotency_key = 3;
  bool destructive_confirmed = 4;
}

message ResetConversationRuntimeResponse {
  Conversation conversation = 1;
  uint64 closed_external_session_epoch = 2;
  bool replayed = 3;
}
```

Station persists one `ExternalRuntimeResetCommand` keyed by
`(ptid, client_idempotency_key)`. It records payload hash, old binding tuple,
reset fence, lifecycle state, safe error code, and committed response.
`RESET_PREPARED` is durable before process/session/home cleanup starts.
Successful cleanup advances exactly one epoch and emits one sequenced
`runtime_reset` event. Failed cleanup preserves the old tuple and records
`CLEANUP_FAILED`; the same command may retry it.

### CreateAndStartAgentTask

Required:

- Actor-scoped client idempotency key.
- Agent ID and expected Agent version.
- Title/instruction and optional accepted topic reference.
- Readiness snapshot ID.

The mutation atomically creates one durable Task and admits its first run.
Duplicate same-payload submission returns the original Task/run. Reusing the
key with different input returns `IDEMPOTENCY_CONFLICT`. Cancellation targets
the Task/run ID and is idempotent; it propagates to the canonical Turn when one
has been admitted.

### Capability Operation Commands

- `CreateCapabilityOperation`: idempotency key, operation kind, capability
  version, payload hash, target capability session, deadline.
- `CancelCapabilityOperation`: operation ID, expected revision, cancellation
  reason.
- `ReportCapabilityOperationEvent`: operation ID, executor lease ID, monotonic
  attempt epoch, fencing token, sequence, progress/result/error/cleanup
  outcome.
- `ReconcileCapabilityOperation`: operation ID and event cursor.
- `TakeOverCapabilityOperation`: operation ID, expected revision, new
  actor/device/session lease; valid only in takeover-eligible states and
  atomically increments attempt epoch/fence. It must provide an idempotent
  recovery contract or request cleanup-only settlement when side effects may
  already exist.
- `TakeOverCleanup`: operation ID, expected cleanup epoch, same resource/device
  scope and new cleanup lease; valid only after cleanup lease expiry.
- `ReconcileSideEffectReceipt`: ToolCall ID, same-device receipt recovery
  session, receipt attempt/fence and receipt hash.

Tool invocation is not a `CapabilityOperation`. It remains a `ToolCall` inside
the canonical Turn. Capability operations cover install/configure/test/connect/
reconnect/uninstall and their local resource lifecycle.

Consequently, J03 `ERR-O06` applies to the ToolCall
`ReceiptRecoveryCredential` expiry boundary. The similarly named J04 cell
applies to the independent `CapabilityOperation` cleanup lease. Formal
evidence must not project either record as the other.

### Evaluation Commands

- Create/update benchmark/dataset/case mutations carry actor-scoped
  idempotency key and expected revision.
- `CreateEvaluationRun` pins dataset revision and target Agent/runtime/config/
  readiness snapshots.
- `StartEvaluationRun`, `CancelEvaluationRun`, and `RetryEvaluationCases` carry
  run ID, command kind, expected revision, idempotency key, and payload hash.
- `CancelEvaluationRun` first commits cancel-intent CAS before dispatching case
  cancellation; completion requires no cancel-intent fence.
- Cancellation propagates to non-terminal case Turns and records each
  cancellation acknowledgement.
- Retry accepts only failed/partial case IDs and creates a child run with linked
  source attempt/result IDs; the terminal parent never transitions.

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

`CLIENT_PERMISSION_DENIED` is non-retryable and terminal for the submitted
Turn. Its only safe details are `capability_id` and `permission_kind`.
Permission correction is a later user action and never causes automatic
resubmission. Browser renders the same Station payload for a selected native
executor while its own MCA-D19E session remains capability-empty.

## 6. Persistence And Retention

- Conversation, messages, turns, attempts, semantic events, traces, feedback,
  and runtime bindings are durable Station state.
- Runtime homes and external sessions are Station-private runtime assets with
  conversation lifecycle cleanup.
- Text event chunks may be compacted after completion.
- Diagnostic exports are generated views, not a second source of truth.
- Deletion must remove or tombstone dependent runtime assets according to
  policy and must never leave active provider/tool processes.

V2 deletion/retention:

- Agent deletion first fences new Turns/Tasks/Evaluation runs. If active work
  exists, deletion returns `ACTIVE_DEPENDENCY` unless explicit cancel-and-delete
  is requested; cancellation/cleanup must become terminal before bindings are
  tombstoned and Home references removed. Historical snapshots retain safe
  display metadata.
- Manifest retirement blocks new binding/admission. Active ToolCalls keep their
  pinned manifest/fence until terminal; force retirement cancels/fences them.
  Historical manifest versions remain immutable while referenced by retained
  trace/evidence.
- Binding deletion uses expected revision, blocks new admission, and either
  waits for active ToolCalls or explicitly fences/cancels them. It never changes
  historical ToolCall snapshots.
- Device/session revocation transaction invalidates readiness and blocks new
  dispatch. Claims not yet dispatch-committed are cancelled. A dispatched claim
  is fenced; if a side effect may already exist it reconciles to applied,
  cancelled, or `UNKNOWN_SIDE_EFFECT` without redispatch. Cleanup remains
  required and visible.
- Normal OAuth disconnect atomically increments connection revision, marks it
  `disconnecting`, and blocks new admission. ToolCalls dispatch-committed before
  that transaction may finish under their pinned old revision; undispatched
  calls cancel. Security/credential revocation uses force-disconnect and fences
  even dispatched calls, which then reconcile without redispatch. Resource
  manifests become unavailable after in-flight settlement. Historical ToolCall
  snapshots remain redacted and inspectable.
- OAuth revoke first commits local disable/revision so no new admission can use
  the token, then runs an idempotent provider-revoke operation with bounded
  retry. Provider acknowledgement sets `revoked`; provider rejection/timeout
  sets `revocation_unconfirmed` while local state remains disabled and visibly
  recoverable. It never auto-reenables. Repeated revoke uses the same provider
  idempotency key and exposes the final provider-safe error.
- Benchmark deletion is rejected while active runs exist. Dataset/case delete
  tombstones source definitions; terminal run/attempt/result snapshots remain
  while referenced by terminal runs. Draft runs may cascade-delete.
- Evaluation run deletion is a separate explicit evidence-retention action and
  never deletes canonical Turn/Trace records. Terminal run/result snapshots are
  retained while their Turn/Trace evidence exists; retention expiry tombstones
  identifiers before hard deletion.
- Runtime homes/processes are deleted on reset/conversation deletion; cleanup
  failure is durable and blocks completion.

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

## 8. V2 Contract Additions

These are architecture-level contract shapes. Implementation remains
proto-first under `model/domain/agent/`; generated files are never edited.

### 8.1 HomeWorkProjection

```text
HomeWorkProjection
  ptid, revision, generated_at, freshness
  pinned_agents[], recent_work[], readiness
  brief_items[], needs_user_items[], active_tasks[]
  capability_summaries[], slice_errors[]
```

`recent_work` references canonical topic/task IDs. Slice errors preserve valid
accepted slices. The projection is read-only and rebuildable from Station truth.

### 8.2 CapabilityManifest

```text
CapabilityManifest
  capability_id, version, source_kind, source_instance_id
  display_metadata, input_schema_ref, output_schema_ref
  execution_owner, required_runtime_capabilities[]
  risk_class, default_approval_policy, secret_boundary, availability
```

Manifest identity is `(capability_id, version)`; display labels are not
identity.

### 8.3 AgentCapabilityBinding

```text
AgentCapabilityBinding
  binding_id, ptid, agent_id, capability_id, capability_version
  enabled, approval_policy, expected_agent_version
  revision, updated_at
```

Mutations require expected versions. Bindings never contain credentials.

### 8.4 CapabilityReadinessSnapshot

```text
CapabilityReadinessSnapshot
  snapshot_id, ptid, agent_id, runtime_snapshot_id
  model_capabilities, binding_revisions[], connection_revisions[]
  selected_client_session_id?, capabilities[]
  created_at, expires_at
```

Each result is `ready`, `degraded`, `unavailable`, `blocked`, or `unknown`,
with authority and typed reason. Turn admission pins the snapshot ID.

Ownership rules:

- Binding actor must own the Agent and may reference only visible manifests.
- Connector manifest actor and OAuth connection owner must match.
- Client-local readiness names one authenticated device/session; another device
  cannot satisfy or report its operation.
- Actor, device, session, lease, capability ID/version, and payload hash
  mismatch are hard rejection with audit evidence.

### 8.5 CapabilityOperation

```text
CapabilityOperation
  operation_id, idempotency_key, payload_hash
  ptid, capability_id, capability_version
  target_device_id, capability_session_id, executor_lease_id
  operation_kind, status, attempt, attempt_epoch, fencing_token, revision
  deadline, last_event_sequence, cancel_requested_at?, cancel_ack_at?
  desired_terminal_outcome?, cleanup_lease_id?, cleanup_epoch?
  cleanup_fencing_token?, cleanup_deadline?, side_effect_started_at?
  progress, result_ref?, error?, cleanup_outcome?
  created_at, updated_at, terminal_at?
```

```text
pending -> dispatched -> running
pending/dispatched/running/disconnected/reconnecting
  -> cancelling -> settling_cleanup(cancelled)
pending/dispatched/running/disconnected/reconnecting
  -> settling_cleanup(timed_out | failed)
dispatched/running -> disconnected -> reconnecting -> dispatched | running
running -> settling_cleanup(succeeded | failed)
settling_cleanup -> succeeded | cancelled | timed_out | failed | cleanup_failed
                   | unknown_side_effect
```

Events carry operation ID and monotonic sequence; repeated delivery is
idempotent. `(operation_id, attempt_epoch, sequence)` is unique. Lease takeover
increments attempt epoch and fencing token; the old executor cannot report
accepted progress/result. A result is accepted only from the bound actor/device/
session/lease before lease/deadline expiry. Cancellation wins when its durable
fence commits before the result fence; otherwise the committed result wins.
Timeout commits a desired terminal fence and enters cleanup settlement.
Every outcome, including pending cancellation with no spawned resource, passes
through `settling_cleanup` (a no-op cleanup may acknowledge immediately).
Cleanup failure commits `cleanup_failed`, never rewrites another terminal
outcome. Late events are rejected audit facts.

Takeover is allowed only in `dispatched`, `running`, `disconnected`, or
`reconnecting`, before a terminal/cleanup fence. If no side effect started, the
new lease may execute. If side effects may exist, takeover requires an
operation-specific idempotent recovery protocol; otherwise state becomes
`settling_cleanup(unknown_side_effect)` and no repeat execution is allowed.
The old executor loses business progress/result authority but retains a scoped
`cleanup_lease_id` that can report cleanup only. The new executor coordinates
cleanup when the old executor is unreachable.

Cleanup settlement has an independent lease epoch/fence. `TakeOverCleanup` is
allowed only in `settling_cleanup` after cleanup lease expiry and only on an
authenticated compatible executor for the same device/resource scope. It
increments cleanup epoch/fence. Old cleanup reports are rejected. If no
compatible executor appears before cleanup deadline, Station commits
`cleanup_failed` with orphan-resource diagnostics; the operation never remains
non-terminal indefinitely.

### 8.6 ConnectorResourceManifest

```text
ConnectorResourceManifest
  ptid, connector_id, oauth_connection_id, connection_revision
  resource_id, resource_version
  scopes[], tool_manifests[], status, expires_at?
```

Tokens remain in the OAuth owner. Expiry or scope loss invalidates readiness.

### 8.7 Evaluation Aggregate

```text
EvaluationBenchmark
  benchmark_id, ptid, name, rubric, revision
EvaluationDataset
  dataset_id, benchmark_id, ptid, name, revision
EvaluationTestCase
  case_id, dataset_id, input, expected, rubric_override?, revision
EvaluationRun
  run_id, ptid, idempotency_key, payload_hash, revision
  parent_run_id?, command_kind, mutation_scope
  cancel_intent_fence?, cancel_ack_deadline?, terminal_fence
  dataset_id, dataset_revision, target_agent_snapshot
  readiness_snapshot_id, status, progress
  metrics?, metrics_version?, metrics_comparability?
  created_at, terminal_at?
EvaluationCaseAttempt
  attempt_id, run_id, case_id, attempt, idempotency_key
  source_attempt_id?, source_result_id?
  turn_id, status, output_ref?, score?, error?
  cancellation_ack_at?, terminal_at?
EvaluationResult
  result_id, run_id, case_id, attempt_id
  output_ref, score, rubric_version, terminal_status, created_at
```

```text
draft -> pending -> running
running -> cancel_intent_committed -> cancelling -> cancelled | partial
running -> completed | partial | failed
partial/failed -> create child retry run -> pending
client projection -> restoring -> authoritative running/terminal readback
```

Unique constraints:

- `(ptid, command_kind, idempotency_key)` for mutations. `mutation_scope`
  and all command inputs are part of `payload_hash`; reusing the key for another
  resource/case set/snapshot returns `IDEMPOTENCY_CONFLICT`.
- `(run_id, case_id, attempt)` for attempts.
- one `EvaluationResult` per terminal attempt.
- one active scheduler claim per `(run_id, case_id, attempt)`.

Duplicate scheduler delivery returns the existing attempt/Turn. Terminal
EvaluationRun states never transition. `restoring` is a client projection state,
not an aggregate transition. Retry creates a child run containing selected
failed/incomplete cases and links `parent_run_id`; the parent remains terminal.
`mutation_scope` is audit/routing metadata, never part of idempotency
uniqueness. Create-run uses `dataset:<revision>:target:<snapshot>`;
update/start/cancel uses `run:<id>`; retry uses `parent-run:<id>`. The selected
case set is payload and therefore changes `payload_hash`. Create benchmark/dataset/case
uses `benchmark:create`, `benchmark:<id>:dataset:create`, or
`dataset:<id>:case:create`. Update/delete uses
`benchmark:<id>`, `dataset:<id>`, or `case:<id>`.

For each case, metrics use the terminal result from the highest accepted
attempt inside that run. Terminal status, terminal fence, metrics,
metrics_version, comparability, and revision freeze in one Station transaction.
Completed metrics are comparable. Partial/failed/cancelled metrics include only
terminal results and are marked non-comparable with coverage counts.

Cancel uses CAS `(run_id, expected_revision, status=running,
cancel_intent_fence=null)` to commit `cancel_intent_fence` and `cancelling`
before cancellation is dispatched. Completion CAS requires
`cancel_intent_fence=null`, so it cannot pass a committed cancellation intent.
Results committed before the intent remain. Non-terminal case Turns acknowledge
cancel before the terminal cancellation transaction atomically freezes status,
terminal fence, metrics/version/comparability, and run revision.

Pending runs cancel atomically without case acknowledgements. Running
cancellation has a bounded acknowledgement deadline. At deadline, Station
fences unresolved case Turns as `interrupted`; if all local/external cleanup is
confirmed the run becomes `cancelled`, otherwise it becomes `partial` with
typed `CANCEL_ACK_TIMEOUT`/cleanup errors and non-comparable coverage metrics.
It never remains `cancelling` indefinitely.

Child retry run records `parent_run_id`; each child attempt records exact
`source_attempt_id` and `source_result_id`. Parent metrics never change.

### 8.8 V2 Typed Errors

- Home: projection stale, slice unavailable, readiness unresolved.
- Catalog: manifest missing/version stale/schema invalid.
- Binding: version conflict, capability unavailable, policy invalid.
- Operation: executor unavailable, lease expired, cancelled, timeout,
  disconnected, cleanup failed, unknown side effect, stale fence.
- Connector: OAuth expired, scope denied, resource removed, manifest stale.
- Evaluation: dataset revision conflict, target snapshot invalid, run not
  cancellable, case retry conflict, evaluator unavailable.

### 8.9 Fenced Client Capability Execution

The core contract is accepted by `MCA-D19`. The recovery additions below are
accepted by `MCA-D19A`; G1-C remains blocked until they are generated
proto-first and implemented in Station.

`ClientCapabilityRequest` extends the portable execution envelope with:

```protobuf
message ClientCapabilityRequest {
  string request_id = 1;
  string turn_id = 2;
  string tool_call_id = 3;
  string capability_session_id = 4;
  string capability_id = 5;
  string schema_version = 6;
  repeated ClientResourceRef resource_refs = 7;
  bytes bounded_arguments = 8;
  string approval_id = 9;
  uint64 sequence = 10;
  string attempt_id = 11;
  string target_device_id = 12;
  string decision_id = 13;
  uint64 decision_revision = 14;
  string execution_claim_id = 15;
  string executor_lease_id = 16;
  uint64 fencing_token = 17;
  uint64 dispatch_sequence = 18;
  string payload_hash = 19;
  google.protobuf.Timestamp execution_deadline = 20;
  string tool_batch_id = 21;
  ClientExecutionReplayPolicy replay_policy = 22;
  string external_idempotency_key = 23;
  ReceiptRecoveryCredential recovery_credential = 24;
  google.protobuf.Timestamp reconciliation_deadline = 25;
  uint64 capability_lease_revision = 26;
}
```

```protobuf
enum ClientExecutionReplayPolicy {
  CLIENT_EXECUTION_REPLAY_POLICY_UNSPECIFIED = 0;
  CLIENT_EXECUTION_REPLAY_POLICY_NO_REPLAY_AFTER_PREPARED = 1;
  CLIENT_EXECUTION_REPLAY_POLICY_WITH_EXTERNAL_IDEMPOTENCY = 2;
}

message ReceiptRecoveryCredential {
  string credential_id = 1;
  string device_signing_key_id = 2;
  bytes nonce = 3;
  string scope_hash = 4;
  google.protobuf.Timestamp expires_at = 5;
}

message ReceiptRecoveryScopePayload {
  string actor_ptid = 1;
  string device_id = 2;
  string request_id = 3;
  string tool_call_id = 4;
  string execution_claim_id = 5;
  uint64 capability_lease_revision = 6;
  uint64 fencing_token = 7;
  string payload_hash = 8;
  ClientExecutionReplayPolicy replay_policy = 9;
  google.protobuf.Timestamp execution_deadline = 10;
  google.protobuf.Timestamp reconciliation_deadline = 11;
  string credential_id = 12;
  string device_signing_key_id = 13;
  bytes nonce = 14;
}
```

`scope_hash` is Station-computed over actor, device, request, ToolCall,
execution claim, lease revision, fence, payload hash, replay policy, and both
deadlines. It is descriptive input to the signature and is always checked
against the persisted credential row; it is not trusted from the client. The
terminal `result_id` is bound when the nonce CAS stores the first valid receipt
digest.

Envelope construction is two-stage to avoid a circular hash:

```text
payload_hash = SHA-256(
  deterministic-protobuf(
    ClientCapabilityRequest with
      payload_hash = ""
      recovery_credential = absent
  )
)
scope_hash = SHA-256(
  deterministic-protobuf(
    actor_id, device_id, request_id, tool_call_id, execution_claim_id,
    capability_lease_revision, fencing_token, payload_hash, replay_policy,
    execution_deadline, reconciliation_deadline, credential_id,
    device_signing_key_id, nonce
  )
)
```

Station computes `payload_hash` first, then creates the credential and
`scope_hash`, and commits both with the outbox. Client and Station verify the
same two-stage definition. The credential is integrity-checked against its
persisted row rather than recursively included in `payload_hash`.

The executor acknowledgement/result contract is:

```protobuf
enum ClientCapabilityReceiptStatus {
  CLIENT_CAPABILITY_RECEIPT_STATUS_UNSPECIFIED = 0;
  CLIENT_CAPABILITY_RECEIPT_STATUS_PREPARED = 1;
  CLIENT_CAPABILITY_RECEIPT_STATUS_APPLIED = 2;
  CLIENT_CAPABILITY_RECEIPT_STATUS_FAILED = 3;
  CLIENT_CAPABILITY_RECEIPT_STATUS_RECONCILED_UNKNOWN = 4;
}

message ClientCapabilityReceipt {
  string request_id = 1;
  string turn_id = 2;
  string tool_call_id = 3;
  string capability_session_id = 4;
  string target_device_id = 5;
  string decision_id = 6;
  uint64 decision_revision = 7;
  string execution_claim_id = 8;
  string executor_lease_id = 9;
  uint64 fencing_token = 10;
  uint64 dispatch_sequence = 11;
  string payload_hash = 12;
  string side_effect_receipt_id = 13;
  ClientCapabilityReceiptStatus status = 14;
  bytes bounded_result = 15;
  string error_code = 16;
  uint64 sequence = 17;
  google.protobuf.Timestamp occurred_at = 18;
  string result_id = 19;
  string tool_batch_id = 20;
  ReceiptRecoveryProof recovery_proof = 21;
}

message ReceiptRecoveryProof {
  string credential_id = 1;
  bytes nonce = 2;
  string device_signing_key_id = 3;
  bytes signature = 4;
}

message ReceiptRecoverySigningPayload {
  string domain = 1;
  string credential_id = 2;
  bytes nonce = 3;
  string device_signing_key_id = 4;
  string scope_hash = 5;
  bytes receipt_digest = 6;
}

message ClientCapabilityAdvertisement {
  string advertisement_id = 1;
  ClientPlatform platform = 2;
  repeated ClientCapability capabilities = 3;
  string connection_id = 4;
  string device_signing_key_id = 5;
  string device_id = 6;
}

message RegisterClientCapabilityLeaseRequest {
  reserved 1;
  reserved "lease";
  ClientCapabilityAdvertisement advertisement = 2;
  ClientCapabilityCommandProof command_proof = 3;
}

message RegisterClientCapabilityLeaseResponse {
  ClientCapabilityLease lease = 1;
  ClientCapabilityCommandErrorCode error_code = 2;
}

message RenewClientCapabilityLeaseRequest {
  string capability_session_id = 1;
  string lease_id = 2;
  uint64 expected_lease_revision = 3;
  string capability_set_hash = 4;
  string device_signing_key_id = 5;
  ClientCapabilityCommandProof command_proof = 6;
}

message RenewClientCapabilityLeaseResponse {
  ClientCapabilityLease lease = 1;
  ClientCapabilityCommandErrorCode error_code = 2;
}

enum ClientCapabilityLeaseRevokeReason {
  CLIENT_CAPABILITY_LEASE_REVOKE_REASON_UNSPECIFIED = 0;
  CLIENT_CAPABILITY_LEASE_REVOKE_REASON_USER_LOGOUT = 1;
  CLIENT_CAPABILITY_LEASE_REVOKE_REASON_STATION_SWITCH = 2;
  CLIENT_CAPABILITY_LEASE_REVOKE_REASON_WORKER_SHUTDOWN = 3;
  CLIENT_CAPABILITY_LEASE_REVOKE_REASON_DEVICE_KEY_REVOKED = 4;
  CLIENT_CAPABILITY_LEASE_REVOKE_REASON_ADMIN_POLICY = 5;
}

message RevokeClientCapabilityLeaseRequest {
  string capability_session_id = 1;
  string lease_id = 2;
  uint64 expected_lease_revision = 3;
  ClientCapabilityLeaseRevokeReason reason = 4;
  ClientCapabilityCommandProof command_proof = 5;
}

message RevokeClientCapabilityLeaseResponse {
  string capability_session_id = 1;
  string lease_id = 2;
  uint64 lease_revision = 3;
  google.protobuf.Timestamp revoked_at = 4;
  ClientCapabilityLeaseRevokeReason reason = 5;
  ClientCapabilityCommandErrorCode error_code = 6;
}

message PullClientCapabilityRequestsRequest {
  string capability_session_id = 1;
  string device_id = 2;
  uint64 after_sequence = 3;
  uint32 limit = 4;
  ClientCapabilityCommandProof command_proof = 5;
}

message PullClientCapabilityRequestsResponse {
  repeated ClientCapabilityRequest requests = 1;
  uint64 last_sequence = 2;
  ClientCapabilityCommandErrorCode error_code = 3;
}

message SubmitClientCapabilityReceiptRequest {
  ClientCapabilityReceipt receipt = 1;
  ClientCapabilityCommandProof command_proof = 2;
}

message SubmitClientCapabilityReceiptResponse {
  bool accepted = 1;
  bool replayed = 2;
  string result_id = 3;
  string continuation_id = 4;
  ClientCapabilityReceiptErrorCode error_code = 5;
  ClientCapabilityCommandErrorCode command_error_code = 6;
}

message SubmitClientCapabilityRecoveryReceiptRequest {
  ClientCapabilityReceipt receipt = 1;
}

message SubmitClientCapabilityRecoveryReceiptResponse {
  SubmitClientCapabilityReceiptResponse result = 1;
}
```

```protobuf
enum ClientCapabilityCommandDomain {
  CLIENT_CAPABILITY_COMMAND_DOMAIN_UNSPECIFIED = 0;
  CLIENT_CAPABILITY_COMMAND_DOMAIN_REGISTER_LEASE = 1;
  CLIENT_CAPABILITY_COMMAND_DOMAIN_RENEW_LEASE = 2;
  CLIENT_CAPABILITY_COMMAND_DOMAIN_REVOKE_LEASE = 3;
  CLIENT_CAPABILITY_COMMAND_DOMAIN_PULL_REQUESTS = 4;
  CLIENT_CAPABILITY_COMMAND_DOMAIN_SUBMIT_ACTIVE_RECEIPT = 5;
}

message ClientCapabilityCommandProof {
  string command_id = 1;
  string device_signing_key_id = 2;
  bytes nonce = 3;
  google.protobuf.Timestamp issued_at = 4;
  bytes signature = 5;
}

message ClientCapabilityCommandSigningPayload {
  ClientCapabilityCommandDomain domain = 1;
  string actor_ptid = 2;
  string device_id = 3;
  string command_id = 4;
  bytes body_hash = 5;
  bytes nonce = 6;
  google.protobuf.Timestamp issued_at = 7;
}

enum ClientCapabilityCommandErrorCode {
  CLIENT_CAPABILITY_COMMAND_ERROR_CODE_UNSPECIFIED = 0;
  CLIENT_CAPABILITY_COMMAND_ERROR_CODE_PROOF_REQUIRED = 1;
  CLIENT_CAPABILITY_COMMAND_ERROR_CODE_KEY_NOT_FOUND = 2;
  CLIENT_CAPABILITY_COMMAND_ERROR_CODE_DEVICE_KEY_REVOKED = 3;
  CLIENT_CAPABILITY_COMMAND_ERROR_CODE_SIGNATURE_INVALID = 4;
  CLIENT_CAPABILITY_COMMAND_ERROR_CODE_PROOF_EXPIRED = 5;
  CLIENT_CAPABILITY_COMMAND_ERROR_CODE_NONCE_CONFLICT = 6;
  CLIENT_CAPABILITY_COMMAND_ERROR_CODE_BODY_CONFLICT = 7;
}
```

Typed Station endpoints:

```text
POST /agent/capability/lease/register
POST /agent/capability/lease/renew
POST /agent/capability/lease/revoke
POST /agent/capability/requests/pull
POST /agent/capability/receipt
POST /agent/capability/receipt/recover
```

The active receipt endpoint requires actor JWT plus capability command proof.
The recovery endpoint requires a terminal receipt plus D19A recovery proof and
does not require a live actor JWT. It derives actor/device/key from the
persisted credential and ignores header identity. Both endpoints invoke the
same terminal-result CAS. Recovery is not exposed as an execution or lease
endpoint.

The active endpoint rejects `recovery_proof`; the recovery endpoint requires it
and has no generic command-proof field. This endpoint split prevents proof-mode
downgrade.

Canonical capability-command signing:

```text
body_hash = SHA-256(
  deterministic-protobuf(request with command_proof absent)
)
signed_bytes = deterministic-protobuf(
  ClientCapabilityCommandSigningPayload {
    domain,
    authenticated_actor_ptid,
    request_or_lease_device_id,
    command_id,
    body_hash,
    nonce,
    issued_at
  }
)
signature = Ed25519.sign(actor_device_private_key, signed_bytes)
```

Station resolves the current verified key by authenticated actor, signed device
ID, and signing-key ID. `X-Device-ID` must equal the signed device ID but never
selects authority. Proof age may differ from Station time by at most 60 seconds.

The new messages and field numbers above are reserved by accepted D19A.
Registration field 1 is retired rather than reused: an old embedded
`ClientCapabilityLease` payload must decode with no advertisement and fail
closed. Renaming wire field 20 from `deadline` to `execution_deadline`
preserves its field number and changes its semantics explicitly. No handwritten
transport type may replace this shared contract.

Canonical recovery signature:

```text
domain = "peers-touch/agent/tool-receipt-recovery/v1"
receipt_digest = SHA-256(
  deterministic-protobuf(ClientCapabilityReceipt without recovery_proof)
)
signed_bytes = deterministic-protobuf(
  ReceiptRecoverySigningPayload
)
signature = Ed25519.sign(actor_device_private_key, signed_bytes)
```

Station loads actor/device from the persisted credential, resolves the active
verified key by `(actor, device, device_signing_key_id)`, recomputes both
hashes, and verifies the signature. Client-supplied or header actor/device
fields never select the recovery key.

State transitions:

```text
ToolCall:
  waiting_approval
    -> approved/denied/expired
  approved
    -> dispatch_committed
  dispatch_committed
    -> prepared
  prepared
    -> applied | failed | unknown_side_effect
  applied
    -> result_committed
  result_committed
    -> batch_settled

ToolBatch:
  open
    -> ready_for_continuation | blocked

TurnContinuation:
  ready
    -> claimed
  claimed
    -> completed | ready | reconciliation_required

ReceiptAttempt:
  none -> PREPARED -> APPLIED | FAILED | RECONCILED_UNKNOWN

RecoveryCredential:
  issued -> consumed
  issued -> expired | invalidated_by_device_key_revoke

CapabilityCommand:
  unseen -> verified -> committed
  verified -> identical_replay
  verified -> nonce_conflict | expired | key_revoked
```

Transactional invariants:

- Decision submission uses
  `(approval_id, tool_call_id, decision_id, expected_revision,
  idempotency_key, payload_hash)`.
- The first valid decision increments `decision_revision`. Repeating the same
  key and payload returns the original decision acknowledgement. Reusing the
  key with another payload returns `IDEMPOTENCY_CONFLICT`; a stale expected
  revision returns `STALE_REVISION`.
- Decision, claim, dispatch sequence, and one targeted outbox envelope are
  committed before delivery. The same transaction persists one recovery
  credential/nonce record. No client claim command exists.
- Envelope payload and recovery scope use the two-stage canonical hashes above;
  neither implementation may hash a self-referential credential structure.
- `(tool_call_id, fencing_token)` identifies one receipt attempt;
  `(request_id, payload_hash)` is immutable.
- `result_id` identifies the immutable terminal payload for one ToolCall.
  `(tool_call_id, result_id)` is unique, and a ToolCall accepts at most one
  terminal result.
- `tool_batch_id` identifies all ToolCalls parsed from one provider response
  under one Turn attempt. It is generated and persisted by Station before any
  member dispatch.
- `PREPARED` is persisted by the selected client kernel before side effects.
  A duplicate envelope returns the existing receipt/result.
- `PREPARED` is accepted only from the bound actor/device/session/lease
  revision/claim/fence before `execution_deadline`.
- A terminal receipt before `execution_deadline` may use the active lease. A
  terminal receipt after lease revoke/expiry or execution-deadline expiry
  requires a valid recovery proof, matching PREPARED row, and unexpired
  `reconciliation_deadline`.
- Recovery accepts only `APPLIED|FAILED|RECONCILED_UNKNOWN`; it cannot create
  PREPARED, renew a lease, request work, redispatch, or continue a Turn.
- Nonce consumption and terminal ToolResult CAS are one transaction. Identical
  digest replay returns the stored acknowledgement; another digest returns
  `RECOVERY_NONCE_CONFLICT`.
- A late valid `APPLIED` receipt records the authoritative side-effect fact,
  but a cancelled, expired, or otherwise blocked Turn/ToolBatch remains blocked
  and cannot gain a continuation.
- For such a late receipt, immutable `ToolResult` stores the observed APPLIED
  fact while the already-terminal ToolCall/Turn lifecycle state remains
  cancelled or expired. Result truth does not rewrite lifecycle truth.
- Register, renew, revoke, pull, and active-lease receipt paths verify a
  capability command proof before reading or mutating lease/outbox/result
  authority.
- The command ledger binds `(actor_id, device_id, signing_key_id, nonce)` to one
  command ID and body digest. Identical write replay reconstructs the same
  durable response; another digest conflicts. Identical pull may re-read the
  same `after_sequence`.
- Revoking the verified device key invalidates all subsequent generic command
  proofs and recovery proofs for that key.
- Key revocation is checked synchronously on every proof verification.
  Outstanding PREPARED calls need no cross-subserver mutation hook; the
  reconciliation worker settles them UNKNOWN at deadline when no valid proof
  can arrive.
- Each terminal receipt commits its unique ToolCall result atomically. When the
  submitted receipt is the final member of a batch and every member is
  `APPLIED`, the same transaction marks the batch ready and creates the unique
  continuation key `(turn_id, attempt_id, tool_batch_id)`.
- A batch containing `DENIED`, `EXPIRED`, `FAILED`, `CANCELLED`, or
  `RECONCILED_UNKNOWN` becomes `blocked` and creates no automatic
  continuation. "Continue without tool" is a separate explicit recovery
  command and therefore cannot reuse or mutate the blocked continuation key.
- Duplicate result delivery returns the original acknowledgement. It cannot
  append a second ToolResult event or schedule another model step.
- A Station continuation worker claims `ready` rows with a durable lease. An
  expired claim returns to `ready` only when no provider request was emitted.
  After provider request emission, replay uses the continuation key as provider
  idempotency identity when supported; otherwise an ambiguous crash becomes
  `reconciliation_required` and is never retried automatically.
- Completion persists the provider response and marks the continuation
  `completed` in one transaction. Restart recovery scans only `ready`, expired
  pre-emission claims, and provider-idempotent emitted claims.
- Lease takeover before `PREPARED` increments the fence and may redispatch.
  After `PREPARED`, takeover requires external idempotency; otherwise the
  terminal outcome is `UNKNOWN_SIDE_EFFECT`.
- Post-restart execution is never authorized by the local receipt ledger or
  recovery credential. For `REPLAY_WITH_EXTERNAL_IDEMPOTENCY`, Station may
  CAS-take over a PREPARED ToolCall only under a current matching lease and
  before the original execution deadline. It keeps ToolCall/decision/claim,
  immutable arguments, and the external idempotency key; increments the fence;
  rebinds lease/session/revision; and issues a new request/outbox envelope,
  payload hash, and recovery credential.
- The takeover transaction invalidates the prior recovery credential. Old-fence
  terminal submissions are audit-only rejects. Resource-bearing takeover fails
  closed until a separate cross-session resource-rebind contract is accepted.
- `NO_REPLAY_AFTER_PREPARED` never executes again after restart.
  `REPLAY_WITH_EXTERNAL_IDEMPOTENCY` requires a non-empty key and reuses that
  exact key; an unspecified policy fails closed.
- Reconciliation deadline expiry or device signing-key revoke converts
  unresolved PREPARED work to `UNKNOWN_SIDE_EFFECT` without continuation.

Delivery uses a Station-owned targeted capability-session outbox/stream. A
TurnEvent may project proposal, decision, and terminal result to Web, but the
executable envelope is consumed by the client capability kernel and is never a
Web execution command. Actor identity is derived from authenticated transport
context for lease registration, targeted pull, and receipt submission; it is
never accepted from these request bodies.

Station persistence adds:

```text
ClientCapabilityLease:
  actor_id, device_id, capability_session_id, lease_id, lease_revision
  capability_set_hash, device_signing_key_id, connection_id
  expires_at, revoked_at?, revoke_reason?

ReceiptRecoveryCredential:
  credential_id, actor_id, device_id, device_signing_key_id
  request_id, tool_call_id, execution_claim_id, capability_lease_revision
  fencing_token, payload_hash, replay_policy
  scope_hash, nonce_hash, issued_at, expires_at
  consumed_receipt_digest?, consumed_result_id?, consumed_ack_ref?
  consumed_at?, invalidated_at?

ClientCapabilityCommand:
  actor_id, device_id, device_signing_key_id, nonce_hash
  command_id, command_domain, body_hash, issued_at
  outcome_code, lease_id?, lease_revision?, response_ref?
  committed_at, expires_at
```

Unique constraints:

- one active lease revision per `(actor_id, device_id,
  capability_session_id, lease_id)`;
- one recovery credential per `(tool_call_id, fencing_token)`;
- one consumed terminal digest per credential nonce;
- one terminal result per ToolCall.
- one command digest per `(actor_id, device_id, device_signing_key_id,
  nonce_hash)`;

Typed receipt errors add `RECOVERY_REQUIRED = 8`,
`RECOVERY_CREDENTIAL_EXPIRED = 9`, `RECOVERY_SCOPE_MISMATCH = 10`,
`RECOVERY_SIGNATURE_INVALID = 11`, `RECOVERY_DEVICE_KEY_REVOKED = 12`, and
`RECOVERY_NONCE_CONFLICT = 13`.

### 8.10 Runtime Advertisement And Activity Snapshots

MCA-D19D adds production readback contracts:

```protobuf
enum RuntimeAdvertisementState {
  RUNTIME_ADVERTISEMENT_STATE_UNSPECIFIED = 0;
  RUNTIME_ADVERTISEMENT_STATE_READY = 1;
  RUNTIME_ADVERTISEMENT_STATE_DEGRADED = 2;
  RUNTIME_ADVERTISEMENT_STATE_NOT_ADVERTISED = 3;
  RUNTIME_ADVERTISEMENT_STATE_BLOCKED = 4;
}

message EffectiveRuntimeAdvertisement {
  RuntimeKind runtime_kind = 1;
  string runtime_id = 2;
  RuntimeAdvertisementState state = 3;
  string reason_code = 4;
}

message EffectiveRuntimeProfileSnapshot {
  string snapshot_id = 1;
  string ptid = 2;
  string agent_id = 3;
  string profile_id = 4;
  uint64 profile_revision = 5;
  string readiness_snapshot_id = 6;
  repeated EffectiveRuntimeAdvertisement runtimes = 7;
  google.protobuf.Timestamp observed_at = 8;
}

message RuntimeActivityCounters {
  uint64 runtime_bindings_created = 1;
  uint64 external_sessions_created = 2;
  uint64 runtime_homes_created = 3;
  uint64 processes_started = 4;
  uint64 workspaces_created = 5;
}

message RuntimeActivitySnapshot {
  string snapshot_id = 1;
  string owner = 2;
  string owner_instance_id = 3;
  string ptid = 4;
  RuntimeKind runtime_kind = 5;
  string runtime_id = 6;
  string counter_epoch = 7;
  RuntimeActivityCounters counters = 8;
  google.protobuf.Timestamp observed_at = 9;
}
```

Rules:

- Station returns every known conditional runtime candidate explicitly; omitted
  rows are `UNKNOWN`, never `NOT_ADVERTISED`.
- `runtime_id` identifies a registered candidate such as `external-agent` or
  `trae-cli`; it is not a command or executable path.
- Station activity counters are actor-scoped and monotonic within the Station
  counter epoch.
- Desktop activity counters are actor/device/boot-scoped and monotonic within
  the Desktop boot epoch.
- Snapshot requests are read-only and expose no reset, decrement, or arbitrary
  actor selector.
- Counter comparison requires equal owner, owner instance, actor, epoch,
  profile revision, and readiness snapshot identity.
- Values contain no local path, PID, command line, credential, or secret.

### 8.11 Trusted Package Catalog Snapshot

MCA-D20 defines an exact-byte signed discovery contract:

```text
CatalogTrustRoot:
  source_id, publisher_id
  signing_key_id, public_key
  trust_class

CatalogTransport:
  official_station:
    endpoint_path, distribution_id
  user_pinned_github:
    repository, branch, manifest_path

CatalogSourceRegistration:
  display_name, built_in, enabled
  trust_root
  transport

CatalogEnvelopeV1:
  schema_version = "peers.package-catalog.envelope.v1"
  payload_base64
  signing_key_id
  signature_base64

CatalogSnapshotV1 payload:
  schema_version = "peers.package-catalog.v1"
  source_id, publisher_id, revision, generated_at
  revoked_at?
  packages[]

CatalogPackageV1:
  package_id, package_type, version
  name, description, publisher_id
  artifact_encoding, artifact_content, artifact_sha256
  license?, homepage?, repository?, keywords[]
  revoked_at?
```

The Ed25519 signature covers the exact decoded `payload_base64` bytes with
domain separator `peers-touch/package-catalog/v1\0`. The verifier resolves the
public key only from `CatalogTrustRoot`, checks that envelope key ID matches the
pinned key, then validates source ID, publisher ID, schema, revision, package
IDs, semantic versions, artifact encodings, artifact hashes, and bounded sizes.
Transport metadata cannot modify the trust root.

MCA-D20A adds one proto-first Station distribution response:

```text
GetOfficialPackageCatalogResponse:
  envelope_json
  media_type = "application/json"
  distribution_id = "peers-official-station-v1"
  envelope_sha256
```

`envelope_sha256` validates transport bytes but never substitutes for the
publisher signature. The official endpoint is side-effect free and returns one
immutable envelope per Station build. An old Station, timeout, authentication
failure, invalid digest, invalid signature, or rollback leaves the last
verified snapshot visible only as stale.

The canonical signed asset is
`packages/agent-catalog/official-catalog.v1.envelope.json`. Desktop bootstrap
reads it directly; the Station byte projection is generated and must match it
exactly.

Derived projection fields are never accepted from the payload:

```text
signature_status = verified | invalid
trust_level      = official | user_pinned
scan_verdict     = passed | blocked
risk_level       = low | medium | high
install_policy   = allowed | confirmation_required | blocked
```

Pagination tokens bind source ID, immutable revision, filter, and next offset.
A token from another source/revision/filter is invalid. List responses never
mix revisions.

`MarketInstallRecord` is a cache/reconciliation record:

```text
source_id, catalog_revision, package_id, package_version
artifact_sha256, package_type
target_authority, target_id
installed_at, last_readback_at
revoked_at?
```

It may report `installed=true` only after target-authority readback succeeds.
Agent and Skill targets are Station-owned; MCP targets are owned by the
actor-scoped Desktop Rust MCP store. Catalog revocation blocks new mutation but
does not delete the target. Explicit uninstall deletes through the same target
authority and removes the ledger record only after absence readback.

### 8.12 Formal Scenario Evidence

MCA-D21 makes one expanded runtime-matrix tuple the atomic evidence identity:

```text
ScenarioTuple:
  gate, row, platform, runtime
  cell, locale, ordering, sample_id

ScenarioExecution:
  scenario_execution_id
  tuple
  attestation_profile
  source_identity
  observed_at
  runtime_facts

RoleObservation:
  scenario_execution_id
  runtime_tuple_key
  role
  oracle_assertion_id
  observed_facts
```

`scenario_execution_id` is unique inside one Gate candidate. All role
observations for a tuple reference that ID. A primary command, Turn, ToolCall,
operation, Evaluation run, or contract-run identity cannot appear under a
second executable tuple.

The supported profiles are:

- `station_command`
- `station_control_plane`
- `station_turn`
- `client_capability_turn`
- `station_capability_turn`
- `contract_only`
- `unavailable_runtime`
- `orchestration_guard`
- `non_advertised`

Profiles contain only entities created by their production path. In
particular, `station_command`, `station_control_plane`, `contract_only`, and
`unavailable_runtime` never carry a synthetic TurnAttempt, ToolCall, client
lease, or receipt. `station_capability_turn` identifies the Station executor
without presenting it as a client device lease.

Each matrix row owns a complete role-policy partition:

```text
always + required + not_applicable = Gate scenario roles
```

The sets are disjoint. The validator compares every role's observation keys to
the exact applicable tuple set and rejects missing, extra, duplicate, or
cross-execution observations.

### 8.13 Agent Acceptance Scenario State

MCA-D22 through MCA-D24 define one ephemeral Station-owned scenario state that
exists only while an authorized Acceptance run is active:

```text
AgentAcceptanceScenario:
  run_id
  scenario_execution_id
  actor_ptid
  family = binding_j02 | governed_tool_j03 | mcp_j04 |
           connector_j05 | evaluation_j06
  runtime_attestation_profile
  cell
  platform
  locale
  ordering
  sample_id
  scenario_handle
  resource_ids[]
  active_barrier?
  selected_executor?
  executor_hook_ticket_digest?
  clock_milestone?
  created_at
```

This state is process-local coordination, not product truth or durable
evidence. Product manifests, bindings, readiness snapshots, ToolCalls,
receipts, MCP processes, Connector resources, Evaluation runs/results/metrics,
typed failures, and activity counters remain in their canonical owners. A
Station restart invalidates every handle except when the reviewed cell
explicitly requires handle restoration, and cleanup is idempotent.

The setup response exposes only opaque resource identities and a source
inventory hash. A selected executor may receive one short-lived, single-use
hook ticket whose secret is not evidence. Setup, barrier, clock, interruption,
and cleanup responses cannot contain expected outcomes, assertion booleans,
evidence roles, or candidate status.

The server derives every allowed barrier, lifecycle action, provider response
class, and clock milestone from the reviewed tuple. Callers cannot submit raw
methods, paths, SQL, timestamps, durations, state values, or expected results.
J03-J05 executor/provider hooks remain subordinate to the Station handle. J06
barriers observe canonical Evaluation CAS boundaries and cannot choose their
winner.

Capability catalog and binding failures use the existing enum families:

```text
CapabilityCatalogErrorCode:
  MANIFEST_MISSING
  MANIFEST_VERSION_STALE
  SCHEMA_INVALID

CapabilityBindingErrorCode:
  VERSION_CONFLICT
  CAPABILITY_UNAVAILABLE
  POLICY_INVALID
```

Their transport projection follows the shared typed-error contract: exact
stable code, locale key, retryability, terminality, and an allowlisted detail
map. Rejected commands preserve the latest authority revision and have zero
runtime execution count.
