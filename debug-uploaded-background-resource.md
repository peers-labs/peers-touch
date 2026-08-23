# Debug Session: uploaded-background-resource
- **Status**: [OPEN]
- **Issue**: Native Chat background upload and Station projection recover, but the uploaded background CSS resource never reaches a loaded image state.
- **Debug Server**: http://127.0.0.1:7779/event
- **Log File**: `.dbg/trae-debug-log-uploaded-background-resource.ndjson`

## Reproduction Steps
1. Build the dedicated `acceptance-webdriver` Desktop binary from exact HEAD.
2. Deploy the same HEAD to Profile Three.
3. Run `CHAT_ACCEPTANCE_RESET=1 CHAT_ACCEPTANCE_ALLOW_STATION_RESTART=1 python3 tooling/scripts/acceptance-run.py --gate chat-native-product-closure-e2e`.
4. Observe `background_upload_recovery` pass, followed by timeout waiting for `uploaded background CSS resource`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Rust authenticated attachment cache request construction fails before a local mirror is created. | High | Low | Confirmed: resolver returns `host=self`, and the cache GET reports `oss network error: builder error`. |
| B | Resolver fallback returns a URL that CSS loads without required Station authentication. | High | Low | Confirmed: fallback is `self/sub-oss/file?...`, WKWebView resolves it under `tauri://localhost`, and the private Station object returns 403 without bearer auth. |
| C | The resource loads, but Gate CSS extraction or image probing misclassifies the computed background. | Medium | Low | Rejected: the probe extracts the exact CSS URL and receives an image error with zero dimensions. |
| D | Projection/render ordering leaves the rendered CID or resolved URL behind the final Station background reference. | Medium | Medium | Rejected: projected reference, hook CID, and CSS key are identical in the failing run. |

## Instrumentation Plan
- Report the `ossResolveUrl()` result shape and the source selected by `useOssAttachmentUrl`.
- Report the active conversation background reference and resolved render URL.
- Report each distinct Gate background resource snapshot, including computed CSS, extracted source, loaded/error state, and dimensions.

## Log Evidence
Instrumentation source checks:
- Desktop `pnpm run check`: PASS.
- Native Chat static suites: 57/57 PASS.
- `git diff --check`: PASS.

Pre-fix Native run:
- Run `20260823T162313856137Z-fe189b365c4727d2a9a3d090b52d0e48` reproduces the timeout at `uploaded background CSS resource`.
- Debug log line 25: `ossResolveUrl()` returns `host=self`, no local path or data URL, and selects `self/sub-oss/file?...`.
- Debug log line 27: computed CSS resolves that fallback to `tauri://localhost/self/sub-oss/file?...`.
- Debug log line 28: the image probe reports `errored=true`, `loaded=false`, and zero dimensions.
- Direct unauthenticated GET of the same private object returns HTTP 403.
- Runtime cleanup evidence passes; actor ports 3330/3331 and WebDriver ports 4445/4446 are released.

## Verification Conclusion
The Rust OSS cache accepts `self` as a bound-station sentinel but preserves the
Station capability response's `host=self`. It therefore constructs an invalid
relative cache URL and returns the same value as the renderer fallback. Even
after host canonicalization, this private object requires the current local
session bearer for the cache GET. The fix belongs in the Rust OSS cache:
canonicalize the sentinel to the configured Station origin and authenticate
the bound-station mirror request.

Post-fix Native run
`20260823T163659827915Z-24fcd3bb8f461899848653911281dc25`
passed `background_rendered` and `settings_station_readback`. Debug log lines
25-28 show the resolver returning the bound local gateway host, an authenticated
cache file, and an inline PNG that loads at `1x1`. The overall Gate then
advanced to `attachment.failure.ui`, where an outgoing Ant modal transition
still intercepted the next Native click. That later harness synchronization
failure does not invalidate the background resolver fix.
