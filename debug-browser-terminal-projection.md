# Debug Session: browser-terminal-projection
- **Status**: [OPEN]
- **Issue**: Browser AS-F06 replay is source-matching, but the client terminal
  projection remains `failed` with a different content hash while Station is
  `interrupted`.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-browser-terminal-projection.ndjson

## Reproduction Steps
1. Activate profile `two` on the owning worktree.
2. Deploy Station and build the Acceptance Desktop binary from the same clean
   source commit.
3. Run `agent-v2-kernel-foundation-e2e` with Station restart authorization.
4. Inspect the first failed Browser AS-F06 tuple and its source-bound evidence.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Final capture prefers a stale failed operation over the authoritative interrupted message | High | Low | Pending |
| B | Snapshot reduction does not replace the prior assistant content | High | Medium | Pending |
| C | Conversation reconciliation reintroduces stale local terminal content after snapshot | Medium | Medium | Pending |
| D | Browser replay records the snapshot but does not apply it to the owning chat store | Low | Medium | Pending |

## Log Evidence
- Exact-source run `20260830T053507185569Z-beae2d48d453d4fb6921bc125303e699`
  passed replay sequence, source identity, payload hash, stale-generation,
  stale-revision, and stale-terminal checks.
- The only AS-F06 assertion failure was `terminalProjectionEqualsStation`.
- Client status/hash: `failed` /
  `e19e95e4d531ca39a171b3900306e1015fbd1a60b693acd770a4fd373c7ca846`.
- Station status/hash: `interrupted` /
  `21f98f1c3b3c5a596b9e9e67c61289115f1fbdbf2f357b74847cc8722eff7cbd`.

## Instrumentation
- `chatRuntime.ts:reloadAgentTurnSnapshot.reconciled` records snapshot status
  and content length together with the owning operation/message projection
  immediately after reconciliation.
- `harness.ts:runFoundationF06Complete` records the same projection facts and
  hashes after the client restart, immediately before the independent oracle
  receives the capture.
- Neither point records message content, actor identity, credentials, or
  authorization values.

## Verification Conclusion
Pending source and runtime ownership audit. No product change has been made.
