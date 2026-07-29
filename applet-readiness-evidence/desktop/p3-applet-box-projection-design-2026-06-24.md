# P3.1 Applet Box Station-Backed Projection Design

> Evidence class: `NOT_IMPLEMENTED`
> Plan source: `docs/architecture/applet-runtime/execution-plans/2026-06-23-applet-capability-completion-plan.md`
> Platform source: `docs/client/desktop/runtime-projections.md`

## Objective

Replace the current local-only Applet Box projection with a Desktop runtime projection over Station Store truth while preserving local directory import as an explicit development source.

## Current State

- `apps/desktop/src/runtimes/appletsRuntime.ts` already owns long-lived applet projection refresh through bootstrap, interval reconciliation, visibility change, and focus.
- `apps/desktop/src/store/applets.ts` currently derives applets from local `AppletManager.scanApplets()` and persists installed ids under `pt.applets.installedIds`.
- `apps/desktop/src/pages/AppletsPage.tsx` is a renderer over the `applets` runtime/store and already separates:
  - installed applets;
  - Applet Box catalog entries;
  - local directory import.
- This state is still local-only for product install truth and therefore cannot satisfy P3 exit criteria.

## Target Projection Ownership

`appletsRuntime` remains the Desktop projection owner.

It must reconcile four source classes:

- Station catalog: from P2 `ListAppletCatalog`, source of product Applet Box availability.
- Station install state: from P2 `ListInstalledApplets`, source of product "mine" and sidebar eligibility.
- Local package reader: from `AppletManager` for imported development packages only.
- Launch/session state: from Desktop Host/Gateway runtime for active, revoked, unavailable, or integrity-failed launch state.

Pages remain pure renderers. `AppletsPage` may call store actions for user intent, but it must not become the owner of fetching, reconciliation, or Station fallback rules.

## Store Shape

The applet store should move from `installedAppletIds` as truth to a normalized projection:

```text
catalogById
installedById
localDevById
launchStateById
diagnostics
lastOpenedAtById
loadingState
```

Each displayed applet should carry a source label:

```text
station
local-dev
bundled-official
```

Only `station` and `bundled-official` entries count as product install truth. `local-dev` remains explicit and cannot silently satisfy Station Store acceptance.

## User Actions

- `refresh`: runtime-owned reconciliation, not page mount fetch.
- `importAppletDirectory`: validates and stores a local-dev package projection only.
- `installApplet`: calls Desktop Rust Store client, which calls Station Store install API; local preferences may cache the result but never own the truth.
- `uninstallApplet`: calls Station Store uninstall API and removes sidebar/pinned eligibility.
- `loadApplet`: requires installed or explicit local-dev mode; revoked Station entries must fail before session creation.
- `reconcile`: refreshes catalog, installed state, local-dev diagnostics, and launch availability.

## Desktop Rust Boundary

Desktop Web must not call Station Store directly.

Required Rust commands:

- `applets_store_list_catalog`
- `applets_store_list_installed`
- `applets_store_install`
- `applets_store_uninstall`
- `applets_store_get_version`

These commands are the Desktop Gateway client/cache boundary for P2/P3. They may cache Station Store responses locally, but cache invalidation must follow runtime reconciliation and must not become the source of truth.

## Acceptance For Implementation

- `appletsRuntime.bootstrap()` populates Applet Box from Station Store when a session is available.
- `appletsRuntime.reconcile(reason)` updates catalog/install/revoke/update state without remounting `AppletsPage`.
- `AppletsPage` renders Station-backed installed/catalog/revoked/update states from store selectors only.
- Sidebar pinned applets derive from installed Station state or explicit local-dev state.
- Local directory import remains visible as local-dev and never masquerades as Station-installed.
- Account switch clears or rekeys cached install state by actor/device.

## Not Implemented In This Step

- No Desktop Rust command was added here.
- No Desktop Web Store client was added here.
- Applet Box still uses the current local-only store until P3 implementation lands.

## Claim

P3.1 projection design is defined. P3 implementation is not complete, and Applet Box is not yet Station-backed.
