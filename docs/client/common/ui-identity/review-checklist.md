# UI Identity Review Checklist

> Status: Canonical UI identity review checklist.
> Audience: Product designers, client engineers, reviewers, and AI agents.
> Updated: 2026-06-18.

## 1. Purpose

Use this checklist before accepting any client UI change.

The goal is to catch "functionally correct but visually assembled" UI before it reaches E2E or review.

## 2. Required Inputs

- Screenshot or preview of the changed surface.
- User task the surface supports.
- Module contract under `modules/` when one exists.
- Relevant shared pattern under `patterns/`.
- State matrix for normal, loading, empty, error, disabled, overflow, and narrow-window states.

## 3. Product Identity

- [ ] The surface follows Quiet Protocol Minimalism.
- [ ] The screen does not feel like mixed LobeUI, antd, and one-off CSS defaults.
- [ ] Primary content reads before metadata and chrome.
- [ ] Federation/trust state is visible where it affects interpretation or action.
- [ ] The UI does not look like an admin dashboard unless the module is an admin module.

## 4. Layout And Boundaries

- [ ] Page canvas, content rail, action rail, trust rail, and recovery layer are identifiable.
- [ ] No unexplained large gutter or detached side void exists.
- [ ] Header, tabs, CTA, composer, and content align to one grid.
- [ ] Continuous content has a continuous surface model.
- [ ] Floating layers are anchored and do not cover primary content unexpectedly.

## 5. Component Style

- [ ] Button roles are named and visually consistent.
- [ ] Primary CTA does not visually fight tabs, header, or content.
- [ ] Cards/surfaces are not nested without distinct user intent.
- [ ] Inputs and composite controls have one parent boundary.
- [ ] Danger actions are scoped, explicit, and recoverable.

## 6. State And Feedback

- [ ] Loading state belongs to the semantic action owner.
- [ ] Disabled state explains why when it blocks task completion.
- [ ] Error state preserves input and provides retry/recovery.
- [ ] Optimistic updates have rollback.
- [ ] Trust/policy states are server-authoritative when backend owns truth.

## 7. Content And Localization

- [ ] All user-facing text uses i18n keys.
- [ ] Empty states explain what the surface is and what the user can do.
- [ ] Error copy includes context without leaking secrets or PII.
- [ ] Long names, long station domains, and localized strings do not break layout.

## 8. Accessibility

- [ ] Keyboard users can reach primary and secondary actions.
- [ ] Focus ring belongs to the correct semantic owner.
- [ ] Popovers/menus restore focus to the source.
- [ ] Contrast is sufficient for text, metadata, and states.
- [ ] Icon-only actions have accessible labels.

## 9. Frontend Tree And Alive

- [ ] The changed surface has a defined component tree layer in `frontend-component-tree.md`.
- [ ] The surface has an Alive / lazy / LRU / non-alive decision in `frontend-component-tree-registry.md` when it is a page, primary tab, provider section, applet runtime, overlay, or large list.
- [ ] Primary tab navigation changes visible route before data, schema, bundle, or runtime loading.
- [ ] Settings/provider UI mounts only the selected provider schema; CLI provider fields are not forced through a generic cloud-provider form.
- [ ] Hidden alive trees use narrow store selectors and do not re-render on unrelated runtime/store updates.
- [ ] Large feeds, messages, rosters, logs, and grids are virtualized or incrementally rendered.
- [ ] Long-task, remount, or route-to-visible risk is measured or explicitly marked as unproven.

## 10. Social Methodology Gate

When validating Social UI, include at least one incomplete or partially implemented capability.

Required checks:

- [ ] Feature unavailable state does not look broken.
- [ ] Pending backend capability is distinguishable from empty content.
- [ ] Station/moderation policy state is never fabricated locally.
- [ ] Comment/reaction/follow states expose loading and rollback.
- [ ] Feed/detail/thread surfaces stay visually continuous.

## 11. AI Agent Output Contract

When reporting UI work, include:

- Files changed.
- Contract files read.
- Frontend tree layer and Alive category when UI lifetime is affected.
- Registry row updated or reason it was not required.
- UI states verified.
- Performance evidence checked or explicitly unproven.
- Known gaps.
- Whether the change follows common UI Identity, module UI Identity, or both.
