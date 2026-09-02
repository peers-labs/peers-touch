# Debug Session: base-active-mutation-conflict
- **Status**: [OPEN]
- **Issue**: The exact-source Browser
  `BASE-ACTIVE_MUTATION_CONFLICT` scenario proves the Station rejection but
  fails the independent `localizedRecoveryVisible` receiver assertion.
- **Debug Server**: http://127.0.0.1:7780/event
- **Log File**: `.dbg/trae-debug-log-base-active-mutation-conflict.ndjson`

## Reproduction Steps
1. Use worktree `peers-ai-agent`, branch
   `feat/p0-streaming-runtime-message-actions`, profile `two`.
2. Deploy Station and build both clients from the same clean source commit.
3. Run `agent-v2-kernel-foundation-e2e` with Station restart authorization.
4. Observe Browser `BASE-ACTIVE_MUTATION_CONFLICT` in English.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| A | Agent Profile does not mount before the 30-second receiver wait | Medium | Low | Surface selector is absent while store conflict state is present |
| B | The profile mounts for a different selected Agent | Medium | Low | Profile Agent ID differs from the disposable fixture ID |
| C | Conflict state reaches the store but the expected selectors are hidden or absent | High | Low | Store reports `conflict`; conflict/reload selector visibility is false |
| D | The selectors are visible but localized text differs from the expected locale keys | Medium | Low | Captured actual and expected text hashes differ |
| E | The exact typed error is not classified by the store | Low | Low | Rejection code is correct but save state is not `conflict` |

## Instrumentation
- Pending: record only Agent ID hashes, selected surface, save-state value,
  selector presence/visibility, and localized-text hashes before the receiver
  assertion.

## Log Evidence
- Exact-source run
  `20260902T070303965649Z-71a64c78ea7a07f259ca547edd9753f8`
  on `b717ccac3b7f99b656fa8be3c647886e7ba3564e` failed only
  `localizedRecoveryVisible` for Browser English.
- Exact source, redaction, and cleanup passed.
- Debug lines 1-2 prove the disposable Agent, profile surface, exact rejection,
  save state, and both selectors were correct and visible. The tuple requested
  English, but the runtime locale remained `zh-CN`; both expected strings were
  unresolved global i18n keys rather than Agent-namespace translations.

## Verification Conclusion
Hypothesis D is confirmed. Hypotheses A, B, C, and E are rejected. The
Foundation direct probe did not apply each tuple's locale after AS-F06 left the
client in Chinese, and the producer called global `i18n.t` without the `agent`
namespace. The correction applies and verifies locale before every non-AS-F06
direct probe, and resolves both expected strings from the Agent namespace.
Instrumentation remains active for post-fix comparison.
