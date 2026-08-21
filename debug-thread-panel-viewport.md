# Debug Session: thread-panel-viewport
- **Status**: [OPEN]
- **Issue**: The real Thread panel opens and proves exact data, but its close control is rendered outside the narrow Alice actor viewport.
- **Debug Server**: http://127.0.0.1:7779/event
- **Log File**: `.dbg/trae-debug-log-thread-panel-viewport.ndjson`

## Reproduction Steps
1. Run `CHAT_ACCEPTANCE_RESET=1 make acceptance-chat-native-product-closure`.
2. Create the Alice/Bob MLS group and complete the real Reply journey.
3. Hover the root row and click the real Thread action.
4. Observe `thread_exact=PASS`.
5. Attempt to click `[data-chat-thread-close]`; its rect is `x=1080..1108` while the viewport width is `864`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected signal |
|----|------------|------------|--------|-----------------|
| J | The Chat page retains a desktop minimum width larger than the actor viewport | High | Low | Confirmed: layout `clientWidth=806`, `scrollWidth=1068` |
| K | The fixed-width Thread panel is appended after a non-shrinking conversation pane | High | Low | Confirmed: pane `380px` plus panel `360px` begins after the `48px + 280px` rails |
| L | The acceptance-only Tauri resize does not propagate to the React layout | Low | Low | Rejected: viewport width is `864` and layout right edge is exactly `864` |
| M | The selector resolves a hidden duplicate Thread panel | Low | Low | Rejected: `closeControlCount=1` |
| N | The panel is visible but a transformed ancestor corrupts WebDriver geometry | Medium | Low | Rejected: pane/panel/control rects match the measured width sum |

## Log Evidence
Initial Native run:
`20260821T080712872082Z-f8e3af1719281cf80fd3aeebc8ff427d`.

- `thread_exact=PASS`.
- Close rect: `left=1080`, `right=1108`, viewport width `864`.
- All five center/inset hit probes were outside the document and returned no target.
- Cleanup released `3330`, `3331`, `4445`, and `4446`.

## Verification Conclusion
Run `20260821T081456014220Z-16471cb2799c220be5153b72b3dbdcde`
confirmed a responsive layout ownership defect. The page keeps the `280px`
conversation list while opening a `360px` side panel beside a non-shrinking
`380px` conversation pane, producing `1068px` of content inside an `806px`
layout viewport. The Desktop Chat contract requires a narrow window to degrade
toward a single conversation pane. The fix belongs in `SocialChatPage`: when a
side panel is open below the Desktop narrow breakpoint, hide the conversation
list rail, disable horizontal scrolling, and allow the conversation pane to
shrink. The Thread panel remains a normal sibling and does not overlay readable
message content.

Post-fix run:
`20260821T082035385490Z-faae0c63f2931335197d41fe3dd5bccd`.

- `layout.clientWidth` and `layout.scrollWidth` both measured `806`.
- The conversation pane moved to `x=106..504`; the Thread panel occupied
  `x=504..864`; the close control occupied `x=818..846`.
- `thread_exact=PASS`, the real close click completed, and the Gate advanced to
  the next independent failure: `timed out waiting for Alice complete
  transcript`.
- Cleanup released `3330`, `3331`, `4445`, and `4446`.

The narrow Thread-panel viewport defect is fixed in dirty runtime evidence. The
debug session remains open until user confirmation and clean source-bound
verification; instrumentation is intentionally retained.
