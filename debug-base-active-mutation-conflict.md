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
  `20260831T214308436370Z-db73b14299793ff96cf7ac6b37e29e1c`
  on `6539fbc2a` failed only
  `localizedRecoveryVisible` for Browser English.
- Exact source, redaction, and cleanup passed.

## Verification Conclusion
Pending runtime instrumentation.
