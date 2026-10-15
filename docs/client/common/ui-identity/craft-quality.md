# Client Experience Craft Quality

> Status: Canonical client craft and review contract.
> Audience: Product designers, client engineers, reviewers, and AI agents.
> Updated: 2026-10-11.

## 1. Purpose

Peers Touch must be functionally complete, recognizably itself, and unusually
well executed. Craft is not a decorative pass after product design. It is the
quality of the product argument as experienced through structure, content,
interaction, motion, accessibility, and runtime behavior.

This contract turns that expectation into observable evidence. It does not
promise awards, infer quality from a brand reference, or reduce judgment to a
self-assigned score.

## 2. Identity Position

**Structured Expressive Minimalism** is the product-level north star.

**Quiet Protocol Minimalism** is its default expression for dense, recurring
workflow surfaces such as Chat, Social, Settings, and operator tools.

The relationship is:

```text
Structured Expressive Minimalism
  -> stable structure and Peers-owned signature
  -> expression strength selected by surface type
  -> Quiet Protocol Minimalism for recurring workflows
  -> stronger but still purposeful expression for entry and milestone states
```

This is one system, not two visual identities.

## 3. External Calibration

External criteria are evidence and vocabulary, never a certification claim.

- FWA recognizes work that pushes creative boundaries and publishes aggregate
  judge scores. It does not provide a deterministic recipe for a Peers product:
  <https://thefwa.com/about/about-fwa/> and <https://thefwa.com/awards>.
- The 2025/2026 Webby criteria evaluate content, structure and navigation,
  visual design, functionality, interactivity, innovation, and overall
  experience. They explicitly connect visual design and functionality to
  inclusion and diverse user needs:
  <https://www.webbyawards.com/judging-criteria>.
- WCAG 2.2 provides the testable accessibility baseline, including keyboard
  operation, visible and unobscured focus, status messages, and target size:
  <https://www.w3.org/TR/WCAG22/>.
- Core Web Vitals provide measurable web-preview signals for loading,
  interaction, and visual stability. Their current good thresholds are LCP
  within 2.5 seconds, INP at or below 200 milliseconds, and CLS at or below
  0.1 at the 75th percentile:
  <https://web.dev/articles/vitals>.

Do not write "FWA-level", "award-ready", or a numeric craft score as a fact.
Record the observed evidence and the unresolved gap.

## 4. Craft Dimensions

Every material client surface is reviewed through these dimensions:

| Dimension | Required question | Evidence |
| --- | --- | --- |
| Product argument | What user outcome or Peers-specific advantage becomes clearer here? | Journey and benchmark disposition |
| Structure | Can the user form a correct mental model and move without losing context? | Navigation walkthrough and state map |
| Visual hierarchy | Is there one main subject, deliberate contrast, and a coherent reading path? | Rendered wide/narrow evidence |
| Interaction continuity | Does each action produce immediate, local, recoverable feedback? | Real click, keyboard, touch, and failure paths |
| Content | Is copy concise, localized, domain-specific, and useful under failure? | Locale and expansion review |
| Functionality | Does the experience work across claimed platforms and states? | Exact-source runtime checks |
| Accessibility | Is the complete journey operable and understandable without color, hover, or motion? | Keyboard, focus, semantic, contrast, and reduced-motion checks |
| Performance perception | Does the surface remain responsive and spatially stable? | Transition capture, long-list check, and available lab metrics |
| Meaningful innovation | Does a novel behavior improve the product thesis instead of decorating it? | Before/after task evidence |
| Peers signature | Would the surface remain recognizably Peers without the logo? | Identity and module-envelope review |

No dimension may be waived because another dimension is strong.

## 5. Positive Calibration

High-craft Peers surfaces exhibit all of the following:

- The first viewport establishes subject, current state, and next action.
- Navigation preserves place and context across list, detail, and recovery.
- Information density is high because hierarchy is disciplined, not because
  type and controls are compressed indiscriminately.
- Feedback is local to the affected object; failure preserves the user's work.
- Motion explains continuity, causality, or spatial ownership.
- Module personality comes from product meaning, proportion, rhythm, and one
  Peers-owned signature, not from arbitrary decoration.
- Keyboard, touch, assistive technology, localization expansion, reduced
  motion, and narrow layouts are designed as first-class paths.
- Loading, interaction, and layout stability are measured when the runtime
  permits measurement; unavailable evidence remains explicitly unproven.

## 6. Negative Calibration

Reject a surface when any of these are true:

- It is a generic card grid, marketing hero, or component-library demo with
  Peers copy applied afterward.
- It uses oversized headings, decorative gradients, ambient blobs, or
  continuous motion to compensate for a weak product argument.
- It looks polished only in one static screenshot while empty, loading,
  failure, recovery, long-content, or narrow states are missing.
- It copies a benchmark's visual identity or interaction without a recorded
  Peers disposition.
- It hides critical actions behind hover, makes touch targets fragile, loses
  focus, or communicates state only through color or animation.
- It invents trust, policy, delivery, or recovery success locally.
- It claims performance from a build result, accessibility from semantic
  markup alone, or craft quality from a checklist count.
- It optimizes pixel sameness across platforms at the expense of native
  ergonomics or shared product semantics.

## 7. Surface Quality Contract

Before implementation, record:

1. **Thesis**: the user outcome and Peers-specific product argument.
2. **Main subject**: the one object or activity that owns attention.
3. **Boundary model**: shell, content, action, trust, floating, and recovery
   layers.
4. **Module envelope**: inherited rules, adjustable expression, and the one
   allowed signature feature.
5. **State model**: default, empty, loading, pending, partial, success,
   failure, recovery, offline/degraded, long-content, and narrow states.
6. **Input model**: pointer, keyboard, touch, assistive technology, and
   reduced motion.
7. **Performance budget**: layout-stability expectation, long-list strategy,
   and measurable runtime targets.
8. **Platform adaptation**: semantic invariants and intentional Desktop,
   Mobile, and browser/operator differences.

## 8. Evidence Gate

Use the existing prototype evidence levels:

### L1 Contract Trace

- Source paths and capability/journey IDs.
- Token and module-contract ownership.
- State branches and localized copy source.
- Component tree and lifetime policy when applicable.

### L2 Visual

- Real rendered default and critical states.
- Wide and narrow viewports.
- Light/dark themes when claimed.
- Long content and localization expansion.
- Positive calibration statement and named negative patterns checked.

### L3 Dynamic

- Complete success path.
- Failure and recovery path with preserved input.
- Keyboard path and focus restoration.
- Touch path for Mobile.
- Motion continuity and reduced-motion behavior.
- No incoherent overlap or layout shift.

### L4 Runtime Quality

- Semantic/assistive-technology inspection.
- Contrast and target-size inspection.
- Long-list or high-frequency interaction behavior.
- Available performance measurements and their environment.
- Explicit `UNPROVEN` cells when real runtime or field evidence is unavailable.

`pending-review` requires L1, L2, and the L3 paths material to the prototype.
`confirmed` additionally requires owner confirmation and no unresolved
blocking craft defect. Prototype evidence never proves production readiness.

## 9. Accessibility And Performance Baseline

- Target WCAG 2.2 AA for claimed web/client surfaces.
- Prefer at least 44 by 44 CSS pixels for primary Mobile touch targets; where
  density requires a smaller visible control, preserve an adequate hit area
  and spacing.
- Focus must be visible, unobscured, ordered by task, and restored after
  transient surfaces close.
- Status and error changes must be exposed through semantics, not only visual
  treatment.
- `prefers-reduced-motion` must remove non-essential movement while preserving
  state meaning.
- For browser-delivered production surfaces, use the Core Web Vitals good
  thresholds as the default field targets. Prototype lab results are
  directional evidence only and must name the environment.
- Any interaction or state change that causes visible geometry movement must
  be justified by the product transition; accidental movement is a defect.

## 10. Review Output

Craft review is findings-first and evidence-backed:

```text
Verdict: passed | changes-required | unproven
Blocking findings: observable defect + affected journey + evidence
Positive calibration: what is intentionally strong and why
Negative calibration: rejected patterns checked
Evidence: L1/L2/L3/L4 paths and runtime conditions
Unproven: exact missing runtime, platform, accessibility, or performance cell
```

Do not return an averaged score. A severe failure in task completion,
accessibility, trust, or recovery blocks the verdict regardless of polish.

## 11. AI Agent Checklist

- [ ] Product thesis and main subject are explicit.
- [ ] External references have Peers-specific dispositions.
- [ ] Positive and negative calibration are both recorded.
- [ ] All material states are reachable in the prototype.
- [ ] Keyboard, touch, assistive-technology, localization, and reduced-motion paths are covered.
- [ ] Performance and layout stability are measured where possible and otherwise marked unproven.
- [ ] The review reports evidence and findings, not awards or self-scores.
