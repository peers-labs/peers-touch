# Debug Session: direct-projection-role
- **Status**: [OPEN]
- **Issue**: Windows Product Closure commits and later lists the Alice/Bob Direct conversation, but the initiating Desktop UI remains in the failed intent state because `messaging_create_direct` returns an error.
- **Debug Server**: http://10.4.43.34:7777/event
- **Log File**: `.dbg/trae-debug-log-direct-projection-role.ndjson`

## Reproduction Steps
1. Deploy exact source to disposable station-four, station-five, and sixwin.
2. Run `chat-native-product-closure-e2e` in `desktop-windows-native`.
3. Alice searches for Bob and opens the exact friend result.
4. Observe the failed intent pane while the Direct conversation later appears in the local projection.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Direct creation commits, then the Tauri command fails because inbox validation requires a Group-style owner role. | High | Low | **Confirmed**: pre-fix log line 1028 reports `messaging conversation owner role is not projected`; later lines report `direct:1`. |
| B | Station emits an invalid Direct role set. | Low | Low | **Rejected**: the Conversation aggregate canonically assigns `member` to both Direct participants. |
| C | Station bootstrap invents an owner role for Direct and conflicts with the canonical inbox projection. | High | Low | **Confirmed**: bootstrap maps `owner_ptid` to `OWNER` without checking conversation kind. |
| D | UI ignores a successful command/projection after an earlier failure. | Medium | Low | **Confirmed as consequence**: failed intent remains visible with one durable Direct session row and no active pane. |

## Log Evidence
- Pre-fix Acceptance run: `20260907T153750428899Z-90da421fea631aa9b0f51ae3b958df1f`.
- Exact source: `a008a1c3282c3cbdc5c2bb36dc7c3286f92b452a`.
- Binary SHA-256: `3925e2d5bb831937f8668261fd9a6bb5255a2b6747686e54fbf690aab635d54f`.
- First failed step: `conversation.search.ui`.
- Runtime log sequence: Conversation projection count becomes one; queue drain repeatedly rejects `messaging conversation owner role is not projected`; UI remains `data-chat-conversation-intent-state="failed"`.
- Cleanup: `DONE/PROVEN`.
- Debug log lines 1-4 bind the runtime failure, canonical Station roles, bootstrap role synthesis, and failed UI intent.
- The focused Desktop binary unit-test target is independently blocked by pre-existing `application::auth::service` test-only import/type errors; this does not alter the runtime evidence.

## Verification Conclusion
Root cause confirmed: Desktop applies Group owner-role invariants to canonical
Direct projections. The fix must make Direct validation require two sorted
`MEMBER` participants with the deterministic owner metadata present, while
retaining exact `OWNER` enforcement for Group. Station bootstrap must project
the same kind-specific roles instead of inventing Direct ownership.

## Fix
- Desktop inbox validation now applies kind-specific Direct and Group role
  invariants.
- Station bootstrap projects Direct participants as `MEMBER` and reserves
  `OWNER` synthesis for Group.
- The Direct creation regression fixture now matches the canonical Station
  event.

## Post-Fix Evidence
- `cargo check --features acceptance-webdriver`: PASS.
- `station-messaging-unit`: `20260907T162201940480Z-ef80f18031688cbc36e95116b914a62e`.
- `messaging-platform-contract`: `20260907T162220659277Z-75ade6a5e23284b518a19e8793f7a97e`.
- `desktop-check`: `20260907T162250297926Z-b0986d285384583575acedb4b90a8302`.
- `chat-native-visible-static`: `20260907T162311315463Z-728ed72316862d015983e93b23cd90aa`.
- Exact-source Windows Product Closure
  `20260907T162910781782Z-6bab8cef6910f9f82faeae965d0eb0fc`
  proves first-open success, repeated deterministic reopen, and one active pane.
- Product Closure next failed at `group.create.ui`; cleanup remained
  `DONE/PROVEN`.

## Iteration: Group Create Gate
| ID | Hypothesis | Status | Evidence |
|----|------------|--------|----------|
| E | The runner clicks submit before React commits contact selection and enables the button. | Confirmed | The runner has no post-selection wait; Station received no `/conversation/group/prepare`; no Group row exists. |
| F | Product `handleFinish` rejects actor or Federation input. | Rejected | No frontend `createGroup failed` or validation feedback was emitted. |
| G | Group prepare reached Station and failed. | Rejected | Station request logs contain no `/conversation/group/prepare` for the failed interval. |
| H | Authority committed a Group but the clients failed to project it. | Rejected | station-four contains only the proven Direct; station-five contains no Conversation row. |

## Group Gate Fix
- The runner now waits for Bob's contact control to expose
  `aria-pressed="true"` and for the submit control to become enabled before
  issuing the native submit click.
- A bounded timeout captures the Alice DOM, screenshot, modal count, pane
  states, and submit state without weakening the Group product assertion.
- The focused synchronization test passes.
- Fresh local Gate runs pass:
  - `station-messaging-unit`:
    `20260907T171455773732Z-45ff86e160d98743abc4293f4bab99fd`;
  - `messaging-platform-contract`:
    `20260907T171455773750Z-ac295bc48df5b5c147413cd6c3a6d9d9`;
  - `desktop-check`:
    `20260907T171455773766Z-7a236d1a2c3514b2da8b0e80290de1cd`;
  - `chat-native-visible-static`:
    `20260907T171455773563Z-97c990c064491a98b727cfe253fbcdcf`.
- Exact-source Windows post-fix verification remains pending; the debug session
  stays `[OPEN]`.
