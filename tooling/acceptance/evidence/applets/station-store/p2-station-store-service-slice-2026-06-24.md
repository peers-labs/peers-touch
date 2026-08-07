# P2.2-P2.4 Station Store Service Slice Evidence

> Date: 2026-06-24
> Plan source: `docs/architecture/applet-runtime/execution-plans/2026-06-23-applet-capability-completion-plan.md`
> Workstream: `P2 - Station Store and Install State`
> Tasks: `P2.2 Station Store Persistence Model`, `P2.3 Station Store Service`,
> `P2.4 Station Store Handler`
> Evidence class: `CONTROLLED_LOCAL_UPSTREAM`

## Scope Completed

This implementation slice upgrades the existing `applet_store` package from the
previous demo-shaped list/details/publish service toward the active plan's
Station Store source-of-truth model.

Completed:

- Added Station Store persistence models for:
  - applets and applet versions with package status and release channel;
  - manifest snapshots;
  - bundle assets and storage metadata;
  - channel rollout and rollback state;
  - actor/device install state;
  - capability and service policies;
  - audit records.
- Updated `tables.sql` to describe the same Store tables and indexes.
- Added `StoreService.Migrate()` with one authoritative model list.
- Removed the list-handler path that automatically seeded demo applets.
- Removed the hardcoded `localhost` bundle domain from legacy multipart publish.
- Added service methods for:
  - catalog listing;
  - version lookup;
  - install;
  - uninstall;
  - installed applet listing;
  - revoke version;
  - rollback channel;
  - audit ingest;
  - audit query.
- Added typed handler entry points for those same operations.
- Updated tests to use explicit Store fixtures instead of implicit mock seed.

## Runtime Verification

`TestAppletStoreInstallRevokeRollbackAndAudit` verifies the service/handler path
for a controlled Station Store fixture:

- catalog returns the seeded published applet;
- install writes an actor/device install state;
- installed listing returns the active install;
- rollback resolves the stable channel target version;
- audit ingest persists a Host capability record;
- audit query returns the persisted record;
- revoke marks the version as revoked.

## Evidence

| Command | Status | Notes |
|---------|--------|-------|
| `gofmt -w app/subserver/applet_store/...` | PASS | Applet Store Go files formatted. |
| `cd apps/station && go test ./app/subserver/applet_store/...` | PASS | Store db/model, handler, generated model, service, and storage packages compile and tests pass. |
| `git diff --check -- apps/station/app/subserver/applet_store/...` | PASS | No whitespace diff errors in touched Store files. |
| Store forbidden scan | PASS | No `mock`, `localhost`, `TODO`, or debug print markers remain in Store Go/SQL source. |

## Not Completed

- Store publish is still only a legacy multipart compatibility path; typed
  proto publish with manifest and policy validation is not implemented.
- Bundle serving remains unimplemented.
- CLI gates for `pnpm applet:publish`, `pnpm applet:install`, and
  `pnpm applet:revoke` are not implemented.
- Desktop Gateway Store client/cache is not implemented.
- Applet Box is not Station-backed yet.
- Gateway policy enforcement is not connected to Store-distributed policies.
- Audit ingestion is implemented at Store service/handler level, but Host upload
  integration is not implemented.

## Claim

P2.2 persistence model and a P2.3/P2.4 service-handler slice are implemented and
verified inside Station `applet_store`. P2 is still not complete because publish
validation, bundle serving, CLI gates, Desktop Store client/cache, Applet Box
projection, and Host/Gateway policy/audit integration remain open.
