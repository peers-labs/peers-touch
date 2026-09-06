# Debug Session: foundation-f04-expiry-settlement
- **Status**: [OPEN]
- **Issue**: Browser AS-F04 intermittently times out waiting for the manual-approval ToolCall and Turn to settle as expired.
- **Debug Server**: `http://127.0.0.1:7784/event`
- **Log File**: `.dbg/trae-debug-log-foundation-f04-expiry-settlement.ndjson`

## Reproduction Steps
1. Activate the approved `chat-native-disposable` profile.
2. Verify local source and the disposable Station are both exact-source.
3. Run `agent-v2-kernel-foundation-e2e` with disposable reset and Station restart authorization.
4. Observe Browser `AS-F04 / en / single / sample-001`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal | Evidence |
|----|------------|------------|--------|-----------------|----------|
| A | The ToolCall remains `WAITING_APPROVAL` beyond its Station-authored execution deadline. | Medium | Low | Timeout evidence has one waiting ToolCall, a past deadline, and a non-terminal Turn. | Pending |
| B | The ToolCall reaches `EXPIRED`, but the owning ToolBatch/Turn remains non-terminal. | Medium | Low | Timeout evidence has one expired ToolCall and a non-terminal Turn. | Pending |
| C | The provider emits more than one ToolCall, so the strict exact-one predicate cannot settle. | Medium | Low | Timeout evidence reports more than one ToolCall fact. | Pending |
| D | Diagnostic replay is unavailable or stale while the Station worker settles the underlying state. | Low | Medium | Repeated diagnostics fail or retain an unchanged pre-expiry revision after the deadline. | Pending |

## Log Evidence
- Exact-source run
  `20260906T160432461241Z-649e4dc840f14fd348be87601bdb15db`
  on `368497d7150f76943e1d6278463c01463cdc2146` failed first at Browser
  `AS-F04 / en / single / sample-001` with
  `timed out waiting for: Foundation expiry ToolCall settlement`.
- The same AS-F04 path passed in earlier exact-source runs, including the run
  on `31f8208ad1fa5640356108b837d9a6e8cf0549ef` that later reached AS-F12.
- Inner and outer cleanup both passed, and all six Foundation product ports
  were released.

## Instrumentation
- The existing bounded settlement wait now records ToolCall count/statuses,
  execution deadlines, Turn status/terminal reason, and observed event types
  only when the expiry case times out.
- The diagnostic uses the dedicated loopback collector on port `7784` and does
  not record actor, conversation, Turn, ToolCall, approval, or credential
  identifiers.
- The 120-second Station deadline, 180-second settlement budget, polling
  interval, and strict exact-one/terminal predicate are unchanged.

## Local Verification
- Agent native static tests: `69/69` PASS.
- Desktop check: PASS.
- `git diff --check`: PASS.

## Verification Conclusion
Pending exact-source runtime evidence.
