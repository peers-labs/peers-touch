# Mobile Form Control Layout Contract

> Status: Mobile platform-level contract.
> Audience: Mobile UI implementers, reviewers, and AI agents.
> Updated: 2026-06-09.

## 1. Purpose

This document refines `docs/client/common/form-control-ux-contract.md` for Mobile.

Mobile form controls must preserve visual continuity while handling thumb interaction, keyboard, safe areas, sheets, small widths, and system input behavior.

## 2. Mobile Composite Field Model

Mobile composite controls MUST use a parent field frame:

```text
MobileCompositeField
├─ FieldLabel
├─ FieldFrame
│  ├─ PrefixSlot
│  ├─ InternalDivider
│  ├─ PrimaryInput
│  └─ SuffixOrInlineAction
├─ FieldHelper
├─ FieldError
└─ SheetOrPickerLayer
```

Rules:

- `FieldFrame` owns border, radius, background, focus, error, disabled, loading, and expanded state.
- Child slots must appear embedded in the frame.
- Prefix selection should use a BottomSheet when options are not frequent enough to justify always-visible segmented controls.
- Mobile controls should avoid desktop-style small floating dropdowns unless explicitly approved by this contract.

## 3. Prefix Selection

For low-cardinality selectors such as protocol, country code, filter, or currency:

Preferred pattern:

```text
[ Prefix ▾ | Primary input        ]

Tap Prefix -> BottomSheet
```

Allowed alternatives:

- Inline segmented prefix when there are exactly two stable options and the control has enough width.
- Attached popover only on larger mobile breakpoints and only if it remains visually connected to `FieldFrame`.

Forbidden:

- Native-looking or library-default dropdown that visually detaches from the input.
- Prefix slot with independent outer border, radius, or focus ring.
- Menu that covers the field label, active input text, keyboard, or bottom safe area.

## 4. Touch Targets

- Interactive slots SHOULD meet `control.target.min`.
- Visual prefix width may be compact, but tap target must remain comfortable.
- Internal divider must not reduce tap target or become the perceived boundary of two separate controls.
- Suffix actions must have the same height rhythm as the field frame.

## 5. Keyboard And Safe Area

- Focused input must stay visible above the keyboard.
- BottomSheet selection must not be hidden by Home Indicator or Android gesture navigation.
- Opening a picker or sheet from a prefix slot must preserve the current input value and focus recovery behavior.
- Form cards must reserve enough bottom space for keyboard and sheet interactions.

## 6. Station Address Example

Mobile station address entry SHOULD use:

```text
StationAddressField
├─ FieldFrame
│  ├─ ProtocolPrefixButton
│  ├─ InternalDivider
│  ├─ AddressInput
│  └─ AddButtonOrAdjacentAction
└─ ProtocolBottomSheet
```

Specific rules:

- `HTTPS` / `HTTP` selection opens a BottomSheet by default.
- The selected protocol appears as a prefix label with a down chevron.
- The prefix does not render an independent bordered select.
- The host input is borderless inside the same parent frame.
- Focus state wraps the complete address field.
- Error state wraps the complete address field and describes the full station URL.

## 7. Mobile Acceptance Matrix

| State | Expected outcome |
| --- | --- |
| Default | Prefix and input read as one field. |
| Input focused | Full frame shows focus. |
| Prefix tapped | BottomSheet opens and remains connected to the field intent. |
| Protocol changed | Field keeps shape and input value. |
| Error | Full frame shows error state. |
| Keyboard open | Field and sheet avoid keyboard and safe area. |
| Narrow device | Prefix remains readable and input keeps useful width. |
| Disabled | Prefix, input, and action share disabled state. |

## 8. AI Agent Notes

When changing Mobile form controls, especially `apps/mobile/src/features/station/StationSelector.tsx`, an AI agent MUST:

1. Read `docs/client/common/ux-design-methodology.md`.
2. Read `docs/client/common/form-control-ux-contract.md`.
3. Read this document.
4. Read `docs/knowledge/invariants/composite-form-control-boundaries.md`.
5. Avoid adjacent independent `Select + Input` layouts for one semantic field.
6. Use Mobile-native sheet or segmented-prefix behavior for prefix selection.

## 9. Change Record

- 2026-06-09: Created Mobile-specific form control contract from the station protocol selector example.
