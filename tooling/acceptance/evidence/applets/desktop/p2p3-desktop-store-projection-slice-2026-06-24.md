# P2.6 / P3 Desktop Store Projection Slice

> Evidence class: `CONTROLLED_CLIENT_INTEGRATION`
> Plan source: `docs/architecture/platform/applet-runtime/execution-plans/2026-06-23-applet-capability-completion-plan.md`
> Design source: `tooling/acceptance/evidence/applets/desktop/p3-applet-box-projection-design-2026-06-24.md`

## Completed

- Added Desktop Rust Station Store client/cache command boundary:
  - `applets_store_list_catalog`
  - `applets_store_list_installed`
  - `applets_store_install`
  - `applets_store_uninstall`
  - `applets_store_get_version`
- Added `application::applet_store` to keep Station Store calls out of page/runtime code.
- Added actor/device scoped applet Store cache under Desktop app data:
  - catalog cache;
  - installed state cache;
  - version cache.
- Cache is marked explicitly with:
  - `source: "cache"`;
  - `stale: true`;
  - `stationUnavailable: true`.
- Station failures no longer silently fall back to local applet preferences as product install truth.
- Added TS API types and command wrappers in `desktop_api.ts`.
- Changed applet store projection from local installed id truth to mixed source projection:
  - `station`;
  - `local-dev`;
  - `bundled-official`.
- Sidebar pinned applets now derive from the installed projection instead of `installedAppletIds`.
- Applet Box now carries revoked / unavailable states in store data and shows a localized Station unavailable banner.

## Verification

```bash
cd apps/desktop/src-tauri && cargo check
```

Result: PASS.

Notes: Existing generated-code warnings remain; no new Rust compile error.

```bash
cd apps/desktop && pnpm run check
```

Result: PASS.

```bash
git diff --check -- apps/desktop/src-tauri/src/application/applet_store.rs apps/desktop/src-tauri/src/application/mod.rs apps/desktop/src-tauri/src/contracts.rs apps/desktop/src-tauri/src/interface/tauri_commands/applets.rs apps/desktop/src-tauri/src/main.rs apps/desktop/src/services/desktop_api.ts apps/desktop/src/store/applets.ts apps/desktop/src/components/AppSideNav.tsx apps/desktop/src/pages/AppletsPage.tsx packages/locales/en/applet.json packages/locales/zh-CN/applet.json
```

Result: PASS.

Forbidden scan for debug statements / placeholders over edited Desktop files: PASS.

## Not Completed

- Live authenticated Station Store E2E is not proven in this slice.
- Desktop package download/cache from `bundle_url` is not implemented yet.
- Station-backed applet launch still needs bundle materialization before it can replace local `AppletManager` paths.
- Gateway policy enforcement still does not consume Store-distributed policy rows.
- Host audit upload to Store audit ingestion is still not wired.

## Claim

Desktop now has the P2.6 Store client/cache boundary and the first P3 Station-backed projection slice. Applet Box no longer treats local installed preferences as production Station truth, but full Station-backed launch acceptance is still open.
