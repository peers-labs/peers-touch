# Debug Session: interaction-projection-loss
- **Status**: [OPEN]
- **Issue**: During the Native interaction retry Gate, the Engine retains the committed message projection while the frontend Acceptance projection reports the message as missing for the full bounded wait.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-interaction-projection-loss.ndjson

## Reproduction Steps
1. Run `chat-native-interactions-e2e` on `desktop-linux-native` against the disposable Station.
2. Create a Direct message and verify it on Alice and Bob.
3. Route Alice through the submit fault proxy and arm one connection loss.
4. Submit an edit and wait for the Engine intent and outbox to reach `retry_wait`.
5. Observe whether the original message remains in the Rust projection, frontend store projection, and visible DOM.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | A concurrent `loadMessages` request overwrites the conversation store with an empty result after the Station endpoint switch. | High | Medium | Pending |
| B | The Harness and Engine snapshot read different active profile or Engine instances during endpoint switching. | Medium | Medium | Pending |
| C | Preparing the retrying edit temporarily removes the committed message row from the conversation projection query. | Medium | Medium | Pending |
| D | The Rust projection remains present but TypeScript projection mapping or filtering drops the message. | Medium | Low | Pending |

## Log Evidence
- Pre-fix Gate run `20260829T023644548452Z-8983d0bd277b21b69d93e766da7eaa4e` failed after 120 seconds.
- The last Harness state was `present=False, contentState=missing, edited=None`.
- The Gate had already observed the Engine intent and outbox in `retry_wait`.
- Runtime-cell and provisioner cleanup both passed.

## Instrumentation
- `apps/desktop/src/acceptance/chat/harness.ts`: expose raw and mapped store state before and after the existing conversation refresh.
- `tooling/acceptance/gates/chat/native_interactions_runner.py`: report retry-wait Engine state, Rust list output, Harness state, and DOM state to the Debug Server.
- Instrumentation is read-only and does not change Gate assertions, retry timing, product state, or cleanup behavior.

## Verification Conclusion
Pending instrumentation and a clean pre-fix reproduction.
