# Debug Session: foundation-readiness-timeout
- **Status**: [OPEN]
- **Issue**: Browser zh-CN AS-F01 times out after submitting the real Ark readiness turn instead of observing one authoritative completed terminal.
- **Debug Server**: `http://127.0.0.1:7790/event`
- **Log File**: `.dbg/trae-debug-log-foundation-readiness-timeout.ndjson`

## Reproduction Steps
1. Use exact source commit `715e4f099e28c8af667f99fe96ef3d64766f206a`.
2. Activate the approved `chat-native-disposable` profile.
3. Verify the live Station commit matches the exact source.
4. Run the unchanged `agent-v2-kernel-foundation-e2e` Gate.
5. Observe Browser `AS-F01 / zh-CN / single / sample-001`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected signal |
|----|------------|------------|--------|-----------------|
| A | The Ark provider attempt remains active beyond the fixed Turn deadline. | High | Low | Provider-started progress exists, no terminal event exists, and Station readback remains running or streaming at timeout. |
| B | The provider selects an unexpected ToolCall despite AS-F01 capability isolation. | Medium | Low | A tool-call or approval event exists and Station readback is waiting for tool or approval. |
| C | Station persists a terminal Turn but Browser transport or projection does not deliver the terminal event. | Medium | Medium | Station Turn/Message/Attempt readback is terminal while the observed Browser event list has no matching terminal sequence. |
| D | Admission, capability-session, or readiness fails before provider execution. | Medium | Low | No provider-started event exists and Station readback contains a typed pre-provider failure or no admitted Turn. |
| E | Transport recovery interrupts terminal projection. | Medium | Medium | Browser observes connection loss or recovery handoff while Station has replayable progress or a terminal result. |

## Instrumentation Plan
- Record AS-F01 submission start with platform, locale, and capability-isolation counts.
- Record each observed event type, sequence, stage, and terminal classification without content.
- On settlement, record the bounded event summary and result key.
- On failure, read Station conversation, Turn diagnostic replay, Attempt/runtime state, and recovery state using existing production APIs.
- Keep the fixed provider, model, prompt, timeout, matrix, assertions, and cleanup unchanged.
- Instrumentation is active in
  `apps/desktop/src/acceptance/agent/harness.ts` with `runId=pre-fix`.
- Desktop TypeScript checks, Agent static regressions (`85/85`), Python
  compilation, and diff hygiene pass.

## Log Evidence
- Exact-source diagnostic run
  `20260913T105112476698Z-dc7299475bf0e6204dd729b488cfad60`
  failed first at Browser `AS-F01 / zh-CN / single / sample-001` with
  `agent.acceptance.turnSubmissionTimeout`.
- Provisioner cleanup completed successfully.
- The existing immutable Gate artifacts do not include enough AS-F01 event and
  authoritative readback detail to distinguish hypotheses A-E.

## Verification Conclusion
Pending instrumentation and exact-source reproduction.
