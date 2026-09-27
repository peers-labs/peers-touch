# Frontend Component Tree Standard

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-07-01 | **Updated**: 2026-09-11
> **Owner**: Client Platform Team
> **Module**: `docs/client/common/ui-identity/`

---

## 1. Purpose

This document defines the frontend component tree standard for Peers Touch client UI.

It complements UI Identity by turning visual and interaction intent into an implementation tree that AI agents and engineers can inspect before writing UI code.

Architecture source: `docs/architecture/frontend-runtime/README.md` owns the cross-client runtime model for scheduling, lifecycle, hidden-tree budget, Applet container behavior, and performance evidence. This document is the downstream UI tree standard that applies that architecture to client component trees.

This standard exists because a UI can pass visual review and still feel slow when its tree is wrong:

- Primary tabs remount heavy pages instead of showing already-alive surfaces.
- Hidden keep-alive trees keep re-rendering on broad store/context updates.
- Settings and provider panels mount every schema at once.
- Loading, runtime projection, and page rendering work all compete on the same click frame.
- AI-generated UI creates local wrappers, cards, stores, and effects instead of joining the platform tree.

## 2. Scope

This document defines:

- The canonical client UI tree layers.
- Alive and non-alive page/component categories.
- How to choose preload, keep-alive, cache, and unmount behavior.
- How AI agents must implement UI without introducing tab-switch jank.
- How to review whether a frontend tree is standard.

This document does not define:

- Product visual style. Use `README.md`, `foundations.md`, `layout.md`, `components.md`, and module UI Identity contracts.
- Desktop kernel internals. Use `docs/client/desktop/runtime-projections.md`.
- Mobile-specific safe-area, keyboard, gesture, or platform navigation primitives. Use `docs/client/mobile/`. This document does define the cross-platform alive/lifetime contract that Mobile must also satisfy (see §14).
- Runtime ownership across processes. Use architecture-layer runtime documents.

## 3. Position In UI Identity

UI Identity defines what the product should feel like. The frontend component tree defines how the implementation must be shaped so that the product remains responsive and coherent.

Constraint direction:

```text
Product / Architecture intent
  -> Frontend Runtime Architecture
      -> UI Identity
          -> Frontend Component Tree Standard
              -> Platform contracts
                  -> Page descriptors / routes / stores / components
                      -> Code
```

Rules:

- UI Identity owns visual, spatial, interaction, and accessibility semantics.
- Frontend Runtime Architecture owns cross-client scheduling, page/section/applet lifecycle, hidden-tree budget, and performance evidence.
- Frontend tree standard owns component lifetime, mounting shape, render boundaries, and performance perception.
- Platform contracts translate the common tree into Desktop or Mobile primitives.
- Code must not create one-off page lifetime rules when a platform kernel has a page/runtime registry.

## 4. Canonical Tree Layers

Every client UI surface must be explainable through these layers.

```text
AppShell
  NavigationShell
    PageHost
      PageFrame
        PageBoundary
          PageContent
            SectionBoundary
              FeatureComponent
                PrimitiveComponent
  OverlayHost
  RuntimeProjection
  StoreSubscription
```

### 4.1 AppShell

Owns app-wide chrome, boot state, auth state, global providers, side navigation, theme, i18n, and top-level error recovery.

Rules:

- Shell is long-lived and must not remount on primary page switches.
- Shell must not fetch page-specific business data.
- Shell may subscribe to global navigation badges, account state, and app readiness only.
- Shell may provide context, but context values must be stable or split by responsibility.

### 4.2 NavigationShell

Owns primary navigation, secondary navigation, selected page id, and platform route synchronization.

Rules:

- Route changes should update the smallest route state necessary.
- Primary tab changes should be interruptible where the platform supports transitions.
- Navigation click handlers must not await page data before changing route.
- Navigation badges must come from runtime/store projections, not child page effects.

### 4.3 PageHost

Owns page descriptor resolution, page mounting, keep-alive policy, preload policy, and active-page visibility.

Rules:

- PageHost is the only layer that decides whether a primary page is mounted, hidden, cached, or unmounted.
- New high-frequency pages must register with the platform page registry rather than a legacy fallback router.
- Page prewarm must be scheduled outside the click frame.
- Idle prewarm must be chunked; do not mount several heavy pages in one idle callback.
- Hidden alive pages should be visually hidden without losing local UI state.

### 4.4 PageFrame

Owns the stable wrapper around one page instance: active/inactive visibility, descriptor metadata, lifecycle instrumentation, and local error boundaries when required.

Rules:

- PageFrame should be memoized or otherwise protected from unrelated active-page changes.
- PageFrame must not allocate heavy data, derive large lists, or perform API calls.
- PageFrame should expose testable attributes when the platform needs E2E proof of ownership.

### 4.5 PageBoundary

Owns route-specific layout, content rail, action rail, recovery layer, scroll root, and page-local providers that are safe to keep alive.

Rules:

- PageBoundary must preserve the same semantic rail model across loading, empty, error, overflow, and narrow states.
- PageBoundary must not subscribe to a whole global store if a section only needs one slice.
- PageBoundary may own scroll restoration and focus restoration.
- PageBoundary must not bootstrap long-lived runtime projections.

### 4.6 PageContent

Owns the product task surface: list, detail, editor, feed, composer, settings section, applet runtime, or provider configuration.

Rules:

- PageContent should be split by semantic sections, not by incidental visual wrappers.
- Heavy sections must be lazy, virtualized, deferred, or loaded on intent.
- PageContent must not render all mutually exclusive detail panels at once.
- Selected-provider or selected-applet configuration must mount only the selected schema.

### 4.7 SectionBoundary

Owns a reusable section with one data dependency and one user task.

Rules:

- SectionBoundary may use suspense, skeleton, retry, optimistic state, and local form state.
- SectionBoundary should subscribe to the narrowest store selector possible.
- SectionBoundary must expose an explicit unavailable or not-implemented state when capability is not alive.
- SectionBoundary must not create a second page-level scroll root unless the layout contract requires it.

### 4.8 FeatureComponent

Owns task-specific controls and content rendering.

Rules:

- Feature components should be mostly pure renderers.
- Expensive derivations must be memoized by stable inputs or moved to projection selectors.
- Event handlers should schedule work after route/visual feedback when possible.
- Feature components must not create invisible background runtimes.

### 4.9 PrimitiveComponent

Owns normalized design-system primitives.

Rules:

- Prefer shared component contracts and LobeUI-first primitives for Desktop.
- Do not mix raw antd defaults, LobeUI defaults, and one-off CSS on one semantic surface.
- Primitive props should not encode business state that belongs to a section or runtime projection.

### 4.10 OverlayHost

Owns dialogs, popovers, sheets, menus, command palettes, and toasts.

Rules:

- Floating layers must be anchored to the semantic source surface.
- Mobile action surfaces must use platform-appropriate sheets or dedicated pages, not desktop drawers by default.
- Overlay content must not keep hidden heavy trees alive unless the user task requires draft preservation.

### 4.11 RuntimeProjection

Owns long-lived business freshness, reconciliation, event consumption, and cross-page derived state.

Rules:

- Data freshness belongs to runtime/store projections, not incidental page mount effects.
- Projection install, bootstrap, teardown, and reconcile must be idempotent where the platform supports runtimes.
- Page visit may trigger one-shot section prefetch only when the owning runtime already exists or the data is truly page-local.

### 4.12 StoreSubscription

Owns render invalidation boundaries.

Rules:

- Subscribe to exact slices with selectors.
- Avoid broad context values that change on every navigation, polling tick, or runtime reconcile.
- Hidden alive trees must not re-render on data they do not display.
- Derived collections should be computed in selectors or memoized with stable identity.

## 5. Alive Taxonomy

Alive means a UI tree remains mounted while not visible or not focused. Alive is a product and performance decision, not a default.

| Category | Lifetime | Use When | Examples | Required Guardrails |
|----------|----------|----------|----------|---------------------|
| `eager + forever` | Mounted during ready shell and never unmounted | Landing page or critical task must be instantly available | Desktop search/home | Small first render, no blocking fetch in render, stable store selectors |
| `idle + forever` | Mounted after first paint during idle and retained | High-frequency primary tabs benefit from instant return | Chat, Agent, Settings, Moments | Chunked prewarm, memoized frame, hidden-tree render guard |
| `on-visit + lru` | Mounted on first visit and retained within bounded cache | Dynamic instances need local state but cannot all stay alive | Applet runtime, document detail, thread detail | LRU limit, teardown policy, memory proof |
| `on-visit + none` | Mounted only while active | Rare, lightweight, or sensitive surfaces | One-off confirmation, import wizard, auth recovery step | Fast mount proof, draft handling, no surprise state loss |
| `lazy section` | Parent alive, section mounted on user intent | Heavy panels inside an alive page | Provider schema editor, advanced settings, large picker | Intent trigger, placeholder state, no all-schema mount |
| `virtualized content` | Page alive, visible rows only render | Large list/grid/tree surfaces | Feed, messages, logs, contacts | Stable item keys, preserved scroll, accessible focus |

Default decision:

- Primary module tab: start from `idle + forever`, then downgrade if memory or hidden render cost is high.
- Dynamic detail: start from `on-visit + lru`.
- Modal/sheet: start from `on-visit + none`.
- Heavy settings/provider panels: start from `lazy section`.
- Large list: keep page alive only if list virtualization and selector boundaries are in place.

## 6. Primary Module Tab Standard

Primary modules are the app's first-level side navigation or bottom navigation destinations.

Rules:

- A primary module must have a named page descriptor or equivalent platform route contract.
- The active page switch must be route/visibility first, data second.
- Do not block navigation on API calls, bundle loading, schema loading, or runtime materialization.
- Do not add primary modules to a legacy router when a PageHost/PageDescriptor registry exists.
- Idle prewarm order should favor high-frequency modules.
- Hidden primary modules must not keep repainting due to broad context/store updates.

Acceptance:

- First click changes visible route immediately or shows a page-owned preparing state.
- Return click to an already-alive tab does not remount the page root.
- Long tasks above 50 ms are either absent or attributed to page-internal known debt with a follow-up owner.
- E2E can identify which host owns the rendered page.

## 7. Settings And Provider Tree Standard

Settings and provider configuration pages are high-risk because they often gather many unrelated forms and schemas.

Rules:

- The settings page may be alive, but individual provider editors must be lazy sections.
- Selecting a provider mounts only that provider's configuration schema.
- CLI providers must have dedicated configuration sections for command, binary path, working directory, environment, model, arguments, timeout, and capability flags when those properties exist.
- Non-CLI providers must not inherit CLI-only fields through a generic all-provider form.
- Expensive validation, model discovery, or capability probing must run on explicit intent or background runtime projection, not on every settings mount.
- Switching providers must preserve unsaved draft only for the selected provider or an explicit draft cache, not by keeping every provider form mounted.

Anti-patterns:

- Rendering every provider form and hiding inactive ones.
- Fetching every provider's model list when opening settings.
- Building one giant form with fields that appear/disappear through local CSS only.
- Using a page mount effect as the source of provider capability truth.

## 8. Applet And Embedded Runtime Tree Standard

Applets and embedded runtimes are dynamic and potentially heavy.

Rules:

- Launcher/list page should navigate immediately; runtime page owns preparing and failure states.
- Runtime materialization must be deduplicated by id.
- Applet instances should use bounded `on-visit + lru` unless product requires global persistence.
- The host page owns shell, error, preparing, and trust state; the applet owns applet-local content.
- SDK/bridge readiness tolerance belongs to shared runtime contracts, not per-applet retries.
- Bundles and runtime engines may be prewarmed during idle only when prewarm is cancellable and does not block primary tab interaction.

## 9. Jank Prevention Rules

These rules are mandatory for UI work that touches navigation, primary tabs, settings, provider config, applets, feeds, messages, or large lists.

### 9.1 Protect The Click Frame

- Change route/visible state before awaiting data.
- Use transition scheduling for low-priority route state where the platform supports it.
- Defer heavy mount, schema parsing, and large derivation until after visual feedback.
- Do not synchronously install runtimes from click handlers.

### 9.2 Split Prewarm

- Prewarm after first paint.
- Mount at most one heavy idle page or section per idle slot.
- Use timeout-backed idle scheduling so work eventually completes without starving.
- Cancel prewarm on teardown.

### 9.3 Guard Hidden Trees

- Hidden alive trees must use narrow store selectors.
- Page frames should be memoized.
- Store projection updates should not invalidate every page.
- Avoid broad provider values that recreate on every render.

### 9.4 Bound Heavy Content

- Virtualize long lists and grids.
- Lazy-load rare panels.
- Defer markdown, syntax highlighting, chart rendering, and schema compilation.
- Keep large derived data outside render or behind memoized selectors.

### 9.5 Prove With Evidence

- Use browser long-task sampling for suspected jank.
- Record route-to-visible behavior for primary tabs.
- Verify remount behavior with stable root markers or lifecycle logs.
- Capture memory or cache-size reasoning for `forever` and `lru` decisions.

## 10. Standard Review Checklist

Use this checklist before accepting any frontend UI tree change.

Architecture:

- [ ] The surface is mapped to canonical layers from Shell to Primitive.
- [ ] Page lifetime is declared as eager, idle, on-visit, lru, none, lazy section, or virtualized content.
- [ ] Runtime projection ownership is separate from page rendering.
- [ ] Dynamic instances have bounded cache or explicit non-alive behavior.

Navigation and alive:

- [ ] Primary tab switch is not blocked by data or bundle loading.
- [ ] PageHost/PageDescriptor or platform-equivalent owner is used.
- [ ] Hidden alive pages do not receive broad unrelated updates.
- [ ] Idle prewarm is chunked and cancellable.

Rendering:

- [ ] Heavy sections are lazy, virtualized, deferred, or selector-backed.
- [ ] Page frame and section boundaries prevent unnecessary re-render.
- [ ] Selected schemas/forms mount by intent, not all at once.
- [ ] Overlay content does not keep heavy hidden subtrees alive accidentally.

UX Identity:

- [ ] Content rail, action rail, trust rail, and recovery layer remain identifiable.
- [ ] Alive/preparing/error states are visible to users and do not look broken.
- [ ] Incomplete capabilities are named as unavailable, degraded, or not implemented.
- [ ] Platform-specific adaptation does not copy desktop patterns into mobile or vice versa.

Evidence:

- [ ] Long-task risk is measured or explained.
- [ ] E2E or manual proof confirms page ownership and visible route.
- [ ] Known non-alive decisions are recorded in `frontend-component-tree-registry.md`.
- [ ] Any exception has owner, rationale, and follow-up.

## 11. AI Agent Implementation Contract

Before implementing or modifying UI, an AI agent must:

1. Read this document and the closest UI Identity module/pattern contract.
2. Identify the page or section's intended alive category.
3. Check `frontend-component-tree-registry.md` for existing lifetime decisions.
4. Locate the platform page/runtime/store owner.
5. Plan the component tree before writing JSX.
6. Keep data freshness in runtime/store projections.
7. Mount heavy panels only on visit or intent.
8. Preserve user feedback on the first interaction frame.
9. Add verification evidence for route visibility, remount behavior, and long-task risk.
10. Update the registry when a feature's alive category changes.

AI agents must not:

- Generate a new page wrapper hierarchy without naming the layer it belongs to.
- Add mount-time API calls to make a tab "fresh".
- Keep every hidden provider, settings panel, applet, or detail view mounted.
- Hide inactive heavy trees with CSS as a substitute for an alive policy.
- Fix jank with arbitrary timeouts instead of moving work to the owning layer.

## 12. Registry Requirement

Any primary module, applet host, settings/provider section, long-lived overlay, or large-list surface must be registered in `frontend-component-tree-registry.md`.

Registry rows must include:

- Feature or surface name.
- Platform (may be inherited from a platform-scoped section header; explicit only for cross-client rows — see registry §2).
- Owner layer.
- Alive category.
- Preload or mount trigger.
- Cache policy.
- Runtime/store owner.
- Current status.
- Verification evidence.
- Review owner.

If a feature is not in the registry, reviewers should assume its alive behavior is undefined and request an update before approving related UI work.

Source-of-truth sync:

- Desktop primary-module rows describe the same migration state as `docs/client/desktop/runtime-projections.md §7`. Any change to a Desktop page's descriptor/runtime ownership must update both the registry row and §7 in the same change, so the two never drift.
- Mobile rows describe the `MobileShell` / feature-runtime model. Changing the Mobile tab lifetime must update both `frontend-component-tree-registry.md §8` and §14 of this document.

## 13. Change Rules

- Changing a feature from non-alive to alive requires memory/render invalidation reasoning.
- Changing a feature from alive to non-alive requires state-loss and task recovery reasoning.
- Increasing LRU size requires a cache bound explanation.
- Adding a primary module requires a registry row and a platform page descriptor or equivalent.
- Adding a provider/editor section requires a lazy-section decision unless it is proven lightweight.
- Any exception must include owner, date, and revisit condition.

## 14. Mobile Platform Tree Standard

Desktop and Mobile share the same alive/lifetime contract (§5), but they realize it with different primitives. Desktop uses the kernel `PageHost` + `PageDescriptor` registry to keep primary tabs alive (`idle + forever`). Mobile must satisfy the same responsiveness goals through a navigation-shell + feature-runtime model. This section is the cross-platform standard for Mobile; platform-specific safe-area, keyboard, and gesture rules still live under `docs/client/mobile/`.

### 14.1 Current Mobile Tree

```text
MobileShell (NavigationShell)
  MobileNavigationStore (descriptor-backed primary route + detail stack)
  mobile-content (active tab only)
    ChatPage | MomentsPage | ContactsPage | SettingsPage
      OverlayHost (action sheet, modals)
  mobile-tabbar (NavigationShell)
  RuntimeProjection: Mobile runtime registry + social/group stores
```

Layer mapping:

- `MobileShell` plays the `NavigationShell` role and renders the active
  descriptor from `MobileNavigationStore`.
- There is **no `PageHost` keep-alive layer**. `renderPage` returns only the active tab; inactive tabs are unmounted.
- Conversation, Contact, Group, Moment, and selected Settings details are
  descriptor-owned routes. Social/Group/Settings selections may guide
  projection readback, but they do not decide whether a detail tree is visible.
- `RuntimeProjection` is owned by the Mobile runtime registry and feature
  stores, so projection truth stays fresh even while a tab tree is unmounted.

### 14.2 Mobile Alive Rules

- A Mobile primary tab is `on-visit + none` by default: only the active tab tree is mounted; switching tabs unmounts the previous tree. This is the accepted current standard, not a defect — but it carries a re-mount audit obligation (see §14.4).
- Mobile must keep **data freshness in feature runtimes/stores**, never in tab mount effects. A tab re-mount must re-project from already-fresh store state, not re-fetch from the network as the source of truth.
- The tabbar is alive while in tab mode and is hidden only when an immersive surface needs full height (e.g. an open chat thread). Hiding the tabbar must not unmount runtime projections.
- Mobile must not copy the Desktop `display:none` hidden-keep-alive trick to fake alive tabs. If a Mobile tab needs to survive switches (e.g. expensive list scroll position), promote it explicitly to `on-visit + lru` with a bounded cache and record it in the registry — do not keep all tabs mounted.

### 14.3 Mobile Overlay And Navigation Rules

- Conversation and contextual actions must use a bottom action sheet or a dedicated page, never a desktop-style right drawer (`ChatActionSheet` returns `null` when closed).
- Modal/sheet surfaces are `on-visit + none`; they must not retain heavy hidden trees after close.
- Find People and Create Group use one selected-only descriptor-owned overlay
  route; closing, replacing the primary route, or entering a detail route
  unmounts the overlay tree.
- Any future Mobile route stack (planned `session` runtime) must still declare each stacked page's alive category and cache bound in the registry.

### 14.4 Mobile Acceptance

- Switching tabs changes the visible surface on the same interaction frame; any heavy re-projection is deferred or selector-backed.
- Returning to a tab restores from fresh store/runtime state without a blocking network round-trip.
- Opening/closing a conversation does not leak mounted threads or runtime subscriptions.
- The Mobile chat tab re-mount cost is sampled (or recorded as known debt with an owner) in `frontend-component-tree-registry.md §12`.

### 14.5 Mobile Registry

Mobile surfaces are registered in `frontend-component-tree-registry.md §8` with the same field model as Desktop. The Mobile rows must state the real lifetime (currently `not alive` per-tab) and name the feature runtime that owns freshness — not a `Platform-defined` placeholder.

## 15. Related Documents

- `docs/client/common/ui-identity/README.md`
- `docs/client/common/ui-identity/review-checklist.md`
- `docs/client/common/ui-identity/frontend-component-tree-registry.md`
- `docs/client/desktop/runtime-projections.md`
- `docs/client/common/ux-design-methodology.md`
- `docs/knowledge/invariants/client-ui-identity-before-edit.md`
