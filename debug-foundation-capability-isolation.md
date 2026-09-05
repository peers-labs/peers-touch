# Debug Session: foundation-capability-isolation
- **Status**: [OPEN]
- **Issue**: Browser AS-F01 fails before Turn creation because the required positive capability isolation prerequisite is unavailable.
- **Debug Server**: `http://127.0.0.1:7785/event`
- **Log File**: `.dbg/trae-debug-log-foundation-capability-isolation.ndjson`

## Reproduction Steps
1. Activate the approved `chat-native-disposable` profile and bind the existing approved provider tuple.
2. Verify Station and local source both match the current checkpoint.
3. Run `agent-v2-kernel-foundation-e2e` with disposable reset and Station restart authorization.
4. Observe Browser `AS-F01 / en / single / sample-001`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal | Evidence |
|----|------------|------------|--------|-----------------|----------|
| A | The selected Agent has no enabled capability binding after deterministic fixture reset. | High | Low | Precondition reports zero enabled bindings and zero ready capabilities. | Pending |
| B | Enabled bindings exist, but none are READY for the selected Browser capability session. | Medium | Low | Enabled count is positive while ready count is zero, with a non-ready state/reason summary. | Pending |
| C | The selected Agent differs from the Agent configured by fixture bootstrap. | Medium | Low | Selected and authoritative Agent identity hashes or versions differ. | Pending |
| D | Entry restoration removes or reverts the only usable capability fixture before AS-F01. | Low | Medium | A persisted fixture/isolation journal exists before restoration and binding counts fall afterward. | Pending |

## Log Evidence
- Exact-source aggregate
  `20260905T155910608914Z-5e1551459204f9f999b32a19fb8a374b`
  on `7601b663861e101b37d0183badcc16956765664e` failed at Browser
  `AS-F01 / en / single / sample-001` with
  `agent.acceptance.foundationCapabilityIsolationUnavailable`.
- The failure occurred before AS-F01 conversation creation or provider
  execution.
- Provisioner and client cleanup completed `DONE / PROVEN / passed`.

## Instrumentation
- `foundationDirectProbe` records journal presence before and after restoration,
  selected-Agent resolution shape, Agent count, and selected Agent version.
- `withFoundationCapabilitiesDisabled` records selected/authoritative Agent
  version equality, total/enabled binding counts, readiness entry/READY counts,
  and sorted state/reason histograms immediately before the fail-closed
  prerequisite.
- Instrumentation uses the dedicated loopback collector on port `7785` and
  does not record actor, Agent, binding, capability-session, or credential
  identifiers.
- Desktop check, 51 focused capability-isolation tests, 68 native static tests,
  and `git diff --check` pass.

## Verification Conclusion
Pending focused runtime reproduction. No fixture or product behavior change is
authorized until the prerequisite state is classified.
