---
name: pt-prototype-replica-guard
description: Keeps confirmed prototypes and production behavior aligned. Use when authoring a production-intent prototype or implementing a confirmed prototype. Do not use to force pixel identity across platforms.
---

# PT Prototype Replica Guard

## Invoke When

- Authoring or reviewing a prototype that is intended to guide production.
- Implementing a confirmed prototype in Desktop, Mobile, Dashboard, or an
  applet host.
- A production change may alter a prototype-covered Journey, state, copy,
  interaction, or visual hierarchy.

This skill does not decide the design. Product, UI Identity, module contracts,
and the confirmed prototype own that decision.

## Core Rule

Prototype and production share one **experience contract**, not necessarily one
DOM tree or one set of literal pixel values.

Preserve:

- Product Journey and visible state transitions.
- Information hierarchy and boundary ownership.
- Action roles, trust semantics, localized copy intent, and recovery behavior.
- Component-system ownership and semantic token roles.
- Keyboard, touch, assistive-technology, reduced-motion, and performance
  expectations.
- The module's accepted signature feature and its product meaning.

Adapt:

- Platform-native controls and navigation.
- Density, target size, window/safe-area behavior, and input mechanisms.
- Runtime-specific component structure when production architecture requires
  it.

Never preserve a prototype defect merely because it has an exact CSS value.

## Source Order

Read in this order:

1. Accepted product Journey/state/acceptance sources.
2. `docs/client/common/ui-identity/README.md`.
3. `docs/client/common/ui-identity/craft-quality.md`.
4. Closest module UI Identity and shared patterns.
5. Closest Desktop/Mobile/Dashboard/app runtime contract.
6. Prototype entry document and ledger status.
7. Complete rendered prototype source for the affected surface.
8. Production component, store/runtime owner, and existing tests.

Only a `confirmed` prototype is an implementation reference. A
`pending-review` prototype may be compared and reviewed, but must not silently
become production authority.

## Prototype Authoring Contract

### Reuse The Production Component System

- Use existing project components first.
- For Desktop web prototypes, prefer LobeUI, `react-layout-kit`, antd tokens,
  and `lucide-react` in the same ownership roles as production.
- For Mobile and Dashboard, use the closest production platform primitives and
  interaction conventions; do not import Desktop anatomy merely for visual
  similarity.
- Raw elements are allowed when they are the semantic or platform-appropriate
  primitive and no project component owns the behavior.
- Add a shared abstraction only when it removes real repeated behavior or
  establishes an accepted product boundary.

### Use Semantic Tokens

- Map color, spacing, radius, typography, elevation, and motion to roles from
  UI Identity or the module contract.
- A literal value is acceptable only when the owning contract or production
  token source explains the role.
- Do not encode a temporary screenshot's measurements as a global design
  system table inside this skill.
- Component-library defaults are not Peers identity until normalized.

### Implement Complete State Ownership

Prototype the semantic owner of:

- default, empty, loading, pending, partial, success;
- failure, preserved input, retry, offline/degraded, restored;
- long content, localization expansion, narrow layout;
- keyboard focus, touch feedback, assistive status, reduced motion.

State injection controls may exist for review, but they must not be confused
with product UI and must be excluded from production replication.

### Preserve Layout Stability

- Stable regions use explicit tracks, min/max constraints, aspect ratios, or
  fixed scroll ownership.
- Loading, empty, and error states preserve the intended geometry.
- Floating feedback does not push document flow.
- Motion explains continuity, causality, or spatial ownership.
- Accidental overlap or layout movement blocks review.

## Prototype To Production Workflow

### Step 1. Verify Authority

- Confirm the prototype ledger status.
- Resolve the exact product Journey, module contract, and platform cell.
- Record any prototype/design contradiction as a blocker; do not choose a
  winner silently.

### Step 2. Build A Parity Map

For every material surface, map:

```text
prototype region/state/action
  -> product Journey/state ID
  -> production owner/component
  -> semantic token/component role
  -> platform adaptation
  -> verification evidence
```

The map must include failure/recovery and accessibility paths, not only the
default screenshot.

### Step 3. Check Prototype Conformance

Before copying any source:

- Verify UI Identity, craft-quality, module, and platform contracts are
  traceable.
- Verify user-facing text has an i18n source.
- Verify action roles, state ownership, focus, touch, reduced motion, and
  layout stability.
- Verify positive and negative craft calibration.
- Fix a prototype defect through the prototype review flow first. Do not
  replicate it into production.

### Step 4. Implement At The Production Owner

- Reuse production stores, runtime projections, services, and shared
  components.
- Preserve semantic hierarchy and state transitions.
- Replace mock data and callbacks with production-owned projections and
  commands.
- Preserve server/runtime authority for trust, policy, delivery, and recovery.
- Use platform-native anatomy where it improves ergonomics without changing
  product semantics.
- Do not add compatibility paths, duplicate state, or a second visual system.

### Step 5. Compare Rendered Behavior

Use side-by-side or overlay evidence at equivalent product states:

- Default and critical state renders.
- Wide/narrow or representative device/window sizes.
- Long content and localization expansion.
- Claimed themes.
- Success and failure/recovery interactions.
- Keyboard/focus on Desktop.
- Touch/safe-area behavior on Mobile.
- Reduced-motion behavior.
- Assistive semantics and status changes.
- Available performance and layout-stability evidence.

Pixel diff is diagnostic, not the verdict. Investigate every visible
difference, then classify it as:

- accepted platform adaptation;
- accepted runtime/component-system adaptation;
- prototype defect;
- production defect;
- evidence gap.

### Step 6. Sync Both Directions

When production intentionally changes a prototype-covered experience:

- update the accepted product/module contract when semantics changed;
- update or supersede the prototype;
- refresh the parity map and evidence;
- keep the prototype ledger status honest.

Do not leave a confirmed prototype that describes behavior production no
longer intends to implement.

## Verification

The reviewer reports:

```text
Verdict: parity-passed | changes-required | unproven
Authority: product/module/prototype status
Semantic parity: Journeys, states, actions, trust, recovery
Platform adaptations: accepted differences and rationale
Craft evidence: L1/L2/L3/L4
Prototype defects: fixed or blocking
Production defects: fixed or blocking
Unproven: exact missing runtime/platform evidence
```

Required checks:

- The prototype is `confirmed` before production claims it as authority.
- Product Journey and visible state parity are complete.
- The same semantic token and component roles are used.
- Copy intent is localized in production.
- Keyboard, touch, assistive-technology, reduced-motion, and recovery paths
  match the claimed platform cells.
- Render comparison has no unexplained difference.
- Prototype and production documentation remain synchronized.

## Anti-Patterns

Never:

- Claim "pixel perfect" from source inspection or one screenshot.
- Treat copy-paste as the goal when production ownership differs.
- Maintain hardcoded global radius, icon, typography, color, or shadow tables
  in this skill.
- Force Desktop anatomy onto Mobile or Dashboard.
- Copy a benchmark identity or add an unreviewed "improvement" during
  replication.
- Preserve inaccessible targets, hidden focus, decorative motion, or layout
  shift because the prototype contains them.
- Treat a prototype as backend/runtime correctness or production Acceptance.
- Claim award readiness, accessibility, or performance from a checklist count.
- Leave prototype and production as two divergent sources of truth.
