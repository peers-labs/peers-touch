# Modern Chat Agent — Data Model

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-07-30 | **Updated**: 2026-08-17
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
ACTIVE -> ARCHIVED -> DELETED
```

`DELETED` first creates an actor-inaccessible tombstone and fences new
admission. Hard deletion occurs only after active turns/operations are terminal
and runtime cleanup is acknowledged. Trace/evidence snapshots follow the
explicit rules in §6.

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

`TurnAttempt` pins `capability_readiness_snapshot_id`. Every `ToolCall` pins
`capability_id`, `capability_version`, `binding_id`, `binding_revision`, and
`readiness_snapshot_id`; replay and diagnostics never resolve these from the
current Agent configuration.

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
| `manifest_id`, `manifest_version` | Immutable capability contract |
| `binding_id`, `binding_revision`, `readiness_snapshot_id` | Admission facts |
| `approval_id`, `decision_id`, `decision` | Unique human/policy decision |
| `execution_claim_id`, `executor_lease_id`, `fencing_token` | Side-effect ownership |
| `side_effect_receipt_id`, `external_idempotency_key` | Crash-safe execution receipt |
| `dispatch_sequence`, `dispatch_committed_at`, `payload_hash`, `deadline` | Deduplication and linearization |
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
- executor validates claim, lease, fence, payload hash, and deadline before
  side effects;
- external calls use `tool_call_id` as idempotency key when supported;
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
  string ptid = 2;
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

### RegenerateTurn

Requires source assistant message. Creates a new turn and sibling branch. It
does not delete the source response.

### ResetConversationRuntime

Valid only for a stateful external runtime. Requires expected conversation
version and explicit destructive confirmation. It terminates the current
external-session epoch, cleans runtime state, increments epoch, and clears the
resume handle.

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
