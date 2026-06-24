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
- Popovers must not cover the content the user is acting on unless no safe position exists.
- Reaction pickers must remain compact and reversible.
- Menus need keyboard access and focus restoration.

## 9. Empty, Loading, And Error States

Rules:

- Empty states must tell the user what the surface is for and what they can do next.
- Loading states should preserve layout geometry when possible.
- Error states must include context, recovery, and stable localized text.
- Trust-related empty states must distinguish "no data" from "hidden by policy".

## 10. Covered UX Dimensions

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

## 11. AI Agent Checklist

- [ ] Is every button role named before styling?
- [ ] Are library defaults normalized through token roles?
- [ ] Does each card/surface represent one user intent?
- [ ] Are tabs, CTA, and page header aligned as one system?
- [ ] Are popovers anchored, bounded, and keyboard-recoverable?
- [ ] Are empty/loading/error states designed, localized, and recoverable?
