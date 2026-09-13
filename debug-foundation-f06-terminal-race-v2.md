# Debug Session: foundation-f06-terminal-race-v2
- **Status**: [OPEN]
- **Issue**: The unchanged 419-cell Foundation Gate fails in Browser English AS-F06 preparation because the recovery Turn is already terminal before the transport-cut scenario can take ownership.
- **Debug Server**: http://127.0.0.1:7780/event
- **Log File**: .dbg/trae-debug-log-foundation-f06-terminal-race-v2.ndjson

## Reproduction Steps
1. Activate the canonical `chat-native-disposable` profile.
2. Deploy exact source `2d9d69df40b2ac8fd5d41d58c19de949e16fceec`.
3. Run `agent-attachment-e2e` and confirm 19/19 assertions.
4. Run the unchanged `agent-v2-kernel-foundation-e2e`.
5. Observe Browser English `AS-F06` fail in `foundationF06Prepare` with `agent.acceptance.foundationRecoveryTurnAlreadyTerminal`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| A | The provider completes the recovery Turn before the transport cut is armed. | High | Low | The terminal event timestamp precedes the cut request or cut acknowledgement. |
| B | The cut is armed, but the fault proxy does not match the active request/stream. | Medium | Medium | The cut is acknowledged for a different request or no bytes are cut before terminal settlement. |
| C | Browser restart/readback selects a stale conversation or Turn. | Medium | Low | Prepared conversation/Turn IDs differ from the IDs read after restart. |
| D | Cleanup wraps an expected already-terminal state and obscures the primary ordering failure. | Medium | Low | Cleanup begins after terminal settlement and emits secondary cancel/readback failures. |
| E | The real proxy cut completes, but Browser consumes an already-buffered terminal frame before its recovery store observes transport loss. | High | Low | Confirmed: proxy cut was requested and acknowledged with the matching active record, then `done` removed that record in the same millisecond before the non-CONNECTED boundary settled. |

## Instrumentation Plan
- Record preparation start and the elapsed time to failure.
- Record terminal event type, sequence, event counts, recovery-record state, and whether the cut was already requested.
- Record fault-cut request and acknowledgement timing and recovery cursor/phase.
- Record cleanup locator selection and secondary cleanup outcome.

## Log Evidence
- Pre-fix run: `20260911T011437939285Z-27e9444f5a5686f4e1697f9440f97bed`.
- Candidate run: `20260911T011446852235Z-3196ffd3b473f6a37d35965371cd9582`.
- Failure tuple: `foundation-browser-direct / browser / direct_model / AS-F06 / en / single / sample-001`.
- Primary chain: `FoundationCandidateError -> FoundationClientError -> GateError`.
- Cleanup: both clients, all ports, storage, and actor identity released; outer Provisioner cleanup passed.
- Instrumented run
  `20260911T013357171761Z-3e0f22bd90738ba4e8d15784e5ad8e1c`
  on `ed423e16eef10a6d43a32a781e2b9fc48338c8c9` crossed all four
  AS-F06 tuples.
- Browser English requested and acknowledged the cut at 4039/4041 ms;
  Browser Simplified Chinese at 3847/3849 ms; Desktop English at 1949/1992
  ms; Desktop Simplified Chinese at 2289/2328 ms.
- Every tuple retained its recovery record at acknowledgement, settled only
  after the cut boundary, and completed scenario cleanup.
- Exact-source run
  `20260912T112845134359Z-c05aa8bcfaf45a91f7e171c27a90c915`
  on `68417f9f19bf8e2a78700dd2799edd4e958ea7db` crossed the
  managed-launcher restart defect. Browser English AS-F06 completed its cut,
  restart, and cleanup. Browser Simplified Chinese requested the proxy cut at
  2616 ms and received the acknowledgement at 2617 ms with the matching active
  record still `CONNECTED`; a buffered `done` event was consumed at 2618 ms
  before the recovery phase changed, removing the record and producing
  `foundationRecoveryTurnAlreadyTerminal`.
- That failed preparation also proved the cleanup diagnostic gap: the durable
  cleanup locator contained the Turn ID, but canceling the already-terminal
  Turn returned `agent.turnCancelFailed` and prevented queue cancellation and
  Conversation deletion inside the first cleanup attempt. Outer failure
  cleanup eventually released all processes, ports, storage, and Station
  leases.
- The local correction preserves the external proxy as the fault authority,
  then invokes the existing production transport-disconnect primitive only
  after the proxy acknowledges that its active sockets are closed. This drops
  buffered post-cut frames through the existing `consumeAgentSSE` abort check
  before waiting for the recovery phase. Cleanup records a Turn-cancel error
  but continues to queue cancellation, Conversation deletion, and final residue
  verification; a still-active dependency therefore continues to fail closed.
  Desktop API tests pass `60/60`, Foundation runtime/scenario tests pass
  `74/74`, Agent static tests pass `85/85`, Desktop strict check and diff
  hygiene pass. Exact-source post-fix proof remains pending.

## Verification Conclusion
The earlier controlled run rejected A through D as stable defects, but the
latest exact-source run confirms E and reproduces D as a secondary cleanup
problem. The proxy remains the source of the outage: the local transport is
disconnected only after the proxy acknowledges the real cut, solely to discard
bytes buffered before that acknowledgement. No retry, timeout increase,
synthetic terminal, or relaxed oracle is introduced.

## Iteration 2: Interrupted Recovery Closure

Exact-source Foundation run
`20260912T134934601704Z-2a47f9cf4b4e32fb5b07225daad92a1c`
on `09a6897e3d4b4c4399cc53cd69a4a75153f0fe18` crossed all AS-F06,
context-overflow, and forbidden-actor cells reached before Browser English
`BASE-INTERRUPTED`. The first cleanup deleted the Conversation, handoff,
cleanup locator, and local projection, but reported
`recoveryRecordCleared=false`. Its idempotent retry cleared the record and
completed every remaining cleanup fact.

The recovery trace identifies the ordering defect:

1. the terminal snapshot reconciliation reached `RECONCILING`;
2. reconciliation cleared the active recovery record;
3. the same in-flight `connected` event continued after the await and recreated
   the record for the same Turn and stream generation;
4. cleanup observed the resurrected record before its retry removed it.

The owner-layer correction in `chatRuntime` rechecks the generation-bound
record after authoritative `connected` reconciliation. If reconciliation
closed it, the runtime stops that recovery subscription, persists the empty
state, and does not publish or consume the stale `connected` marker. A focused
runtime regression recreates this exact ordering. No retry, delay, cleanup
weakening, or Harness-only suppression is added.

## Iteration 3: Native Handoff Persistence

Exact-source C08 run
`20260912T164209337981Z-1dd91d795d071a4d07025ed07620fcc3`
on `e68640fc6ef195f1e805443c827a4fa71a4fcb58` is `DONE / PROVEN`.
After two fail-closed invocations exposed omitted AS-F06 authorization
variables, fully authorized Foundation run
`20260912T170246593060Z-c3aa9e29803ff2ee6cf45578ac99fffc`
crossed Browser English and Simplified Chinese AS-F06. Desktop English then
prepared and finalized its handoff, but the native client failed its bounded
warm-up after Station restart and was restarted. The next capability-isolation
restore reported `agent.acceptance.foundationRecoveryHandoffMissing`.
Provisioner cleanup remained `DONE / PROVEN / passed`.

| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| R | The native client restart loses the Acceptance handoff storage key. | High | Low | The key exists after finalization and is absent at post-restart restore. |
| S | The key survives, but one serialized `null` or invalid field makes the fail-closed handoff parser reject the map. | Medium | Low | The target entry exists after restart, but parsed handoff is absent and invalid/null field metadata is present. |
| T | Cleanup for another AS-F06 tuple removes the Desktop handoff through a scenario-key collision. | Low | Low | The storage map survives but does not contain the Desktop scenario entry. |
| U | Auth/navigation startup clears the key before capability restoration. | Medium | Medium | Finalization reports a valid entry, while post-auth restore reports missing storage without a parse defect. |

The next instrumentation records only storage presence, serialized length,
entry count, target-entry presence, null field names, and parser acceptance
before navigation and after Station recovery. It records no handoff values,
actor identity, conversation identity, draft content, or credentials.

Exact-source run
`20260912T173659604871Z-1f7f52da5b4decfe75a9e4e31440e1f2`
on `f504880cf60ae1c880e82558b81462e87e70e74d` did not reproduce the
earlier loss at capability restoration. Browser English, Browser Simplified
Chinese, and Desktop English all reported a valid one-entry handoff before
navigation and after Station recovery, with no top-level or tool-isolation
`null` fields and `parsedHandoffPresent=true`.

Desktop English then completed durable reload, the coordinator performed its
explicit client restart, and the following `foundationDirectProbe` failed with
`agent.acceptance.foundationRecoveryHandoffMissing`. This moves the loss
boundary from Station recovery to the explicit native client restart. The next
observation reuses the same bounded storage snapshot at the DirectProbe entry
to distinguish a missing key from a post-durable-reload parser rejection.

Exact-source run
`20260912T180742830795Z-694e471ddbaec21631a4f8e75d5ed7e1`
on `69011df9f388c4d50627c331b0dfbbd61fe78bc8` confirms the root
cause. Browser retained and parsed its handoff after client restart. Desktop
English reported a valid handoff after Station recovery, then
`storagePresent=false` and `parsedHandoffPresent=false` at DirectProbe entry
after the explicit native client restart.

- R is confirmed for the explicit native client restart.
- S is rejected: no serialized `null` fields or parser rejection preceded the
  loss.
- T is rejected: each runtime held exactly one correctly scoped entry.
- U is narrowed to the native WebView restart boundary; Station recovery and
  the first re-authentication retained the key.

The Acceptance runner owns restart-surviving oracle state. The owner-layer fix
exports the latest strict handoff after durable reload, retains it only in the
Python coordinator, and imports it only into the Desktop native Harness after
the explicit client restart. Browser continues proving its native persistence
path. The imported object is scope-checked and strict-parser validated, is not
published as product evidence, and cannot replace Station snapshot, cursor
replay, or receiver assertions.

## Iteration 4: Interrupted Persisted Outcome Readback

Exact-source C08 run
`20260912T234312907224Z-d1244d088d9980940826c8f449985217`
on `7e148f83bd7b90805d95cb3b3bbbec2e18bdb01e` completed
`DONE / PROVEN`. The same-source Foundation run
`20260912T234615828770Z-2f4a011183adcc54ad3a57d694361c27`
proved all AS-F06 and both `BASE-CONTEXT_OVERFLOW` locale tuples, then failed
first at Browser English `BASE-INTERRUPTED` with
`agent.acceptance.foundationInterruptedPersistedOutcomeMissing`.
Provisioner cleanup completed `DONE / PROVEN / passed`.

Read-only PostgreSQL inspection after cleanup shows the two latest
`station_restart_interrupted` Turns each have one Assistant Message with
`status=interrupted` and a non-empty 276-byte `error_json`. The persisted JSON
contains the accepted `LIFECYCLE_INTERRUPTED`,
`agent.errors.lifecycleInterrupted`, retryable/terminal flags, and string
`turn_id`/`reason_code` details. Station startup logs also record one reclaimed
interrupted Chat step for each restart.

| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| V | Browser Conversation readback omits or transforms the persisted `error_json` even though Station storage contains it. | High | Low | Selected Assistant Message is interrupted but `errorJson` is absent, empty, or has an unexpected runtime type. |
| W | The Harness selects a different Assistant Message for the same Turn. | Medium | Low | Multiple matching Assistant Messages exist and the selected final candidate lacks the persisted outcome. |
| X | The response contains the typed payload but the strict projector rejects its shape. | Medium | Low | Parsed keys are present while `persistedOutcomePresent=false`; field types or detail keys identify the mismatch. |
| Y | The failure is an early readback race before startup recovery commits the interrupted Message outcome. | Low | Medium | First readback reports pending/missing outcome while later readback or Station storage reports interrupted/present. |
| Z | The provider completes after the client fault boundary but before Station restart takes ownership, so restart recovery has no running Turn to interrupt. | High | Low | The selected Assistant Message is `completed` with no error JSON, and Station logs have no reclaimed interrupted step at this tuple's restart. |

The next instrumentation records only Conversation status, message counts,
message status, error JSON presence/length/runtime type, parsed key names,
typed-field runtime types, detail key names, and projector acceptance. It does
not record message content, raw error payload values, actor identity,
credentials, or provider data.

The failed run's Station logs record interrupted-step reclamation during the
earlier AS-F06 restart window but none during the later `BASE-INTERRUPTED`
window. Recent read-only database grouping shows valid 276-byte typed outcomes
for actually interrupted Turns and completed Assistant Messages without
`error_json` for later Turns. This raises Z but does not identify the Harness
Turn without the bounded readback-shape instrumentation.

Exact-source C08 run
`20260913T003619586251Z-f9d282299dedcaf1e19e40c011255774`
on `bf1af73241b76e4e7b3b857aa29091dbf63fcda9` completed
`DONE / PROVEN`. The same-source Foundation run
`20260913T003753703208Z-727e7fa98b35bbad6ac31bf02f8ed1be`
proved all AS-F06 and both context-overflow locale tuples, then failed at
Browser English `BASE-INTERRUPTED` with
`agent.acceptance.foundationInterruptedReceiverMissing`. Provisioner cleanup
completed `DONE / PROVEN / passed`.

The V-Z readback evidence is decisive:

- one matching Assistant Message exists;
- its status is `interrupted`;
- its `error_json` is present and 276 bytes;
- parsed keys and detail keys match the accepted typed contract;
- all strict field types are correct;
- `persistedOutcomePresent=true`.

V, W, X, Y, and Z are rejected for this exact-source run. The prior
`foundationInterruptedPersistedOutcomeMissing` did not reproduce, and the Gate
advanced to receiver sampling.

| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| AA | The visible primary error copy lacks `data-pt-agent-message-error-text`; that selector exists only inside the collapsed diagnostics panel. | High | Low | Wait readiness succeeds from message/recovery attributes, but post-wait `errorElementPresent=false` while message and recovery remain present. |
| AB | The message element is removed between wait completion and final sampling. | Medium | Low | `waitReadyObserved=true` followed by `messageElementPresent=false` or a changed current session. |
| AC | The store projection is removed or lacks the Turn identity after the DOM becomes ready. | Medium | Low | DOM remains present while `projectedPresent=false` or `projectedTurnPresent=false`. |
| AD | The recovery element is replaced between wait completion and final sampling. | Low | Low | Message remains present while `recoveryPresent=false` after readiness. |

The next instrumentation captures only booleans, counts, terminal/error
attributes, and the current-session-presence flag after the ready boundary. It
records no text, IDs, actor identity, credentials, or provider payload.
