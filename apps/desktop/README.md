# Peers Touch Desktop

Desktop client for Peers Touch - Decentralized Social + AI Agent platform.

## Tech Stack
- **Framework**: Tauri 2.0 + React 18
- **Language**: TypeScript
- **UI Library**: Ant Design 5 + LobeUI
- **Build Tool**: Vite
- **Applet Runtime**: Lynx

## Project Structure
```
├── src/
│   ├── applet/              # Applet runtime related
│   │   ├── AppletManager.ts # Applet lifecycle management
│   │   └── LynxContainer.tsx # Lynx rendering container
│   ├── components/          # Reusable components
│   ├── hooks/               # Custom React hooks
│   ├── pages/               # Page components
│   ├── store/               # State management
│   ├── types/               # TypeScript type definitions
│   ├── utils/               # Utility functions
│   ├── App.tsx              # Root component
│   ├── main.tsx             # Application entry
│   └── style.css            # Global styles
├── src-tauri/               # Tauri backend code
│   ├── src/
│   │   └── main.rs          # Rust entry point
│   ├── Cargo.toml           # Rust dependencies
│   └── tauri.conf.json      # Tauri configuration
├── index.html               # HTML template
├── vite.config.ts           # Vite configuration
├── tsconfig.json            # TypeScript configuration
└── package.json             # Dependencies and scripts
```

## Getting Started

### Prerequisites
- Node.js >= 18
- pnpm >= 9
- Rust >= 1.70 (for Tauri development)
- Tauri CLI >= 2.0

### Installation
```bash
# Install dependencies from root directory
pnpm install
```

### Development
```bash
# From the repository root, start the native Tauri application.
make desktop
```

### Build
```bash
# Build frontend assets only
pnpm build

# Build Tauri application for production
pnpm tauri:build
```

### Other Commands
```bash
# Type check
pnpm check

# Lint code
pnpm lint

# Preview production build
pnpm preview
```

## Applet Development
The desktop client supports running Applets powered by the Lynx rendering engine. To develop an Applet:

1. Follow the Applet development specification
2. Use TypeScript for Applet development
3. Access native capabilities through the provided JSAPI

### Applet JSAPI
Integrated Desktop Applets use `@peers-touch/applet-sdk`. The SDK maps public APIs such as `app`, `lifecycle`, `ui`, `events`, `storage`, `network`, `device`, `clipboard`, `file`, `skills`, `tasks`, `agent`, `ai`, and `telemetry` to canonical `peers-touch.applet.bridge` capability methods. Desktop evidence gates require built Lynx bundles to call the SDK through the Host bridge; raw URLs, legacy invoke names, and standalone adapter paths are not Desktop L3 evidence.

### Applet Runtime Gates
```bash
pnpm applet:developer-flow-gate
pnpm applet:desktop-runtime-gate
pnpm applet:desktop-product-host-gate
pnpm applet:desktop-product-host-real-gateway-gate
pnpm applet:desktop-product-shell-real-gateway-gate
pnpm applet:desktop-packaged-assets-gate
pnpm applet:desktop-product-window-gate
pnpm applet:web-host-runtime-gate
node tooling/scripts/create-generic-complex-applet.mjs .artifacts/applet-readiness/packages/external-certification-applet --id external-certification-applet --name "External Certification Applet" --package-name "@external/certification-applet" --description "External-style certification fixture for Desktop product-window applet readiness evidence." --author "External Producer"
node tooling/scripts/applet-desktop-product-window-gate.mjs .artifacts/applet-readiness/packages/external-certification-applet
pnpm applet:external-producer-certification-gate /tmp/peers-touch-external-l3-cert
pnpm applet:desktop-e2e
```

`applet:desktop-product-host-gate` exercises the real Desktop renderer modules in a controlled DOM harness. It validates `AppletManager`, `<lynx-host>`, session creation, `applets_invoke`, Host event delivery, and unmount cleanup, but it is not Desktop product evidence and does not replace native Tauri product-window E2E.

`applet:desktop-product-host-real-gateway-gate` runs the same product Host chain against the Rust HTTP Gateway test server and controlled upstream. `applet:desktop-product-shell-real-gateway-gate` renders the normal `ReadyView` / `PageHost` product shell at `applet:<id>` without the readiness-probe view, uses a non-probe session state, and verifies SDK calls plus Host UI/device commands through the real Gateway. `applet:desktop-packaged-assets-gate` verifies that Desktop build output includes `/applets-dist/index.json`, applet manifests, Lynx bundles, and integrity-covered files inside Tauri `frontendDist`. `applet:desktop-product-window-gate` builds and launches the packaged Tauri `.app` with a bounded product-window certification session, routes the real product window through the normal `App` / `ReadyView` / `PageHost` shell to `applet:<id>`, rejects `AppletReadinessProbeView` dependency, runs against an isolated storage root/profile instead of user default Application Support state, and requires Gateway product-shell evidence plus controlled upstream network/agent/provider requests. With no argument it generates the generic complex package; with a package directory argument it stages and certifies that package without rewriting its manifest id. The `external-certification-applet` command pair above creates and certifies a non-generic manifest id as repository-owned evidence that the product-window path is not hardcoded to `generic-complex-applet`. `applet:external-producer-certification-gate /tmp/peers-touch-external-l3-cert` proves the full certification pipeline accepts a package outside this repository and includes the normal product shell route; because that package is still generated by Peers-Touch tooling, it is stronger than repo-local fixture evidence but not a substitute for real third-party producer certification.

`applet:web-host-runtime-gate` covers the independently owned Web Host product, not Desktop. It installs a manifest-validated `__PEERS_TOUCH_APPLET_HOST__` bridge, creates a Web Host session, runs the developer readiness flow through `WebHostBridgeAdapter`, enforces permission/session/raw-URL/service-path policy, and requires controlled upstream network/agent/provider requests.

## Architecture
### Applet Runtime Architecture
```
Applet Package (/applets-dist) → AppletManager → LynxContainer/LynxHost → peers-touch.applet.bridge → Tauri applets_create_session/applets_invoke → Rust Gateway
```

### Runtime Components
- `AppletManager` scans `/applets-dist/index.json`, validates canonical manifests, verifies SHA-256 integrity, creates Rust-backed applet sessions, and manages lifecycle.
- `LynxContainer` resolves `load.desktop.entry` and wraps loading/error state. Packages without a Desktop Lynx load entry are excluded from the integrated runtime path.
- `LynxHost` is the desktop Lynx host element used for rendering and load/error event binding.
- The bridge uses `peers-touch.applet.bridge` envelopes for host capability invocation and Host-to-applet events.
- The Desktop Lynx runtime depends on `@lynx-js/web-core`, `@lynx-js/web-elements`, and `@lynx-js/lynx-core`; `@lynx-js/lynx-core` is required for the background app-service thread that runs ReactLynx lifecycle effects and SDK bridge calls. Keep `@lynx-js/web-core` aligned with the rspeedy/react-rsbuild toolchain used by official applets, because older web-core decoders reject newer Lynx bundle headers at runtime. Production Desktop builds copy Lynx Web `client_prod/static` into `dist/lynx-web-core/static` and load it as runtime assets before creating `<lynx-view>`, avoiding Vite-rechunked Lynx/WASM initialization order regressions in the packaged Tauri WebView.

### Friend Chat Runtime Notes
- Friend chat now relies on `src/services/desktop_api.ts` + `src-tauri/src/interface/tauri_commands/` as the single Desktop bridge layer.
- Frontend errors are forwarded to `frontend_log`, so `LogsTab` should show `Error.message` and `stack` instead of opaque `{}` payloads.
- WebRTC/TURN/signaling access is bridged through `src-tauri/src/interface/tauri_commands/ice.rs`; Station must expose `/api/v1/turn/*` and `/api/v1/ice/*`.
- Background friend-chat sync currently uses Station incremental sync as the baseline receive path; direct P2P transport is additive, not a replacement for persistence.

### Legacy Applet Upgrade Checklist
- [ ] Use the canonical manifest fields: `targets`, `entries`, platform-specific `load`, `bridge.protocol = peers-touch.applet.bridge`, `permissions`, optional `services`, `skills`, and `integrity`.
- [ ] Desktop integrated applets must provide `load.desktop.type = lynx-web` and a built Lynx `.bundle` entry. React DOM / Vite HTML packages are standalone web-spa artifacts, not Desktop Lynx evidence.
- [ ] Declare full capability-method permissions such as `network.request`, `storage.get`, `storage.set`, and `lifecycle.destroy`.
- [ ] Ensure `minPlatformVersion` matches desktop runtime requirement.
- [ ] Verify applet can be discovered from `/applets-dist/index.json`.
- [ ] Validate launch, hide/show, destroy lifecycle events in desktop runtime.
- [ ] Run SDK calls (`system`, `storage`, `network`, `notification`) against desktop host.

### Migration Guide Snippet
```json
{
  "id": "demo.applet",
  "name": "Demo Applet",
  "version": "1.0.0",
  "description": "Demo applet migrated to Lynx runtime",
  "author": "Peers Touch",
  "minPlatformVersion": "0.1.0",
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
  "permissions": ["app.getContext", "system.getInfo", "storage.set", "ui.showToast"],
  "capabilities": [],
  "services": [],
  "skills": [],
  "integrity": {
    "algorithm": "sha256",
    "files": {
      "main.lynx.bundle": "sha256:..."
    }
  }
}
```

```ts
import { sdk } from '@peers-touch/applet-sdk'

async function boot() {
  const system = await sdk.system.getInfo()
  await sdk.storage.set('boot.platform', system.platform)
  await sdk.ui.showToast({ message: `Applet ready on ${system.platform}` })
}

boot()
```

## License
MIT
