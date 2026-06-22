---
kind: invariant
title: Composite form controls and compact trigger status must have explicit slots
status: active
owns:
  - apps/mobile/src/features/station/StationSelector.tsx
  - apps/mobile/src/features/auth/
  - apps/mobile/src/pages/SettingsPage.tsx
  - apps/desktop/src/components/common/StationPicker.tsx
  - apps/desktop/src/components/settings/
  - apps/desktop/src/pages/SettingsPage.tsx
  - apps/desktop/src/pages/LoginPage.tsx
referenced-by:
  - docs/knowledge/playbooks/ux-case-to-contract.md
related:
  - docs/client/common/ux-design-methodology.md
  - docs/client/common/form-control-ux-contract.md
  - docs/client/mobile/form-control-layout-contract.md
detected: 2026-06-09
---

# Composite form controls and compact trigger status must have explicit slots

## What must hold

When multiple form sub-elements represent one semantic input, they MUST share one parent `FieldFrame`. Child controls MUST NOT render independent external borders, independent outer radii, independent focus rings, or independent error rings unless a documented component contract explicitly defines them as separate fields.

Compact triggers that summarize picker or connection state MUST define explicit `IconSlot`, `LabelSlot`, and trailing `StatusSlot` ownership. Unknown or not-yet-checked status MUST NOT render as an unexplained neutral dot in collapsed triggers; known status indicators must sit in the trailing slot and expose an accessible label.

## Why this is non-negotiable

Composite fields are common in Station selection, auth, settings, search, and future setup flows. If every implementation joins library defaults by eye, the product accumulates abrupt seams: mismatched radii, duplicated borders, split focus states, detached menus, and controls that look assembled rather than designed.

The station protocol selector revealed this class of failure. The protocol and host form one station address, but rendering a standalone `Select` next to an `Input` makes the user perceive two unrelated controls. That breaks visual continuity and makes focus, error, disabled, loading, and expanded states ambiguous.

The station picker trigger revealed the adjacent status-slot failure. The collapsed trigger rendered unknown reachability as a grey dot after a short label, so the indicator appeared decorative and visually centered. The expanded picker then showed a meaningful green status in a better position. That split the same state across two inconsistent layouts and made the control feel assembled rather than designed.

This invariant forces AI agents and humans to model the user's intention first. If the intention is one value, the frame and state model must also be one.

## How to verify

- `rg "<Select|Select\\b|Dropdown|Popover|Input|TextArea|Segmented" apps/mobile/src/features/station/StationSelector.tsx apps/mobile/src/features/auth apps/mobile/src/pages/SettingsPage.tsx apps/desktop/src/components/common/StationPicker.tsx apps/desktop/src/components/settings apps/desktop/src/pages/SettingsPage.tsx apps/desktop/src/pages/LoginPage.tsx` — review adjacent form controls and confirm one-intention groups use a shared parent frame.
- `rg "border|borderRadius|boxShadow|focus|error|disabled|loading" apps/mobile/src/features/station/StationSelector.tsx apps/mobile/src/features/auth apps/mobile/src/pages/SettingsPage.tsx apps/desktop/src/components/common/StationPicker.tsx apps/desktop/src/components/settings apps/desktop/src/pages/SettingsPage.tsx apps/desktop/src/pages/LoginPage.tsx` — confirm visual states are owned by the composite parent where appropriate.
- `rg "StatusDot|StatusSlot|StationTriggerStatus|colorTextQuaternary|colorSuccess|colorError|Loader2" apps/mobile/src/features/station/StationSelector.tsx apps/mobile/src/features/auth apps/mobile/src/pages/SettingsPage.tsx apps/desktop/src/components/common/StationPicker.tsx apps/desktop/src/components/settings apps/desktop/src/pages/LoginPage.tsx` — review compact status indicators and confirm unknown state is not exposed as an unexplained neutral dot.
- Manual acceptance: check default, focused, expanded, error, disabled, loading, and narrow-width states for every composite form control.
- Manual acceptance: check compact trigger collapsed and expanded states for unknown, checking, online, and offline health. Known indicators must remain trailing and labelled; unknown must not create visual noise.

## Crosswalks

- See `docs/client/common/form-control-ux-contract.md` for the shared composite field anatomy.
- See `docs/client/mobile/form-control-layout-contract.md` for Mobile prefix selection and BottomSheet behavior.
- See `docs/client/common/ux-design-methodology.md` for how new UX examples become contracts and invariants.
