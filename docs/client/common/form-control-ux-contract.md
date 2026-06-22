# Form Control UX Contract

> Status: Canonical client-level contract.
> Audience: Desktop, Mobile, reviewers, and AI agents generating form UI.
> Updated: 2026-06-16.

## 1. Purpose

This document defines cross-client UX rules for form controls, especially composite controls.

A composite form control is any control where multiple visual parts complete one user intention.

Examples:

- Protocol selector + host input.
- Country code selector + phone input.
- Search input + filter selector.
- Currency selector + amount input.
- Tag selector + free text input.
- Date range input with start and end slots.
- Station picker trigger with reachability status.

## 2. Core Principle

If multiple sub-elements represent one submitted value or one tightly coupled user intention, they MUST render as one composite field unless a contract explicitly defines them as separate but coordinated controls.

They must share:

- One parent semantic frame.
- One focus model.
- One error model.
- One disabled model.
- One loading model.
- One density and token system.
- One menu or expansion relationship.

The visual frame may be fully unified or coordinated-adjacent. Use a unified visual frame when the sub-elements together produce one value, such as protocol plus host. Use coordinated-adjacent controls when one part is a separate action, such as an add button that submits or appends the composed value.

## 3. Composite Field Anatomy

Use this structure for combined controls:

```text
CompositeField
├─ FieldLabel
├─ FieldFrame
│  ├─ PrefixSlot
│  ├─ InternalDivider
│  ├─ PrimaryInput
│  ├─ SuffixSlot
│  └─ InlineActionSlot
├─ FieldHelper
└─ FieldError
```

Slot rules:

- `FieldFrame` owns the external border, radius, background, focus ring, error ring, disabled surface, and loading surface.
- `PrefixSlot` may contain protocol, country code, currency, filter, icon, or fixed label.
- `PrimaryInput` owns editable text.
- `SuffixSlot` may contain clear, scan, visibility, or unit affordances.
- `InlineActionSlot` may contain add/search/submit affordance only when it visually belongs to the same intention.
- `FieldHelper` and `FieldError` describe the whole composite field, not only one slot.
- Adjacent actions that commit, append, scan, or navigate MAY sit outside `FieldFrame`, but they must share height rhythm, spacing tokens, disabled/loading coordination, and accessible relationship with the field.

## 4. State Ownership

The parent `FieldFrame` is the state owner.

Required states:

```text
default
hover
focused
active
disabled
readonly
loading
error
success
expanded
```

Rules:

- Focus ring MUST wrap the whole `FieldFrame`.
- Error ring MUST wrap the whole `FieldFrame`.
- Disabled state MUST apply to every slot with one visual tone.
- Loading state MUST not make one child look enabled while another is blocked.
- Expanded state MUST visually connect any menu, sheet, or popover to the parent field.

## 5. Boundary Model

Composite fields MUST define these rectangles:

```text
CompositeFieldRect
├─ FieldFrameRect
├─ PrefixSlotRect
├─ PrimaryInputRect
├─ SuffixSlotRect
├─ AdjacentActionRect
├─ MenuOrSheetRect
└─ HelperErrorRect
```

Required invariants:

- Child slots MUST NOT draw independent external borders.
- Child slots MUST NOT own independent outer radius unless they are a segmented control by contract.
- Internal dividers MUST be weaker than external borders.
- Menus, sheets, and popovers MUST be visually traceable to `FieldFrameRect`.
- Hit targets may be larger than visible elements, but expanded hit targets MUST NOT break the field's perceived shape.
- Adjacent actions MUST NOT look like unrelated controls when they operate on the composite value.

## 6. Visual Continuity Rules

Composite controls are acceptable only when these continuity checks pass:

- The user perceives the control as one field before noticing its sub-parts.
- All slots share height and vertical alignment.
- Text baseline is aligned across prefix, input, and suffix.
- Prefix and suffix do not visually overpower the primary input.
- The divider is internal, subtle, and never mistaken for an external boundary.
- Radius appears once at the outer frame.
- Focus, error, and disabled states do not split the field into unrelated parts.
- If an action is adjacent rather than embedded, the spacing, height, and state relationship make it clear whether it belongs to the field or starts a separate task.

## 7. Compact Trigger Status Slots

When a compact trigger summarizes a richer picker, selector, or connection surface, it MUST define a stable status slot instead of placing the status glyph inline after the label.

Required anatomy:

```text
CompactTrigger
├─ IconSlot
├─ LabelSlot
└─ StatusSlot
```

Rules:

- `IconSlot`, `LabelSlot`, and `StatusSlot` MUST have explicit ownership and stable dimensions.
- `LabelSlot` MUST flex and truncate; it must not push the status indicator away from its trailing position.
- `StatusSlot` MUST be visually trailing in both collapsed and expanded states when it is shown.
- `StatusSlot` MUST encode a meaningful state, such as checking, online, offline, error, or warning.
- Unknown or not-yet-checked state MUST NOT render as an unexplained neutral dot in a compact trigger. Use no visible indicator, explicit copy, or a tooltip-backed affordance only when the state helps the user decide.
- Collapsed and expanded representations MUST preserve semantic parity: the same health state cannot look like an ambiguous decorative mark when collapsed and a clear status when expanded.
- Color alone is insufficient for a status indicator; the indicator must have an accessible label or an adjacent textual state where space allows.

## 8. Forbidden Patterns

Do not implement composite controls as:

- A bordered `Select` placed next to a bordered `Input` when both produce one submitted value.
- A child dropdown with its own box-shadow inside an input frame.
- A focus ring that only wraps the editable input while the prefix remains unfocused.
- Separate error states for prefix and input when the submitted value is one semantic field.
- A desktop-style small dropdown on Mobile when a BottomSheet is required by platform contract.
- Magic-number width, height, radius, border, or shadow values.
- A neutral grey dot inside a compact trigger without clear semantic value.
- A status glyph that sits inline after short text instead of occupying a fixed trailing slot.

## 9. Protocol + Address Field Contract

The station address field is the first canonical example.

Required anatomy:

```text
StationAddressField
├─ FieldLabel
├─ FieldFrame
│  ├─ ProtocolPrefix
│  ├─ InternalDivider
│  ├─ AddressInput
│  └─ AddAction
├─ FieldHelper
└─ FieldError
```

Rules:

- `ProtocolPrefix` and `AddressInput` MUST share one `FieldFrame`.
- `ProtocolPrefix` MUST NOT render an independent external border.
- `AddressInput` MUST NOT render an independent external border.
- `ProtocolPrefix` and `AddressInput` text baselines MUST align.
- `FieldFrame` owns focus, error, disabled, loading, and expanded state.
- The protocol menu must feel attached to the field:
  - Mobile: BottomSheet or full-width attached sheet.
  - Desktop: collision-aware popover/select aligned to the prefix or frame.
- The add action may be inside `FieldFrame` only if it belongs to the address entry intent; otherwise it must be a separate adjacent action with matched height and tokenized spacing.

## 10. Token Requirements

Implementations MUST use named form/control tokens.

Minimum token groups:

```text
control.height.sm
control.height.md
control.height.lg
control.radius.md
control.radius.lg
control.border.default
control.border.focus
control.border.error
control.surface.default
control.surface.muted
control.surface.disabled
control.text.primary
control.text.secondary
control.text.placeholder
control.divider.muted
control.shadow.menu
control.gap.inline
control.padding.inline
control.target.min
```

## 11. Accessibility And I18n

- Labels, helper text, errors, options, and action names MUST use locale keys.
- Composite field label MUST describe the whole value.
- Prefix and suffix interactive slots MUST have accessible names.
- Keyboard navigation MUST enter the composite field predictably.
- Screen reader order MUST match visual order.
- Expanded menus or sheets MUST announce their relationship to the source field.
- Compact trigger status indicators MUST have accessible labels when visible.

## 12. Acceptance Matrix

| State | Expected outcome |
| --- | --- |
| Default | Composite reads as one field. |
| Focused by input | Focus ring wraps the whole frame. |
| Focused by prefix | Focus ring wraps the whole frame. |
| Expanded prefix menu | Menu or sheet is visibly related to the frame. |
| Error | Error ring and message describe the whole field. |
| Disabled | All slots share disabled state. |
| Loading | Add/submit affordance cannot contradict loading state. |
| Narrow width | Slots compress by contract, not by visual collision. |
| Long value | Primary input truncates or scrolls without pushing prefix out of shape. |
| Compact trigger unknown status | No unexplained neutral dot is rendered. |
| Compact trigger known status | The indicator sits in a fixed trailing `StatusSlot` and has an accessible label. |
| Collapsed to expanded trigger | Status meaning and placement remain consistent across both states. |

## 13. AI Agent Checklist

When generating a form control, an AI agent MUST:

1. Decide whether the UI produces one submitted value, one tightly coupled intention, or multiple independent fields/actions.
2. If it is one submitted value, implement `CompositeField`.
3. Assign external border, radius, focus, error, disabled, and loading state to `FieldFrame`.
4. Keep child slots borderless except for internal dividers.
5. Use control tokens for height, radius, gap, color, and shadow.
6. Apply platform-specific menu behavior from the relevant platform contract.
7. If an action is adjacent, document why it is outside `FieldFrame` and how its state remains coordinated.
8. If a compact trigger shows status, verify `IconSlot`, `LabelSlot`, and `StatusSlot` ownership in collapsed and expanded states.
9. Verify the acceptance matrix before claiming completion.

## 14. Change Record

- 2026-06-16: Added compact trigger status-slot rules from the Station picker reachability indicator case.
- 2026-06-09: Created form control contract from the station protocol selector example.
