# Official Applets

> Official Peers-Touch applets live here as product units.

This directory is for first-party applets that must prove the same architecture contract used by external applet producers.

The architecture source of truth is:

- [`docs/architecture/platform/applet-runtime/official-applet-architecture-contract.md`](../../docs/architecture/platform/applet-runtime/official-applet-architecture-contract.md)
- [`docs/architecture/platform/applet-runtime/note-applet-validation-design.md`](../../docs/architecture/platform/applet-runtime/note-applet-validation-design.md)
- [`docs/architecture/platform/applet-runtime/execution-plans/2026-06-17-note-official-applet-implementation-plan.md`](../../docs/architecture/platform/applet-runtime/execution-plans/2026-06-17-note-official-applet-implementation-plan.md)

## Required Shape

```text
apps/applets/<applet-id>/
├── README.md
├── applet.manifest.json
├── service.manifest.json
├── frontend/
├── service/
├── contracts/
├── docs/
└── tests/
```

## Scaffold

Official applets should be created through the contract-driven scaffold:

```bash
pnpm applet:create-official --id peers.note --service note --name Note
```

The scaffold owns the initial directory shape, manifests, frontend baseline, service baseline, contract docs, and validation hooks. Manual structure creation is only acceptable while bootstrapping the scaffold itself.

## Rules

- Frontend code must use `@peers-touch/applet-sdk` for Host capabilities.
- Service code must follow DDD boundaries.
- Cross-process schema source remains under `model/domain/**`.
- Desktop, Mobile, and Web Hosts load built artifacts; they do not import applet product source.
- Station may mount an official applet service through its adapter, but applet business logic stays under the applet product unit.
