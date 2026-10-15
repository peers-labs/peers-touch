# MPUB-03-MACOS-RUNTIME-PROOF: Main-Display Native Probe Proof

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"message-publishing-acceptance-20261015","taskId":"MPUB-03-MACOS-RUNTIME-PROOF","workstreamId":"MPUB-W05","title":"Prove the macOS Native runtime cell on the current display layout","workClass":"infrastructure","completionClass":"functional","executionMode":"fix","closureId":"message-publishing-macos-runtime-functional","journeyId":"MPUB-J01","runtimeClass":"source-only","writeSet":["tooling/acceptance/reports"],"readSet":["docs/architecture/engineering/acceptance","docs/knowledge/playbooks/desktop-debug-runtime.md","tooling/acceptance/provisioners/native_desktop_macos.py","tooling/acceptance/tests/test_native_desktop_macos.py","tooling/scripts/acceptance-cell.py"],"budgets":{"focusedCheckSeconds":300,"functionalRunSeconds":900,"cleanupSeconds":60},"checks":[{"id":"macos-runtime-probe-regression","command":"python3 -m unittest tooling.acceptance.tests.test_native_desktop_macos","verificationClass":"SOURCE_CHECK"},{"id":"macos-runtime-cell-functional","command":"sh -c 'trap \"make acceptance-cell-stop CELL=desktop-macos-native >/dev/null 2>&1 || true\" EXIT; make acceptance-cell-ready CELL=desktop-macos-native CELL_GATE=message-publishing-macos-runtime-functional'","verificationClass":"FUNCTIONAL_CHECK"}],"doneWhen":["the main-display positioning regression passes and the real macOS runtime-cell preflight reaches LEASED on the current host","probe cleanup removes the temporary process, screenshot, ports, and runtime-cell lease","the result proves runtime readiness only and makes no Message Publishing product claim"],"failureBehavior":["source-only unit success does not replace the real runtime-cell preflight","host permission or display failure remains BLOCKED rather than weakening probes","cleanup failure blocks progression"],"updatedAt":"2026-10-15T15:25:00.000Z"}
```

## Current Snapshot

Stable obligation: prove the corrected adapter contract before the product
Journey owns the macOS runtime cell.

## Closure

The current host can run the full fail-closed macOS Native adapter preflight.
