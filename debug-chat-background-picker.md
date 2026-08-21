# Debug Session: chat-background-picker
- **Status**: [OPEN]
- **Issue**: The real Native background Select click leaves no visible, enabled option for the MP-W13 product closure Gate.
- **Debug Server**: http://127.0.0.1:7783/event
- **Log File**: `.dbg/trae-debug-log-chat-background-picker.ndjson`

## Reproduction Steps
1. Run `CHAT_ACCEPTANCE_RESET=1 make acceptance-chat-native-product-closure`.
2. Complete the real Native Thread, Reaction, identity, Mute, and Pin journeys.
3. Open the background Modal and click `[data-chat-background-select]`.
4. Observe a timeout waiting for two visible, enabled background options.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected signal |
|---|---|---|---|---|
| A | The Native click reaches the Select root but does not open the dropdown | High | Low | Select click acknowledgement exists while `aria-expanded` stays false and no popup becomes visible |
| B | The dropdown opens and immediately closes during the same Native input/focus transition | High | Low | Mutation/event timeline records visible popup creation followed by removal before option lookup |
| C | Ant Design exposes rendered options through a different visible node shape than `[role=option]` | Medium | Low | Popup is visible and `.ant-select-item-option` nodes are visible while role options are hidden |
| D | The popup portal renders but is occluded by the Modal mask or another layer | Medium | Low | Popup and options have non-empty rects but `elementFromPoint` belongs to a different overlay |
| E | The Gate resolves a stale or non-current background Select | Low | Low | The selected node is disconnected, hidden, or belongs to a different Modal than the visible popup |
| F | The option rect moves during popup animation and the Native point lands on Calm instead of Paper | High | Low | Pre-click option target is Paper but the captured click target is Calm |
| G | Selenium option order differs from rendered visual order | Medium | Low | `options[1]` text is not Paper before the Native click |
| H | Paper receives the click but the product `onChange` maps it to Calm | Low | Low | Captured click target is Paper while the resulting Select text and Station patch are Calm |
| I | The selected WebElement is reused for another virtual option before click | Medium | Low | The same element changes text or rect between option resolution and the captured click |
| J | Selenium's default local file detector calls an unsupported remote upload endpoint before the product input receives the path | High | Low | Stack enters `WebElement._upload` and `Command.UPLOAD_FILE`; Embedded WebDriver returns `Not Found` |
| K | Sending the local path directly through the Embedded WebDriver element-value endpoint is a valid Native file selection path | Low | Low | Plugin implementation constructs a real `FileList` without script mutation or synthetic events |
| L | The visible product upload control opens the real WKWebView/macOS file chooser | High | Medium | CoreGraphics click is acknowledged, the webview loses focus to a Native panel, and no product handler runs before selection |
| M | CoreGraphics keyboard input plus macOS Accessibility state can select a path in the real chooser and produce a DOM `FileList/onChange` acknowledgement | Medium | Medium | Native panel lifecycle and focused control transitions complete, then the input exposes the selected filename/count |

## Log Evidence
Pre-fix source-bound run:
`20260821T113231993752Z-6029622db9e5c85081b5c7e4b085d7b7`.

| ID | Status | Evidence |
|---|---|---|
| A | Rejected | Lines 2-12 record the full Native pointer/mouse/click sequence and `aria-expanded=true` |
| B | Rejected | Lines 2-12 contain one popup add mutation, no removal, and the dropdown remains open for the full timeout |
| C | Confirmed | Lines 4-12 show six `.ant-select-item-option` nodes with visible `384x32` rects while both `[role=option]` nodes remain zero-width virtual nodes |
| D | Rejected | Lines 4-12 show each rendered option center hits its own `.ant-select-item-option-content` |
| E | Rejected | Lines 1-12 show the Select remains connected, focused, visible, and owned by the current visible Modal |

## Verification Conclusion
The Ant Design virtual list exposes zero-width accessibility nodes through
`[role=option]`; Selenium correctly reports those nodes as not displayed. The
real Native targets are the visible `.ant-select-item-option` nodes. The Gate
must wait for and click the rendered option class while retaining CoreGraphics
input and DOM acknowledgement. Product Select behavior is correct and requires
no UI change.

Post-fix source-bound run:
`20260821T114156898577Z-dcc3c233dc722109f3305125f0e2fc39`.

- The Gate no longer timed out resolving or clicking a rendered option.
- The real UI action reached Station and persisted `background="calm"`.
- The Gate then timed out waiting for its expected `background="paper"`.
- The current picker probe stops before reporting the option click target, so
  hypotheses F-I remain inconclusive pending one instrumentation-only run.

Target-trace source-bound run:
`20260821T115041469608Z-d695551f1a951ba42bee418499bbe071`.

| ID | Status | Evidence |
|---|---|---|
| F | Rejected | Lines 5-6 show the intended option and every captured Native event target were both Dusk |
| G | Confirmed | Line 5 shows `visible_options()[1]` resolved to Dusk while the complete rendered DOM order remained Default, Paper, Mint, Dusk, Calm, Graphite |
| H | Rejected | The captured Dusk click produced the matching Station patch `background="dusk"` |
| I | Rejected | The intended node stayed connected and retained Dusk text through the click |

The second root cause is indexing after an animation-sensitive visibility
filter. The Gate must select the second node from the complete stable rendered
option order, then let `click_element` wait for that specific Paper node to
become visible and enabled.

Stable-order source-bound run:
`20260821T115837563032Z-8a281cd46cd8fd89ebaefed3e466135b`.

- The intended option and every captured Native event target were Paper.
- The product action and Station write both committed `background="paper"`.
- The next failure occurred while reopening Background: the completed Modal
  was still in its leave transition and `.ant-modal-wrap` occluded the Details
  action.
- `open_background_modal` must reuse an active background Modal and otherwise
  wait for any blocking Modal wrap to leave before posting the next Native
  click. Fixed sleeps and product animation changes are rejected.

Modal-lifecycle source-bound run:
`20260821T120502833852Z-46d0f77e8ee16dd8cd86b932b04a8203`.

| ID | Status | Evidence |
|---|---|---|
| J | Confirmed | The Gate reached `[data-chat-background-input].send_keys(...)`; Selenium 4.36 entered `WebElement._upload`, issued `Command.UPLOAD_FILE`, and the Embedded WebDriver returned `Not Found` before invoking the element-value command |
| K | Rejected | `tauri-plugin-wdio-webdriver` v1.3.0 has no `/session/{id}/se/file` route; its `/element/{id}/value` implementation assigns `HTMLInputElement.value` from JavaScript and dispatches synthetic `input/change` events, which cannot construct a legal file selection and violates the Native-only Gate |
| L | Pending | The product control and hidden input are connected, but the latest run bypassed the visible upload control and therefore did not observe a real chooser |
| M | Pending | No OS-level chooser interaction was attempted in the latest run |

The next instrumentation/fix must preserve the actual user path: CoreGraphics
click on `[data-chat-background-upload]`, event-driven detection of the macOS
file panel, OS-level path entry and confirmation, and a DOM readback proving the
selected `FileList` reached the product `onChange`. Direct `send_keys` to hidden
file inputs, JavaScript value assignment, synthetic `dispatchEvent`, store
mutation, and command/harness selection remain forbidden.
