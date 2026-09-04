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
| A | The provider Turn reaches a terminal event before the Station outage, so the recovery store correctly removes it. | Inconclusive | Low | The failure did not reproduce. The diagnostic run retained the active record through outage entry; unrelated Turns show expected terminal removal. |
| B | Identity or runtime teardown resets the actor-scoped recovery store before outage observation. | Rejected | Low | No reset occurred between the AS-F06 prepare boundary and outage-observer entry. |
| C | The stream controller remains active while the recovery record is rejected by generation, sequence, or actor guards. | Rejected | Medium | The target record remained active and all handoff identity comparisons were true at outage entry. |
| D | Station restart reconciliation converts the Turn to a terminal snapshot before the failure phase can be observed. | Rejected | Medium | Outage observation began with the record still present; later restart recovery completed and the Gate advanced. |
| E | The prepared handoff and runtime record diverge in Turn, stream, generation, or actor identity. | Rejected | Low | Actor, Turn, stream, and generation equality were all true at prepare and outage boundaries. |

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

## Instrumentation
- Recovery-store actor begin/reset records active and watermark counts.
- First, phase-transition, terminal, and rejected events record identity
  equality, sequence, acceptance, terminal closure, and resulting presence.
- Explicit recovery-record clear records the prior phase, cursor, and count.
- AS-F06 prepare and outage-observer boundaries record handoff/runtime identity
  equality and active-record presence without persisting identifiers.

## Verification Conclusion
The missing-registration failure did not reproduce on unchanged behavior with
instrumentation. The successful path proves the recovery record is normally
retained through outage entry, so no product fix is justified from the current
evidence. Keep the instrumentation and debug session open while the Gate
continues through later source-backed failures.
