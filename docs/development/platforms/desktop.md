# Desktop Development

> **Status**: active
> **Scope**: `apps/desktop/`

Desktop is a native Tauri application composed of a React/TypeScript renderer,
a Rust local runtime, and the Tauri host. Station remains the shared business
truth owner.

## Read First

1. [Desktop docs](../../client/desktop/README.md)
2. [Desktop runtime architecture](../../architecture/platform/client/desktop/runtime.md)
3. [Station/Desktop ownership](../../architecture/platform/station-desktop-boundary.md)
4. [Page, Runtime, and Boot contracts](../../client/desktop/runtime-projections.md)
5. [Desktop coding guide](../../global/coding-guide/desktop/)

UI changes also read:

- [UX design methodology](../../client/common/ux-design-methodology.md)
- [UI Identity](../../client/common/ui-identity/README.md)
- the closest module UI contract

## Run

```bash
make desktop
make desktop-restart
make status
```

Use the native development app for debugging and product Journeys. Browser-only
Desktop and packaged release bundles are not normal development substitutes.

## Check

```bash
pnpm --dir apps/desktop run check
pnpm --dir apps/desktop run test
pnpm --dir apps/desktop run build
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
```

Run focused tests first. Add a native Journey when the claim depends on window,
WebView, Tauri command, local storage, device capability, or runtime lifecycle.

## Boundaries

- Pages render projections; runtimes own long-lived freshness.
- Shared contracts remain proto-first.
- TypeScript does not bypass required Rust/Station owners.
- Product UI uses project components, tokens, and i18n.
- Normal debugging starts with `make desktop`, not `tauri build` or direct
  executable launch.
