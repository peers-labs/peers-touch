# Peers Touch Desktop (Tauri)

## PREFACE

Desktop has been migrated to a Tauri architecture and is no longer Flutter-based.

Current stack:
- Frontend: React + TypeScript (`apps/desktop/src`)
- Desktop shell and command layer: Tauri + Rust (`apps/desktop/src-tauri/src`)
- API bridge: `apps/desktop/src/services/desktop_api.ts`

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

## Directory Baseline

```
apps/desktop/
├── src/
│   ├── pages/
│   ├── components/
│   ├── store/
│   └── services/desktop_api.ts
└── src-tauri/src/
    ├── interface/contracts/
    ├── interface/tauri_commands/
    ├── application/
    ├── domain/
    └── infrastructure/
```

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

## Notes

---

> Legacy note: Any references to `client/desktop`, `flutter build`, or GetX in other documents
> should be considered outdated. This file is the current Desktop baseline.
