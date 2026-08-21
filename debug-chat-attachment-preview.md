# Debug Session: chat-attachment-preview
- **Status**: [OPEN]
- **Issue**: A real Native chooser produces two ready Composer attachment drafts, but the image preview reports `complete=false` or `naturalWidth=0`.
- **Debug Server**: Existing project Debug Servers on ports 7783 and 7785 remain open; the Gate report is the source-bound evidence channel for this session.
- **Log File**: External Acceptance Evidence Store run artifacts.

## Reproduction Steps
1. Build and deploy clean source `e87b8e583a381791f961213f2eec972905e58570`.
2. Run `make acceptance-driver-smoke`.
3. Run `CHAT_ACCEPTANCE_RESET=1 PT_STATION_SKIP_DEPLOY=true python3 tooling/scripts/acceptance-run.py --gate chat-native-product-closure-e2e`.
4. Observe run `20260821T224443129311Z-7f8175117fbd47011f341b3702110dfe`.
5. Confirm `attachment_failure_draft_retained` passes, then inspect the first ready image draft.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected signal |
|---|---|---|---|---|
| A | The preview source remains an `oss://` URI that WKWebView cannot decode directly. | High | Low | Draft metadata is ready, but the image `src` has the `oss:` scheme and `naturalWidth=0`. |
| B | A blob/object preview URL is revoked before the image finishes decoding. | Medium | Medium | The image `src` is `blob:`, followed by an error event or an unreachable object URL. |
| C | The generated PNG fixture bytes are invalid or unsupported. | Medium | Low | The local fixture fails independent image decoding or the DOM image emits an error for an otherwise reachable URL. |
| D | The Gate samples before the image reaches its load/error terminal state. | Medium | Low | A later transition changes `complete` or `naturalWidth` without any source mutation. |
| E | The selector resolves the wrong ready draft or a non-image preview. | Low | Low | The selected draft metadata has a non-image MIME/name or differs from the intended fixture. |

## Log Evidence
- Run `20260821T224443129311Z-7f8175117fbd47011f341b3702110dfe` is source-bound to clean source and Station `e87b8e583`.
- `background_upload_recovery`, `settings_station_readback`, and `attachment_failure_draft_retained` passed.
- The first failure is `GateError: Composer image preview did not load`.
- The preserved Alice native app log records:
  `tauri::protocol::asset: asset protocol not configured to allow the path: .../w13-image.png`.
- `messaging_pick_attachment_source` returns the selected external path without adding
  that exact file to Tauri's asset protocol scope.
- Cleanup released `3330`, `3331`, `4445`, `4446`, and `65425`.

## Verification Conclusion
| ID | Status | Evidence |
|---|---|---|
| A | Confirmed | Tauri rejects the exact selected image path because it is outside the asset allowlist. |
| B | Rejected | The preview source is an `asset:` URL created from a native path, not an owned blob URL. |
| C | Rejected | The same PNG bytes uploaded successfully as the Background image before this step. |
| D | Rejected | The native protocol emits a terminal authorization rejection; waiting cannot make the path readable. |
| E | Rejected | The selected element is an image under a ready draft and Tauri logs the intended `w13-image.png` path. |

The root cause is confirmed at the Desktop Rust picker boundary. The picker must
grant Tauri asset access to the exact regular file selected by the user before the
renderer receives the path. Product behavior remains `UNPROVEN` until the post-fix
Native Gate proves preview load and the downstream attachment ledger.

## Fix Under Verification
- `messaging_pick_attachment_source` now grants asset protocol access to the exact
  selected regular file before returning it to the renderer.
- Engine-staged browser and capture sources use the same exact-file helper so every
  local attachment path returned to the renderer has the same preview contract.
- Scope failures remain typed failures; Engine-managed staged files are removed on
  the failure path.
- Static Chat Gate: `20/20 PASS`.
- Desktop TypeScript check: `PASS`.
- Rust `acceptance-webdriver` compile: `PASS` with pre-existing warnings.
- Post-fix Native Gate: not run yet.
