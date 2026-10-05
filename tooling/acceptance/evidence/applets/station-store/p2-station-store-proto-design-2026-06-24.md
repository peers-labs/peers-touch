# P2.1 Station Store Proto Design Evidence

> Date: 2026-06-24
> Plan source: `docs/architecture/platform/applet-runtime/execution-plans/2026-06-23-applet-capability-completion-plan.md`
> Workstream: `P2 - Station Store and Install State`
> Task: `P2.1 Station Store Proto Design`
> Evidence class: `NOT_IMPLEMENTED` for runtime behavior; `REAL_PRODUCT_PATH`
> for generated proto compatibility checks.

## Upgrade Goal

P2 upgrades the current demo-shaped `applet_store` into the Station source of
truth for applet catalog, package versions, install state, policy, revocation,
rollback, and audit ingestion.

This task only completes the proto-first design contract. It does not implement
the Station Store service, Desktop Gateway client, Applet Box projection, CLI
publish/install/revoke commands, or release behavior.

## Current State Before P2.1

| Area | Current state | Gap |
|------|---------------|-----|
| Proto source | `model/domain/applet/applet.proto` had list/details/publish metadata only. | Missing install state, policy, revocation, rollback, audit, manifest registry, and bundle integrity contracts. |
| Station subserver | `apps/station/app/subserver/applet_store` exists but is demo/MVP-shaped. | It seeds mock applets, uses local bundle placeholders, and bundle serving is not implemented. |
| Runtime truth | Desktop has local Applet Box/import state from previous work. | Local state is not Station-backed source of truth. |
| P2 gates | No Station Store publish/install/revoke CLI gates exist. | Required by active plan but not implemented. |

## Domain Responsibilities

| Domain | Owner | Responsibility |
|--------|-------|----------------|
| Package Registry | Station Store | Own applet id, version, owner, status, channel, and publication metadata. |
| Manifest Registry | Station Store | Store raw manifest plus normalized targets, permissions, capabilities, service declarations, runtime, bridge, and integrity metadata. |
| Bundle Storage | Station Store | Store bundle URI, bundle hash, bundle size, asset hashes, content types, and storage backend identity. |
| Version Channel | Station Store | Resolve `stable`, `beta`, and `dev` channels, rollout percent, and rollback target. |
| Policy Distribution | Station Store | Distribute capability/service decisions, quota, timeout, payload limits, and user gesture requirements. |
| Install State | Station Store | Own actor/device applet install status, version, channel, config, and status reason. |
| Audit Ingestion | Station Store | Receive allowed/denied capability records from Hosts and support query by actor/device/applet/session/time. |

## Proto Contract Added

`model/domain/applet/applet.proto` now includes:

- `AppletPackageStatus`
- `AppletInstallStatus`
- `AppletReleaseChannel`
- `AppletPolicyDecision`
- `AppletAuditDecision`
- `ManifestSnapshot`
- `BundleAssetIntegrity`
- `BundleStorage`
- `AppletCapabilityPolicy`
- `AppletServicePolicy`
- `AppletPolicySet`
- `AppletVersionChannel`
- `AppletCatalogItem`
- `AppletInstallState`
- `AppletAuditRecord`
- `ListAppletCatalogRequest`
- `ListAppletCatalogResponse`
- `GetAppletVersionRequest`
- `GetAppletVersionResponse`
- `InstallAppletRequest`
- `InstallAppletResponse`
- `UninstallAppletRequest`
- `UninstallAppletResponse`
- `ListInstalledAppletsRequest`
- `ListInstalledAppletsResponse`
- `RevokeAppletVersionRequest`
- `RevokeAppletVersionResponse`
- `RollbackAppletChannelRequest`
- `RollbackAppletChannelResponse`
- `IngestAppletAuditRequest`
- `IngestAppletAuditResponse`
- `QueryAppletAuditRequest`
- `QueryAppletAuditResponse`

Existing `AppletInfo`, `AppletVersionInfo`, `ListAppletsRequest`,
`GetAppletDetailsResponse`, `PublishAppletRequest`, and `PublishAppletResponse`
were extended without removing existing fields.

## Execution Closure

The intended P2 runtime closure after this proto design is:

1. Producer publishes package and manifest to Station Store.
2. Station validates manifest, bundle integrity, policy, and channel.
3. Catalog exposes only compatible target-platform packages to Desktop.
4. User installs an applet for actor/device/channel.
5. Desktop mirrors install state locally, but Station remains truth.
6. Host creates sessions only for installed, non-revoked applet versions.
7. Gateway enforces distributed capability/service policy.
8. Host uploads allowed and denied capability audit records.
9. Revoke prevents new sessions; rollback resolves an older version.

## Dependency Order

1. `P2.2 Station Store Persistence Model`
   - Replace demo tables with package, version, manifest, bundle, channel,
     install state, policy, and audit tables.
2. `P2.3 Station Store Service`
   - Implement catalog/version/install/uninstall/revoke/rollback/audit services
     behind the new proto contract.
3. `P2.4 Station Store Handler`
   - Replace mock seeding and unimplemented bundle serving with authenticated
     typed handlers and explicit error mapping.
4. `P2.5 CLI Gates`
   - Add `pnpm applet:publish`, `pnpm applet:install`, and
     `pnpm applet:revoke` gates.
5. `P2.6 Desktop Gateway Client`
   - Add Desktop Rust client/cache that mirrors Station Store state without
     becoming source of truth.

## Evidence

| Command | Status | Notes |
|---------|--------|-------|
| `./model/build.sh` | PASS | Regenerated Go and TypeScript proto outputs from the updated proto source. Existing unrelated proto warnings remain. |
| `cd apps/station && go test ./app/subserver/applet_store/...` | PASS | Existing applet_store packages compile against the expanded generated proto. |
| `cd apps/desktop && pnpm run check` | PASS | Desktop TypeScript check passes against regenerated TS proto output. |

## Not Completed

- Station Store persistence is not implemented.
- Station Store service/handler behavior is not implemented.
- Publish/install/revoke CLI gates are not implemented.
- Desktop Gateway Store client/cache is not implemented.
- Applet Box is not Station-backed yet.
- Revoke, rollback, policy enforcement, and audit ingestion are not runtime
  verified yet.

## Claim

P2.1 Station Store Proto Design is complete. The repository now has a
proto-first Station Store contract for registry, catalog, install state, policy,
revocation, rollback, and audit ingestion. P2 itself is not complete until the
Station service, Desktop client/cache, CLI gates, and runtime acceptance pass.
