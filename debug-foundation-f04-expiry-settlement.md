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
| E | The Station persistence layer cannot commit expiry settlement because the deployment disk is full. | Confirmed | Low | PostgreSQL repeatedly reported `could not extend file ... No space left on device` for `agent_turn_attempts` terminal updates during the failed run. |

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
- Whole-host inspection showed `/dev/vda2` at 100% usage with zero available
  bytes. Docker accounted for `26.73 GB` of build cache and `8.257 GB` of
  reclaimable images.
- PostgreSQL logs showed the AS-F04 settlement update failing repeatedly with
  `No space left on device`, followed by a checkpoint panic and restart loop.
- Removing only unused Docker build cache and dangling images older than 24
  hours recovered `12 GB`; named volumes and running-container images were
  preserved.
- The next exact-source run passed both AS-F04 locale tuples without emitting a
  timeout diagnostic, confirming the environment cause.

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
Hypothesis E is confirmed. AS-F04's source behavior is intact; the failed run
could not persist the Station-owned ToolCall and Turn terminal state because
the remote root filesystem was full. The cleaned deployment passed AS-F04
without assertion or timeout changes. The debug session remains open until the
overall Foundation closure is confirmed.
