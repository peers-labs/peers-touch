---
kind: playbook
title: Promote UX examples into reusable contracts
status: active
owns:
  - docs/client/common/
  - docs/client/mobile/
  - docs/client/desktop/
  - docs/knowledge/invariants/
  - docs/knowledge/playbooks/
referenced-by:
  - docs/knowledge/invariants/composite-form-control-boundaries.md
  - docs/knowledge/invariants/client-ui-identity-before-edit.md
related:
  - docs/client/common/ux-design-methodology.md
  - docs/client/common/form-control-ux-contract.md
  - docs/client/common/ui-identity/README.md
detected: 2026-06-09
---

# Promote UX examples into reusable contracts

## When to use

Use this playbook when a screenshot, prototype, product review, implementation review, or runtime observation reveals a UX issue that may recur beyond one component.

Examples:

- A dropdown and input look visually detached despite representing one field.
- A menu covers content or appears disconnected from its source.
- A bottom tab, composer, keyboard, or safe area hides important content.
- A hover or long-press action breaks the perceived structure of a card, message, or form.
- An empty, error, permission, trust, or weak-network state blocks user recovery.

## Pre-conditions

- [ ] The concrete UX issue has at least one visual, behavioral, or file reference.
- [ ] The user task behind the UI is known.
- [ ] The platform/device/window context is known.
- [ ] The case has been checked against existing contracts before creating new rules.

## Roles

- Product / design owner: names the user task, intent, content priority, and acceptable platform behavior.
- Engineer: identifies implementation boundaries, path ownership, feasibility, and verification commands.
- Reviewer: checks whether the rule is too broad, too narrow, or already covered elsewhere.
- AI agent: follows the contract and invariant, cites evidence, and avoids inventing broad rules from one case.

## Artifact Decision

Use this decision tree before editing docs:

```text
Is the issue already covered by an existing contract or invariant?
  -> Cite and apply the existing rule. Do not duplicate.

Is the issue purely local and unlikely to recur?
  -> Fix the component. Do not create a new contract.

Does the issue recur within one component family?
  -> Update or create a component/domain contract.

Does the issue affect multiple client domains?
  -> Update or create a common client contract.

Does it require different Mobile/Desktop behavior?
  -> Add platform refinements.

Can known code paths regress easily?
  -> Add or update a knowledge invariant with owns entries.

Is the process itself repeatable?
  -> Add or update a playbook.

Is evidence too narrow or controversial?
  -> Record the case in the methodology case library and defer hard rules.
```

## Steps

1. **Capture the raw case** — Record screenshot/prototype/file path, platform, device/window context, data state, and the user's intended task.
2. **Name the defect** — Describe the failure in precise UX terms, such as "split focus model", "detached popup", "duplicate external borders", "content occlusion", "missing recovery", or "trust state underweighted".
3. **Identify the user intention** — Decide whether the UI represents one semantic field, one action surface, one scroll surface, one recovery flow, one trust decision, or multiple independent elements.
4. **Map UX dimensions** — Use `docs/client/common/ux-design-methodology.md` to mark task success, boundaries, information hierarchy, feedback, content, accessibility, platform fit, performance perception, and data extremes.
5. **Load UI Identity** — For client UI work, read `docs/client/common/ui-identity/README.md`, the closest module contract, and relevant patterns before naming the target style.
6. **Extract the principle** — Convert the defect into a reusable but scoped rule. Avoid universal rules from one example.
7. **Choose the artifact** — Apply the Artifact Decision tree.
8. **Update or create the contract** — Put shared rules under `docs/client/common/`, `docs/client/common/ui-identity/`, or a domain-specific `docs/client/<domain>/` directory.
9. **Add platform refinements** — Put Mobile-specific rules under `docs/client/mobile/` and Desktop-specific rules under `docs/client/desktop/`.
10. **Add an invariant when needed** — If future edits to known paths must obey the rule, add or update `docs/knowledge/invariants/` with `owns:` entries.
11. **Define acceptance evidence** — Add a matrix covering user task, context, input/data extremes, expected behavior, evidence, and owner.
12. **Update indexes** — Link the new or changed documents from the relevant README or platform entry document.

## Conflict Handling

When reviewers disagree:

- Prefer the higher-level source of truth when docs conflict.
- Prefer platform-native behavior when identical cross-platform UI would reduce usability or accessibility.
- Prefer explicit recovery and trust communication over minimal visual design.
- Prefer scoped contracts over broad rules when evidence comes from a single case.
- If the decision affects product behavior, ask the product/design owner rather than silently codifying an engineering assumption.

## Verification

- [ ] Existing docs were searched before adding new rules.
- [ ] `rg "<new contract filename>|<new invariant filename>" docs/README.md docs/client docs/knowledge/README.md` shows the new document is discoverable.
- [ ] `git diff --check -- docs` succeeds.
- [ ] The contract declares covered and out-of-scope UX dimensions.
- [ ] The contract includes an AI agent checklist.
- [ ] The invariant includes machine-checkable grep commands or explicit manual acceptance checks.
- [ ] The acceptance matrix includes user task, context, data extremes, evidence type, and owner.

## Crosswalks

- Invariants this playbook respects: `docs/knowledge/invariants/composite-form-control-boundaries.md`, `docs/knowledge/invariants/client-ui-identity-before-edit.md`.
- Contracts this playbook currently supports: `docs/client/common/ux-design-methodology.md`, `docs/client/common/form-control-ux-contract.md`, `docs/client/common/ui-identity/README.md`.
