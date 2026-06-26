# Client UX Design Methodology

> Status: Canonical client-level methodology.
> Audience: Product designers, client engineers, reviewers, and AI agents.
> Updated: 2026-06-09.

## 1. Purpose

Peers-Touch client UI must evolve from concrete defects into reusable design knowledge without turning every visual complaint into a global rule.

When a screenshot, prototype, review finding, or user complaint exposes a UX issue, the result must not be only a local patch. The issue should be analyzed as a product experience problem, then routed to the right artifact: component fix, product contract, platform contract, invariant, or playbook.

This methodology defines how to diagnose UX issues beyond surface styling, decide whether a case deserves reusable rules, preserve platform-native behavior without product drift, and give AI agents precise implementation and verification language.

## 2. Design Philosophy

### 2.1 Continuity Over Assembly

The user should perceive one continuous control, surface, or flow when the product intent is continuous.

Example: a protocol selector plus host input is one address field, not a small dropdown glued to a text input.

Rule:

- If elements complete one user intention, they should share one semantic frame, one state model, and one interaction story.
- The visual frame may be unified, adjacent, or separated depending on platform convention, action risk, space constraints, and the strength of the relationship.
- When the visual frame is not unified, the semantic relationship must still be obvious through alignment, spacing, copy, affordance, and feedback.

### 2.2 Boundaries Before Styling

Visual quality starts with explicit boundaries, not colors.

Every UI surface must define:

- Content bounds.
- Interaction bounds.
- Floating layer bounds.
- Focus bounds.
- Error bounds.
- Safe-area and occlusion bounds.
- Data and loading bounds.
- Accessibility bounds.

Rule:

- A UI element is not acceptable until its normal, focused, disabled, error, loading, expanded, overflow, collision, and recovery states have defined boundaries.

### 2.3 State Belongs To The User Intent

When several sub-elements represent one intent, state must apply to the composite intent before it applies to a child.

Example: focus ring on an address field must wrap the whole address field, not only the host input.

Rule:

- Composite controls must have a parent state owner. Children may show local affordances, but cannot contradict the parent state.
- When a child owns local state, the contract must explain how local state composes with the parent state.

### 2.4 Platform Native Without Product Drift

Mobile and Desktop may use different interaction mechanisms, but they must preserve shared semantics.

Example:

- Mobile protocol selection may open a BottomSheet.
- Desktop protocol selection may open a popover or select menu.
- Both still represent the same `ProtocolPrefix` slot inside one `AddressField`.

Rule:

- Semantic anatomy and user intent must stay consistent.
- Concrete component anatomy, placement, and motion may differ by platform when the platform contract explains the difference.
- Platform-native interaction wins over visual sameness when visual sameness would reduce usability, accessibility, or trust.

### 2.5 Task Success Over Visual Neatness

A UI can look clean and still fail the user task.

Rule:

- UX quality is judged by whether the user can complete the task safely, confidently, and recoverably under realistic device, data, network, permission, and accessibility conditions.
- Visual polish is necessary but not sufficient.

### 2.6 Defects Become Contracts Carefully

A repeated UX problem is often a missing contract, but not every issue deserves a new global rule.

Rule:

- If an issue is one-off and local, fix the component and cite the nearest contract.
- If an issue recurs across components, create or update a component contract.
- If an issue differs by platform, create or update a platform contract.
- If an issue can regress in known paths, create or update an invariant.
- If an issue reveals a repeatable work process, create or update a playbook.
- If the evidence is too narrow, record the case but do not over-generalize the rule.

## 3. UX Dimension Matrix

Every reusable UX contract must declare which dimensions it covers and which dimensions are intentionally out of scope.

| Dimension | Question | Typical evidence |
| --- | --- | --- |
| Task success | Can the user complete the intended task without hidden steps or ambiguity? | Task walkthrough, prototype, acceptance scenario. |
| Visual continuity | Do related elements feel like one intentional surface or flow? | Screenshot comparison, token review, layout inspection. |
| State ownership | Does focus, error, loading, expanded, and disabled state belong to the correct semantic owner? | State map, focus/error screenshots, component contract review. |
| Spatial boundaries | Are content, input, floating layers, and safe areas non-overlapping? | Device matrix, collision checks, scroll states. |
| Information hierarchy | Does the UI prioritize primary content and actions correctly? | Content audit, density review, state priority list. |
| Interaction discoverability | Can users find available actions without guessing? | Interaction map, hover/long-press/keyboard path review. |
| Feedback and recovery | Does the UI explain progress, failure, retry, and completion? | Loading/error/retry scenarios, weak-network test. |
| Content strategy | Are labels, helper text, errors, empty states, and warnings useful and localized? | i18n keys, long-language checks, copy review. |
| Trust and safety | Does the UI communicate risk, privacy, protocol, identity, or security state? | Threat/risk state walkthrough, sensitive-action review. |
| Accessibility | Can keyboard, screen reader, focus, contrast, and motion-sensitive users operate it? | Keyboard path, screen reader order, focus restore, contrast. |
| Platform fit | Does the UI follow Mobile/Desktop conventions while preserving product semantics? | Platform contract comparison, device/window review. |
| Performance perception | Does loading, skeleton, transition, and refresh behavior feel stable? | Slow device/network capture, transition timing review. |
| Extreme data | Does the UI survive long text, empty data, many items, media, and localization expansion? | Fixture matrix, overflow review, RTL/long language where applicable. |

Minimum rule:

- A contract may focus on a subset of dimensions, but it must explicitly state why excluded dimensions are not relevant or are owned elsewhere.

## 4. The UX Case Ladder

Use this ladder whenever a new example arrives.

```text
Raw Case
  ↓
Observed Defect
  ↓
Underlying Intent
  ↓
Affected UX Dimensions
  ↓
Reusable Principle
  ↓
Artifact Decision
  ↓
Component Contract
  ↓
Platform Contract
  ↓
Knowledge Invariant
  ↓
Acceptance Evidence Matrix
```

### 4.1 Raw Case

Capture what was seen without interpreting it too early.

Required fields:

- Screenshot, prototype, video, PR, or file path.
- Platform and device/window context.
- User task being attempted.
- Visible defect.
- Data and state context: empty, loading, error, long content, weak network, permission state, or normal state.

### 4.2 Observed Defect

Describe the actual failure.

Good:

- "The protocol selector and host input look like unrelated controls because they do not share one frame, radius, focus ring, or menu model."
- "The message action menu covers the selected image body and blocks the content the user is acting on."
- "The empty state tells the user that no station exists but does not provide a recovery path."

Bad:

- "The dropdown looks ugly."

### 4.3 Underlying Intent

Name the product intent.

Example:

- "The user is entering one station address."
- "The protocol is a prefix dimension of the address, not an independent form field."
- "The user is trying to recover from a failed connection and continue setup."

### 4.4 Affected UX Dimensions

Select dimensions from the UX Dimension Matrix.

Example:

```text
Case: Protocol selector + host input
Dimensions: visual continuity, state ownership, platform fit, accessibility, content strategy
```

### 4.5 Reusable Principle

Turn the intent into a reusable rule, but keep the rule scoped.

Example:

- "Sub-elements that complete one input intention must share one parent field frame and state model."

Too broad:

- "All adjacent controls must be merged."

### 4.6 Artifact Decision

Decide where the learning belongs.

```text
Is it one-off and local?
  -> Fix component and cite nearest contract.

Does it repeat across components in one domain?
  -> Update or create a domain/component contract.

Does it apply across Desktop and Mobile?
  -> Update or create a common client contract.

Does it need different platform behavior?
  -> Add Mobile/Desktop platform refinements.

Can future edits to known paths violate it easily?
  -> Add or update a knowledge invariant.

Is the work process repeatable?
  -> Add or update a playbook.

Is evidence too narrow or controversial?
  -> Record as a case note, do not create a broad rule yet.
```

### 4.7 Component Contract

Define anatomy, legal states, forbidden patterns, tokens, and acceptance criteria.

Example:

```text
CompositeField
├─ FieldFrame
├─ PrefixSlot
├─ Divider
├─ PrimaryInput
└─ SuffixAction
```

### 4.8 Platform Contract

Refine the shared contract for Mobile, Desktop, or another client surface.

Example:

- Mobile uses BottomSheet for low-frequency prefix selection.
- Desktop may use a popover if it remains frame-aligned and collision-aware.

### 4.9 Knowledge Invariant

Create an invariant when future code edits should be blocked or reviewed if they violate the rule.

Example:

- `ProtocolSelector` and `AddressInput` must not own separate external borders when they form one address field.

### 4.10 Acceptance Evidence Matrix

Acceptance is not only a state list. It must combine task, context, data, expectation, and evidence.

Template:

| User task | Context | Input/data extreme | Expected behavior | Evidence | Owner |
| --- | --- | --- | --- | --- | --- |
| Enter station address | Mobile, keyboard open | Long host value | Field remains one control and input is visible | Screenshot or preview capture | Implementer |
| Select message action | Mobile, near bottom | Image message | Action surface does not cover image body | Screenshot/video | Reviewer |
| Recover from failure | Weak network | Connection failed | Error explains cause and offers retry | Manual scenario | Product + engineer |

## 5. Conflict Resolution

Use this priority order when rules conflict:

1. User safety, privacy, and data integrity.
2. Task completion and recovery.
3. Accessibility and platform operability.
4. Content readability and non-occlusion.
5. Platform-native interaction convention.
6. Cross-client semantic consistency.
7. Visual continuity and polish.
8. Implementation simplicity.

Common conflict decisions:

- If platform-native behavior conflicts with visual sameness, keep semantic consistency and allow platform-specific presentation.
- If visual continuity conflicts with recoverability, prioritize explicit recovery controls.
- If density conflicts with readability, prioritize readability for primary content.
- If animation conflicts with responsiveness or reduced-motion settings, prioritize stable feedback.
- If a shared rule creates worse UX on one platform, refine the platform contract instead of forcing identical UI.

## 6. UX Contract Template

Every reusable UX contract should include:

- Purpose and scope.
- Covered UX dimensions and explicit out-of-scope dimensions.
- User tasks and success criteria.
- Component or semantic anatomy when relevant.
- Ownership of state and recovery.
- Boundary model.
- Legal states and transitions.
- Forbidden patterns.
- Token requirements.
- Platform differences.
- Content, i18n, and accessibility requirements.
- Acceptance evidence matrix.
- AI agent implementation checklist.
- Case references that motivated the contract.

## 7. Case Library

### Case 001: Station Protocol Selector + Address Input

Raw case:

- Mobile station setup screen shows `HTTPS` selector next to `Host / IP:Port` input.
- The selector and input look like unrelated controls because they use separate boundaries and focus treatment.

Observed defect:

- Split visual frame.
- Split state ownership.
- Desktop-like dropdown behavior on Mobile.
- Weak perceived relationship between protocol and address value.

Underlying user intent:

- The user is entering one station address.

Affected dimensions:

- Visual continuity.
- State ownership.
- Platform fit.
- Accessibility.
- Content strategy.

Reusable principle:

- A prefix dimension and primary input that form one submitted value should share one field state model and a visually continuous field relationship.

Artifacts:

- `docs/client/common/form-control-ux-contract.md`
- `docs/client/mobile/form-control-layout-contract.md`
- `docs/knowledge/invariants/composite-form-control-boundaries.md`

### Case 002: Chat Message Action Occludes Content

Raw case:

- Message action menu, hover bar, or long-press options appear over text or image content.

Observed defect:

- Action surface hides the content the user is trying to inspect or act on.
- Floating layer placement is based on visual tuning instead of collision-aware boundaries.

Underlying user intent:

- The user wants to read, verify, copy, reply, forward, retry, or delete a message without losing context.

Affected dimensions:

- Spatial boundaries.
- Content readability.
- Interaction discoverability.
- Platform fit.
- Accessibility.

Reusable principle:

- Message actions must be anchored to the message but must not cover primary message content.

Artifacts:

- `docs/client/chat/chat-ux-contract.md`
- `docs/client/mobile/chat-layout-contract.md`
- `docs/client/desktop/chat-layout-contract.md`
- `docs/knowledge/invariants/chat-message-boundaries.md`

### Case 003: Mobile Bottom Layers Hide Primary Content

Raw case:

- Bottom tab, composer, keyboard, attachment panel, or Home Indicator hides the last visible content.

Observed defect:

- Multiple bottom layers are treated as separate layout hacks instead of one bottom clearance model.

Underlying user intent:

- The user wants to read the latest content and continue input without spatial surprises.

Affected dimensions:

- Spatial boundaries.
- Platform fit.
- Task success.
- Performance perception.

Reusable principle:

- All visible bottom occlusion sources must participate in one measured or tokenized clearance model.

Artifacts:

- `docs/client/mobile/chat-layout-contract.md`
- `docs/knowledge/invariants/mobile-chat-layout-boundaries.md`

### Case 004: Empty Or Error State Without Recovery

Raw case:

- A screen says there is no data or a connection failed, but does not explain what the user can do next.

Observed defect:

- State communicates absence or failure but not recovery.

Underlying user intent:

- The user wants to continue setup, retry, change input, or understand the blocker.

Affected dimensions:

- Task success.
- Feedback and recovery.
- Content strategy.
- Trust and safety.

Reusable principle:

- Empty and error states must pair explanation with a next valid action when recovery is possible.

Artifacts:

- Future common empty/error state contract when another concrete case confirms recurrence.

### Case 005: Security Or Trust State Is Visually Underweighted

Raw case:

- A protocol, identity, encryption, permission, or connection state exists but the UI does not communicate its risk or trust meaning.

Observed defect:

- The user can proceed without understanding a security-relevant distinction.

Underlying user intent:

- The user wants to connect, share, authenticate, or send content safely.

Affected dimensions:

- Trust and safety.
- Content strategy.
- Information hierarchy.
- Task success.

Reusable principle:

- Security-relevant state must be visible at the decision point and written in action-oriented, localized language.

Artifacts:

- Future trust/safety UX contract when concrete product cases are collected.

## 8. AI Agent Language

When asking an AI agent to implement UI, use contract language and identify the UX type.

Composite form example:

```text
Implement this as a CompositeField, not as adjacent independent controls.
The parent FieldFrame owns border, radius, focus ring, error ring, disabled state, and loading state.
Child slots must not draw independent outer borders unless the contract defines a segmented control.
All dimensions and colors must use form/control tokens.
Mobile prefix selection must use BottomSheet unless the platform contract allows inline selection.
```

Chat boundary example:

```text
Implement message actions with collision-aware placement.
The action surface must not intersect selectedMessageContentRect.
If above and below placements are unsafe on Mobile, use BottomSheet.
The last message must remain visible above composer, input panel, keyboard, and safe area.
```

Empty/error recovery example:

```text
Implement the empty/error state as a recovery surface.
It must include localized explanation, primary recovery action, secondary diagnostic or navigation action when relevant, and loading/retry feedback.
Do not rely only on toast feedback for recoverable failures.
```

Avoid vague language:

```text
Make it look better.
Make it softer.
Fix the dropdown style.
Make the empty state nicer.
```

## 9. Updating This Methodology

Future examples should update this methodology only when they reveal a new class of UX problem or expose a flaw in the decision process.

Use this decision rule:

- One-off visual issue: fix the component and cite the relevant contract.
- Repeated component issue: update the component contract.
- Cross-domain issue: update or create a common client contract.
- Platform-specific interaction issue: update the platform contract.
- Path-sensitive regression risk: add or update an invariant.
- Repeatable review workflow: add or update a playbook.
- Evidence is too narrow: add a case note, defer broad rules.

## 10. Change Record

- 2026-06-09: Created methodology from the station protocol selector example to formalize how concrete UX defects become reusable client design contracts.
- 2026-06-09: Expanded methodology with UX dimensions, artifact decision rules, conflict resolution, case library, and acceptance evidence model.
