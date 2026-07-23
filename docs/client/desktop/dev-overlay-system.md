# Desktop Dev Overlay System

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-07-23 | **Updated**: 2026-07-23
> **Owner**: @printfcoder

---

## 1. Purpose

Provide a structured, tree-shakeable dev-only overlay system for Desktop that
surfaces runtime information (worktree, branch, commit, profile, connection
state) during development without polluting production code.

### Design Goals

- **Zero production impact**: entire `dev/` directory is eliminated in
  production builds via Vite dead-code elimination.
- **Zero business-code if-else**: business modules never check `DEV` to
  render dev UI. They only expose observable state.
- **Plugin architecture**: new dev surfaces (perf monitor, store inspector,
  network overlay) are added as plugins without modifying the shell or kernel.
- **Consistent mounting**: single overlay provider in the React tree,
  positioned via kernel boot slot.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ App.tsx                                                      │
│  └── <DevOverlayProvider />  ← conditional import (DEV only)│
│       ├── slot: 'titleBar'   → [worktree-badge]             │
│       ├── slot: 'bottomLeft' → [perf-monitor, ...]          │
│       └── slot: 'floating'   → [store-inspector, ...]       │
├─────────────────────────────────────────────────────────────┤
│ kernel/boot.ts                                               │
│  └── no dev logic; only exposes observable lifecycle phases  │
├─────────────────────────────────────────────────────────────┤
│ dev/                     ← entire tree DEV-only              │
│  ├── DevOverlayProvider.tsx   (slot renderer)                │
│  ├── registry.ts              (plugin registration)          │
│  ├── slots.ts                 (slot position constants)      │
│  └── plugins/                                                │
│       ├── worktree-badge.tsx  (first plugin)                 │
│       └── ...                                                │
└─────────────────────────────────────────────────────────────┘
```

### Runtime Data Flow

```
dev-desktop-app.sh
  → exports VITE_GIT_BRANCH, VITE_GIT_COMMIT, VITE_GIT_WORKTREE
  → Vite exposes as import.meta.env.VITE_*

Plugin reads import.meta.env at module scope
  → renders into assigned slot
```

---

## 3. Contracts

### 3.1 Slot Positions

| Slot | Position | Z-index | Use Case |
|------|----------|---------|----------|
| `titleBar` | Fixed top-right corner, inside window chrome area | 9999 | Identity: branch, commit, worktree, profile |
| `bottomLeft` | Fixed bottom-left, above sidebar | 9998 | Metrics: render count, store fanout |
| `floating` | Draggable overlay panel | 9997 | Inspector: store state, event log |

### 3.2 Plugin Interface

```typescript
interface DevOverlayPlugin {
  id: string;
  slot: DevSlot;
  order?: number;
  component: React.ComponentType;
}
```

### 3.3 Registration

```typescript
// dev/registry.ts
const plugins: DevOverlayPlugin[] = [];

export function registerDevPlugin(plugin: DevOverlayPlugin): void {
  plugins.push(plugin);
  plugins.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function getPluginsForSlot(slot: DevSlot): DevOverlayPlugin[] {
  return plugins.filter(p => p.slot === slot);
}
```

### 3.4 Conditional Import Entry

```typescript
// App.tsx (the ONLY place that references dev/)
const DevOverlayProvider = import.meta.env.DEV
  ? lazy(() => import('./dev/DevOverlayProvider'))
  : () => null;
```

---

## 4. Implementation Rules

### 4.1 MUST

- All dev overlay code lives under `apps/desktop/src/dev/`.
- Plugin registration happens inside `dev/plugins/` at module scope.
- `DevOverlayProvider` is the sole consumer of the registry.
- Environment variables for dev info use `VITE_` prefix (Vite convention).
- The launch script (`dev-desktop-app.sh`) is the only place that computes
  git/worktree metadata and exports env vars.

### 4.2 MUST NOT

- Business components (`pages/`, `components/`, `kernel/`, `store/`) must not
  import from `dev/`.
- No `if (import.meta.env.DEV)` in business code for rendering dev UI.
  (Allowed only for debug logging guards, not for UI rendering.)
- Dev plugins must not mutate application state or intercept user interactions.
- Dev overlay must not affect layout measurement of business components.

### 4.3 MAY

- Dev plugins may read (not write) any Zustand store via `getState()`.
- Dev plugins may subscribe to kernel events via `eventBus`.
- Dev plugins may call read-only Tauri commands for diagnostics.

---

## 5. First Plugin: Worktree Badge

Renders in `titleBar` slot:

```
┌──────────────────────────────────┐
│  peers-group-chat @ a1b2c3d      │
│  profile: one | station: remote  │
└──────────────────────────────────┘
```

Data sources:
- `import.meta.env.VITE_GIT_BRANCH` — current branch name
- `import.meta.env.VITE_GIT_COMMIT` — short commit hash
- `import.meta.env.VITE_GIT_WORKTREE` — worktree directory basename
- `import.meta.env.PEERS_STATION_URL` — station connection target (via Rust)

Visual:
- Semi-transparent background, monospace font, small (11px)
- Non-interactive (no click handlers)
- Does not overlap with window controls or navigation

---

## 6. Production Guarantee

The following ensures zero production bundle impact:

1. `dev/` is never statically imported from any production module.
2. The single dynamic `import('./dev/DevOverlayProvider')` is guarded by
   `import.meta.env.DEV` which Vite replaces with `false` in production,
   causing the entire import subtree to be eliminated.
3. `VITE_GIT_*` env vars are not exposed in production builds (only set by
   dev launch scripts).

---

## 7. Future Plugins (Non-Exhaustive)

| Plugin | Slot | Purpose |
|--------|------|---------|
| `store-fanout-guard` | `bottomLeft` | Live store subscription count |
| `event-stream` | `floating` | Real-time kernel event log |
| `network-inspector` | `floating` | Station/SSE connection state |
| `render-profiler` | `bottomLeft` | Component re-render frequency |
| `projection-state` | `floating` | Runtime projection staleness |
