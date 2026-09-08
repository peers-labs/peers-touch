# Debug Session: as-f06-page-switch
- **Status**: [OPEN]
- **Issue**: The exact-source Foundation run times out while switching the Browser AS-F06 preparation surface from Agent chat to Settings.
- **Debug Server**: `http://127.0.0.1:7791/event`
- **Log File**: `.dbg/trae-debug-log-as-f06-page-switch.ndjson`

## Reproduction Steps
1. Use worktree `peers-ai-agent`, branch `feat/p0-streaming-runtime-message-actions`, and profile `chat-native-disposable`.
2. Deploy the exact clean source to the approved disposable Station and use the source-matched Acceptance Desktop assets.
3. Run `agent-v2-kernel-foundation-e2e` with the approved disposable reset and Station restart authorizations.
4. Observe Browser `AS-F06 / en / single / sample-001` during `foundationF06FinalizePreparation`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal | Evidence |
|----|------------|------------|--------|-----------------|----------|
| A | The `NAVIGATION_REQUESTED` subscriber is absent when finalization publishes the Settings request. | Medium | Low | Publication is reported, but no matching consumer-entry report follows. | Pending |
| B | The subscriber consumes the request, but the router page does not transition to `settings`. | Medium | Low | Consumer-entry is present while the post-dispatch page remains `agent`. | Pending |
| C | The router reaches `settings`, but the keep-alive Agent page leaves the composer visibly mounted. | High | Low | Router reports `settings` while composer count and visible count remain non-zero. | Pending |
| D | A later lifecycle or navigation action returns the router to `agent` before the wait observes the Settings surface. | Medium | Medium | Reports show `settings` followed by a second transition to `agent` during the same finalization trace. | Pending |

## Instrumentation
- `harness.ts:finalizeFoundationF06Preparation` reports the safe structural
  snapshot immediately before and after publication, then at completion or
  timeout.
- `useNavigation.ts` reports subscriber installation/removal, Settings request
  consumption, router dispatch, and the first post-render animation frame.
- Every snapshot contains only the URL hash, Settings navigation-event count,
  page-frame IDs/display/visibility, and composer presence/visibility.
- Debug Server session `as-f06-page-switch` is active on port `7791`; its log
  is cleared and configured as `runId=pre-fix`.

## Log Evidence
- Exact-source Gate run
  `20260908T102314913721Z-f9e3337ef779cc2f52b5c6a7908d26b6`
  on `a1f9d8c82edc013a02cf96f35982180299cd3e35` failed first at
  `foundation-browser-direct / browser / direct_model / AS-F06 / en / single /
  sample-001`.
- The failure was
  `timed out waiting for: Foundation AS-F06 page switch`.
- Source, Station, and provisioned runtime commits matched. Provisioner cleanup
  completed `DONE / PROVEN / passed`.
- Existing AS-F06 collectors cover recovery registration, failure-key, and
  replay-prefix behavior; none records this navigation boundary.
- Local instrumentation verification:
  - Desktop TypeScript check: PASS.
  - Desktop tests: PASS, `588/588`, with one unrelated environment-dependent
    test skipped.
  - Desktop production build: PASS.
  - Agent native static tests: PASS, `75/75`.
  - `git diff --check`: PASS.

## Verification Conclusion
Pending current-source instrumentation and exact-source reproduction. No
navigation behavior, timeout, Gate tuple, or assertion has been changed.
