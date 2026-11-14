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
| Real Mobile already consumes `@peers-touch/ui` through `MobileNorthStarProvider`; antd/lobehub dependencies are removed. Remaining work is product composition and private control chrome, not initial provider adoption | **[F]** | `apps/mobile/package.json`, `src/styles.css`, `src/app/MobileNorthStarProvider.tsx` |
| `@peers-touch/ui` is source-only ESM, React 19 peer, styles scoped under `.pt-ui` (no `:root`/global pollution), CSS auto-injected by `UIProvider` | **[F]** | `packages/ui/web/{package.json,src/provider.tsx,src/styles.css}` |
| peers-ui ships one application feedback channel: `createFeedbackChannel()` provides `notify`, promise-based `requestConfirmation`, `requestChoice`, and a serial queue; `FeedbackHost` is mounted through `UIProvider`'s `feedback` slot | **[F]** | `packages/ui/web/src/application-feedback.tsx:24-87`, `provider.tsx:26,83` |
| Desktop and the mobile prototype already consume peers-ui with zero Vite alias; prototype renders peers-ui at real 390pt width | **[F]** | `apps/desktop/src/main.tsx`, `packages/prototypes/mobile/chat/{package.json,src/MobileApp.tsx}` |
| Old UI imports and brand token definitions/aliases/consumers are now guarded at zero across every Mobile TS/TSX/CSS file | **[F]** | `apps/mobile/scripts/check-presentation-boundaries.mjs` |
| North-star primary is neutral ink with pine accent; the private `#667eea→#764ba2` gradient has no token | **[F]** | `packages/ui/tokens/src/north-star-theme.ts`, `apps/mobile/src/styles.css:1-33,227` |
| Real and prototype shell use three bottom destinations; production Chats/Contacts scopes and their queries/return locations live under Messages. Real requests, group administration and Direct call owners remain active | **[F]** | `MobileShell.tsx`, `app/navigation/navigationStore.ts`, `ContactsPage.tsx`, `chat/ChatOverlayHost.tsx`, prototype `app/screens.tsx` |
| Notification center is mounted through the Shell overlay; Me has profile statistics, native image edits and public credential copy. Functional native proof remains required | **[F]** | `components/{MobileNotificationCenter,MobileShell}.tsx`, `pages/settings/`, `runtimes/profileImageRuntime.ts` |
| `safety-number` and `chat-background` are intentionally unavailable this release and have no owner | **[F]** | `pages/SettingsPage.tsx:489-496`, parent `design.md §12.7` |
| Acceptance harness: fixture surfaces across six fixtures; whole-product inventory is 166 surfaces (22+4+13+38+26+31+32) | **[F]** | `src/acceptance/{contracts,registry,actions}.ts`, `tooling/acceptance/gates/mobile/whole_product_surface_inventory.json` |
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

Find People follows the user-confirmed dedicated-page contract in
`../experience-contract.md`: `FindPeoplePage` owns transient query, explicit
Station/Federation scope and request progress; `FindPeopleSurface` is the shared
production/acceptance renderer. `socialStore.searchPeople` owns typed discovery
and stale-reply fencing. Station search uses the existing profile gateway's
actor-search operation, independently of Federation membership. The prototype
uses the same top-search/result-list composition and models request outcomes
with local fixtures. Native keyboard, real directory and request proof remain
required before completion.

```text
pages/ + components/   ── consume @peers-touch/ui primitives + --pt-* tokens
  features/*           ── presentation state/adapters; may import ui
  acceptance surfaces  ── render production components under fixture state
  runtimes/ services/  ── MUST NOT import @peers-touch/ui (presentation-free)
  Tauri/Rust           ── unchanged
```

### Composer recovery ownership

M08 requires unsent image/file/voice drafts to survive route changes and
process restart. Source inspection verified that completed sources previously
had only an in-memory registration and startup deleted unowned files.
The native Messaging SQLCipher store now owns completed
`AttachmentSourceStageRecord` commitments; the Engine's map owns incomplete
byte streams only. Completion syncs bytes before recording their commitment.
Transfer adoption removes the stage row in the same transaction as the
pending message and upload records. Explicit discard removes only an unadopted
stage. Startup cleanup preserves both registered stages and transfer sources.

`ChatDraftPayload` keeps device-local stage IDs separate from encrypted
object references, and retains thread context and pending message identity.
The presentation restores stages through verified native file grants; no
filesystem path, File serialization, or preview URL is stored in the envelope.
Grants expire/revoke under the existing Engine activation and presentation
owner. Station/actor scope and device-native storage remain unchanged.
Language changes and same-identity token refresh do not reset the composer.
Admission is bounded at 128 ready stages / 512 MiB per native store; capacity
failure leaves existing sources intact and returns `FILE_DRAFT_CAPACITY`.

Architecture review: the source and draft have distinct ownership, and transfer
adoption is atomic; retaining a second completed-stage cache or persisting
browser object URLs would violate the target. The remaining crash boundary
between completion and envelope save is closed by the record's conversation
owner: restoration lists its committed sources even without a web envelope.
Ready is published only after its source ID has been written to the envelope.
Between transfer adoption and envelope update, the original source reference
resolves the existing native pending message, including attachments not yet
uploaded; it cannot become a second send. Source checks must cover reopen, explicit discard,
adoption, corrupt bytes and cross-scope denial; native proof additionally
requires draft restore followed by verified receiver delivery.

Search result presentation is owned by `pages/MobileSearchResult`. The Search
page supplies its live actor/conversation projection and action; deterministic
Chat surfaces supply fixture facts to the same component and stylesheet.
Snippet and metadata wrap at maximum text size. A separate single-line fixture
result cannot substitute for the production presentation.

### Contact preference ownership

M09 local contact nickname/note use the existing L2 `(mobile, station, actor)`
`config.preference` repository through `mobilePersonalizationScope`. The
`contact-preferences` runtime owns readback and serialized writes, depends on
session, and clears its projection on identity replacement/teardown. Delayed
reads and writes cannot change the incoming identity's projection. Contacts and
Chat consume one typed name projection for display and local search; this does
not change the peer's profile or the member's own group nickname.

Mute and alerts remain L1 conversation-member settings through the existing
Social Gateway. Contact details may establish the real direct conversation on
the user's setting action, then submit a partial update. Gateway readbacks are
fenced to their originating session and gateway. Neither setting is copied
into the local contact preference record.

### Profile images and notification ownership

The Me hero projects canonical profile statistics. Public username/PTID/Station
facts render only in a selected credential detail; copy uses the platform
clipboard action. Avatar and cover selection use the same native picker on iOS
and Android. Rust owns session-bound opaque stages, validates bytes and
PNG/JPEG/GIF/WebP format under 8 MiB, and issues expiring preview grants.
`profile-images` owns one retained choice, upload, observed profile revision,
authoritative readback and asset readiness. Conflict/failure retains the choice
for explicit retry; cancellation preserves the previous choice. Session
replacement and teardown revoke grants and discard owned stages, including
picker results that return late. Write admission is checked again after upload.

The Shell owns one notification overlay. Social runtime/Gateway owns retained
page-window refresh, pagination, read/all-read/delete, and authoritative
validation. Session, Gateway and current-read tokens fence projections.
Overlay pending/error state is also session-fenced; a late old operation cannot
unlock or report errors in a new session. Routes retain the original
conversation/message or post/comment target. These source contracts require
native picker, clipboard, notification and restart Journeys before product
completion.

The original `chat-contacts` Journey exercises credential-copy controls,
reads the selected Simulator's native pasteboard, edits the real contact
remark form, restarts the application, then observes Contacts/Chats and peer
isolation. The original `recovery` Journey retains file/audio sources through
SIGKILL and Station restart, sends from the restored composer and opens the
receiver attachments. The original `moments` Journey produces a comment
mention through Social, opens its original post/comment from the notification,
and checks read/delete against the retained owner projection. File-input selection in the recovery Journey
does not prove the native picker or recorded voice capture; those remain
separate required native observations.

Native photo selection uses PHPicker on iOS and the system Photo Picker on
Android 13+, with the platform content chooser on older Android. The document
picker remains the document capability. Selected iOS bytes retain their source
extension through native copying so the existing type/format validator sees the
actual image or video; the old `.stage` suffix erased this information and
rejected image selections. PHPicker copies ephemeral item-provider URLs before
their callback returns, then applies the original count, size, digest and
session-bound stage validation. Late callbacks clean only their own request's
imports. The system photo picker does not require broad photo-library access.

The original `chat-contacts` Journey now seeds the owned Simulator photo
library, cancels and operates the real avatar/cover pickers, observes decoded
Me images and authoritative profile revisions, restarts the native application
and restores the original images. The original `recovery` Journey additionally
records real microphone input, sends from the composer and verifies receiver
voice metadata and openable bytes. The `moments` Journey produces 31 distinct
real mention notifications to cross the 30-row page boundary, operates load
more and all-read, then restarts and reads both persisted pages. These are
required runtime observations, not claims of passed native proof.

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

### 2.5 Confirmed design and real capability reconciliation

The confirmed design governs presentation; real owners govern behavior:

- Shell/tab structure: **three bottom destinations** (messages/moments/me).
  Chats and contacts share messages and use **top subtabs**. Contact/group
  details are pushed within messages and return to the selected pane. The
  real app's existing four-tab descriptors must migrate with native back,
  search, badges, requests and group capabilities preserved. They cannot
  override the user-confirmed navigation (ADR-4, 2026-11-13).
- Moments navigation: the confirmed **Feed / Circles top subtabs** own the
  primary pane. Local searches replace that same header band; pane, query,
  feed scope and scroll/focus context survive pushed details and tab return.
  Explore and global/federated search remain explicit secondary actions.
  Incoming circle-list routes consume the same Circle renderer; circle and
  member details keep their real route and authority owners.
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
- Me uses the confirmed cover/overlapping-avatar hero and profile-backed
  posts/following/follower/joined facts. Public username, PTID and station facts
  move to the credentials detail; copies use the native system-action port.
  Image edits use the native `profile_image` picker surface, hash-verified
  session-scoped stages and WebView-owned opaque preview grants. They upload
  publicly through existing OSS, carry an observed profile revision through the
  existing profile mutation, and require readback before releasing the preview.
  Failed edits retain their stage for explicit retry or discard; stale sessions
  cannot commit them. JPEG/PNG/GIF/WebP images are bounded to 8 MiB.
- Notification center is an on-demand overlay. The notification store fences
  reads/mutations by session and gateway, retains the loaded page window on
  readback, and confirms read/delete results. Object navigation happens on
  click before awaiting the read mutation. Unknown targets have a concrete
  unavailable reason; they are never routed to a generic conversation.
- Prototype-only cosmetic settings with no real owner (fake auto-lock behavior,
  per-contact switches bound to globals) are removed from the prototype rather
  than faked in the app.

### 2.5.1 Native view continuity

The 2026-11-14 user correction prohibits a webpage-refresh experience
throughout Mobile. Navigation is one bounded presentation owner:
`MobileNavigationHost` retains visited primary frames (three destinations,
two nested Messages panes) and the last four current-stack details. The
Messages header and bottom navigation remain mounted. Popped details are
removed; older stack views are evicted with external draft/scroll recovery.

React 19.2 Activity preserves hidden DOM and local state while suspending
Effects/subscriptions. Normal cleanup stops recording, typing, timers,
observers and pending page reads. DOM audio/video pauses at the frame.
Presentation assets use the frame-owned `useMobilePageDisposal` boundary so
hiding a view does not revoke a displayed draft URL; child removal or eviction
releases it. Nested visibility inherits the parent.

The retained tree's identity includes Station, actor, device, lifecycle
generation and Session. A new identity destroys the old tree and restoration
metadata. Same-identity warm resume keeps the page. Initial unavailable routes
stay closed; transient re-preparation of a previously ready route retains
content. Real runtime failure suspends the content and keeps the original
retry/back surface, without discarding the retained controller.

Leaf-frame layout effects restore scroll/focus before paint. Compound frames
delegate to the nested host so a pane change cannot overwrite another pane's
position with the newly selected scroll owner. Settings keeps
its identity/navigation layout while permission/version/preference readback
updates the corresponding sections. Reactivation must not clear initialized
chat drafts, directory results, or editable setting/circle drafts. Runtime
freshness remains outside page lifetime.

Verification requires current-source native DOM identity, scroll/header
continuity, frame-bound and hidden-resource observations. Source and
prototype checks do not substitute for that native Journey.

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
here) and the full 166-surface whole-product gate.

---

## 3. Functional-point coverage contract

The authoritative per-point ledger is
[functional-coverage.md](./functional-coverage.md). Each row binds:
prototype point → real owner (runtime/service/Rust command/acceptance action)
→ disposition → primary evidence gate. Disposition is one of:

- **REAL-RESTYLE**: real behavior exists; migrate presentation, keep behavior.
- **CONFIRMED-DESIGN-ALIGN**: implement the accepted presentation/navigation
  while retaining real runtime capabilities (three bottom destinations and
  top chats/contacts subtabs inside messages).
- **CONFLICT-REAL-WINS**: fixture capability differs from real behavior;
  reconcile to the real owner. Existing shell tab count does not override
  confirmed navigation.
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
