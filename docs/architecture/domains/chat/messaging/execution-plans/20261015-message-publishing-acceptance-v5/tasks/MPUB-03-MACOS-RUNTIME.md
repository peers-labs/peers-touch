# MPUB-03-MACOS-RUNTIME: Main-Display Native Probe Source

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"message-publishing-acceptance-20261015","taskId":"MPUB-03-MACOS-RUNTIME","workstreamId":"MPUB-W05","title":"Place the macOS runtime-cell probe window on the main display","workClass":"infrastructure","completionClass":"source","executionMode":"fix","closureId":"message-publishing-macos-runtime-source","journeyId":"MPUB-J01","runtimeClass":"source-only","writeSet":["tooling/acceptance/provisioners/native_desktop_macos.py","tooling/acceptance/tests/test_native_desktop_macos.py"],"readSet":["docs/architecture/engineering/acceptance","docs/knowledge/playbooks/desktop-debug-runtime.md","tooling/acceptance/drivers/native/macos.py"],"budgets":{"focusedCheckSeconds":300,"functionalRunSeconds":1,"cleanupSeconds":30},"checks":[{"id":"macos-runtime-probe-source","command":"python3 -m unittest tooling.acceptance.tests.test_native_desktop_macos","verificationClass":"SOURCE_CHECK"}],"doneWhen":["the runtime-cell probe activates and moves only its own temporary Native window to the main display before pointer and point-ownership checks","negative-origin or stale persisted window placement cannot make all probe points off-screen","input, focus, point ownership, screenshot, process, port, and cleanup requirements remain fail-closed"],"failureBehavior":["do not bypass pointer, window-stack, focus, screenshot, process, or cleanup probes","do not mutate product window persistence or unrelated user windows","do not convert macOS Native proof to browser or Harness-only evidence"],"updatedAt":"2026-10-15T15:25:00.000Z"}
```

## Current Snapshot

Stable obligation: the runtime-cell probe must own a visible main-display
window before testing native input and window ownership.

## Closure

The macOS probe source handles negative-origin display layouts without
weakening any native adapter assertion.
