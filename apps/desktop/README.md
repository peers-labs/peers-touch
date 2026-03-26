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
# Start development server (browser only)
pnpm dev

# Start Tauri development window
pnpm tauri:dev
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
The following APIs are available for Applets:
- `system.getInfo()` - Get system information
- `storage.get(key)` - Get storage item
- `storage.set(key, value)` - Set storage item
- `storage.remove(key)` - Remove storage item

## Architecture
### Applet Runtime Architecture
```
Applet Bundle (/applets-dist) → AppletManager → LynxContainer/LynxHost → Bridge V2 → Native Capabilities
```

### Runtime Components
- `AppletManager` scans `/applets-dist/index.json`, validates manifest and capabilities, then manages lifecycle.
- `LynxContainer` resolves applet entry and wraps loading/error state.
- `LynxHost` is the desktop Lynx host element used for rendering and load/error event binding.
- `Bridge V2` uses `peers-touch.applet.bridge.v2` protocol for host capability invocation.

### Legacy Applet Upgrade Checklist
- [ ] Set `manifestVersion` to `2` in `applet.json`.
- [ ] Add `load.type` as `lynx` and set `load.entry` to the applet entry file.
- [ ] Add `bridge.version` and `bridge.protocol` for Bridge V2.
- [ ] Declare required `permissions` and optional `capabilities`.
- [ ] Ensure `minPlatformVersion` matches desktop runtime requirement.
- [ ] Verify applet can be discovered from `/applets-dist/index.json`.
- [ ] Validate launch, hide/show, destroy lifecycle events in desktop runtime.
- [ ] Run SDK calls (`system`, `storage`, `network`, `notification`) against desktop host.

### Migration Guide Snippet
```json
{
  "manifestVersion": 2,
  "id": "demo.applet",
  "name": "Demo Applet",
  "version": "1.0.0",
  "description": "Demo applet migrated to Lynx runtime",
  "author": "Peers Touch",
  "permissions": ["storage", "network", "notification"],
  "capabilities": ["chat.send"],
  "minPlatformVersion": "0.1.0",
  "targetPlatforms": ["desktop"],
  "load": {
    "type": "lynx",
    "entry": "index.html"
  },
  "bridge": {
    "version": 2,
    "protocol": "peers-touch.applet.bridge.v2"
  }
}
```

```ts
import { sdk } from '@peers-touch/applet-sdk'

async function boot() {
  const system = await sdk.getSystemInfo()
  await sdk.storage.set('boot.platform', system.platform)
  await sdk.showToast({ content: `Applet ready on ${system.os}` })
}

boot()
```

## License
MIT
