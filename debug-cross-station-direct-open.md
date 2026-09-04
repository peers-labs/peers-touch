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
| A | Native click reaches the DOM but the React selection handler does not run. | Medium | Low | Inconclusive: debug lines 1-3 prove the click reached the exact result, but the current probe does not observe handler entry. |
| B | The selection handler enters the existing-conversation branch with an invalid projection ID. | Low | Low | Rejected: after 120 seconds the search value remains `bob`, no session row is active, and no pane exists. The existing branch clears search synchronously. |
| C | `messaging_create_direct` starts but hangs or fails before returning a projected conversation. | High | Low | Inconclusive: no invoke event was captured, but handler entry is not yet observed independently of the invoke hook. |
| D | A duplicate login transition revokes the token used by the messaging engine. | High | Low | Confirmed: both clients run `auth_login -> refresh-current-session -> auth_restore_session`; the original worker token is rejected as `session_revoked:kicked` while restore succeeds with a replacement token. |
| E | The conversation is created but store selection/projection never becomes visible. | Medium | Low | Rejected for this run: no create success event, conversation pane, or session projection appeared. |

## Log Evidence
- Pre-debug Gate `20260904T045902948981Z-417027f393536e2374d0c23805f7e141`:
  exact source and client bindings passed; product failed waiting for Alice's
  first direct conversation; cleanup passed.
- Both client logs contain early `session_revoked: kicked` failures in the
  messaging lifecycle.
- Pre-fix run
  `20260904T053556542665Z-6aa174fec173c38d9b9c98594ba9e011`
  used exact source `63e830f6b50dafa02ad8c0a2b5f66491cf100059`,
  distinct station-four/station-five bindings, Windows WebView2, Win32
  `SendInput`, and a 1920x1080 GUI session. Product result was
  `PARTIAL/UNPROVEN`; cleanup was `DONE/PROVEN`.
- Debug log line 1 proves the exact station-five Bob result was ready.
- Debug log line 2 proves the native click reached that exact result; no
  create-direct event or pane was visible immediately afterward.
- Debug log line 3 proves the state remained unchanged for 120 seconds:
  search value `bob`, zero session rows, zero panes, and no visible feedback.
- Alice app log lines 96-115 prove `auth_login` succeeded, then
  `auth_restore_session` ran inside `refresh-current-session`; the original
  token was rejected as `kicked` before restore returned a replacement token.
  Bob app log lines 88-105 show the same sequence.

## Verification Conclusion
The duplicate Station session issuance is confirmed at the Desktop identity
reconciliation boundary. The minimal owner-layer correction is to validate and
project the already bound window session during `refresh-current-session`
instead of invoking takeover-style persisted-session restore.

The direct-open branch still needs one narrower post-fix observation: record
React handler entry, branch selection, and create-direct completion directly
from `ChatSessionList`. Existing instrumentation and the Debug Server remain
active until post-fix evidence and user confirmation.
