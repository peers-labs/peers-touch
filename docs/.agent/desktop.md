# Desktop Agent Entry

> Load this file when working on `apps/desktop/`.
> Parent rules: [AGENTS.md](../../AGENTS.md)

---

## 1. Role Of This File

This file is an **Agent navigation + guardrail entry**, not the Desktop architecture or coding-standard source of truth.

Use it to answer:

- Which Desktop documents must be read first
- Which hard constraints cannot be violated
- Which verification commands must run before completion

Do **not** use this file as the place to redefine Desktop architecture, module boundaries, or full coding standards.

---

## 2. Read These Sources First

### Architecture Sources

- [Desktop Runtime Architecture](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/docs/architecture/runtime/desktop-runtime-architecture.md)
- [Station/Desktop Scope Boundary](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/docs/architecture/boundaries/station-desktop-scope-boundary.md)

### Platform Sources

- [Desktop Base](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/docs/client/desktop/base.md)
- [Desktop README](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/docs/client/desktop/README.md)
- [Desktop Client Lifecycle](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/docs/client/desktop/lifecycle.md)
- [Desktop Runtime Projections — Page / Runtime / Boot kernel contracts (single source of truth)](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/docs/client/desktop/runtime-projections.md)
- [Desktop Global Context Kernel](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/docs/client/desktop/global-context-kernel.md)

### Specification Sources

- [Desktop Coding Guide](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/docs/global/coding-guide/desktop)
- [Common Coding Guide](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/docs/global/coding-guide/common)

### Topic Sources

- [Provider Model Target Architecture](file:///Users/bytedance/Documents/Projects/peers-touch/peers-touch/docs/client/desktop/provider-model-target-architecture.md)

---

## 3. Hard Constraints

- UI runtime is `desktop-web -> desktop-rust -> station`; do not bypass `desktop-rust` when the architecture says it is the required bridge.
- Use generated proto/domain contracts; do not introduce manual parallel models.
- Desktop UI uses LobeUI first; use antd only when necessary and consistent with existing design.
- TypeScript uses strict typing; do not introduce `any` unless the user explicitly accepts it.
- Rust commands return `AppResult<T>`; do not panic for normal error paths.
- Logging must go through project loggers; do not use `console.*`, `println!`, or `eprintln!`.
- Runtime-backed UI state must be maintained by the owning runtime/store through event consumption plus periodic reconciliation. Do not solve stale chat/contact/notification state only with component mount or tab-click refreshes; read `docs/client/desktop/runtime-projections.md` first.
- New Desktop pages must be implemented as `PageDescriptor` (`apps/desktop/src/pages/<Name>.descriptor.tsx`) with explicit `preload` / `keepAlive` / `runtimes`, and registered in `pages/registry.ts`. Pages MUST be pure renderers — no mount-time data fetches; data ownership belongs to a `RuntimeDescriptor` in `apps/desktop/src/runtimes/`. One-shot section data uses `kernel/usePrefetch`. See `docs/client/desktop/runtime-projections.md §6` (Kernel Contracts) for the full Page / Runtime / Boot contract.

---

## 4. Verification Commands

```bash
cd apps/desktop
pnpm run check
pnpm run test
pnpm run build
```

Tauri verification:

```bash
cd apps/desktop
source ~/.cargo/env
CI=false pnpm run tauri:build
```

---

## 5. What This File Does Not Define

- It does not define Desktop runtime topology in detail.
- It does not define Desktop module boundaries in detail.
- It does not define the full Desktop coding standard body.

If you need those answers, go to the linked source documents above.
