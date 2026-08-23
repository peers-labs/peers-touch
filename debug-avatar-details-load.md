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
| A | Details member projection supplies an empty or incorrect raw avatar URL. | High | Low | Pending |
| B | Rust avatar cache resolves a source, but the returned local URL cannot load in WKWebView. | High | Low | Pending |
| C | Details mounts before profile convergence and does not react to the updated member profile. | Medium | Medium | Pending |
| D | Only one source class, external or Station-relative, fails while other surfaces use a different resolved source. | Medium | Low | Pending |

## Instrumentation Plan
- Capture the complete per-PTID Details identity snapshot on every not-ready poll.
- Report raw source, canonical source, current image source, and loaded state.
- Retain exact actor, required surface, and source-bound Native run context.

## Log Evidence
Pending pre-fix instrumentation run.

## Verification Conclusion
Pending.
