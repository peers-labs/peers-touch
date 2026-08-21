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
