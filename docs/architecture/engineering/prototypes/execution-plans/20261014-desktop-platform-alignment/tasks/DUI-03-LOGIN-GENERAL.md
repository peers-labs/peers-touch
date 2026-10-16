# DUI-03 - Login and general settings closure

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"desktop-platform-alignment-20261014","taskId":"DUI-03-LOGIN-GENERAL","workstreamId":"DUI-SHELL","title":"Close C19-C24 through canonical login, Station selection, locale, and appearance boundaries","workClass":"product-behavior","completionClass":"functional","executionMode":"fix","closureId":"dui-login-general","journeyId":"DUI-C19-C24","runtimeClass":"native-desktop","writeSet":["apps/desktop","apps/station/app/subserver/oauth","apps/station/frame/touch","packages/locales","packages/prototypes/desktop","docs/client/desktop","tooling/acceptance/core/launch_context.py","tooling/acceptance/tests/test_launch_context.py","docs/architecture/engineering/acceptance/design.md"],"readSet":["docs/architecture/domains/identity/oauth-login-broker","docs/architecture/platform/station/access","docs/client/desktop/identity-lifecycle.md"],"budgets":{"focusedCheckSeconds":1200,"functionalRunSeconds":3000,"cleanupSeconds":180},"checks":[{"id":"dui-login-general-source","command":"pnpm --dir apps/desktop run check && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml","verificationClass":"SOURCE_CHECK"},{"id":"dui-login-general-functional","command":"pnpm --dir apps/desktop exec vitest run src/pages/login/LoginPage.oauth.test.ts src/services/accessGate.test.ts src/acceptance/stationAccess.test.ts src/i18n/index.test.ts","verificationClass":"FUNCTIONAL_CHECK"},{"id":"dui-login-general-channel-source","command":"python3 -m unittest tooling.acceptance.tests.test_launch_context","verificationClass":"SOURCE_CHECK"},{"id":"dui-login-general-proof","command":"python3 tooling/scripts/acceptance-run.py --gate station-access-desktop-oauth-native-e2e && python3 tooling/scripts/acceptance-run.py --gate desktop-primary-navigation-e2e","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["Theme, density, and locale controls expose only shipped capabilities","OAuth providers come from the broker and password login has no fake credentials","Invite, terms, custom, blocked, maintenance, and unknown Access Gate outcomes are typed and visible","Station picker add/select/remove/probe behavior is real and restart-safe"],"failureBehavior":["Do not hardcode provider availability or credentials","Do not accept an unknown Access Gate as granted","Do not advertise an unshipped locale or appearance mode"],"updatedAt":"2026-10-16T00:01:00.000Z"}
```

## Objective

Make login and general settings truthful before any prototype claims that an
account has entered the product.

## Current Snapshot

- C19-C24 production ownership and prototype capability boundaries are aligned.
- Prototype build, contract checks, wide/narrow L2 evidence, and material L3
  interactions pass.
- Formal Native OAuth and primary-navigation Acceptance remain required before
  this Task and its six ledger rows can close.
