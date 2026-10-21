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
- Portable client Rust libraries: capability-owned crates under `packages/`
- Cross-client architecture:
  `docs/architecture/platform/client/cross-client-runtime/`

### 3) Reuse before specialization
- Search architecture capabilities and workspace packages before creating a
  client-local component, helper, runtime, package, or crate.
- Shared contracts, protocol/security/state semantics, and product-entity
  semantics have one canonical implementation.
- A second consumer must reuse or extract the canonical asset before merge.
- Desktop/Mobile Presentation Policy and Desktop/Android/iOS Host adapters are
  the only default divergence axes.
- Any other parallel implementation requires an accepted divergence record.

### 4) Desktop command path consistency
- Desktop business calls should prefer Tauri command bridge.
- Contract/input types in TS must align with Rust `interface/contracts`.
- New commands must be registered in `apps/desktop/src-tauri/src/main.rs`.

### 5) Logging and security
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
pnpm mobile:check
```

`pnpm mobile:check` proves shared source checks only. A release or capability
claim for Android or iOS additionally requires its own source-bound native
build and runtime Gate. Evidence from one OS never proves the other; a missing
required cell is `UNPROVEN`.

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
- Assign public APIs to resource owners. Conversation `/conversation/*` is the
  sole Chat entry point; Device, Inbox, Recovery, Key Exchange, and Federation
  expose `/device/*`, `/device/inbox/*`, `/recovery/*`, `/key-exchange/*`, and
  peer-only `/federation/*`. Device Messaging Engine is an internal
  Desktop/Mobile runtime term, not a public namespace.
- Prefer bounded atomic cutovers. A compatibility path is allowed only by an
  explicit accepted architecture decision with one owner, a removal trigger, and a
  fail-closed deletion Gate; permanent shims and parallel truth owners are forbidden.

---

## ✅ Quick Self-Check

- [ ] Are paths and commands aligned with `apps/*`?
- [ ] Did the change reuse or register the canonical cross-client capability?
- [ ] Are contracts and command names consistent end-to-end?
- [ ] Are lint/build/test checks passed on touched modules?
- [ ] Is runtime verification done in app mode for desktop?
