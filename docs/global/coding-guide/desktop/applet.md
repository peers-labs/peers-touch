# Desktop Applet System Guide

## Architecture

Desktop Applets are external packages rendered by the Desktop Host in a Lynx runtime. Current implementation uses:

- Canonical manifest contract from `@peers-touch/applet-contract`
- Canonical bridge protocol: `peers-touch.applet.bridge`
- Desktop frontend Host: `AppletManager` + `<lynx-host>` + `<lynx-view>`
- Desktop backend boundary: Tauri command / HTTP test gateway into the Rust Applet Gateway
- Gateway-owned session, permission, service binding, audit, quota, timeout, and event outbox enforcement

The required runtime path is:

```text
applet package -> SDK -> Lynx runtime -> Desktop Host -> Tauri/Rust Gateway -> Station/provider/service upstream
```

Do not use standalone SDK mocks, raw URLs, or frontend-only capability responses as Desktop L3 evidence.

## Package Layout

Desktop integrated packages are distributed under `/applets-dist/`:

```text
/applets-dist/
├── index.json
└── {applet-id}/
    ├── manifest.json
    ├── applet.json
    ├── main.lynx.bundle
    └── assets...
```

`index.json` uses version `1` and contains canonical package manifests:

```json
{
  "version": 1,
  "generatedAt": "2026-06-09T00:00:00.000Z",
  "applets": []
}
```

## Canonical Manifest

Desktop Host consumes the canonical manifest shape:

```json
{
  "id": "demo-applet",
  "name": "Demo Applet",
  "version": "1.0.0",
  "description": "Demo applet",
  "author": "Peers Touch",
  "targets": ["desktop"],
  "entries": {
    "lynx": "main.lynx.bundle"
  },
  "load": {
    "desktop": {
      "type": "lynx-web",
      "entry": "main.lynx.bundle"
    }
  },
  "bridge": {
    "protocol": "peers-touch.applet.bridge",
    "version": "1.0.0"
  },
  "permissions": [
    "app.getContext",
    "lifecycle.reportReady",
    "network.request",
    "storage.get",
    "storage.set"
  ],
  "services": [
    {
      "id": "primary-api",
      "kind": "http",
      "binding": "station-resolved",
      "allowedMethods": ["GET", "POST"],
      "allowedPaths": ["/api/v1/*"],
      "streaming": true
    }
  ],
  "skills": [],
  "integrity": {
    "algorithm": "sha256",
    "files": {
      "main.lynx.bundle": "sha256:..."
    }
  }
}
```

Validation rules:

| Field | Rule |
| --- | --- |
| `id` | Non-empty DNS-like lowercase id |
| `version` | SemVer string |
| `targets` | Non-empty array; Desktop integrated applets include `desktop` |
| `entries.lynx` | Non-empty Lynx bundle entry and covered by `integrity.files` |
| `load.desktop.type` | Must be `lynx-web` for Desktop integrated applets |
| `bridge.protocol` | Must be `peers-touch.applet.bridge` |
| `permissions` | Full capability methods, not module aliases |
| `services` | Required when `network.request` is granted |
| `integrity.algorithm` | Must be `sha256` |

`targetPlatforms`, `manifestVersion`, `bridge.v2`, and module-level permissions such as `network` or `storage` are legacy compatibility concepts and must not be used in new Desktop package sources.

## Desktop Integrated Vs Standalone Packages

Desktop L3 evidence requires a built Lynx bundle:

```text
load.desktop.type = "lynx-web"
load.desktop.entry = "*.bundle"
```

React DOM / Vite HTML packages are `standalone` `web-spa` artifacts. They may be distributed for standalone/web contexts, but they are not Desktop Lynx runtime evidence and must not be counted as Desktop L3 proof.

## Bridge Envelope

Host and SDK communicate with canonical response/event envelopes:

```typescript
type AppletBridgeResponse = {
  protocol: 'peers-touch.applet.bridge'
  kind: 'response'
  appletId: string
  sessionId: string
  requestId: string
  ok: boolean
  result?: unknown
  error?: {
    code: string
    message: string
    details?: Record<string, unknown>
    requestId?: string
  }
}
```

Host-to-applet events use the same protocol with `kind: 'event'`. Desktop Host delivers these events through the SDK `applet.event` path; background Gateway events must pass through `events.poll` or a future product push transport, not direct applet-side state mutation.

## Required Gateway Boundaries

Every Desktop capability call must be authorized by the Rust Gateway:

- The applet session must exist and match the trusted manifest snapshot.
- The actor/session binding must still be valid.
- The manifest must grant the exact capability method.
- Network calls must use a declared service id and allowed path/method; raw URLs are forbidden.
- Capability responses must fit payload limits and execution timeout policy.
- Audit records must capture allow/deny/quota/security outcomes.

## Verification

Use these gates for Desktop applet changes:

```bash
pnpm applet:contract-test
pnpm applet:developer-flow-gate
pnpm applet:desktop-package-gate
pnpm applet:desktop-runtime-gate
pnpm applet:desktop-product-host-gate
pnpm applet:desktop-product-host-real-gateway-gate
pnpm applet:desktop-packaged-assets-gate
pnpm applet:desktop-e2e
```

For packaged product evidence:

```bash
pnpm applet:desktop-tauri-bundle-gate
pnpm applet:desktop-product-window-gate
```
