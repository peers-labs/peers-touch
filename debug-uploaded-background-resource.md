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
| A | Rust authenticated attachment cache request construction fails before a local mirror is created. | High | Low | Pending: capture resolver result and correlate with the existing `builder error`. |
| B | Resolver fallback returns a URL that CSS loads without required Station authentication. | High | Low | Pending: capture `data_url`, `local_path`, fallback `url`, selected `src`, and image probe result. |
| C | The resource loads, but Gate CSS extraction or image probing misclassifies the computed background. | Medium | Low | Pending: capture computed CSS, extracted source, dimensions, and error state. |
| D | Projection/render ordering leaves the rendered CID or resolved URL behind the final Station background reference. | Medium | Medium | Pending: correlate projected reference, hook input, resolved source, and final CSS in one Native run. |

## Instrumentation Plan
- Report the `ossResolveUrl()` result shape and the source selected by `useOssAttachmentUrl`.
- Report the active conversation background reference and resolved render URL.
- Report each distinct Gate background resource snapshot, including computed CSS, extracted source, loaded/error state, and dimensions.

## Log Evidence
Instrumentation source checks:
- Desktop `pnpm run check`: PASS.
- Native Chat static suites: 57/57 PASS.
- `git diff --check`: PASS.

Pending pre-fix Native reproduction.

## Verification Conclusion
Pending runtime evidence. No business logic modification is permitted before the hypotheses are resolved.
