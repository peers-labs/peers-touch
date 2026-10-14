# DUI-02 - Identity and trust closure

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"desktop-platform-alignment-20261014","taskId":"DUI-02-IDENTITY-TRUST","workstreamId":"DUI-SHELL","title":"Close C10-C18 and C25 through trusted local identity lifecycle","workClass":"product-behavior","completionClass":"functional","executionMode":"fix","closureId":"dui-identity-trust","journeyId":"DUI-C10-C18-C25","runtimeClass":"native-desktop","writeSet":["apps/desktop","apps/station/frame/touch","model/domain/actor","packages/locales","packages/prototypes/desktop/shell","docs/client/desktop","docs/architecture/engineering/prototypes/execution-plans/20261014-desktop-platform-alignment"],"readSet":["docs/client/desktop/identity-lifecycle.md","docs/client/desktop/pin-recovery.md","docs/architecture/platform/station/access"],"budgets":{"focusedCheckSeconds":1800,"functionalRunSeconds":3600,"cleanupSeconds":240},"checks":[{"id":"dui-identity-trust-source","command":"pnpm --dir apps/desktop run check && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml","verificationClass":"SOURCE_CHECK"},{"id":"dui-identity-trust-functional","command":"pnpm --dir apps/desktop exec vitest run src/kernel/identityRuntime.test.ts src/kernel/identityLifecycle.test.ts src/store/session.test.ts src/store/relationships.test.ts src/services/messaging-recovery-service.test.ts","verificationClass":"FUNCTIONAL_CHECK"},{"id":"dui-identity-trust-proof","command":"python3 tooling/scripts/acceptance-run.py --gate station-access-auth-e2e --gate chat-native-multi-device-e2e --gate chat-native-recovery-e2e","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["PIN set, unlock, remove, lockout, and recovery preserve the canonical identity phase model","Blocked users and authorized devices are live, and remote device revoke is enabled","Switch Station revokes the Station session, unbinds/removes the active Station, preserves local messages, and returns to the account/Station picker","Unsupported auto-lock, biometric, presence, and receipt preferences are absent","Multi-account and encrypted-message recovery journeys use canonical stores"],"failureBehavior":["Never clear durable messages during Station switch","Never present devices as accounts or accounts as devices","Fail closed on stale device/profile revisions and incomplete identity teardown"],"updatedAt":"2026-10-14T13:49:30.000Z"}
```

## Objective

Close local security, account, device, Station-switch, and recovery behavior as
one identity transition system.

## Current Snapshot

- C10, C12, C15, C18, and C25 have canonical production paths; exact-source
  proof and prototype truthfulness remain open.
- C11, C13, and C14 require prototype-only removal of unsupported controls.
- C16 has a live revoke command but the UI still disables it as pending.
- C17 logs out but does not remove the active Station before account selection.
