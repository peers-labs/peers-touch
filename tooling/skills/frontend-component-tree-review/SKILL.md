---
name: frontend-component-tree-review
description: "Checks UI component tree lifetime, alive policy, and jank risk. Invoke for client UI/UX, tabs, settings/provider, applet, or large-list changes."
---

# Frontend Component Tree Review

Use this skill to check whether a client frontend tree follows Peers Touch UI Identity and performance-lifetime standards.

This skill is a UI/UX Identity supplement. It does not replace visual review; it verifies that the implementation tree can actually deliver the intended UX without tab-switch jank, hidden-tree churn, or accidental all-panel mounting.

## When To Invoke

Invoke this skill when any of these are true:

- The user asks for frontend tree, component tree, alive, keep-alive, tab switching, or UI performance standards.
- You create, modify, or review client UI/UX under Desktop, Mobile, Web, applets, or prototypes.
- You add or change a primary module tab, page descriptor, route, shell, or navigation behavior.
- You change Settings, provider/model configuration, CLI provider forms, schema editors, or advanced settings panels.
- You change applet launcher/runtime, embedded runtimes, Lynx host surfaces, or applet shell behavior.
- You change large lists, feeds, messages, rosters, logs, grids, or tree views.
- A UI feels correct visually but slow, sticky, janky, or inconsistent when switching pages.

## Required Reading

Before proposing or applying changes, read:

- `docs/client/common/ui-identity/README.md`
- `docs/client/common/ui-identity/frontend-component-tree.md`
- `docs/client/common/ui-identity/frontend-component-tree-registry.md`
- `docs/client/common/ui-identity/review-checklist.md`
- The closest module contract under `docs/client/common/ui-identity/modules/`
- The closest shared pattern under `docs/client/common/ui-identity/patterns/`

When editing Desktop UI under `apps/desktop/src/`, also read:

- `docs/client/desktop/runtime-projections.md`
- `.trae/skills/desktop-runtime-projections/SKILL.md`

When editing Mobile UI, also read the closest `docs/client/mobile/` contract.

## Core Procedure

### 1. Name The Surface

Identify the exact surface being changed:

- Primary module tab
- Dynamic page/detail
- Settings/provider section
- Applet launcher/runtime
- Overlay/sheet/dialog
- Large list/feed/message surface
- Primitive or reusable component

If the surface has no row in `frontend-component-tree-registry.md`, plan a registry update before changing lifetime behavior.

### 2. Map The Tree

Map the implementation to the canonical layers:

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

For each layer, answer:

- Who owns mounting?
- Who owns visual state?
- Who owns data freshness?
- Who owns cache and teardown?
- Which store/context updates can re-render it while hidden?

### 3. Choose The Alive Category

Assign exactly one category unless the surface is a parent with lazy children:

- `eager + forever`
- `idle + forever`
- `on-visit + lru`
- `on-visit + none`
- `lazy section`
- `virtualized content`

Use these defaults. Primary-module defaults are platform-specific — do not copy a single default across platforms; defer to the platform tree standard.

- Primary module tab (Desktop): `idle + forever`, except landing page may be `eager + forever` (kernel `PageHost` + `PageDescriptor` keep-alive; see `frontend-component-tree.md §5`).
- Primary module tab (Mobile): follow `frontend-component-tree.md §14` — Mobile uses the `MobileShell` navigation-shell + feature-runtime model, so only the active tab tree mounts (`on-visit + none` per tab) while runtimes keep projection truth fresh.
- Dynamic detail or applet instance: `on-visit + lru`.
- Rare flow, overlay, or wizard: `on-visit + none`.
- Provider editor and advanced settings panel: `lazy section`.
- Feed, message list, roster, logs, or large grid: `virtualized content`.

When a platform tree standard section (e.g. `frontend-component-tree.md §14` for Mobile) defines a primary-tab lifetime, that section wins over any default listed here.

### 4. Check Runtime Ownership

Verify that long-lived business freshness belongs to a runtime/store projection, not a page mount effect.

Reject patterns like:

- `useEffect(...load...)` added only to make a primary tab fresh.
- Navigation click handlers awaiting data before route changes.
- Shell or PageFrame fetching page-specific business data.
- Hidden pages doing broad reconciliation because they remain mounted.

Prefer:

- Runtime install/bootstrap/reconcile for durable projections.
- One-shot section prefetch for page-local data only.
- Store selectors scoped to the minimum data needed by the visible section.

### 5. Protect The Click Frame

For navigation and first interaction:

- Route or visible state must update before awaiting API calls, bundle loading, schema loading, or runtime materialization.
- Heavy work must run after visual feedback or in idle chunks.
- First click may show a page-owned preparing state, but must not leave the user on the old page without feedback.
- Prewarm must be chunked and cancellable.

If the change touches Desktop primary tabs, verify PageHost/PageDescriptor ownership instead of legacy fallback routing.

### 6. Guard Hidden Trees

For alive trees:

- PageFrame should be memoized or otherwise protected from unrelated active-page changes.
- Hidden pages must use narrow store selectors.
- Context values must be stable or split.
- Large derived collections must be selector-backed or memoized.
- Hidden trees must not repaint because a runtime reconcile changed unrelated state.

### 7. Enforce Lazy Settings And Provider Forms

For Settings/provider work:

- Settings shell may be alive.
- Provider list may mount with the settings section.
- Only the selected provider editor may mount.
- CLI provider editor must expose command, binary path, working directory, environment, model, args, timeout, and capability flags when applicable.
- Cloud/API provider editor must not inherit CLI-only fields through a generic all-provider form.
- Model discovery must run on explicit intent or background runtime projection, not on Settings mount.

Reject:

- Rendering every provider form and hiding inactive ones.
- Fetching all provider model lists on Settings mount.
- One giant form that toggles unrelated provider fields with CSS.

### 8. Enforce Applet Runtime Boundaries

For applets and embedded runtimes:

- Launcher/list page should navigate immediately.
- Runtime page owns preparing and error states.
- Runtime materialization must be deduplicated by applet id.
- Applet host owns shell, trust, preparing, and failure boundaries.
- Applet content remains applet-local.
- Bridge/SDK readiness belongs to shared runtime contracts, not one-off applet retries.

### 9. Verify Large Content

For large lists, feeds, messages, rosters, logs, or grids:

- Use virtualization or incremental rendering.
- Preserve stable keys and scroll restoration.
- Keep expensive filter/sort/search derivations outside render or behind memoized selectors.
- Do not keep high-volume diagnostic/log surfaces alive by default.

### 10. Collect Evidence

Select evidence proportional to risk:

- Static proof: descriptor, registry row, selector boundaries, lazy import, virtualization usage.
- Runtime proof: visible route changes before data load, no remount on alive tab return.
- Browser proof: long-task sampling, click-to-visible timing, screenshot/snapshot.
- Memory proof: LRU bound, cache count, teardown behavior.

A gate not run is unproven. Say what remains unproven.

## Output Contract

When reporting, include:

```markdown
## Frontend Tree Review

- Surface:
- Platform:
- Registry row:
- Alive category:
- Owner layers:
- Runtime/store owner:
- Hidden render risk:
- Jank risk:
- Evidence checked:
- Registry/doc updates:
- Verdict:

## Required Fixes

1. <fix>
   Impact:
   Suggested change:
```

Use `Verdict: follows standard` only when registry, alive policy, runtime ownership, and evidence all align.

Use `Verdict: follows with gaps` when behavior is acceptable but evidence or registry updates are missing.

Use `Verdict: does not follow standard` when the tree blocks navigation, mounts all hidden panels, lacks bounded cache, or puts runtime ownership in page effects.

## Review Red Flags

Treat these as blockers unless there is an explicit documented exception:

- Primary tab rendered only through a legacy fallback when the platform has PageDescriptor/PageHost.
- Primary tab click awaits data before navigation.
- Alive hidden page subscribes to a whole global store.
- Idle prewarm mounts several heavy pages in one callback.
- Settings mounts all provider schemas or fetches all model lists immediately.
- CLI provider configuration is forced into a generic cloud-provider form.
- Dynamic runtime instances stay alive forever without LRU or memory reasoning.
- Large list renders all items while the page is kept alive.
- Overlay keeps a heavy hidden tree alive without draft-preservation rationale.

## Registry Update Rules

Update `docs/client/common/ui-identity/frontend-component-tree-registry.md` when:

- Adding a primary module, provider editor, applet runtime, overlay, large list, or dynamic page.
- Changing alive category, LRU size, preload trigger, runtime/store owner, or status.
- Moving a surface from `needs audit` to `alive`, `lazy`, `lru`, or `not alive`.
- Discovering hidden-render or long-task debt that should be tracked.

## Composition With Other Skills

| Other skill | Order |
|-------------|-------|
| `read-before-edit` | Run before file edits to load knowledge entries. |
| `desktop-runtime-projections` | Run for Desktop files under `apps/desktop/src/`. |
| `prototype-design` | Run first when building or reviewing a web prototype. |
| `quality-check` | Run later when evidence aggregation is needed before review. |
| `github-review` | Use for final merge judgment; this skill supplies frontend-tree findings. |

## Crosswalks

- Standard: `docs/client/common/ui-identity/frontend-component-tree.md`
- Registry: `docs/client/common/ui-identity/frontend-component-tree-registry.md`
- UI review: `docs/client/common/ui-identity/review-checklist.md`
- Desktop runtime contract: `docs/client/desktop/runtime-projections.md`
- UI identity invariant: `docs/knowledge/invariants/client-ui-identity-before-edit.md`
