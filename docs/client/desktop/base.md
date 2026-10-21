# Peers Touch Desktop (Tauri)

> **Status**: active
> **Updated**: 2026-10-16

## Platform Baseline

Current stack:
- Frontend: React + TypeScript (`apps/desktop/src`)
- Desktop shell and command layer: Tauri + Rust (`apps/desktop/src-tauri/src`)
- API bridge: `apps/desktop/src/services/desktop_api.ts`
- Portable Rust mechanisms: capability-owned crates under `packages/`

Desktop/Mobile form, host, portable-core, port, and presentation-policy
relationships are defined by
[`cross-client-runtime`](../../architecture/platform/client/cross-client-runtime/README.md).

## Core Rules

1. App-first runtime:
   - Validate with `tauri:build` and native app launch.
   - Do not treat web-only runtime as the default acceptance path.

2. Layered architecture:
   - UI/store in TypeScript only.
   - Business command contracts in Rust `interface/contracts`.
   - Command handlers in Rust `interface/tauri_commands`.
   - Implementation in Rust `application/*`.

3. Single call path:
   - Prefer `invokeRustDataFromStatus(...)` for business APIs.
   - Keep direct HTTP/fetch only for explicit multipart/streaming exceptions.

4. Contract consistency:
   - TS input/output types must align with Rust contracts.
   - Command names must be registered in `src-tauri/src/main.rs`.

5. Portable core boundary:
   - Shared protocol/security/state mechanisms remain host-neutral Rust
     libraries.
   - Desktop Rust composes ports and local stores.
   - Portable cores do not own Station business truth or Desktop presentation.

## Directory Baseline

```
apps/desktop/
├── src/
│   ├── kernel/                # Page / Runtime / Boot contracts (see runtime-projections.md)
│   │   ├── runtime.ts         # RuntimeDescriptor + registry
│   │   ├── page.ts            # PageDescriptor + registry
│   │   ├── boot.ts            # BootPipeline phases + scheduleIdle
│   │   ├── identityRuntime.ts # Framework-level identity lifecycle runtime
│   │   ├── PageHost.tsx       # Mounts pages from descriptors
│   │   ├── usePrefetch.ts     # One-shot page-local prefetch
│   │   └── events/            # AppEventBus (catalog / bus / browser)
│   ├── runtimes/              # Long-lived projection owners (RuntimeDescriptor impls)
│   ├── pages/                 # Page modules + <Name>.descriptor.tsx
│   ├── components/
│   ├── store/                 # Zustand stores (read by runtimes / pages)
│   └── services/
│       ├── desktop_api.ts     # Single API surface
│       ├── appRuntime.ts      # Boot orchestration: registers + installs runtimes
│       └── socialRealtime.ts  # Social runtime impl (consumed by socialRuntime.ts)
└── src-tauri/src/
    ├── interface/contracts/
    ├── interface/tauri_commands/
    ├── application/
    ├── domain/
    └── infrastructure/
```

> **Loading Foundation contracts**: `kernel/`, `runtimes/`, `pages/<Name>.descriptor.tsx`, and the boot pipeline are defined in [`runtime-projections.md`](./runtime-projections.md). New pages and projection owners must conform to those contracts; do not redefine them here.
>
> **Lifecycle contract**: Desktop boot, identity/auth gate, runtime bootstrap, steady reconcile, session change, and shutdown are defined in [`lifecycle.md`](./lifecycle.md). Use it as the top-level lifecycle counterpart to Mobile before changing login, runtime bootstrap, or Station/session behavior.

## Delivery Checklist

Before claiming completion:

```bash
cd apps/desktop
pnpm run check
pnpm run test
pnpm run build
```

For app validation:

```bash
cd apps/desktop
source ~/.cargo/env
CI=false pnpm run tauri:build
```
