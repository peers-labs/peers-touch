# DUI-13 - Applet runtime and workspace closure

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"desktop-platform-alignment-20261014","taskId":"DUI-13-APPLET-RUNTIME","workstreamId":"DUI-APPLETS","title":"Close AP4-AP8 through real Lynx lifecycle and multi-instance workspace identity","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"dui-applet-runtime","journeyId":"DUI-AP4-AP8","runtimeClass":"native-desktop","writeSet":["apps/desktop","packages/applet-contract","packages/applet-kernel","packages/applets","packages/prototypes/desktop","packages/locales","docs/architecture/platform/applet-runtime"],"readSet":["docs/architecture/platform/applet-runtime","docs/client/desktop/applet-runtime-lifecycle.md","docs/client/desktop/runtime-projections.md"],"budgets":{"focusedCheckSeconds":2400,"functionalRunSeconds":4800,"cleanupSeconds":300},"checks":[{"id":"dui-applet-runtime-source","command":"pnpm --dir apps/desktop run check && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml applets","verificationClass":"SOURCE_CHECK"},{"id":"dui-applet-runtime-functional","command":"pnpm --dir apps/desktop exec vitest run src/applet src/runtimes/appletsRuntime.test.ts src/pages/AppletRuntimePage.tsx","verificationClass":"FUNCTIONAL_CHECK"},{"id":"dui-applet-runtime-proof","command":"python3 tooling/scripts/acceptance-run.py --gate applet-desktop-lifecycle-smoothness","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["Real Lynx surfaces launch through materialization, gateway session, and kernel state","Seven lifecycle states and memory reclamation are observable without UI-owned truth","Multiple instances have distinct context/session/page identity and deterministic restore/cleanup","Detach opens a real OS window and pin means Desktop sidebar pin"],"failureBehavior":["Never key multiple instances only by applet ID","Never render a placeholder as a running applet","Do not keep a single-instance compatibility path after cutover"],"updatedAt":"2026-10-14T08:43:26.000Z"}
```

## Objective

Make the applet workspace model real, including the data-model change required
for multiple contexts of one applet.

## Current Snapshot

- AP7 is implemented/unproven.
- AP4-AP6 and AP8 have no alignment delta.
