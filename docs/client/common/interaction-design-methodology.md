---
status: active
owner: Client Platform Team
updated: 2026-10-22
review-cadence: quarterly
next-review: 2027-01-27
related:
  - docs/client/common/ux-design-methodology.md
  - docs/client/common/ui-identity/README.md
---

# Client Interaction Design Methodology

## 1. Purpose

This methodology turns an accepted product Journey into a coherent,
traceable interaction before visual implementation begins.

It complements:

- `ux-design-methodology.md`, which promotes observed defects into reusable
  contracts;
- `ui-identity/`, which owns visual and component grammar;
- Product Design, which owns product promise, Journey and visible state;
- Prototype Design, which implements a runnable high-fidelity expression.

It prevents a visually polished prototype from hiding repeated content,
misplaced information, unnecessary decisions, missing recovery or contract
drift.

## 2. Operating Model

```text
Product Intent
  -> Content Semantics
  -> Information Architecture
  -> Task And Path
  -> State And Recovery
  -> Action Representation
  -> Wireflow
  -> UI Grammar Binding
  -> High-Fidelity Prototype
  -> Evidence
```

Do not skip a layer because a screenshot looks clear. Each layer answers a
different question and has a different owner.

## 3. L0: Product Intent

Required inputs:

- stable capability and Journey IDs;
- stable visible-state and acceptance IDs;
- actor and starting context;
- promised user outcome;
- first useful result and recurring value;
- trust, privacy and authority constraints;
- non-goals and unsupported paths.

Gate:

- The user outcome can be stated without naming a page or component.
- A required Journey has one observable success and explicit failure/recovery.
- No interaction artifact invents a new product capability.

If these are missing, return to Product Design. Do not fill the gap in a
Wireflow.

## 4. L1: Content Semantics

### 4.1 Build A Concept Inventory

For every material piece of copy, identify the concept it introduces,
clarifies or acts upon.

Example:

```text
concept: station-selection
meaning: choose the Station that owns the next authenticated session
scope: station-entry
allowed roles: title, field-label
max occurrences: 1
```

The purpose is not to ban repeated words. It is to prevent the same meaning
from occupying title, subtitle, label, status and helper text without adding
information.

### 4.2 Repetition Rules

Repetition is valid when:

- an accessibility label must stand alone;
- a destructive or security decision needs explicit restatement;
- the same concept appears in a genuinely separate navigation context;
- a persistent shell identity and a page task are distinct concepts.

Repetition is defective when:

- brand, page title and helper text restate the same task;
- a field label and adjacent badge both say the input is required;
- multiple headings create no new scope;
- protocol jargon repeats instead of explaining the user's next action.

Lexical similarity is only a signal. Findings must name the duplicated concept
and scope.

### 4.3 Content Gate

- Every visible string has a semantic role.
- Each concept stays within its occurrence budget.
- Helper text adds consequence, format or recovery information.
- Error copy identifies the failed object, cause class and next action.
- Localization expansion and screen-reader naming remain possible.

## 5. L2: Information Architecture

Every surface declares:

- one main subject;
- parent scope and return destination;
- content rail;
- action rail;
- trust rail when relevant;
- floating layer;
- recovery layer.

Questions:

1. What object or task owns attention?
2. Which information changes the next decision?
3. Which information is stable metadata and may be progressively disclosed?
4. Which region has no owner or repeats another region?
5. Does opening detail preserve the user's place?

Gate:

- Exactly one main subject exists.
- Every region supports that subject or provides navigation/recovery.
- Primary content appears before stable protocol metadata.
- List, detail and recovery preserve a coherent mental model.
- No decorative card or heading creates a fake hierarchy.

## 6. L3: Task And Path Economy

### 6.1 Use A Cost Vector

For each Journey set a maximum budget:

| Dimension | Count |
|---|---|
| Commitments | irreversible or externally visible decisions |
| Context switches | route, modal, application or mental-model changes |
| Decision load | choices requiring understanding before continuing |
| Interruptions | permissions, authentication or setup breaks |
| Recovery debt | user work at risk after failure |

The Product contract sets the maximum vector for that Journey. The candidate
records states, actions and transitions; the evaluator derives the observed
vector from those accepted semantics. A candidate-authored aggregate is not
accepted. There is no universal click limit and no averaged score.

### 6.2 Path Rules

- Frequent low-risk tasks minimize context switches and decision load.
- Necessary security decisions stay explicit even when they add steps.
- Setup details that the system can derive do not precede the first useful
  outcome.
- Modal, page and popover changes count when they change mental context, not
  merely because a click occurred.
- A reversible preview may reduce commitment cost even when it adds one action.

### 6.3 Path Gate

- The candidate vector does not exceed any Journey budget dimension.
- Every step changes state, gathers necessary information or confirms risk.
- No choice is presented before the user has enough context to decide.
- Cancellation returns to a stable prior state.
- Failure does not increase recovery debt beyond the accepted budget.

## 7. L4: State And Recovery

Use the closed state taxonomy and define reachable user-visible states:

- `entry`, `empty`, `loading`, `waiting`, `pending`;
- `partial-success`, `success`;
- `failure`, `unknown-outcome`, `recovery`, `cancelled`;
- `offline`, `degraded`, `restored`;
- `long-content`, `narrow`.

For every recoverable failure record:

- preserved input;
- preserved business state;
- retry or alternate path;
- focus/return destination;
- authoritative readback if the outcome may already have happened.

Gate:

- Required states are reachable from entry.
- Failure has an outgoing recovery transition.
- Draft and irreversible work preservation match the product contract.
- Unknown outcomes reconcile before retrying side effects.
- Local UI never invents server-owned success, trust or policy.

## 8. L5: Action Representation

Choose representation from intent, risk, frequency and option shape.

| Situation | Representation |
|---|---|
| Main commitment | one text Primary Button |
| Routine named command | text or icon+text button |
| Canonical repeated low-risk tool | icon-only with tooltip and accessible label |
| Destructive action | explicit text Danger action with confirmation policy |
| Binary setting | switch or checkbox |
| Mutually exclusive modes | segmented control or tabs |
| Option set | menu/select |
| Numeric bounded value | input, stepper or slider as precision requires |

Rules:

- One surface has at most one unrelated primary commitment.
- Destructive actions are never icon-only.
- The same action keeps one representation across equivalent surfaces.
- Tabs change content scope; they do not submit or mutate data.
- Disabled actions explain the blocker when they stop task completion.

Gate:

- Every action has a stable action ID and UI Grammar role.
- Representation is legal for risk/frequency.
- Keyboard, touch and assistive-technology names are explicit.
- Equivalent surfaces do not drift.

## 9. L6: Wireflow

The Wireflow is a structured interaction graph, not a polished mock.

Each node records:

- surface ID and main subject;
- visible concepts and hierarchy;
- state kind;
- available actions and grammar roles;
- entry and exit transitions;
- recovery and cancellation;
- linked capability/Journey IDs.

Each edge records:

- triggering action;
- state change;
- preserved data;
- authority readback;
- path-cost contribution.

Run the Experience Design evaluator before high fidelity. Blocking findings
return to the owning layer. Do not patch the Wireflow around a failing product
contract.

## 10. L7: UI Grammar Binding

Bind each semantic role through
`ui-identity/grammar-bindings.json`.

The binding chooses an allowed component family and platform adapter; UI
Identity still owns tokens, layout and component geometry. Module contracts may
narrow but not redefine global meaning.

Unknown roles block high-fidelity work.

## 11. L8: High Fidelity And Evidence

After Wireflow review:

1. implement with the production component system;
2. preserve all stable trace IDs;
3. capture L1 contract evidence;
4. inspect required L2 renders;
5. exercise material L3 interactions;
6. collect applicable L4 runtime evidence;
7. rerun drift and evidence validation;
8. obtain independent findings-first review.

Zero deterministic findings means `ready-for-independent-review`, not
automatic acceptance.

## 12. Calibration

Every enforceable rule needs:

- a positive fixture that should remain clean;
- a negative fixture that must trigger the rule;
- a boundary fixture that proves a valid exception or adjacent form.

Known examples are calibration, not blind evaluation. A blind case contains no
expected result. The first result and independent review are bound to the
holdout digest. Promotion creates a separate calibration fixture referencing
that review receipt; the original holdout remains immutable and excluded from
calibration runs.

## 13. Finding Routing

Fix findings at their owner:

- product promise or missing Journey -> Product contract;
- repeated meaning -> Content contract;
- wrong hierarchy -> Information Architecture;
- costly steps -> Journey/path budget or candidate flow;
- missing recovery -> Product state/runtime authority;
- wrong action form -> Interaction contract;
- unknown visual role -> UI Identity;
- missing trace -> Wireflow/prototype;
- missing evidence -> Evidence/runtime owner;
- candidate/contract drift -> accepted contract owner.

Never solve an upstream finding with downstream CSS.

## 14. Review Output

```text
Disposition: changes-required | ready-for-independent-review | unproven
Blocking findings: rule + owner + observed consequence + correction
Warnings: evidence-backed non-blocking concerns
Trace: product -> Wireflow -> grammar -> evidence
Evidence: L1/L2/L3/L4 observed and unproven cells
Calibration: positive/negative/boundary coverage
Non-claims: exact product/runtime claims not established
```

An evaluator cannot approve its own contract or evidence. The acceptance
reviewer must be different from the author named in the case metadata.

## 15. Comparative Experience Review

When the task compares Peers with another implementation, do not align pages,
feature names or screenshots directly. Use the active
[Comparative Experience Review](../../architecture/engineering/experience-design/comparative-experience-review.md):

1. bound one Product Journey and identity-neutral task prompt;
2. complete benchmark discovery and freeze one Outcome Oracle plus Comparison
   Context;
3. capture two evidence-backed Journey observations with aliases `A` and `B`;
4. independently review each leg, then run paired evaluation;
5. freeze and independently review BlindedDelta before identity reveal;
6. reveal which leg is Peers, validate its current EDX binding and perform a
   separate Product disposition review;
7. project only accepted adopt/adapt decisions to Target Contract proposals;
8. return accepted proposals to Product ownership and then re-enter the normal
   ExperienceCase, Wireflow, prototype and evidence lifecycle.

The reference implementation is evidence, not a Product authority. Missing
comparability or exact evidence remains `UNPROVEN`. A mechanism is
intervention-confirmed only after a controlled Peers change closes the Oracle
gap. Source calibration never proves that the comparative framework has
incremental value; that claim requires its separate sealed blind A/B.
