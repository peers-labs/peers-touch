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
| A | The selected Agent has no enabled capability binding after deterministic fixture reset. | Confirmed | Low | The precondition reported one total binding, zero enabled bindings, and zero READY capabilities. |
| B | Enabled bindings exist, but none are READY for the selected Browser capability session. | Rejected | Low | No enabled binding existed; the only readiness row was `BLOCKED` with `binding_disabled`. |
| C | The selected Agent differs from the Agent configured by fixture bootstrap. | Rejected | Low | The selected Agent resolved by name without fallback, and selected/authoritative versions both equaled `1`. |
| D | Entry restoration removes or reverts the only usable capability fixture before AS-F01. | Rejected | Medium | Both isolation and fixture journals were absent before and after entry restoration. |

## Log Evidence
- Exact-source aggregate
  `20260905T155910608914Z-5e1551459204f9f999b32a19fb8a374b`
  on `7601b663861e101b37d0183badcc16956765664e` failed at Browser
  `AS-F01 / en / single / sample-001` with
  `agent.acceptance.foundationCapabilityIsolationUnavailable`.
- The failure occurred before AS-F01 conversation creation or provider
  execution.
- Provisioner and client cleanup completed `DONE / PROVEN / passed`.
- Instrumented exact-source aggregate
  `20260905T164357715597Z-1ab26f1e29b133786540aec33a8d992c`
  on `e2f1cb183f80ca6a9b9016617cbaf4dfd40050fa` reproduced the same
  Browser AS-F01 failure. The awaited debug event recorded
  `totalBindingCount=1`, `enabledBindingCount=0`,
  `readyCapabilityCount=0`, and one `BLOCKED / binding_disabled` readiness
  row. Agent selection and version equality were valid, and no stale journal
  existed. Cleanup again completed `DONE / PROVEN / passed`.

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
Hypothesis A is confirmed. AS-F01 requires a positive READY capability before
testing that capability isolation removes effective tools, but unlike AS-F07 it
does not establish a deterministic reversible capability fixture. It therefore
depends on mutable residual Station binding state. The correction must remain
inside Acceptance business injection: reuse one revision-fenced fixture
lifecycle for AS-F01 and AS-F07, then retain the existing strict isolation and
restoration assertions. Product readiness semantics and Station authority do
not change.

## Fix
- Added one shared `withFoundationReadyCapabilityFixture` lifecycle around the
  existing Station binding APIs and durable fixture journal.
- AS-F01 and AS-F07 now use the same platform-specific fixture setup,
  revision-fenced isolation, reverse restoration, and fail-closed cleanup.
- The strict prerequisite still requires a positive READY capability before
  isolation and zero READY capabilities during the isolated Turn.
- Diagnostic instrumentation remains active for post-fix comparison.

## Local Verification
- Desktop check: PASS.
- Capability-isolation unit tests: `51/51` PASS.
- Agent native static tests: `68/68` PASS.
- Foundation scenario runner tests: `38/38` PASS.
- `git diff --check`: PASS.
- Focused Harness lint: five pre-existing findings remain; the new helper adds
  no lint finding.
- Exact-source runtime comparison: pending.
