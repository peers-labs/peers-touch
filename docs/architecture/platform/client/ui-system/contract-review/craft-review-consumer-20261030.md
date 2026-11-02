---
kind: peers-ui-craft-review
surface: consumer-foundation-breadth-board
reviewer: product-owner
date: 2026-10-30
verdict: changes-required
---

# Craft Review — Consumer Foundation Breadth Board

Independent owner review of the 46-card base-component board. Findings are
screenshot-backed; the author does not self-score.

## Blocking findings (owner)

| ID | Finding | Class | Disposition |
| --- | --- | --- | --- |
| CF-01 | Text-field clear affordance broke the field edge; TextArea counter wrapped (`13 /` / `200`) and collided with the native resize grip | corner composition | Fixed; promoted to battery rules C4–C6 |
| CF-02 | Switch rendered as a full-width black bar with text inside the track; thumb a nested square — not a switch | intrinsic control geometry | Fixed (42×24 track, external label, transform thumb); promoted to C2–C3 |
| CF-03 | Raw OS `Choose File / No file chosen` button in FileDropzone | native-control leakage | Fixed (sr-only input + custom dashed zone/button/glyph); promoted to C1 |
| CF-04 | Date field exposed the un-styled OS calendar indicator; raw `button.pt-link` kept native chrome (password Show) | native-control leakage | Fixed via token-ink mask and native-button reset |
| CF-05 | Overall impression remains a generic SaaS component library; ordinary components, no Peers signature | signature / product argument | **OPEN — cannot be fixed by geometry** |

## Evidence

- Machine geometry: `ui.foundation.consumer.craft-geometry` OBSERVED
  (`craft-battery.mjs` C1–C8 over the rendered board), standalone
  `craft-gate.mjs` exit 0.
- Mutation test: forced full-width switch + injected raw file input fails the
  gate with `native-control-chrome`, `switch-intrinsic-geometry`,
  `switch-thumb-outside-track`, `hit-target-too-small`,
  `card-horizontal-overflow`.
- Physics: `action-ink-physics` / `...-dark` OBSERVED (light + dark).
- Runtime: 14 interaction/structure scenarios OBSERVED; overflow gates clean at
  1360/390; console error free.

## Open / UNPROVEN

- **CF-05 signature**: machine gates cannot judge "generic SaaS". The active
  theme is intentionally neutral ink; a Peers signature requires an owner
  decision on the module envelope (proportion, rhythm, one signature element)
  and the decision-moment brand hue (pine vs amber candidates remain
  undecided). Required next: an independent human signature verdict against
  the north star, not another checklist pass.
- Gate ③ currently scans the specimen board; extension to real product
  surfaces (desktop/mobile) is unproven.
- Gate ③ is geometry-only; typographic rhythm and density confidence remain
  human dimensions.
