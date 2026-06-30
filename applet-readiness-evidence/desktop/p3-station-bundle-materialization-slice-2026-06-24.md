# P3 Station Bundle Materialization Slice

> Evidence class: `CONTROLLED_CLIENT_INTEGRATION`
> Plan source: `docs/architecture/applet-runtime/execution-plans/2026-06-23-applet-capability-completion-plan.md`
> Design source: `applet-readiness-evidence/desktop/p3-applet-box-projection-design-2026-06-24.md`

## Completed

- Added Desktop Rust command:
  - `applets_store_materialize_bundle`
- Added Desktop TS API wrapper:
  - `api.appletStoreMaterializeBundle(...)`
- Added Station bundle download guardrails:
  - rejects empty `bundleUrl`;
  - rejects non-Station absolute URLs;
  - requires a safe relative `entry`;
  - verifies `sha256:<hex>` when Store provides a digest.
- Materialized bundles are written under Desktop app data:
  - `applets/store-bundles/<applet-id>/<version>/<entry>`
- `AppletManager` can now register a runtime-resolved applet manifest after materialization.
- Applet store projection now keeps Station bundle metadata separate from `AppletInfo.path`:
  - `stationBundleUrl`;
  - `stationBundleSha256`.
- `AppletInfo.path` is only updated after Station bundle materialization returns a local directory and Desktop converts it into a WebView-loadable asset URL.
- Station Store `AppletVersionInfo` now includes persisted manifest snapshot and bundle asset metadata when available.

## Verification

```bash
cd apps/station/app && go test ./subserver/applet_store/...
```

Result: PASS.

```bash
cd apps/desktop/src-tauri && cargo check
```

Result: PASS.

Notes: Existing generated-code warnings remain.

```bash
cd apps/desktop && pnpm run check
```

Result: PASS.

## Not Completed

- This slice downloads the desktop entry bundle only.
- Full package materialization for additional integrity files, such as skill input schemas, remains open.
- A third-party Station applet with multi-file integrity can still fail launch-time integrity validation until all declared assets are materialized.
- Live authenticated Station Store E2E is not proven in this evidence.
- Background update/revalidation and cache eviction are not implemented.

## Claim

Desktop now has the first Station-backed bundle materialization path and no longer overloads `AppletInfo.path` with a remote Station URL. Full Station-backed third-party launch remains open until all declared bundle assets are materialized and verified.
