# UI Identity Components

> Status: Canonical shared component identity contract.
> Audience: Product designers, client engineers, reviewers, and AI agents.
> Updated: 2026-06-18.

## 1. Purpose

Components should implement Peers Touch identity, not expose raw defaults from a UI library.

Desktop uses LobeUI first. antd may be used when necessary, but it must be visually normalized into this contract.

## 2. Component Priority

Implementation order:

1. Use existing project component that already follows UI Identity.
2. Use LobeUI primitive and map it to UI Identity tokens.
3. Use antd only when LobeUI lacks the required behavior.
4. Create a module component if the pattern recurs within one module.
5. Create a shared component only after at least two modules need it.

## 3. Buttons

Button roles:

| Role | Meaning | Visual intent |
| --- | --- | --- |
| Primary | main user commitment | strong but not visually alien |
| Secondary | normal navigation/action | quiet, readable |
| Ghost | low-emphasis surface action | visible on hover or subtle background |
| Danger | destructive action | scoped, explicit, recoverable |
| Icon | compact repeated action | accessible label required |

Rules:

- A surface should not have multiple unrelated primary buttons.
- Primary buttons must share height, radius, and fill style across the page.
- Danger text must not sit inline with ordinary links unless the action is low-risk and reversible.
- Icon-only buttons need accessible labels and clear hover/focus states.
- Disabled buttons must explain why when the disabled state blocks task completion.
- Buttons come from one canonical size scale, never bespoke per-surface
  numbers: 24 (inline icon), 28 (compact text), 30 (relationship decision
  icon pair), 32 (standard text), 34 (chat chrome), 36 (header icon),
  40 (hero CTA). Corner radius is 6/8/10/12 only.
- Action groups inside a row share one horizontal center line and one
  trailing edge (button bottoms and centers align); an action that floats
  off the shared line is a defect.
- Across repeated rows, metadata and actions follow the list's shared
  tracks ([layout.md §3.1](./layout.md#31-symmetry-and-repeated-row-tracks)).
  Different action counts do not move time labels or primary content.
  Validate the visible control edge as well as its wrapper rectangle.

### 3.1 One entity, one component

A product entity has exactly one visual component across every surface.
"Friend request in Contacts" and "friend request in Notifications" are the
same entity — they must render the same row/item and the same decision
controls, not two hand-built look-alikes.

- Recurring entities (relationship request, contact row, session row,
  identity block, decision pair, status tag) live in one shared component;
  surfaces compose it, never restyle it.
- Entity components carry a stable `data-entity` contract marker and their
  controls carry stable `data-decision-action` / role markers, so the
  geometry gate can prove cross-surface identity (same size, radius, control
  set) instead of eyeballing each surface.
- A surface-specific wrapper may change layout context around the entity,
  never its internal control geometry or colors.

## 4. Cards And Surfaces

Surface roles:

- Reading surface: post, message, row, item.
- Action surface: composer, settings group, command area.
- Floating surface: menu, popover, picker.
- Recovery surface: empty/error/retry/degraded state.

Rules:

- Feed cards should not look like form panels.
- Detail surfaces should not duplicate the same border hierarchy as list surfaces.
- Nested cards are allowed only when each level has a separate user intent.
- Card internal actions must align to the same action row model.
- Foreground identity elements that overlap a cover keep their separation
  contour visible on every edge and rounded corner. The cover, clipping, and
  transient menus must not erase it or hide the face. A separation ring is
  structural, not a trust or selection cue.
- Validate overlapping boundaries in the browser's painted output and hit
  testing; declared borders, rectangles, and `z-index` alone do not establish
  visibility.

## 5. Tabs And Segmented Controls

Rules:

- Tabs define content scope, not decoration.
- Selected tab must be visible without heavy contrast.
- Tabs and primary CTA must share one header rhythm.
- Do not mix pill tabs, underlined tabs, and segmented buttons in one module without a module contract.

## 6. Chips And Badges

Rules:

- Chips describe stable metadata or filters.
- Badges indicate count, status, or risk.
- Trust chips must not look like marketing tags.
- Audience, station, and reason chips should be quiet by default and expand on demand.

## 7. Inputs And Composers

Rules:

- Inputs inside one semantic field share one parent boundary.
- Composer input, attachment controls, audience selector, and publish action form one action surface.
- Placeholder text should guide the task, not replace labels.
- Error and loading states belong to the composer surface before child controls show local state.

## 8. Popovers And Menus

Rules:

- Floating surfaces must visually attach to the source control.
- A side-anchored popover declares its aligned edge against the source
  button's live rectangle. Bottom-aligned popovers share the source button's
  bottom edge across resize and content changes; fixed viewport offsets alone
  cannot establish this relationship.
- Popovers must not cover the content the user is acting on unless no safe position exists.
- Reaction pickers must remain compact and reversible.
- Menus need keyboard access and focus restoration.
- Expanding a compact preview into a complete viewer replaces the preview
  with one dialog and retains the same data and row components. Search and
  pagination preserve the dialog's bounds; closing restores source focus.

## 9. Empty, Loading, And Error States

Rules:

- Empty states must tell the user what the surface is for and what they can do next.
- Loading states should preserve layout geometry when possible.
- Error states must include context, recovery, and stable localized text.
- Trust-related empty states must distinguish "no data" from "hidden by policy".

## 10. Network Settings Ownership

The desktop **Settings → Network** group is a user surface for account-level
choices only. It contains exactly three sections: **Your Station**,
**Discovery**, **Federation**. Operator capabilities live in the Station
Dashboard, never behind a control in ordinary user Settings.

User-owned (Settings):

- **Your Station**: bound station identity and connection state, authorized
  device list/revoke, and **Switch station**, which is sign-out: return to
  onboarding to pick another station and account, keeping local conversations.
  Relay mounts, seeds, locator sequence, and transport telemetry are operator
  concepts and must not appear here.
- **Discovery**: account discoverability. A master switch (hidden ↔ federated),
  per-federation visibility choices whose previous values are remembered while
  hidden and restored on re-show, the exact handle, and a separate reachability
  policy (who can send requests). Discoverability and reachability are distinct.
- **Federation**: the federations this station has joined — join by endpoint,
  leave (local conversations/contacts are kept; routing and discoverability in
  that federation stop), member/operator role, and member-station count.
  Creating/governing federations is an operator action; users with the operator
  role get a "Manage in Station Dashboard" affordance, not inline governance.

Designed-but-unshipped capabilities (per-federation visibility matrix,
inbound request policy enforcement, cross-station directory) MUST render a
visible **Pending backend** marker and be read-only/disabled — never a live
control that silently does nothing. Fabricated operational numbers (peer/seed
counts, per-federation degraded/unreachable health, visible-actor totals) are
forbidden on user cards unless backed by a real endpoint.

## 11. Covered UX Dimensions

This component contract covers:

- Visual continuity.
- State ownership.
- Interaction discoverability.
- Feedback and recovery.
- Accessibility at the component role level.

Out of scope:

- Module-specific copy.
- Backend data ownership.
- Exact implementation file structure.

## 12. AI Agent Checklist

- [ ] Is every button role named before styling?
- [ ] Are library defaults normalized through token roles?
- [ ] Does each card/surface represent one user intent?
- [ ] Are tabs, CTA, and page header aligned as one system?
- [ ] Are popovers anchored, bounded, and keyboard-recoverable?
- [ ] Are empty/loading/error states designed, localized, and recoverable?
