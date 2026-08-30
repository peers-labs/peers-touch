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
| A | Final capture prefers a stale failed operation over the authoritative interrupted message | High | Low | Secondary: the failed sample had both stale operation and message state |
| B | Snapshot reduction does not replace the prior assistant content | High | Medium | Rejected at the pre-restart boundary |
| C | Conversation reconciliation reintroduces stale local terminal content after snapshot | Medium | Medium | Confirmed across the restart boundary |
| D | Browser replay records the snapshot but does not apply it to the owning chat store | Low | Medium | Rejected at the pre-restart boundary |

## Log Evidence
- Exact-source run `20260830T053507185569Z-beae2d48d453d4fb6921bc125303e699`
  passed replay sequence, source identity, payload hash, stale-generation,
  stale-revision, and stale-terminal checks.
- The only AS-F06 assertion failure was `terminalProjectionEqualsStation`.
- Client status/hash: `failed` /
  `e19e95e4d531ca39a171b3900306e1015fbd1a60b693acd770a4fd373c7ca846`.
- Station status/hash: `interrupted` /
  `21f98f1c3b3c5a596b9e9e67c61289115f1fbdbf2f357b74847cc8722eff7cbd`.
- Instrumented exact-source run
  `20260830T060656514138Z-212276ef2af0c31e4726da2ea4b68aff`
  observed the failing tuple as `interrupted` with content length `576`
  immediately after snapshot reconciliation, then as `failed` with content
  length `163` after client restart. Station remained `interrupted` with
  content length `576`.
- Exact-source run
  `20260830T064048656280Z-c8bf14ec8c6d1edd6381367a8f05a5fb`
  reproduced the same boundary after the first timestamp-based correction:
  pre-restart state was `interrupted` with content length `677`, while
  post-restart state was `failed` with content length `80`. Cross-host
  timestamps are therefore insufficient authority for equal-sequence rows.

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
The authoritative snapshot reaches and updates the owning store before restart.
The stale projection is restored during restart synchronization because the
cache accepts an older same-sequence message and the generic UI merge carries
old terminal fields over an authoritative terminal message. The correction
must make equal-sequence cache merges revision-aware and preserve authoritative
snapshot terminal fields and content.

## Fix
- Equal-sequence cached messages now resolve first by explicit reconciliation
  source, with `station-snapshot` authoritative over `station-list`; timestamps
  only order messages from the same source class.
- Authoritative snapshots may supersede same-sequence terminal events.
- Snapshot text is replaced by field presence, including an authoritative
  empty string.
- Generic message reconciliation no longer restores stale terminal fields over
  an authoritative terminal message, and explicit recovery reconciliation
  reapplies the supplied terminal snapshot after merging.

Post-fix exact-source runtime verification is pending.
