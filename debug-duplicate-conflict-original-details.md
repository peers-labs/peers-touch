# Debug Session: duplicate-conflict-original-details
- **Status**: [OPEN]
- **Issue**: Exact-source Browser `BASE-DUPLICATE_CONFLICT / zh-CN` times out waiting for the original Turn details view after the localized recovery action is clicked.
- **Debug Server**: `http://127.0.0.1:7793/event`
- **Log File**: `.dbg/trae-debug-log-duplicate-conflict-original-details.ndjson`

## Reproduction Steps
1. Use the verified `peers-ai-agent` worktree and exact-source Station.
2. Run C08 and require `DONE / PROVEN`.
3. Run the unchanged `agent-v2-kernel-foundation-e2e`.
4. Observe Browser `BASE-DUPLICATE_CONFLICT / zh-CN / single / sample-001`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal | Evidence |
|----|------------|------------|--------|-----------------|----------|
| A | Locale rerender leaves the Harness holding a stale recovery-action node, so `.click()` does not reach the live handler. | High | Low | The captured node is disconnected or differs from the live selector at click time, and no portal transition follows. | Pending |
| B | The recovery handler executes with an `existing_command_id` that differs from the original Turn ID. | Medium | Low | Hashed handler target differs from the hashed original Turn ID. | Pending |
| C | The recovery handler executes but never writes a `turnDetails` active view. | Medium | Low | Click dispatch is observed while portal state remains unchanged. | Pending |
| D | The portal briefly enters the expected `turnDetails` view and a later transition overwrites it before the Harness samples it. | Medium | Medium | A portal subscription records the expected view followed by another view. | Pending |
| E | The original Turn is absent from the client projection, so details loading rejects after navigation intent. | Medium | Medium | Portal target is correct but the details state reports missing/error rather than ready. | Pending |

## Instrumentation Plan
- Record only booleans, locale, view types, counts, and SHA-256 hashes of Turn IDs.
- Record recovery-node connectivity and live-node identity immediately before click.
- Subscribe to portal transitions before click and record each transition until the wait completes or times out.
- Record the post-click active view and original Turn projection presence.
- Do not record Turn IDs, message content, actor identity, credentials, or payloads.

## Instrumentation
- The Harness records the live recovery-node identity, locale, visibility,
  typed target equality, original Turn projection counts, and initial portal
  state before click.
- A one-shot DOM listener proves whether the click reaches the selected node.
- A temporary portal-store subscription records every view transition and
  whether its Turn target matches the original Turn.
- Timeout evidence records click/transition counts, final portal view,
  original Turn projection counts, and the rendered details state.
- The instrumentation does not change product behavior, Gate assertions,
  tuples, or timeouts.

## Log Evidence
- Foundation run
  `20260911T222932042410Z-f62cac19455ffd1a5c5bb8bd182423b4`
  on `07351dcf4f28fd8b81a2de58f493609b7086177a` crossed
  `BASE-CONTEXT_OVERFLOW` and failed first at Browser
  `BASE-DUPLICATE_CONFLICT / zh-CN / single / sample-001`.
- Failure:
  `timed out waiting for: duplicate conflict original turn details`.
- Outer run
  `20260911T222931919783Z-035e57e4db549bbe72107ed12eb1db2f`
  is `FAILED / PARTIAL / UNPROVEN`.
- Provisioner cleanup is `DONE / PROVEN / passed`.
- Context-overflow pre/post telemetry showed both `en` and `zh-CN` receiver
  text, recovery visibility, focus, and reduced-draft behavior were correct.

## Verification Conclusion
Pending pre-fix instrumentation.

## Local Verification
- Desktop strict check: PASS.
- `git diff --check`: PASS.
