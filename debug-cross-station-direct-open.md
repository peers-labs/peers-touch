# Debug Session: cross-station-direct-open
- **Status**: [OPEN]
- **Issue**: The Windows native Chat Gate selects the exact station-five Bob search result, but Alice's direct conversation does not open.
- **Debug Server**: `http://100.86.255.160:7777/event`
- **Log File**: `.dbg/trae-debug-log-cross-station-direct-open.ndjson`

## Reproduction Steps
1. Deploy the exact source commit to station-four and station-five.
2. Ensure both disposable Stations use the shared DHT and Relay topology.
3. Run `chat-native-product-closure-e2e` through `desktop-windows-native`.
4. Log Alice and Bob into their separately bound native clients.
5. Search for Bob from Alice and click the exact PTID result.
6. Observe that no direct conversation pane opens within 120 seconds.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Native click reaches the DOM but the React selection handler does not run. | Medium | Low | Signal: click observed with no search-state or invoke transition. |
| B | The selection handler enters the existing-conversation branch with an invalid projection ID. | Low | Low | Signal: active ID changes to the peer PTID without a create command. |
| C | `messaging_create_direct` starts but hangs or fails before returning a projected conversation. | High | Low | Signal: invoke starts without success, or records a typed rejection. |
| D | A duplicate login transition revokes the token used by the messaging engine. | High | Low | Signal: command rejection or runtime log reports `session_revoked`. |
| E | The conversation is created but store selection/projection never becomes visible. | Medium | Low | Signal: invoke succeeds with an ID while pane/session projection stays absent. |

## Log Evidence
- Pre-debug Gate `20260904T045902948981Z-417027f393536e2374d0c23805f7e141`:
  exact source and client bindings passed; product failed waiting for Alice's
  first direct conversation; cleanup passed.
- Both client logs contain early `session_revoked: kicked` failures in the
  messaging lifecycle.
- No current evidence distinguishes handler non-entry from a pending or failed
  `messaging_create_direct` command.

## Verification Conclusion
Pending instrumentation and pre-fix reproduction.
