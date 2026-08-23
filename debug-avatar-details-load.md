# Debug Session: avatar-details-load
- **Status**: [OPEN]
- **Issue**: Native `identity.station.dom` times out because at least one Details avatar never reaches a loaded image state.
- **Debug Server**: http://127.0.0.1:7778/event
- **Log File**: `.dbg/trae-debug-log-avatar-details-load.ndjson`

## Reproduction Steps
1. Build the `acceptance-webdriver` Desktop binary from exact HEAD.
2. Deploy the same HEAD to Profile Three.
3. Run `CHAT_ACCEPTANCE_RESET=1 CHAT_ACCEPTANCE_ALLOW_STATION_RESTART=1 python3 tooling/scripts/acceptance-run.py --gate chat-native-product-closure-e2e`.
4. Observe `timed out waiting for alice loaded avatar surfaces ['details']`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Details member projection supplies an empty or incorrect raw avatar URL. | High | Low | Confirmed: Alice receives a Station-relative source that raw `<img>` cannot resolve from the Tauri origin. |
| B | Rust avatar cache resolves a source, but the returned local URL cannot load in WKWebView. | High | Low | Rejected: the Details component never invokes the shared resolver; runtime logs show `avatar_resolve_local` succeeds elsewhere. |
| C | Details mounts before profile convergence and does not react to the updated member profile. | Medium | Medium | Rejected: both final member sources are present and Bob loads successfully. |
| D | Only one source class, external or Station-relative, fails while other surfaces use a different resolved source. | Medium | Low | Confirmed: Station-relative Alice fails while external Bob loads. |

## Instrumentation Plan
- Capture the complete per-PTID Details identity snapshot on every not-ready poll.
- Report raw source, canonical source, current image source, and loaded state.
- Retain exact actor, required surface, and source-bound Native run context.

## Log Evidence
- Native run
  `20260823T154640828949Z-7d91fb4d44962b9909df53fc55a618e7`
  reproduced the same Alice Details timeout with exact source/build/runtime identity.
- Line 1: Alice source is `/sub-oss/file?...`, current source becomes
  `tauri://localhost/sub-oss/file?...`, and `naturalWidth=0`.
- Line 2: Bob's external HTTPS source loads with `naturalWidth=1832`.
- Desktop runtime logs show `avatar_resolve_local` succeeds for the same
  Station-relative source on surfaces using `SquareAvatar`.

## Verification Conclusion
`ChatDetailPanel.MemberAvatar` bypasses the shared resolver-backed
`SquareAvatar` and sends a Station-relative media identity directly to a raw
`img`. WKWebView resolves that path against the `tauri://localhost` transport,
so the identity is correct but the image request is not.

Minimal fix: render Details member images through `SquareAvatar`, preserving
the raw `data-chat-avatar-src` identity on the outer member surface while
resolving the image through the Rust avatar cache. Instrumentation remains
active for post-fix comparison.
