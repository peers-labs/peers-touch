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
| A | The provider Turn reaches a terminal event before the Station outage, so the recovery store correctly removes it. | High | Low | Pending: record terminal consumption and record deletion before the outage observer. |
| B | Identity or runtime teardown resets the actor-scoped recovery store before outage observation. | Medium | Low | Pending: record actor reset and runtime teardown with active-record counts. |
| C | The stream controller remains active while the recovery record is rejected by generation, sequence, or actor guards. | Medium | Medium | Pending: record every rejected recovery-store reduction with bounded identity comparisons. |
| D | Station restart reconciliation converts the Turn to a terminal snapshot before the failure phase can be observed. | Medium | Medium | Pending: record snapshot status, sequence, and recovery record state around reconciliation. |
| E | The prepared handoff and runtime record diverge in Turn, stream, generation, or actor identity. | Low | Low | Pending: record equality booleans at prepare completion and outage-observer entry. |

## Log Evidence
- Exact-source run `20260904T165528931061Z-bea3438ead5633d03409217acd885313`
  on `5c573c1c4eca423041e8a2ad578a940be5f9177a` failed at Browser
  `AS-F06 / en / single / sample-001` with
  `agent.acceptance.foundationRecoveryRegistrationMissing`.
- Provisioning reached `FIXTURE_READY`; source identity matched; provisioner
  cleanup completed `DONE / PROVEN / passed`.

## Instrumentation
- Recovery-store actor begin/reset records active and watermark counts.
- First, phase-transition, terminal, and rejected events record identity
  equality, sequence, acceptance, terminal closure, and resulting presence.
- Explicit recovery-record clear records the prior phase, cursor, and count.
- AS-F06 prepare and outage-observer boundaries record handoff/runtime identity
  equality and active-record presence without persisting identifiers.

## Verification Conclusion
Pending pre-fix runtime evidence.
