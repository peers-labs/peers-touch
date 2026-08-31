# Debug Session: as-f06-recovery-prefix
- **Status**: [OPEN]
- **Issue**: The exact-source Foundation run intermittently rejects Browser
  AS-F06 preparation with `agent.acceptance.foundationRecoveryPrefixMissing`
  after observing a text event and at least two durable event sequences.
- **Debug Server**: http://127.0.0.1:7779/event
- **Log File**: `.dbg/trae-debug-log-as-f06-recovery-prefix.ndjson`

## Reproduction Steps
1. Use worktree `peers-ai-agent`, branch
   `feat/p0-streaming-runtime-message-actions`, profile `two`.
2. Deploy Station and build the Acceptance Desktop binary from the same clean
   source commit.
3. Run `agent-v2-kernel-foundation-e2e` with
   `PT_AGENT_V2_ALLOW_STATION_RESTART=1`.
4. Observe Browser AS-F06 preparation.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| A | A durable `text` event can carry an empty payload, so event type alone is not a valid non-empty recovery-prefix boundary | High | Low | Boundary facts show `textEventCount > 0` but `nonEmptyTextEventCount = 0` |
| B | The recovery cursor can advance beyond text already observed by the callback while the callback's event list omits that text | Medium | Low | `acknowledgedCursor` exceeds the maximum text sequence |
| C | Provider output begins with non-text progress/tool events and reaches the duplicate/out-of-order threshold before any non-empty text delta | High | Low | Durable sequence count reaches two while all non-empty text sequences are absent |
| D | Text content is stored under an event field not covered by `content ?? text` | Medium | Low | Redacted event shape reports a non-empty alternative payload field |

## Instrumentation
- `harness.ts:prepareFoundationF06Conversation` records the durable event
  type/sequence list, acknowledged cursor, text-event payload keys, text
  lengths, and aggregate prefix length at the fault-boundary decision.
- Separate `prefix-missing` and `prefix-ready` checkpoints preserve a binary
  post-fix comparison without recording content or identity.

## Log Evidence
- Exact-source run
  `20260831T190230256694Z-d26d4bba1809c91e4081196d6cb2355d`
  on `5458a5403554dad25cbae505f021005ef4c41abb` failed first at
  Browser AS-F06 `agent.acceptance.foundationRecoveryPrefixMissing`.
- Source identity, deployment identity, redaction, and cleanup passed.

## Verification Conclusion
Instrumentation-only checkpoint passes Desktop typecheck, 125 focused
Foundation tests, and `git diff --check`. Exact-source runtime evidence is
pending.
