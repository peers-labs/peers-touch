# MCA-D29 - Stateful External Agent Runtime Lifecycle

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-10-01 | **Updated**: 2026-10-01
> **Owner**: Peers-Touch Agent Team
> **Decision**: MCA-D29

---

## 1. Product Decision

The Owner selected full implementation of MCA-P12 on 2026-10-01.

MCA-P12 remains `optional-advertised`: Direct Model stays the default, while a
stateful external Agent appears only when one registered session-capable
adapter is healthy. Once advertised, its complete create, resume, restart,
reset, isolation, activity, and cleanup lifecycle is required.

The first implementation uses the Peers-owned `external-agent` runtime ID and
a generic session CLI protocol. Vendor adapters translate their native JSONL
events and commands behind that protocol; vendor names do not become the
architecture identity.

## 2. User Journey

1. The runtime selector shows External Agent only when Station reports it
   `READY`.
2. The first accepted Turn creates one conversation-owned runtime home and one
   external session.
3. A follow-up resumes that exact session and preserves its epoch.
4. Station restart keeps the binding durable; the next follow-up resumes from
   the persisted handle.
5. If the adapter cannot resume, the Turn ends with
   `RUNTIME_RESUME_UNAVAILABLE` and a visible `Confirm reset` action.
6. The old epoch, session, and runtime home remain unchanged until the user
   confirms.
7. Confirmation runs an idempotent cleanup command, removes the old runtime
   home, increments the epoch, clears the session handle, and returns the
   authoritative Conversation.
8. The next Turn creates a fresh external session in the new epoch.

Cancellation terminates the current process group without resetting the
session. Conversation deletion requires the same external cleanup closure.

## 3. Ownership

| Concern | Owner |
|---|---|
| Conversation runtime binding and epoch | Station Agent Runtime Authority |
| Runtime-home identity and path resolution | Station External Runtime Manager |
| External session handle | Station, persisted only as opaque binding state |
| Process start, resume, cancellation, and cleanup | Station External Runtime Manager |
| Provider credentials and adapter configuration | Station deployment/config owners |
| Visible runtime state and reset confirmation | Desktop/Browser projection |
| Turn, messages, events, trace, and terminal outcome | Station Turn kernel |

The external process never becomes Conversation, Message, Turn, or tool-policy
truth.

## 4. Session CLI Contract

Station launches argv directly without a shell. Configuration supplies bounded
JSON arrays for `start`, `resume`, and `reset`; `{session_id}` and
`{runtime_home}` are the only substitutions.

The process receives:

```text
PEERS_TOUCH_AGENT_ID
PEERS_TOUCH_CONVERSATION_ID
PEERS_TOUCH_RUNTIME_PROFILE_ID
PEERS_TOUCH_EXTERNAL_SESSION_EPOCH
PEERS_TOUCH_EXTERNAL_RUNTIME_HOME
```

The JSONL protocol accepts:

```json
{"type":"session.started","session_id":"opaque-id"}
{"type":"text.delta","content":"partial text"}
{"type":"activity","activity":{"id":"a1","kind":"command","status":"running","title":"Run tests","detail":"bounded summary"}}
{"type":"turn.completed","content":"final text"}
{"type":"turn.failed","code":"resume_unavailable","message":"safe summary"}
```

Vendor adapters may translate equivalent native events such as
`thread.started` and `item.completed`, but the Station-facing result is the
same closed protocol. Output, line, event-count, duration, and process-tree
limits are mandatory.

## 5. Binding State Machine

```text
UNBOUND -> READY(epoch=1, session="")
READY(session="") -> STARTING -> READY(session=id)
READY(session=id) -> RESUMING -> READY(session=id)
RESUMING -> RESUME_UNAVAILABLE
RESUME_UNAVAILABLE -> RESET_PREPARED
RESET_PREPARED -> CLEANING -> READY(epoch+1, session="")
                           -> CLEANUP_FAILED
CLEANUP_FAILED -> CLEANING
```

`RESUME_UNAVAILABLE`, `RESET_PREPARED`, and `CLEANUP_FAILED` reject new Turn
execution. No path automatically creates a new session after resume failure.

## 6. Reset Transaction

`ResetConversationRuntime` requires:

- authenticated actor ownership;
- external runtime binding;
- expected Conversation version;
- client idempotency key;
- explicit destructive confirmation;
- no active Turn, queued Turn, unresolved ToolCall, or existing reset command.

The command is two-phase:

1. Transactionally persist `RESET_PREPARED`, the old epoch/session/home tuple,
   payload hash, and a reset fence.
2. Outside the database transaction, terminate the matching process/session
   and remove the resolved runtime home.
3. Transactionally compare the reset fence and old tuple, increment the epoch,
   clear the external session ID, assign the next opaque runtime-home
   reference, mark the binding `READY`, increment Conversation version, persist
   the response, and emit one runtime-reset event.

Failure persists `CLEANUP_FAILED`; retry of the same command continues cleanup.
An identical committed replay returns the original response. A changed payload
under the same idempotency key returns `IDEMPOTENCY_CONFLICT`.
Concurrent delivery of one actor/idempotency key is serialized so only one
caller may enter external cleanup; later callers replay the committed receipt.

## 7. Security And Isolation

- Runtime-home paths are derived from hashes of actor, Conversation, and epoch;
  clients receive only the opaque reference.
- No shell interpolation is used.
- Adapter argv, environment names, executable allow-list, and output schema are
  deployment-owned.
- Child processes receive an allowlisted environment only.
- Two Conversations never share a writable home or external session.
- Browser invokes Station only; it never starts or claims an external process.
- Reset and deletion are actor-scoped, version-fenced, and idempotent.
- Logs and evidence redact prompts, credentials, paths, and raw vendor errors.

## 8. Evidence Contract

The P12 functional closure must prove:

- two Conversations obtain distinct homes and session IDs;
- a follow-up and post-Station-restart follow-up resume the same session/epoch;
- a real adapter resume failure emits `RUNTIME_RESUME_UNAVAILABLE`;
- both locales render `Confirm reset`;
- no epoch/session/home mutation occurs before confirmation;
- confirmed reset cleans the old process/session/home exactly once;
- reset replay is idempotent and conflicting replay is rejected;
- the next Turn creates a new session under epoch + 1;
- Browser observes the same Station truth without local process activity;
- cancellation, reset failure, and final cleanup leave no process or runtime
  home leak.

Development evidence remains `FUNCTIONAL_CHECK`; only MCA-A08 may promote the
final Foundation Gate to `PROVEN`.

## 9. Rejected Alternatives

- Treat a stateless Direct Model retry as external resume: rejected because it
  fabricates state that the runtime does not own.
- Auto-reset after resume failure: rejected because reset is destructive.
- Let Desktop own session IDs or runtime homes: rejected because Browser and
  restart behavior would diverge.
- Store raw runtime-home paths in client contracts: rejected as a privacy and
  portability violation.
- Keep P12 advertised with partial lifecycle support: rejected by the
  `optional-advertised` product contract.

## 10. Review Result

The Owner selected full P12 implementation on 2026-10-01. The separate
findings-first review in
`20261001-mca-d29-stateful-external-runtime-review.md` accepted this contract
for implementation.
