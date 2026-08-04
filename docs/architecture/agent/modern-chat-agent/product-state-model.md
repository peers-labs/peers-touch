# Modern Chat Agent — Product State Model

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-07-30 | **Updated**: 2026-07-30
> **Owner**: Peers-Touch Agent Team

---

## 1. State Ownership

These are user-observable product states. Architecture documents define their
runtime representation.

| State family | Product owner | User question answered |
|---|---|---|
| Agent readiness | Agent context header/profile | Can this Agent handle my request now? |
| Topic lifecycle | Topic rail | Where will this work be saved? |
| Turn lifecycle | Timeline | What is the Agent doing and is it finished? |
| Composer/admission | Composer | Has my intent been accepted? |
| Capability/trust | Context header/recovery layer | What is supported, by whom, and with what limits? |
| Tool intervention | Timeline approval card | What action needs my decision? |
| Resource admission | Composer/resource chip | Is this file usable and retained? |
| Recovery | Timeline/recovery layer | What survived and what can I do next? |

## 2. Agent Readiness

```text
UNKNOWN -> CHECKING -> READY
                    -> DEGRADED
                    -> BLOCKED
```

| State | Meaning | Allowed actions |
|---|---|---|
| `UNKNOWN` | No current readiness fact | Select Agent; refresh |
| `CHECKING` | Provider/runtime/capability facts resolving | Edit draft; cancel navigation |
| `READY` | Required capabilities available | Send |
| `DEGRADED` | Usable with disclosed reduced capability | Review degradation; send if compatible |
| `BLOCKED` | Required config/runtime unavailable | Open contextual recovery |

The send action cannot silently bypass `BLOCKED`.

## 3. Topic Lifecycle

```text
LOCAL_DRAFT -> ACCEPTING_FIRST_TURN -> ACTIVE -> ARCHIVED -> DELETED
                    |                  |
                    +-> REJECTED       +-> RECOVERING
```

- `LOCAL_DRAFT` is not durable conversation truth.
- `REJECTED` preserves composer input and does not create an empty topic.
- `RECOVERING` means the topic exists but its current projection is stale.
- `DELETED` requires explicit destructive confirmation and retention policy.

## 4. Composer And Admission

```text
EMPTY <-> DIRTY
DIRTY -> VALIDATING -> READY_TO_SEND
                    -> INVALID
READY_TO_SEND -> SUBMITTING -> ACCEPTED
                            -> QUEUED
                            -> REJECTED
```

Rules:

- `SUBMITTING` must not clear the draft before acceptance.
- `ACCEPTED` moves the user message into the authoritative timeline.
- `QUEUED` keeps edit/delete/promote controls and position.
- `REJECTED` restores editable text, target, and valid attachments.

## 5. Turn And Timeline

```text
ACCEPTED -> QUEUED | STARTING -> STREAMING
STREAMING -> WAITING_APPROVAL | WAITING_TOOL | COMPRESSING | RETRYING
          -> COMPLETED | PARTIAL | FAILED | CANCELLED | INTERRUPTED
```

| State | Required visible behavior |
|---|---|
| `QUEUED` | Queue position and controls |
| `STARTING` | Stable message geometry and cancel action |
| `STREAMING` | Progressive content/activity and current runtime status |
| `WAITING_APPROVAL` | Blocking decision card in the reading path |
| `WAITING_TOOL` | Tool identity, progress, and cancelability |
| `COMPRESSING` | Context maintenance status without false completion |
| `RETRYING` | Attempt number/reason and retained partial-state policy |
| `COMPLETED` | Final answer and evidence/usage affordances |
| `PARTIAL` | Retained output plus explicit incomplete reason |
| `FAILED` | Typed cause, preserved input, valid recovery |
| `CANCELLED` | Who/what cancelled and whether partial output remains |
| `INTERRUPTED` | Runtime stopped without confirmed normal completion |

Only `COMPLETED` communicates success.

## 6. Tool Intervention

```text
PROPOSED -> POLICY_CHECK
POLICY_CHECK -> AUTO_APPROVED -> RUNNING
             -> AWAITING_USER -> APPROVED -> RUNNING
                              -> DENIED
                              -> EXPIRED
RUNNING -> SUCCEEDED | FAILED | CANCELLED
```

Card requirements:

- Tool and operation.
- Execution authority/device.
- Target and bounded argument summary.
- Risk and consequence.
- Approval expiry.
- Progress and terminal result.

Repeated delivery cannot create a second execution or second decision.

## 7. Attachment And Resource

```text
SELECTED -> VALIDATING -> UPLOADING -> READY
                     \-> REJECTED
UPLOADING -> FAILED -> RETRYING
READY -> ATTACHED -> CONSUMED | OMITTED
```

- `OMITTED` states why the runtime excluded the resource.
- Removing one failed resource does not clear valid draft resources.
- Client-local paths are never displayed as shared durable identity.

## 8. Capability And Trust

Use the shared taxonomy:

- `known`: authoritative capability fact available.
- `pending`: resolution or mutation not yet confirmed.
- `degraded`: reduced path available.
- `unavailable`: not available for the selected runtime/device.
- `unknown`: insufficient evidence; do not infer support.
- `blocked`: policy or required capability prevents action.

Capability state must name its authority: Station runtime snapshot, client
capability session, provider, or user policy.

## 9. Disconnect And Recovery

```text
CONNECTED -> CONNECTION_LOST -> RECONNECTING
RECONNECTING -> REPLAYING -> RECONCILING -> CONNECTED
             -> RECOVERY_FAILED
```

- Connection loss does not imply turn failure.
- Replay may redeliver events; the visible projection remains idempotent.
- `RECOVERY_FAILED` offers retry and durable snapshot reload.
- A stale client must not overwrite a newer topic, branch, or Agent config.

## 10. Branch And Revision

```text
ACTIVE_BRANCH
  -> RETRY_ATTEMPT       # same turn, failed execution recovery
  -> REGENERATE_BRANCH   # new assistant sibling
  -> EDIT_RESEND_BRANCH  # new user branch
```

The branch selector shows alternatives without duplicating the entire topic
rail. Delete is never presented as retry or regenerate.

## 11. Forbidden Product Transitions

- `LOCAL_DRAFT -> ACTIVE` before Station accepts the first turn.
- `WAITING_APPROVAL -> SUCCEEDED` without an authoritative decision and result.
- `CONNECTION_LOST -> FAILED` based only on client transport loss.
- `DEGRADED -> READY` without a fresh capability fact.
- `PARTIAL/FAILED/CANCELLED -> COMPLETED` by client inference.
- `REGENERATE_BRANCH -> destructive replacement of the source response`.
- `REJECTED attachment -> silent omission`.
