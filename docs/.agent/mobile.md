# Mobile Agent Entry

> Load this file when working on `apps/mobile/`, Mobile native plugins, or Mobile docs.
> Parent rules: [AGENTS.md](../../AGENTS.md)

---

## 1. Role Of This File

This file is an **Agent navigation + guardrail entry**, not the Mobile architecture or coding-standard source of truth.

Use it to answer:

- Which Mobile documents must be read first
- Which hard constraints cannot be violated
- Which verification commands must run before completion

Do **not** use this file as the place to redefine Mobile architecture, dual-platform design, or full coding standards.

---

## 2. Read These Sources First

### Platform Sources

- [Mobile Base](file://docs/client/mobile/base.md)
- [Mobile Client Lifecycle](file://docs/client/mobile/lifecycle.md)
- [Native Plugin Layer](file://docs/client/mobile/native-dual-platform.md)
- [Tauri Mobile Mainline Migration Plan](file://docs/client/mobile/execution-plans/20260531-tauri-mobile-mainline-migration.md)

### Topic Sources

- [Applet Container](file://docs/client/mobile/applet-container.md)
- [Sync Protocol](file://docs/client/mobile/sync-protocol.md)

### Specification Sources

- [Mobile Coding Guide](file://docs/global/coding-guide/mobile)
- [Common Coding Guide](file://docs/global/coding-guide/common)

### Global Sources

- [Project Architecture](file://docs/global/architecture.md)
- [Station/Desktop Scope Boundary](file://docs/architecture/boundaries/station-desktop-scope-boundary.md)

---

## 3. Hard Constraints

- Mobile mainline is Tauri v2 Mobile: shared Web UI + Rust capability kernel + Android/iOS native plugins.
- Android Kotlin and iOS Swift are native plugin implementation layers, not the primary UI mainline.
- Do not reintroduce Flutter as an active implementation path.
- Proto definitions come from `model/domain/`; do not create manual parallel domain models.
- Mobile does not become its own cross-end truth source when the architecture says Station owns the truth.
- Use platform-native secure storage; do not store tokens in plaintext.
- Use project loggers; do not use `console.log`, `println()`, `print()`, direct Android `Log.*`, or ad-hoc debug output.
- Mobile pages must not keep long-lived business state fresh through page mount refreshes only; ownership belongs to runtime projections.

---

## 4. Verification Commands

Target Tauri Mobile commands after the shell scripts land:

Tauri Mobile:

```bash
pnpm mobile:check
pnpm mobile:dev:ios
pnpm mobile:build:ios
```

Native plugin verification is iOS-first for the current spike:

```bash
cd apps/mobile/src-tauri/gen/apple
xcodebuild -list -project peers-touch-mobile.xcodeproj
```

Proto generation:

```bash
./tooling/scripts/proto-gen-mobile.sh
./tooling/scripts/proto-gen-mobile.sh
```

---

## 5. What This File Does Not Define

- It does not define the full Mobile module structure.
- It does not define the full native plugin coding standards.
- It does not define the full applet/runtime architecture.

If you need those answers, go to the linked source documents above.
