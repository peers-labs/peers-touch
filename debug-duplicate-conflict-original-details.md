# Debug Session: duplicate-conflict-original-details
- **Status**: [OPEN]
- **Issue**: Exact-source Browser `BASE-DUPLICATE_CONFLICT / zh-CN` now times out before the typed receiver surface appears; the earlier original-Turn details timeout did not reproduce.
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
| A | Locale rerender leaves the Harness holding a stale recovery-action node, so `.click()` does not reach the live handler. | High | Low | The captured node is disconnected or differs from the live selector at click time, and no portal transition follows. | Rejected for both locales: the node was live and the click was observed. |
| B | The recovery handler executes with an `existing_command_id` that differs from the original Turn ID. | Medium | Low | Hashed handler target differs from the hashed original Turn ID. | Rejected for both locales: the target matched the original Turn. |
| C | The recovery handler executes but never writes a `turnDetails` active view. | Medium | Low | Click dispatch is observed while portal state remains unchanged. | Rejected for both locales: one matching transition was recorded. |
| D | The portal briefly enters the expected `turnDetails` view and a later transition overwrites it before the Harness samples it. | Medium | Medium | A portal subscription records the expected view followed by another view. | Rejected for both locales: exactly one transition occurred. |
| E | The original Turn is absent from the client projection, so details loading rejects after navigation intent. | Medium | Medium | Portal target is correct but the details state reports missing/error rather than ready. | Rejected at click time: two original Turn messages including one assistant were present. |

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
- Exact-source C08 run
  `20260911T231620368290Z-b71583aba9e8415b4c964204c34edb19`
  on `43f94f5ef0838dd51ea458857e4f025ce135559a` is
  `DONE / PROVEN`, 19/19, with clean cleanup.
- Foundation run
  `20260911T231733779911Z-ca94e3b2c6d9c4870f95d3ddabee4c02`
  recorded four events for each locale. Both had a connected live recovery
  node, matching target identity, two original Turn messages including one
  assistant, an observed click, and exactly one matching `turnDetails`
  transition.
- The same run failed elsewhere at Browser English
  `BASE-INCOMPATIBLE_CAPABILITY` on `stationReadinessReadback` and
  `cleanupComplete`. Outer run
  `20260911T231733635029Z-de141411895995af4f41eeba257b284e`
  is `FAILED / PARTIAL / UNPROVEN`; Provisioner cleanup passed.

## Verification Conclusion
Hypotheses A-E are rejected for the exact-source run. The previous
duplicate-conflict timeout did not reproduce, both locale cells completed their
real click-to-portal transition, and no correction is justified from current
evidence. The session remains `[OPEN]`; instrumentation and the collector are
retained until the enclosing Foundation proof is complete or the user
authorizes cleanup.

## Iteration 2: Receiver Projection Boundary

Exact-source C08 run
`20260913T012013690791Z-a87dd97ff5c3a0acf76621e915eaa84d`
on `acf98eb3bd0f59a206351488777f89d7a64106e4` completed
`DONE / PROVEN`. The same-source Foundation run
`20260913T013756664860Z-5244311931c42973f9cfccf9571b6c72`
crossed AS-F10 after the prior transient and failed first at Browser
`BASE-DUPLICATE_CONFLICT / zh-CN / single / sample-001` while waiting for
`duplicate conflict receiver`. Outer Provisioner cleanup completed
`DONE / PROVEN / passed`.

This failure occurs after both the typed Station event and the `onRejected`
callback have been observed, but before the existing click/Portal
instrumentation begins.

| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| F | The typed rejection reaches the Harness, but the production store has not projected it when the receiver wait begins. | High | Low | Event/callback snapshots lack the typed assistant, followed by a later store transition. |
| G | The current session changes, so the rejection is retained only in the conversation buffer and not the visible message list. | Medium | Low | `currentSessionMatches=false`, buffered typed conflict count is positive, and visible typed conflict count is zero. |
| H | The store contains the typed assistant, but the rendered DOM omits or normalizes the expected error-type attribute. | Medium | Low | Visible store typed conflict count is positive while the DOM conflict count remains zero. |
| I | The receiver appears transiently and is replaced by a session or locale rerender before the wait samples it. | Low | Medium | An intermediate observation has a positive DOM conflict count followed by a timeout snapshot with zero. |

The next instrumentation records only locale, booleans, counts, operation
status, loading state, stable typed-error codes, and presence of the already
observed event/callback. It records no message content, raw IDs, actor identity,
credentials, or provider payload.

## Local Verification
- Agent Acceptance tests: `418/418` PASS.
- Desktop Vitest: `622/622` PASS with one existing environment-only skip.
- Desktop strict check: PASS.
- Desktop production build: PASS.
- `git diff --check`: PASS.
