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
Applet Code → Lynx Rendering Engine → JSAPI Bridge → Native Capabilities
```

### Communication Flow
1. Applet sends API request through Lynx bridge
2. Host application processes the request
3. Result is returned back to Applet through the bridge

## License
MIT
