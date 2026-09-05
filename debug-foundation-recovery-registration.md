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
session open.
