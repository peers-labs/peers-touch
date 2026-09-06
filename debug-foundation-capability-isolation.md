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
| E | AS-F10 invokes capability isolation without the reversible READY fixture, so an already-disabled binding yields a vacuous restoration with an empty hash. | Confirmed | Low | Exact-source run `20260906T112704879353Z-5e1f364c3649ec3e0e19e68668401c7c` reached AS-F10 with one disabled binding, zero READY capabilities, and failed on empty `restoredReadyCapabilityHash`. |
| F | AS-F12 assumes a READY capability remains after AS-F10 restores the actor's original disabled binding. | Confirmed | Low | Exact-source run `20260906T154109631399Z-f8e7c6f12606844928a56a5ff1d1c87c` passed through AS-F10, then AS-F12 observed zero enabled bindings and zero READY capabilities before failing closed. |

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
- Post-fix exact-source aggregate
  `20260905T173017351674Z-65338c392b7d5a1a098d0adc93796164`
  on `18d5ff27bd0c485adbff996067faec9e6489be90` passed both Browser
  AS-F01 locale tuples. Each strict precondition recorded one enabled binding
  and one `READY / capability_ready` row; the Gate then advanced through
  AS-F02-AS-F05 to the independent AS-F06 cursor boundary. Provisioner and
  client cleanup completed `DONE / PROVEN / passed`.
- Exact-source run
  `20260906T112704879353Z-5e1f364c3649ec3e0e19e68668401c7c`
  (aggregate
  `20260906T112704758489Z-c21aabe8aad755ba7e0b4bd8e98b6ee9`)
  on `e68a5b4c000b1a649667addae279b6e0dd54c726` passed AS-F02 and
  AS-F06, then failed at Browser AS-F10 because its isolation precondition
  observed one disabled binding and zero READY capabilities. The no-binding
  path marked restoration verified without a restored READY hash, while the
  unchanged AS-F10 oracle correctly required non-empty restored/source hashes.
  Inner runtime cleanup and outer Provisioner cleanup both passed.
- Exact-source run
  `20260906T154109631399Z-f8e7c6f12606844928a56a5ff1d1c87c`
  (aggregate
  `20260906T154109496998Z-364edeb89cc3b13c87a7bc1ce27b94d6`)
  on `31f8208ad1fa5640356108b837d9a6e8cf0549ef` passed AS-F01 through
  AS-F10, including a non-vacuous AS-F10 precondition with one enabled binding
  and one `READY / capability_ready` row. It then failed first at Browser
  AS-F12 with `agent.acceptance.foundationCapabilityIsolationUnavailable`.
  The final isolation precondition recorded one disabled binding and zero
  READY capabilities, proving that AS-F10 had restored the original state and
  AS-F12 still depended on ambient fixture state. Inner and outer cleanup both
  passed.

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
Hypotheses A, E, and F are confirmed in separate cells. AS-F01, AS-F10, and
AS-F12 require a positive READY capability before testing that capability
isolation removes effective tools. Each scenario must own that precondition
instead of depending on mutable residual Station binding state. The correction
remains inside Acceptance business injection: AS-F10 and AS-F12 use the same
revision-fenced fixture lifecycle and retain the existing strict
isolation/restoration assertions. Product readiness semantics and Station
authority do not change.

## Fix
- Added one shared `withFoundationReadyCapabilityFixture` lifecycle around the
  existing Station binding APIs and durable fixture journal.
- AS-F01, AS-F07, AS-F10, and AS-F12 now use the same platform-specific
  fixture setup, revision-fenced isolation, reverse restoration, and
  fail-closed cleanup.
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
- Exact-source runtime comparison: AS-F01 passed for both Browser locale
  tuples, AS-F10 passed with a non-vacuous READY fixture, and the first
  subsequent failure was AS-F12's missing fixture ownership.
- AS-F12 fixture ownership static tests: `69/69` PASS.
- AS-F12 fixture ownership Desktop check: PASS.
- The complete Foundation Gate remains `PARTIAL / UNPROVEN`.
