# Debug Session: reaction-picker-focus
- **Status**: [OPEN]
- **Issue**: Native keyboard traversal can skip the reaction trigger before Enter activation.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: `.dbg/trae-debug-log-reaction-picker-focus.ndjson`

## Reproduction Steps
1. Build the `acceptance-webdriver` Desktop binary from exact HEAD.
2. Deploy the same HEAD to Profile Three.
3. Run `CHAT_ACCEPTANCE_RESET=1 make acceptance-chat-native-product-closure`.
4. Observe the timeout in `prove_keyboard_reaction_picker`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Native Return does not reach the reaction trigger handler. | Medium | Low | Confirmed as downstream symptom: no Return event reached reaction. |
| B | The picker opens before its first reaction button can be focused. | Medium | Low | Rejected: no picker-open event occurred. |
| C | Focus reaches the picker, then the blur close timer removes the overlay. | High | Low | Rejected: no picker focus or picker-state blur event occurred. |
| D | Focus is redirected to another element after the picker opens. | Medium | Low | Confirmed at an earlier boundary: a second unsynchronized Tab moved focus from reaction to pin before Return. |

## Log Evidence
- Line 3: focus reached `data-message-action="reaction"`.
- Line 4: the reaction trigger received another `Tab`, not `Enter`.
- Lines 5-6: focus moved from reaction to `data-message-action="pin"`.
- No `picker open requested` or `picker focus transfer completed` event exists.
- Post-fix lines 1-7: focus moved `thread -> reaction`, the reaction trigger
  received `Enter`, the picker opened, and the first emoji button retained
  focus.
- Native run
  `20260823T152722156227Z-6455d091a25364eb575cd9428173ef3d`
  passed `toolbar_keyboard_reachable` and `reaction_picker_success`.

## Verification Conclusion
The Native runner reads focus immediately after posting a CoreGraphics Tab. The
read can observe the previous action and post another Tab before WKWebView has
processed the first event, skipping the reaction trigger. The product picker
open and focus lifecycle was not reached in the pre-fix reproduction.

Minimal fix: after each native Tab event, the Chat Gate now waits until
`document.activeElement[data-message-action]` changes before deciding whether
to send another Tab. Product behavior changes that were not supported by the
evidence were removed; the localized accessible label remains.

Post-fix evidence confirms the keyboard focus defect is fixed. The overall Gate
remains failed at a later reaction retry boundary because a transient React
retry element was cached across a re-render and became stale before native
click delivery. Debug instrumentation and the server remain active until the
user confirmation gate permits cleanup.
