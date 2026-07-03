---
name: pt-official-applet-development
description: >
  Use when creating, modifying, implementing, or validating an official
  Peers-Touch applet under apps/applets, including Note-like applets, applet
  frontend/backend product units, applet service binding, Station-bundled or
  standalone applet services, official applet scaffolding, applet manifests,
  and Host injection into Desktop/Mobile/Web.
---

# Official Applet Development

Use this skill before creating or changing any official applet product unit.

Applies to:

- `apps/applets/**`
- official applet manifests and service manifests
- applet frontend code that uses `@peers-touch/applet-sdk`
- applet backend services that may be Station-bundled or standalone
- service binding through Host Gateway
- official applet scaffold or contract gates

## Required Read Order

1. Read [`docs/architecture/applet-runtime/official-applet-architecture-contract.md`](../../../docs/architecture/applet-runtime/official-applet-architecture-contract.md).
2. Read [`docs/architecture/applet-runtime/README.md`](../../../docs/architecture/applet-runtime/README.md) for current applet-runtime document priority.
3. If implementing Note, read [`docs/architecture/applet-runtime/note-applet-validation-design.md`](../../../docs/architecture/applet-runtime/note-applet-validation-design.md).
4. If implementing Note, follow [`docs/architecture/applet-runtime/execution-plans/2026-06-17-note-official-applet-implementation-plan.md`](../../../docs/architecture/applet-runtime/execution-plans/2026-06-17-note-official-applet-implementation-plan.md).
5. If touching Desktop, Station, or Mobile, also read the matching `docs/.agent/<platform>.md`.

## Scaffold First

Do not hand-create an official applet product unit once the scaffold exists.

Use the official scaffold:

```bash
pnpm applet:create-official --id <applet-id> --service <service-name> --name <DisplayName>
```

For Note:

```bash
pnpm applet:create-official --id peers.note --service note --name Note
```

Only use manual directory creation while bootstrapping the scaffold itself.

## Architecture Boundaries

Official applets are product units:

```text
apps/applets/<applet-id>/
  frontend/
  service/
  contracts/
  docs/
  tests/
```

Keep the boundaries:

- frontend uses `@peers-touch/applet-sdk` for Host capabilities.
- service follows DDD: `domain/application/infrastructure/transport/stationadapter/standalone`.
- proto source remains under `model/domain/**`.
- Desktop/Mobile/Web load built artifacts and inject Host bridge.
- Station may mount `service/stationadapter`, but must not absorb applet domain/application logic.

## Required Checks Before Implementation

- Confirm whether the scaffold exists. If it does not, implement scaffold workstream before the applet product.
- Confirm `applet.manifest.json` declares a canonical `services[]` entry for the service.
- Confirm applet frontend capability access uses `permissions: ["network.request"]`, and platform service intent is declared through `platformPermissions: ["network:service:<service>"]`.
- Confirm `service.manifest.json` declares Station-bundled deployment and standalone status.
- Confirm frontend has no raw backend URL path.
- Confirm Desktop/Mobile code does not import applet product source.

## Forbidden Patterns

- Creating a Desktop page/store/service as the applet implementation.
- Calling Tauri commands directly from applet frontend.
- Calling raw `fetch(baseUrl)` or using an applet-visible backend URL for business APIs.
- Implementing applet service as Desktop commands.
- Putting applet business rules into Station main-program packages.
- Claiming Mobile readiness without a real Mobile Host gate.

## Evidence Standard

When reporting readiness, classify evidence as:

```text
REAL_PRODUCT_PATH
CONTROLLED_LOCAL_UPSTREAM
MOCKED_HARNESS
NOT_IMPLEMENTED
```

Mocked harnesses can support development, but they do not prove official applet readiness.
