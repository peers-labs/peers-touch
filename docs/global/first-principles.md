# First Principles: Non-Negotiable Rules

> These are the baseline rules for the current repository layout.

---

## 🔴 L0: Architecture Principles

### 1) Proto-first domain modeling
- Define cross-platform data contracts in `model/domain/*.proto`.
- Avoid manually duplicating domain models across clients and station.

### 2) Respect current repo boundaries
- Desktop: `apps/desktop` (Tauri + React/TS + Rust)
- Mobile: `apps/mobile/src` + `apps/mobile/src-tauri`; Android/iOS code is native
  plugin/generated platform integration, not the primary UI mainline
- Station: `apps/station/app` and `apps/station/frame`
- Shared client libraries: `client/common/*`

### 3) Desktop command path consistency
- Desktop business calls should prefer Tauri command bridge.
- Contract/input types in TS must align with Rust `interface/contracts`.
- New commands must be registered in `apps/desktop/src-tauri/src/main.rs`.

### 4) Logging and security
- No debug-print style logs in production paths.
- No secrets in logs.
- Validate auth/ownership checks for all read/write handlers.

---

## 🚨 L1: Mandatory Verification

Before claiming completion, run platform checks:

### Desktop
```bash
cd apps/desktop
pnpm run check
pnpm run test
pnpm run build
```

App-only verification:
```bash
cd apps/desktop
source ~/.cargo/env
CI=false pnpm run tauri:build
```

### Mobile
```bash
cd apps/mobile/android && ./gradlew build
cd apps/mobile/ios && xcodebuild -scheme PeersTouch -configuration Debug build
```

### Station
```bash
cd apps/station
gofmt -l .
go test ./...
```

---

## ⭐️ L2: Best Practices

- Keep transport-independent business logic in service/application layer.
- Keep API/contracts explicit and version-safe.
- Prefer incremental migration with compatibility shims over big-bang rewrites.

---

## ✅ Quick Self-Check

- [ ] Are paths and commands aligned with `apps/*`?
- [ ] Are contracts and command names consistent end-to-end?
- [ ] Are lint/build/test checks passed on touched modules?
- [ ] Is runtime verification done in app mode for desktop?
