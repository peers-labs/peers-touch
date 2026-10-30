# UI System Probe Gates

Runtime evidence for peers-ui specimens. Every gate participates in the runner
exit code and the evidence-envelope rollup; a gate failure is never a silent
pass. Gates are ordered by what they can honestly decide.

## Gate ① Physics — token color & WCAG (machine)

- `computedStyle` / `computedStyleNone` oracles assert the **resolved** paint
  on real DOM nodes (CTA fill, accent-color, focus ring, avatar/selection
  fills, canvas background) in light and dark, and scan the whole board for
  retired brand-hue residues.
- Contrast numbers (WCAG ratios) are computed from token values before a
  color change lands; the rendered value is verified after.
- Suite: `suites/consumer.suite.json` scenarios `action-ink-physics*`.

## Gate ② Runtime — structure, interaction, overflow (machine)

- Entry gate (visible reach from nav), card counts, real component
  interactions (dialog/menu/select/toast/form/autocomplete/tag removal),
  keyboard semantics, 1360 and 390 overflow, console-error gate.
- Foundation baseline: 20 base capabilities × 标准/长文案/禁用 conditions.

## Gate ③ Geometry craft — native leakage & composition (machine)

`craft-battery.mjs` is a fixed invariant battery executed against the
rendered board; `craft-gate.mjs` runs it standalone and the
`craftBattery` oracle runs it inside evidence envelopes.

Rules (C1–C8):

1. `native-control-chrome` — visible `input[type=file|color|submit|button|reset]`
   is forbidden; the OS control must be `.pt-sr-only` behind custom chrome.
2. `switch-intrinsic-geometry` — the track stays 34–60 × 20–30 px inside
   stretchy parents (no full-width bars).
3. `switch-thumb-outside-track` — the thumb rect is contained by the track.
4. `counter-text-wraps` — corner meta (`13 / 200`) stays one line.
5. `counter-grip-collision` — the counter sits below the textarea, never over
   the native resize grip.
6. `control-outside-frame` — buttons embedded in a field frame stay inside it.
7. `hit-target-too-small` — interactive controls ≥ 24 CSS px (WCAG 2.5.8 AA;
   coarse pointer raises to 44 via CSS); inline text actions are exempt.
8. `card-horizontal-overflow` — nothing escapes card horizontal bounds.
9. `embedded-control-square-focus` — a radius-0 text-like control inside a
   radius-≥8 host must not paint a visible `:focus-visible` outline; focus
   feedback belongs on the rounded host (`:focus-within`).
10. `chrome-zone-hairline` — app-frame chrome zones (`.sk-rail`,
    `.sk-feed-head`, `.sk-chats`) separate by material, never by borders.
11. `ua-button-chrome` — a visible custom `<button>` must not keep the UA
    `outset` border.
12. `dead-affordance-not-a-control` — interactive-looking frame elements
    (rail icons, stacked identities, conversation rows, moment actions) must
    be real controls (button/a/input or wrapped by one).
13. `focus-ring-transitioned` — a field that paints its focus ring via
    box-shadow must not transition box-shadow with a non-zero duration; the
    keyboard focus indicator must be present immediately (a delayed ring
    also reads as zero-spread right after focus).

C9–C13 govern the evolving desktop-prototype frame
(`suites/north-star.suite.json`, anchor `.sk-shell`); they are no-ops on
boards without those elements.

The battery is mutation-tested: injecting a stretched switch or a raw file
input must fail the gate.

## Gate ④ Signature craft — product argument & Peers identity (human)

Taste, "generic SaaS vs recognizably Peers", hierarchy confidence and the
product argument cannot be machine-scored. They require an **independent
human verdict** in the craft-quality.md §10 format (verdict, blocking
findings with screenshots, evidence, exact UNPROVEN cells). The author never
self-passes. Human findings that describe geometry/composition are promoted
into Gate ③ battery rules so the same defect class cannot regress.

## Usage

```bash
# Evidence-envelope run (all suites + 60-condition baseline)
node tooling/scripts/ui-system/evaluate-specimens.mjs \
  --suite tooling/scripts/ui-system/suites/consumer.suite.json

# Desktop-prototype north-star frame gate
node tooling/scripts/ui-system/evaluate-specimens.mjs \
  --suite tooling/scripts/ui-system/suites/north-star.suite.json

# Geometry craft gate alone (CI-friendly, JSON to stdout)
node tooling/scripts/ui-system/craft-gate.mjs
```
