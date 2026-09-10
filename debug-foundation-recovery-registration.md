# Debug Session: foundation-recovery-registration
- **Status**: [OPEN]
- **Issue**: Browser AS-F06 loses the active Agent Turn recovery registration before outage observation.
- **Debug Server**: `http://127.0.0.1:7780/event`
- **Log File**: `.dbg/trae-debug-log-foundation-recovery-registration.ndjson`

## Reproduction Steps
1. Activate the approved `chat-native-disposable` profile.
2. Verify the Station is remote, healthy, and source-matched.
3. Run `agent-v2-kernel-foundation-e2e` with the approved disposable reset and Station restart envelope.
4. Observe Browser `AS-F06 / en / single / sample-001`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | The provider Turn reaches a terminal event before the Station outage, so the recovery store correctly removes it. | Confirmed | Low | The latest exact-source run retained the record at the prepare boundary, then consumed `done` sequence 44 and authoritative `snapshot` sequence 44 before the outage observer sampled `MISSING`. |
| B | Identity or runtime teardown resets the actor-scoped recovery store before outage observation. | Rejected | Low | No reset occurred between the AS-F06 prepare boundary and outage-observer entry. |
| C | The stream controller remains active while the recovery record is rejected by generation, sequence, or actor guards. | Rejected | Medium | The target record was accepted through `done` and `snapshot`; no identity or sequence guard rejected those events. |
| D | Station restart reconciliation converts the Turn to a terminal snapshot before the failure phase can be observed. | Rejected | Medium | The terminal snapshot arrived before the Python outage callback began, not as Station-restart reconciliation. |
| E | The prepared handoff and runtime record diverge in Turn, stream, generation, or actor identity. | Rejected | Low | Actor, Turn, stream, and generation equality were all true at the prepare boundary. |

## Log Evidence
- Exact-source run `20260904T165528931061Z-bea3438ead5633d03409217acd885313`
  on `5c573c1c4eca423041e8a2ad578a940be5f9177a` failed at Browser
  `AS-F06 / en / single / sample-001` with
  `agent.acceptance.foundationRecoveryRegistrationMissing`.
- Provisioning reached `FIXTURE_READY`; source identity matched; provisioner
  cleanup completed `DONE / PROVEN / passed`.
- Instrumented exact-source run
  `20260904T171932940301Z-1ffb7349f89aa4d4977ac5235a458a6d`
  on `7562b002327821c70296cba42214f4eedb0f5291` retained the target
  recovery record from prepare cursor `3` through outage-observer cursor `238`.
  All actor, Turn, stream, and generation comparisons matched. The run crossed
  AS-F06 and the remaining Foundation core cells before failing later at
  `BASE-APPROVAL-DENIED`. Cleanup completed `DONE / PROVEN / passed`.
- Instrumented exact-source run
  `20260905T131248877567Z-ef022ff2b49f7b5593a5ad8bd508c217`
  (aggregate
  `20260905T131248751096Z-27ef204ebfb28347a409dcff22faf33f`)
  on `f95a4dd0eb779aae6106872257a1d1c4247535b2` reproduced the
  missing-registration failure. The target record was present at the prepare
  boundary with phase `CONNECTED` and cursor `3`. It then accepted
  `connection_lost(3)`, `reconnecting(3)`, `replaying(3)`, deferred terminal
  `done(44)`, `reconciling(44)`, and `connected(44)`. The authoritative
  `snapshot(44)` closed the record before the outage observer sampled it as
  `MISSING`. Cleanup completed `DONE / PROVEN / passed`.
- Post-fix exact-source aggregate
  `20260905T144656500100Z-697d09085b429dbe9832fe2545120f4e`
  on `cdf50ddc8b0c4f2f3d6c3d87c8bbc83907dcce87` reached
  `FIXTURE_READY` and emitted recovery transitions through
  `CONNECTION_LOST`, `RECONNECTING`, `REPLAYING`, and `RECONCILING`. The host
  rebooted at `2026-09-05T23:09:05+08:00` before the runner could publish a
  candidate, run manifest, or cleanup receipt. The attempt is
  `INCOMPLETE / UNPROVEN`; its runtime activity cannot prove AS-F06.
- Exact-source aggregate
  `20260905T173017351674Z-65338c392b7d5a1a098d0adc93796164`
  on `18d5ff27bd0c485adbff996067faec9e6489be90` passed the repaired
  AS-F01 tuples and reached Browser AS-F06. It failed at
  `agent.acceptance.foundationRecoveryCursorAdvancedBeforeFault`: the recovery
  cursor advanced while the asynchronous loopback cut request was in flight.
  The error proves the implementation froze the cursor before the cut was
  acknowledged, not at the actual transport boundary. Outer Provisioner and
  client cleanup completed `DONE / PROVEN / passed`.

## Instrumentation
- Recovery-store actor begin/reset records active and watermark counts.
- First, phase-transition, terminal, and rejected events record identity
  equality, sequence, acceptance, terminal closure, and resulting presence.
- Explicit recovery-record clear records the prior phase, cursor, and count.
- AS-F06 prepare and outage-observer boundaries record handoff/runtime identity
  equality and active-record presence without persisting identifiers.

## Verification Conclusion
Hypothesis A is confirmed. The Harness published a valid handoff, but its
in-process disconnect allowed the still-live Station connection to reconnect
and receive provider completion before the Python outage callback killed the
Station. The recovery store then correctly closed the terminal record. The
post-fix candidate removes that Harness disconnect and has the Harness invoke a
token-bound loopback control endpoint immediately after publishing the cursor
boundary. The prepare call returns only after the endpoint acknowledges that
the client's real Station TCP proxy is cut and the recovery projection has left
`CONNECTED`; cursor movement across that boundary fails closed. A cleanup
locator is persisted immediately after conversation creation, so response loss
cannot silently orphan the Station conversation. Python then invokes a second
Harness phase to hash and persist the handoff before the source-bound Station
restart. The proxy also rejects connections admitted by an earlier fault
generation. Runtime proof is still pending; keep the instrumentation and debug
session open. The post-fix run was externally interrupted by the host reboot,
so an unchanged exact-source rerun is required before comparing the corrected
fault boundary with the pre-fix sequence. That rerun proved the control request
itself is not an atomic cursor boundary: provider events may validly arrive
before the proxy closes the connection. The next correction must register the
pending recovery identity first, request the cut immediately, and capture the
acknowledged cursor only after the proxy confirms closure and the recovery
projection leaves `CONNECTED`. Duplicate/out-of-order mutation checks then run
synchronously against that frozen post-cut cursor.

## Post-Cut Cursor Fix
- The pending recovery identity is registered before the asynchronous control
  request so phase transitions remain observable.
- The pre-request cursor is diagnostic context only.
- `acknowledgedCursor`, prefix evidence, and duplicate/out-of-order source
  events are derived after the proxy acknowledges the cut and recovery leaves
  `CONNECTED`.
- Synthetic stale/duplicate mutations execute synchronously from that point,
  and any later cursor advancement fails closed as
  `agent.acceptance.foundationRecoveryCursorAdvancedAfterFault`.
- Desktop check, 123 focused runtime/coordinator/static tests, and
  `git diff --check` pass.

## Transition-Ordering Follow-Up

| ID | Hypothesis | Status | Evidence |
|----|------------|--------|----------|
| F | Steady-state periodic reconciliation starts recovery while the live Turn is still `CONNECTED`, so `RECONNECTING/REPLAYING` precede the required `CONNECTION_LOST` transition. | Confirmed | Exact-source run `20260905T185006531870Z-ac3390c3b433b509109002e48a903ff0` recorded `fault-cut-requested` at `CONNECTED/cursor=3`, then `RECONNECTING/REPLAYING` at cursor `31`; the first `connection_lost` was recorded later. |
| G | The transition oracle alone selected the wrong occurrence even though runtime state entered `CONNECTION_LOST` first. | Rejected | Timestamped recovery-store instrumentation has no `connection_lost` before the first `RECONNECTING`; the ordering defect is in runtime behavior, not only `indexOf` evaluation. |
| H | The post-cut cursor correction broke replay identity or stale-event fencing. | Rejected | The failed tuple passed `replayAfterAcknowledgedCursor`, source/payload equality, duplicate/out-of-order idempotence, and stale generation/terminal/revision rejection; replay sequences matched Station exactly from `32` through `403`. |

- The run was source-matched to
  `6cc996f229bb0a1f977d5e0097f8174b00e79dfc`, advanced through AS-F05,
  and failed only Browser AS-F06
  `exactRecoveryTransitionOrdering`.
- Inner client cleanup and outer Provisioner cleanup both passed; all client,
  proxy, control, gateway, renderer, and WebDriver ports plus temporary storage
  and actor identity were released.
- The owning runtime correction leaves live `CONNECTED` records under their
  stream owner during steady-state periodic reconciliation. Bootstrap still
  recovers persisted `CONNECTED` records because no live-stream owner exists
  after process start.
- Focused `chatRuntime` tests pass `16/16`, Desktop check passes, the Agent
  native static suite passes `68/68`, and `git diff --check` passes.
- Exact-source post-fix runtime verification remains pending. Keep this session
  and its instrumentation open.
