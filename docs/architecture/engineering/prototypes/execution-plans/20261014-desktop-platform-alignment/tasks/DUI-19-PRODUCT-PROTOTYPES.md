# DUI-19 - Product prototype truthfulness closure

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"desktop-platform-alignment-20261014","taskId":"DUI-19-PRODUCT-PROTOTYPES","workstreamId":"DUI-PROTOTYPES","title":"Align Social Chat, Agent, and Applet prototypes to the canonical product paths","workClass":"product-behavior","completionClass":"functional","executionMode":"fix","closureId":"dui-product-prototypes","journeyId":"DUI-PROTOTYPE-S-AI-AP","runtimeClass":"native-desktop","writeSet":["packages/prototypes/desktop","docs/architecture/engineering/prototypes","docs/architecture/domains/agent","docs/architecture/platform/applet-runtime","apps/desktop","packages/locales"],"readSet":["docs/architecture/engineering/prototypes/execution-plans/20261014-desktop-platform-alignment/scope-ledger.md","docs/architecture/domains/chat/lifecycle","docs/architecture/domains/agent/modern-chat-agent","docs/architecture/platform/applet-runtime"],"budgets":{"focusedCheckSeconds":2400,"functionalRunSeconds":4200,"cleanupSeconds":240},"checks":[{"id":"dui-product-prototypes-source","command":"pnpm --dir packages/prototypes/desktop/features/social-chat run build && pnpm --dir packages/prototypes/desktop/features/agent run build && pnpm --dir packages/prototypes/desktop/features/applet-lifecycle run build && pnpm --dir packages/prototypes/desktop/features/applet-workspace run build && pnpm --dir packages/prototypes/desktop/applets/atelier run build","verificationClass":"SOURCE_CHECK"},{"id":"dui-product-prototypes-visual","command":"make run-prototype","verificationClass":"UX_REVIEW"},{"id":"dui-product-prototypes-functional","command":"pnpm --dir packages/prototypes/desktop/features/social-chat run qa:geometry","verificationClass":"FUNCTIONAL_CHECK"},{"id":"dui-product-prototypes-proof","command":"python3 tooling/scripts/acceptance-run.py --gate chat-native-product-closure-e2e && python3 tooling/scripts/acceptance-run.py --gate agent-dogfood-e2e && python3 tooling/scripts/acceptance-run.py --gate applet-desktop-lifecycle-smoothness","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["Social Chat prototype mirrors real commands, states, safety, media, groups, and calls","Agent prototype mirrors real provider, memory, capability, turn, orchestration, Evaluation, portability, and Home behavior","Applet prototypes mirror real identities, install, lifecycle, multi-instance, detach, pin, governance, status, and uninstall behavior","No toast-only command, fake timer, localStorage authority, placeholder runtime, or fictional product identity remains"],"failureBehavior":["Never use mock success as runtime evidence","Never preserve a richer fictional prototype when the accepted product intentionally cuts it","Do not mark a prototype landed before Native product proof exists"],"updatedAt":"2026-10-14T08:43:26.000Z"}
```

## Objective

Converge the three product prototypes with the real Desktop product before the
final Native aggregate.

## Current Snapshot

- Social Chat remains local-state driven.
- Agent and Applet prototypes still contain mock and fictional behavior.
