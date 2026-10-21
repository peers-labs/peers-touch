# Mobile Development

> **Status**: active
> **Scope**: `apps/mobile/`

Mobile uses Tauri v2 Mobile: shared React/TypeScript UI, a Rust capability
kernel, and Android/iOS native plugins. Native plugins provide device
capabilities; they do not own shared business truth.

## Read First

1. [Mobile platform architecture](../../architecture/platform/client/mobile/README.md)
2. [Mobile platform baseline](../../client/mobile/base.md)
3. [Mobile lifecycle](../../client/mobile/lifecycle.md)
4. [Native plugin boundary](../../client/mobile/native-dual-platform.md)
5. [Mobile coding guide](../../global/coding-guide/mobile/)

Chat and shared UI work also read:

- [Chat UX contract](../../client/chat/chat-ux-contract.md)
- [Client common docs](../../client/common/README.md)
- the closest Mobile layout contract

## Run

Current local runtime entrypoint is the iOS simulator:

```bash
make mobile
make mobile-restart
make status
```

Android and physical-device work uses the generated Tauri project and the
corresponding native toolchain; state the exact target in the verification
report.

## Check

```bash
pnpm --dir apps/mobile run check
pnpm --dir apps/mobile run check:lifecycle-runtime
pnpm --dir apps/mobile run check:native-platforms
```

The aggregate check includes Web type checking/build, Rust check, and iOS
project discovery. It does not prove Android, a physical device, background
lifecycle, permissions, or receiver-visible product behavior unless those
targets were actually run.

## Boundaries

- Station owns cross-device business state.
- Runtime projections, not page mounts, own long-lived freshness.
- Kotlin and Swift remain native plugin layers, not parallel UI products.
- Credentials use platform-secure storage.
- Mobile applets use the canonical Host, SDK, and capability contracts.
