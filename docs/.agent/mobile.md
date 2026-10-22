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

Do **not** use this file as the place to redefine Mobile architecture,
release-target relationships, or full coding standards.

---

## 2. Read These Sources First

### Platform Sources

- [Cross-Client Runtime](../architecture/platform/client/cross-client-runtime/README.md)
- [Mobile Base](../client/mobile/base.md)
- [Mobile Client Lifecycle](../client/mobile/lifecycle.md)
- [Native Plugin Layer](../client/mobile/native-plugin-layer.md)

### Topic Sources

- [Applet Container](../client/mobile/applet-container.md)
- [Sync Protocol](../client/mobile/sync-protocol.md)

### Specification Sources

- [Mobile Coding Guide](../global/coding-guide/mobile/)
- [Common Coding Guide](../global/coding-guide/common/)

### Global Sources

- [Project Architecture](../global/architecture.md)
- [Station/Desktop Scope Boundary](../architecture/platform/station-desktop-boundary.md)

---

## 3. Hard Constraints

- Mobile mainline is Tauri v2 Mobile: shared Web UI + Rust capability kernel + Android/iOS native plugins.
- Android and iOS are release targets of one Mobile product; they do not own
  separate product state models.
- Android Kotlin and iOS Swift are native plugin implementation layers, not the primary UI mainline.
- Do not reintroduce Flutter as an active implementation path.
- Proto definitions come from `model/domain/`; do not create manual parallel domain models.
- Mobile does not become its own cross-end truth source when the architecture says Station owns the truth.
- Use platform-native secure storage; do not store tokens in plaintext.
- Use project loggers; do not use `console.log`, `println()`, `print()`, direct Android `Log.*`, or ad-hoc debug output.
- Mobile pages must not keep long-lived business state fresh through page mount refreshes only; ownership belongs to runtime projections.

---

## 4. Verification Commands

Shared Mobile source gate:

```bash
pnpm mobile:check
```

Android and iOS claims additionally require their own source-bound native
build/runtime Gate. One platform never proves the other.

Proto generation:

```bash
./tooling/scripts/proto-gen-mobile.sh web
```

---

## 5. What This File Does Not Define

- It does not define the full Mobile module structure.
- It does not define the full native plugin coding standards.
- It does not define the full applet/runtime architecture.

If you need those answers, go to the linked source documents above.
