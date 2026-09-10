# Debug Session: foundation-f12-projection
- **Status**: [OPEN]
- **Issue**: Browser AS-F12 Simplified Chinese times out waiting for the selected branch message to appear in the active conversation projection.
- **Debug Server**: `http://127.0.0.1:7781/event`
- **Log File**: `.dbg/trae-debug-log-foundation-f12-projection.ndjson`

## Reproduction Steps
1. Activate the approved `chat-native-disposable` profile.
2. Verify Station source identity equals the current clean worktree HEAD.
3. Run `agent-v2-kernel-foundation-e2e` with the approved disposable reset and Station restart envelope.
4. Observe Browser `AS-F12 / zh-CN / single / sample-001` preparation.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | `selectSession` or `syncMessages` leaves the target branch message absent from the Chat store. | Confirmed | Low | The selected session remained current and registered, but the four-message store projection omitted the selected branch that Station returned. |
| B | Station readback does not project the branch selected by the preceding revision command. | Rejected | Low | Independent Station readback returned four messages and included the expected selected branch. |
| C | The Chat store contains the selected branch but React has not rendered it before the timeout. | Rejected | Low | The selected branch was absent from both the store and DOM. |
| D | Navigation leaves the Agent page hidden while the correct conversation is selected. | Rejected | Low | The target conversation remained selected; the missing DOM row followed the missing store row. |
| E | `syncMessages` encounters a transport error that its projection-preserving contract intentionally absorbs. | Rejected | Low | Station readback completed and the cache returned four stale rows; no transport failure caused the divergence. |

## Log Evidence
- Exact-source Gate run `20260904T150505739160Z-7d9babb401f1240950f77893ac962634` on `686dc32f7a953071ae460b6fcecacc7583883dd4` passed the prior AS-F03 boundary and Browser AS-F12 English.
- Browser AS-F12 Simplified Chinese then timed out waiting for one conversation projection.
- The Gate completed provisioner and client cleanup successfully, but the existing timeout message does not identify which store or DOM predicate stayed false.
- Exact-source run `20260904T155208865276Z-9c5eafc516837c1ec1d29b89c2fc7f05`
  on `16a54457e028864d778c8fcd3058ad910f740818` reproduced the failure
  after both Browser AS-F03 locales passed. The target conversation remained
  selected and registered. Station and the Desktop store each reported four
  messages, but only Station contained the selected branch message.
- The shared cache had advanced its cursor through the regenerated sibling.
  Selecting the lower-sequence original branch changed Station's active
  projection, but the next incremental `after_seq` read could neither fetch
  the older selected head nor remove the inactive sibling.

## Instrumentation
- `A`: selected-session equality, session registration, and synchronized store message count.
- `B`: selected-branch membership in the synchronized store and independent Station readback.
- `C`: selected-branch DOM membership and visibility.
- `D`: rendered message count and selected message role/status.
- `E`: readback error code when the post-timeout Station diagnostic cannot complete.

## Verification Conclusion
Root cause confirmed in the shared Agent message cache. Incremental append-only
synchronization is valid for new messages, but not for mutable active-branch
projections. The local correction adds a paginated authoritative refresh that
replaces projection membership, resets the cursor to the selected projection,
and serializes per-conversation writes. Desktop `syncMessages` and periodic
`agent-topic` reconciliation now use that path. Package, Desktop, and focused
Foundation checks pass; exact-source runtime verification is pending. Keep this
debug session open until the rerun proves AS-F12.

## 2026-09-10 Cross-Topic Isolation Follow-Up

- Exact-source run
  `20260910T063541600785Z-66f9f64175626498fe1e0a22aa0845b7`
  reached Browser `AS-F12 / en / single / sample-001`.
- Restart, payload/hash equality, branch selection, runtime binding, scope, and
  source-restart diagnostics all passed.
- Only `noCrossTopicReferences` failed; cleanup passed.
- The combined assertion currently hides whether the failure is message
  reference ownership, own/foreign fact visibility, or runtime matching.
- Next instrumentation reports only those subcondition booleans and invalid
  reference counts. It does not report message, topic, conversation, Turn,
  branch, runtime, or fact values.
- The first browser-side subcondition event was not persisted because the
  Python oracle rejected the complete capture and teardown immediately closed
  the renderer before its fire-and-forget request completed. The independent
  oracle will now include the same safe booleans plus invalid-reference counts
  in its failure diagnostics, without serializing any identity or content.
