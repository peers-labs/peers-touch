# Debug Session: native-window-activation
- **Status**: [OPEN]
- **Issue**: The source-bound Native Chat Gate times out while establishing
  cooperative focus even though macOS is unlocked and the target client emits a
  real window-focus lifecycle event.
- **Debug Server**: http://127.0.0.1:7781/event
- **Log File**: `.dbg/trae-debug-log-native-window-activation.ndjson`

## Reproduction Steps
1. Verify exact source, Station, and dedicated Acceptance binary identity.
2. Verify the macOS console has no `CGSSessionScreenIsLocked` marker.
3. Run `CHAT_ACCEPTANCE_RESET=1 CHAT_ACCEPTANCE_ALLOW_STATION_RESTART=1 make acceptance-chat-native-product-closure`.
4. Observe the first `group.create.ui` action entering `focus_actor_window()`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected signal | Evidence |
|----|------------|------------|--------|-----------------|----------|
| A | Cooperative activation reaches the target process but WKWebView never reports `document.hasFocus()`. | High | Low | Target PID owns the sampled point while `document.hasFocus()` remains false. | Pending |
| B | The title-bar sample point does not belong to the target Native window after activation. | High | Low | `document.hasFocus()` is true or a focus event fires, but the window stack reports another owner PID at the sampled point. | Pending |
| C | The requested process identity or frontmost application changes during activation. | Medium | Low | Requested PID differs from the frontmost PID or the target process disappears/relaunches. | Pending |

## Instrumentation
- Pending: emit bounded predicate snapshots before activation, after cooperative
  activation, and on timeout.
- Evidence must be persisted by the Gate report and the debug server without
  changing focus behavior or weakening the Native interaction contract.

## Verification Conclusion
Pending runtime evidence.
