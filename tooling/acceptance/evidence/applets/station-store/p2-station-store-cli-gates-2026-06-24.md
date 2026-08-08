# P2 Station Store CLI Gates

> Evidence class: `CONTROLLED_LOCAL_UPSTREAM`
> Plan source: `docs/architecture/applet-runtime/execution-plans/2026-06-23-applet-capability-completion-plan.md`
> Scope: P2.5 CLI gates plus the minimum typed publish and bundle-serving path required by those gates.

## Completed

- Added Station Store CLI wrapper scripts:
  - `pnpm applet:publish <package-dir> --channel dev`
  - `pnpm applet:install <applet-id> --channel dev`
  - `pnpm applet:revoke <applet-id> --version <version>`
- The wrapper calls Go `StoreService` through `apps/station/app/subserver/applet_store/cmd/store_cli`; it does not maintain a separate JSON/local preference source of truth.
- Added typed Station publish service path:
  - validates required publish fields;
  - persists applet/version/channel;
  - persists manifest snapshot;
  - persists bundle asset integrity metadata;
  - persists capability/service policy rows.
- Added local bundle storage safety:
  - rejects absolute/path-traversal storage keys;
  - creates nested storage directories;
  - serves stored bundles through the Station Store bundle handler.
- Corrected `BundleStorage.bundle_uri` semantics to return the Store-relative bundle key while `AppletVersionInfo.bundle_url` remains the public download URL.

## Runtime Verification

```bash
cd apps/station/app && go test ./subserver/applet_store/...
```

Result: PASS.

Covered behavior:

- typed publish writes manifest, bundle asset, channel, and policy state;
- catalog resolves the dev channel version after publish;
- version query returns persisted policy state;
- bundle handler serves stored bundle bytes;
- existing catalog/install/list/revoke/rollback/audit tests still pass.

```bash
pnpm applet:publish .artifacts/applet-readiness/packages/generic-complex-applet --channel dev
pnpm applet:install generic-complex-applet --channel dev
pnpm applet:revoke generic-complex-applet --version 1.0.0
```

Result: PASS.

Observed behavior:

- publish validates package integrity and persists `generic-complex-applet@1.0.0`;
- install writes `cli-user` / `cli-device` install state on dev channel;
- revoke marks `generic-complex-applet@1.0.0` as `APPLET_PACKAGE_STATUS_REVOKED`.

## Not Completed

- This is still a controlled local Station Store fixture using SQLite, not a live authenticated Station API path.
- Desktop Gateway Store client/cache is not implemented in this evidence.
- Applet Box is not yet Station-backed.
- Gateway policy enforcement does not yet consume Store-distributed policy rows.
- Host audit upload integration is not yet wired to the Store audit ingestion API.

## Claim

P2.5 CLI gates have a working controlled-local implementation that reuses Station Store service, persistence, manifest integrity validation, install state, and revoke behavior. P2 is still not complete because Desktop/Applet Box/Gateway integration remains open.
