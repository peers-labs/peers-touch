# Mobile North-Star Realignment — Design

> Status: draft · Version 0.1 · Created 2026-11-09 · Updated 2026-11-09
> Owner: Mobile / Client Architecture
>
> Evidence tags: **[F]** verified by source in this worktree, **[I]** inference
> from verified facts, **[P]** proposal, **[X]** external prerequisite needing
> the human owner.

---

## 1. Evidence ledger (headline facts)

| Claim | Class | Evidence |
|---|---|---|
| Real app has real MLS/X3DH/social/secure-content/oauth/call runtimes via Tauri→Rust→Station | **[F]** | `apps/mobile/src-tauri/src/{messaging,social,secure_content,runtime}`, `runtimes/runtimeRegistry.ts` |
| Real web presentation uses antd v6 + @lobehub/ui + private 5106-line `styles.css`, and does NOT depend on `@peers-touch/ui` | **[F]** | `apps/mobile/package.json`, `src/styles.css`, `src/app/MobileThemeProvider.tsx` |
| `@peers-touch/ui` is source-only ESM, React 19 peer, styles scoped under `.pt-ui` (no `:root`/global pollution), CSS auto-injected by `UIProvider` | **[F]** | `packages/ui/web/{package.json,src/provider.tsx,src/styles.css}` |
| peers-ui ships one application feedback channel: `createFeedbackChannel()` provides `notify`, promise-based `requestConfirmation`, `requestChoice`, and a serial queue; `FeedbackHost` is mounted through `UIProvider`'s `feedback` slot | **[F]** | `packages/ui/web/src/application-feedback.tsx:24-87`, `provider.tsx:26,83` |
| Desktop and the mobile prototype already consume peers-ui with zero Vite alias; prototype renders peers-ui at real 390pt width | **[F]** | `apps/desktop/src/main.tsx`, `packages/prototypes/mobile/chat/{package.json,src/MobileApp.tsx}` |
| antd/lobehub appear in 40 mobile files; imperative usages are `Modal.confirm/success` (12 sites) and `message.*` (17 sites) | **[F]** | grep inventory across `apps/mobile/src` |
| North-star primary is neutral ink with pine accent; the private `#667eea→#764ba2` gradient has no token | **[F]** | `packages/ui/tokens/src/north-star-theme.ts`, `apps/mobile/src/styles.css:1-33,227` |
| Real shell is 4 tabs; prototype is 3 tabs. Real UI already has incoming-call accept/decline, inbound/outbound friend requests, block/unblock, and group admin; the prototype is outgoing-call-only and omits them | **[F]** | `MobileShell.tsx:453`, `call/MobileCallSurface.tsx:42-110`, `ContactsPage.tsx:118-185,392-407`, `chat/ChatOverlayHost.tsx:749-900`; prototype `CallScreen.tsx:7-9` |
| Genuine presentation gaps over real owners are narrow: `MobileNotificationCenter` is complete but unmounted; credentials/encryption detail is a thin placeholder | **[F]** | `components/MobileNotificationCenter.tsx` (zero importers); `pages/SettingsPage.tsx:473-496` |
| `safety-number` and `chat-background` are intentionally unavailable this release and have no owner | **[F]** | `pages/SettingsPage.tsx:489-496`, parent `design.md §12.7` |
| Acceptance harness: 106 registered actions; fixture surfaces across six fixtures; whole-product inventory is 162 surfaces (22+4+13+35+25+31+32) | **[F]** | `src/acceptance/{contracts,registry,actions}.ts`, `tooling/acceptance/gates/mobile/whole_product_surface_inventory.json:53` |
| No current-source iOS gate evidence in this worktree; gates are UNPROVEN (worktree-external store, not repo-verifiable) | **[X]** | `~/Library/Application Support/PeersTouch/acceptance/9c2993be5961ea8b` |
| iOS gate pins iOS 26.5 + iPhone 17; toolchain (Xcode/Appium/drivers/rust target) installed but the 26.5 runtime presence is unverified | **[X]/[F]** | `provisioners/mobile_simulator.py`, `environments/mobile-simulator.yaml` |
| Product gates require a reviewed non-stable remote Station profile in sibling `env` repo; whole-product needs foreground simulator | **[X]** | `mobile-direct-simulator.yaml`, `mobile-station-lifecycle-simulator.yaml` |
| iOS deployment target 15.0 while peers-ui CSS uses dvh/`:has`/`color-mix` (15.4/16.2+) | **[F]** | `gen/apple/...project.pbxproj`, `packages/ui/web/src/styles.css` |

---

## 2. Target architecture

### 2.1 One presentation design system

`apps/mobile` presentation consumes `@peers-touch/ui` exactly as the prototype
and desktop do. A single `UIProvider theme="light"` wraps the product root
(inside the existing `AppProviders`), injected with
`northStarVariables('light', { material: 'flat' })`, plus a thin **mobile skin
stylesheet** that only:

- sets `.pt-ui` width/height to 100% (UIProvider does not stretch by itself —
  proven necessary in `apps/desktop/src/ui/northstar.css`);
- maps a small set of **mobile geometry** tokens that north-star does not
  publish (tab bar height, header height, safe-area usage, chat composer
  geometry) onto a mobile-owned `--pt-m-*` namespace, never a second color set.

Colors, radius, spacing, motion, and controls come exclusively from
`--pt-*`. The private `--brand-*` palette and the blue-purple gradient are
deleted (ADR-2).

### 2.2 Layering (unchanged dependency direction)

```text
pages/ + components/   ── consume @peers-touch/ui primitives + --pt-* tokens
  features/*           ── presentation state/adapters; may import ui
  acceptance surfaces  ── render production components under fixture state
  runtimes/ services/  ── MUST NOT import @peers-touch/ui (presentation-free)
  Tauri/Rust           ── unchanged
```

Forbidden (new, in addition to `../module-layout.md §6`):

- `runtimes/`, `services/`, `storage/`, `src-tauri/**` importing
  `@peers-touch/ui` or any CSS;
- a second color/token source (`--brand-*`, ad-hoc hex) in mobile presentation
  after a surface migrates;
- re-implementing a peers-ui primitive inside `apps/mobile` (the only allowed
  new presentation modules are the thin feedback wrappers in §2.3 and
  mobile-specific layouts);
- acceptance fixtures driving business state outside the harness seam.

### 2.4 antd / lobehub retirement (bounded per-surface replacement)

Replacement is mechanical-API mapping (e.g. `type="primary"`→
`emphasis="primary"`, `danger`→`tone="danger"`, `onClick`→`onActivate`,
`onChange`→`onValueChange`, `Spin.spinning`→`active`), executed per surface
behind green acceptance, never as a big-bang global rewrite. Within a migrated
surface the order is: provider/skin available → primitives (typography,
button, fields, selection, feedback, list rows) → overlays (Modal→Dialog/
BottomSheet, Dropdown→Popover+Menu, Drawer) → delete that surface's private
CSS and antd/lobehub imports and assert zero residual for the surface.

Coexistence rules while surfaces migrate one by one:

- All product UI lives inside one `.pt-ui` provider; peers-ui's scoped reset
  (`.pt-ui *`) and font inherit therefore also reach not-yet-migrated antd
  controls. Each migrated surface is visually checked for reset cross-effects;
  antd body-portaled `Modal/message` are retired first on that surface so
  dialogs render inside the provider instead of escaping `.pt-ui`.
- The 5106-line `styles.css` is retired by **surface ownership split**: Slice 0
  partitions selectors into per-surface/style-module ownership (or co-located
  CSS) before deleting anything; the residual guard counts both imports and
  now-orphaned selectors/tokens, not only `--brand-*`, so dead antd-targeting
  CSS cannot silently remain.
- `react-layout-kit` is a dead dependency (zero imports) and is removed.
  `lucide-react` is replaced progressively by peers `Icon/IconId`; icon churn is
  tracked, not gating.

### 2.5 Real-wins reconciliation (prototype follows the product)

The prototype is corrected to the real structure; the real app is never
degraded to match a fixture:

- Shell/tab structure: adopt **4 tabs** (chat/moments/contacts/settings) and
  the real navigation descriptors; drop the prototype 3-tab/Me shape.
- Moments navigation: real feed + dedicated circles routes win over the
  prototype same-screen segmented form.
- Real UI the prototype merely lacks is **kept as-is and re-skinned**, not
  rebuilt: incoming-call accept/decline, friend request in/out, block/unblock,
  and group admin already exist over real owners (REAL-RESTYLE).
- Remove prototype fake/dead controls (no-op block, dead add-member/group-more,
  globals-bound per-contact switches, fake auto-lock); the prototype stops
  showing actions the product does not own.
- The narrow real presentation work over existing owners is: mount the already-
  built notification center, and give credentials/encryption a real detail over
  its identity owner. `safety-number`/`chat-background` stay unavailable (no
  owner this release) and are not fabricated.
- Prototype-only cosmetic settings with no real owner (fake auto-lock behavior,
  per-contact switches bound to globals) are removed from the prototype rather
  than faked in the app.

### 2.6 Acceptance closure (real functional points)

Every functional point receives, in order of strength:

1. **Source/structural** — `pnpm mobile:check`, per-surface import-residual
   guard (no antd/lobehub/private token in a migrated surface), vitest.
2. **Fixture surface** — the existing 157-surface harness renders the migrated
   production components; pixel/DOM/a11y/interaction evidence is regenerated
   under the new style, and `whole_product_surface_inventory.json` stays in
   lockstep (add/remove surfaces only when structure truly changes).
3. **Exact-source iOS Simulator functional gate** — harness build
   (`VITE_ACCEPTANCE_HARNESS=1`, cargo `acceptance-harness`) via
   `mobile_simulator` provisioner; station-free gates first, then Station-backed
   scenario gates, then whole-product for the slice's surfaces.

No migrated slice is "done" without classes 1–2 green and at least one
exact-source iOS functional Journey at `FUNCTIONAL_PASS` for that surface.
Whole-Mobile completion additionally requires the Android cell (out of scope
here) and the full 162-surface whole-product gate.

---

## 3. Functional-point coverage contract

The authoritative per-point ledger is
[functional-coverage.md](./functional-coverage.md). Each row binds:
prototype point → real owner (runtime/service/Rust command/acceptance action)
→ disposition → primary evidence gate. Disposition is one of:

- **REAL-RESTYLE**: real behavior exists; migrate presentation, keep behavior.
- **CONFLICT-REAL-WINS**: prototype diverged; fix prototype, adopt real.
- **REAL-GAP-PRESENT**: real owner exists but UI is hidden/placeholder; add UI
  over the real owner (no mock).
- **PROTOTYPE-FAKE-REMOVE**: prototype-only fake with no owner; remove from
  prototype, do not add to product.
- **NOT-THIS-PASS**: genuine new capability (e.g. WebRTC media matrix, dark);
  documented and scheduled separately, never silently claimed.

---

## 4. Quality / architecture gates (falsifiable)

- **G1 single design system**: after a surface migrates, a guard fails on any
  `from 'antd'` / `@lobehub/ui` / `--brand-` / raw brand hex under its paths;
  a repository-wide guard tracks the shrinking residual count to zero.
- **G2 presentation-free cores**: import guard proves `runtimes/services/
  storage/src-tauri` never import `@peers-touch/ui`/`.css`.
- **G3 no-mock seam**: new UI binds existing acceptance actions/runtime calls;
  `registry.test.ts`-style rules keep business actions out of zustand and
  fixtures setter-less in production.
- **G4 real functional points**: per surface, iOS Simulator harness gate(s)
  bind current commit/workspace digest; stale evidence rejected.
- **G5 visual fidelity**: migrated fixture surfaces regenerate screenshot/DOM/
  a11y evidence and pass touch-target (44px), no-leaked-i18n-key/PTID, and
  north-star token checks in the whole-product inventory.
- **G6 webview compatibility**: a documented compatibility decision for
  dvh/`:has`/`color-mix` against the iOS deployment target; either raise the
  target with evidence or provide fallbacks; verified on the simulator OS.

---

## 5. Delivery invariant (not a schedule)

Architecture defines the closure every unit of delivery must satisfy; it does
**not** name or order phases (that belongs solely to the accepted execution
plan). Any delivery unit — whatever surface the plan selects — must close all
of:

1. real behavior/runtime path preserved unchanged;
2. presentation migrated to peers-ui north-star with the surface's antd/lobehub/
   private-CSS residual driven to zero;
3. imperative UX routed through the §2.3 feedback wrappers;
4. its acceptance fixture surface(s) and the whole-product inventory kept in
   lockstep (changed only when structure truly changes);
5. prototype reconciled where it diverged from the real owner;
6. source/structural guards green and one exact-source iOS Simulator functional
  Journey at FUNCTIONAL_PASS.

No unit is "done" while it keeps a parallel visual system, fakes a missing
owner, or ships without current-source functional evidence. Concrete slices,
their dependency order, tasks, and gate selection are defined exclusively in
the frozen execution plan
([execution-plans/20261109-mobile-northstar-realignment/plan.md](./execution-plans/20261109-mobile-northstar-realignment/plan.md)).
