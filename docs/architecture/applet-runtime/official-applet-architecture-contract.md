# Official Applet Architecture Contract

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-17
> **Owner**: Architecture Team
> **Module**: `apps/applets/`, `packages/applet-sdk/`, `packages/applet-contract/`, `apps/desktop/`, `apps/mobile/`, `apps/station/`

---

## 1. Purpose

Official applets are Peers-Touch-owned product units. They prove that an applet can be developed, packaged, injected into hosts, and deployed with its own backend without becoming a Desktop, Mobile, or Station main-program feature.

This contract defines the required architecture for official applets under `apps/applets/`.

Operational skill:

- [`official-applet-development`](../../../tooling/skills/official-applet-development/SKILL.md) MUST be used when creating, modifying, implementing, or validating official applets.

## 2. Core Rule

An official applet is independent in source ownership and runtime boundaries:

```text
apps/applets/<applet-id>/
  -> owns applet frontend
  -> owns applet service implementation
  -> owns service manifests and product docs

Desktop / Mobile / Web Host
  -> load built applet artifacts only
  -> inject the Peers-Touch Applet SDK bridge
  -> dispatch capability calls through Host Gateway

Station
  -> may bundle official applet services as subservers
  -> may route to standalone applet services
  -> does not absorb applet domain logic into the main program
```

Official applets may be first-party, but they must follow the same Host / SDK / Gateway / service-binding contract expected from third-party applets.

## 3. Required Directory Layout

```text
apps/applets/<applet-id>/
├── README.md
├── applet.manifest.json
├── service.manifest.json
├── frontend/
│   ├── package.json
│   ├── rspeedy.config.ts
│   ├── src/
│   │   ├── domain/
│   │   ├── application/
│   │   ├── infrastructure/
│   │   │   └── capability/
│   │   ├── presentation/
│   │   └── index.tsx
│   └── locales/
├── service/
│   ├── domain/
│   ├── application/
│   ├── infrastructure/
│   ├── transport/
│   ├── stationadapter/
│   └── standalone/
├── contracts/
│   └── README.md
├── docs/
└── tests/
```

The `apps/applets/<applet-id>` directory is the product unit. The cross-process schema source remains in `model/domain/**.proto` according to the repository proto-first rule.

## 3.1 Scaffold Contract

Official applet directories MUST be created by the official scaffold once the scaffold exists. Manual creation is allowed only while bootstrapping the scaffold itself.

Recommended command:

```bash
pnpm applet:create-official --id peers.note --service note --name Note
```

The scaffold is contract-driven. It must generate:

- `apps/applets/<applet-id>/README.md`
- `apps/applets/<applet-id>/applet.manifest.json`
- `apps/applets/<applet-id>/service.manifest.json`
- `apps/applets/<applet-id>/frontend/` baseline Lynx/ReactLynx applet structure.
- `apps/applets/<applet-id>/service/` baseline DDD service structure.
- `apps/applets/<applet-id>/contracts/README.md`
- `apps/applets/<applet-id>/docs/`
- `apps/applets/<applet-id>/tests/`
- `model/domain/<service>/v1/<service>.proto` baseline proto only when requested by an explicit flag.

The scaffold must not generate generated proto output, Desktop business pages, Mobile business screens, or Station main-program business logic.

The scaffold must be idempotent:

- existing non-empty files are not overwritten unless `--force` is passed.
- generated files include stable placeholders instead of timestamps where possible.
- rerunning the command reports existing files and exits cleanly.

The scaffold is also a validation tool. The official applet contract gate must be able to compare an applet directory with the scaffold contract and fail on missing required directories, forbidden Host imports, missing manifests, or missing service binding declarations.

## 4. Frontend Contract

The applet frontend:

- MUST use `packages/applet-sdk` as the only Host capability entry.
- MUST run through the applet package contract and Lynx runtime target.
- MUST keep applet UI as declarative ReactLynx state and components.
- MUST route Host-level UI through `sdk.ui` and `sdk.navigation`.
- MUST call backend services through `sdk.network.request({ service, path })`.
- MUST use locale keys for user-facing text.

The applet frontend MUST NOT:

- import Desktop, Mobile, or Station internal modules.
- call Tauri commands directly.
- call raw backend URLs from applet code.
- store business truth in applet local storage.
- depend on Browser DOM as the cross-platform runtime contract.

## 5. Service Contract

The applet service is a DDD-led business service. It may be bundled into Station or deployed independently, but it keeps one domain implementation.

Required layers:

```text
service/domain/
  aggregate, value objects, repository interfaces, domain errors, domain events

service/application/
  commands, queries, use cases, transaction boundaries, authorization context

service/infrastructure/
  repository implementations, external adapters, persistence details

service/transport/
  HTTP/gRPC handlers, request decoding, response encoding

service/stationadapter/
  Station subserver registration and route mounting

service/standalone/
  standalone process entry and deployment adapter
```

Transport handlers MUST NOT contain business rules. Station boot code MUST only mount `stationadapter`; it must not copy applet domain or application logic into Station main-program packages.

## 6. Manifest Contract

Every official applet has two manifests.

`applet.manifest.json` declares runtime and frontend capabilities:

```json
{
  "id": "peers.note",
  "runtime": { "type": "lynx" },
  "services": {
    "note": {
      "kind": "station-subserver",
      "required": true
    }
  },
  "permissions": [
    "network:service:note",
    "storage:applet",
    "ui:feedback",
    "navigation:applet",
    "events:applet",
    "telemetry:track"
  ]
}
```

`service.manifest.json` declares backend deployment and binding:

```json
{
  "service": "note",
  "routes": {
    "stationPrefix": "/applets/note/v1",
    "publicPrefix": "/v1"
  },
  "deployment": {
    "stationBundled": true,
    "standalone": true
  },
  "health": {
    "path": "/healthz"
  }
}
```

The Host Gateway maps `service: "note"` to the active deployment target. Applet code does not change when the service moves between Station-bundled and standalone deployment.

## 7. Injection Contract

Desktop, Mobile, and Web inject official applets the same way they inject conforming third-party applets:

```text
read applet artifact
  -> validate manifest and integrity
  -> create Host session
  -> create Lynx runtime
  -> inject SDK bridge
  -> enforce permissions in Host Gateway
  -> resolve service binding
  -> audit capability calls
```

Host code may contain applet registry metadata and launcher entries. Host code MUST NOT contain applet business services, stores, pages, or domain rules.

## 8. Deployment Contract

Official applet services must support at least Station-bundled deployment. Services that claim standalone support must keep the same public service contract:

```text
Station bundled:
  Host Gateway -> current Station -> applet stationadapter -> service/application

Standalone:
  Host Gateway -> service discovery/configured upstream -> standalone service -> service/application
```

Both modes must expose the same service name, route semantics, error model, and authorization requirements.

## 9. Validation Rules

Every official applet must provide gates for:

- package contract validation.
- manifest schema validation.
- service manifest validation.
- SDK-only frontend dependency scan.
- forbidden raw backend access scan.
- Station-bundled service tests.
- standalone service smoke test when standalone is claimed.
- Host Gateway service-binding integration test.
- Desktop live host smoke test.
- Mobile host smoke test when mobile support is claimed.

Completion evidence must separate:

```text
real product path
controlled local upstream
mocked harness
not implemented
```

Mocked harnesses may support development, but they do not prove official applet readiness.

## 10. Forbidden Patterns

- Applet service implemented as Desktop command.
- Applet frontend importing Desktop/Mobile internals.
- Applet frontend calling raw `fetch(baseUrl)` for business APIs.
- Station main program absorbing applet domain/application code.
- Applet manifest declaring capabilities that Host Gateway cannot enforce.
- Telemetry logging note content, tokens, credentials, or PII.
- User-facing strings hardcoded in applet UI.
