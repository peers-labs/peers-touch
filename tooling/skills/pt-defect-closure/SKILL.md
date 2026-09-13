---
name: "pt-defect-closure"
description: "Closes the defect loop: debug → fix → acceptance injection. Invoke for bug fixes that need regression coverage added to the affected module."
stage: "cross-stage"
requires: ["identified bug", "affected module path"]
produces: ["root cause analysis", "fix", "acceptance gap analysis", "acceptance Gate + evidence", "growth decision"]
---

# Defect Closure

When a bug is found and fixed, this skill ensures the fix is not just patched
but also protected by acceptance regression coverage. A fix without a Gate is
"probably fixed."

## Invoke When

- A bug has been identified (reproducible or reported)
- The fix touches behavior, control flow, data ownership, UI, interaction, or
  visual state
- User wants regression protection after the fix

Do not invoke for:
- Typos, comment fixes, internal renames, or changes with zero product impact
- Features or new capabilities (use `pt-acceptance-engineering` ADD mode)

## Core Rule

Every bug fix that touches product behavior MUST leave behind an acceptance
Gate that proves the bug is fixed and won't regress. This includes UI and
interaction defects — a visual regression is still a regression.

## Step 0: Classify the Defect

Before anything else, classify the bug. This determines which path to follow.

| Defect type | Examples | Dispatch |
|-------------|----------|----------|
| **Behavior** | Wrong data, broken API, logic error, race condition | Phase 1 → Phase 2 → Phase 3 → Phase 4 |
| **UI / Interaction** | Misaligned layout, wrong state color, missing loading state, interaction not matching prototype, broken responsive behavior | Phase 1 → Phase 1b (UI contract) → Phase 2 → Phase 3 → Phase 4 |
| **Typo / Comment** | Spelling, comment accuracy, internal rename with zero product impact | `pt-small-fix-discipline` only — no acceptance needed |

---

## Phase 1: Debug & Fix

1. **Locate governing spec** — `pt-small-fix-discipline` §1: which layer owns this?
2. **Layer-ownership audit** — `pt-god-view` §3.3.1: is the fix at the correct layer?
3. **Debug** — use `TRAE-debugger` workflow: hypothesize → instrument → reproduce → analyze
4. **Fix** — surgical, at the correct layer, no patches

---

## Phase 1b: UI Interaction Contract (UI defects only)

For UI / interaction defects, before acceptance injection, define what "correct"
means so the agent and acceptance Gate share a common baseline.

### Priority of truth

```
Confirmed product decision
  → UI Identity / module UX contract (docs/client/common/ui-identity/modules/)
  → Current confirmed prototype (packages/prototypes/)
  → Interaction contract (this phase)
  → Acceptance Gate
  → Product implementation
```

The implementation is NOT the design source. If implementation differs from
prototype, the prototype wins unless a product decision says otherwise.

### Write an interaction contract

Capture the bug scenario in a structured format:

```yaml
surface: <desktop|mobile|dashboard>.<module>.<page>
scenario: <short-description>

given:
  - <precondition 1>
  - <precondition 2>

when:
  - <user action 1>
  - <user action 2>

then:
  - <expected state 1>
  - <expected state 2>

visual_invariants:
  - <layout constraint that must never break>
  - <alignment or spacing rule>

forbidden:
  - <state that must never occur>
  - <side effect that must never happen>

evidence:
  - interaction trace
  - assertions
  - before/after screenshots
```

### Dispatch to prototype sync

After writing the contract, invoke `pt-prototype-sync-guardian` to classify
drift:

- `Implementation bug` → fix product, do not change prototype
- `Prototype bug` → fix prototype and contract first, then product
- `Product decision` → update prototype, contract, and acceptance first, then product
- `Runtime-only detail` → no prototype change needed

### If the contract is insufficient

If the interaction contract format cannot capture the scenario (e.g., complex
animation, gesture, or multi-surface interaction), do NOT skip this phase.
Instead:

1. Describe what is missing from the contract format
2. Propose an extension to the format (new field, new section)
3. Record the gap as a growth signal (Phase 4)
4. Proceed with the best available contract

---

## Phase 2: Acceptance Injection

After the fix is verified:

1. **Identify the affected module** — which domain/feature/capability does this
   bug belong to?
2. **Check existing coverage** — does the module already have acceptance
   contracts?
3. **Dispatch to `pt-acceptance-engineering`**:
   - No existing contract → `ADD` mode: create a new acceptance contract
   - Existing contract with gap → `COMPLETE` mode: add a Gate that proves the
     bug is fixed
   - The Gate MUST include: reproduction scenario, expected behavior, regression
     signal
   - For UI defects: Gate MUST reference the interaction contract from Phase 1b
   - For UI defects: Gate MUST include visual evidence (screenshot comparison)
4. **Run the Gate** — verify it passes with the fix, would fail without it

---

## Phase 3: Verify

1. Run the acceptance Gate against the fixed code → must pass
2. Run the acceptance Gate against the unfixed code (conceptually) → must fail
3. Assertions: all `then` clauses from the interaction contract pass
4. Forbidden: all `forbidden` clauses are absent
5. Visual invariants: all `visual_invariants` are satisfied

---

## Phase 4: Growth (MANDATORY)

Every fix is a chance to make the system more robust. After Phase 3, the agent
MUST answer these three questions and produce a concrete growth decision.

### Question 1: Is the Gate sufficient?

Ask: "Does this Gate cover all the ways this bug could recur?"

- **No** → Gate has gaps → dispatch `pt-acceptance-engineering` `UPGRADE` mode
  to add coverage
- **Yes** → continue

### Question 2: Could this bug recur in other modules?

Ask: "Is there a pattern here that other code could repeat?"

- **Yes** → identify the pattern → record as `knowledge_pitfall` in
  `docs/knowledge/pitfalls/<pitfall-id>.md` with:
  - Reproduction steps
  - Root cause class
  - Affected modules
  - Mitigation (the fix pattern)
  - Detection (how to find similar instances)
- **No** → continue

### Question 3: Is there a hidden constraint now exposed?

Ask: "Did this bug reveal a constraint that was never documented?"

- **Yes** → record as `knowledge_invariant` in
  `docs/knowledge/invariants/<invariant-id>.md` with:
  - The invariant
  - The `owns:` paths it governs
  - What happens when violated
  - How to verify
- **No** → complete

### Growth decision output

The agent MUST produce exactly one of:

| Decision | When | Asset path |
|----------|------|------------|
| `acceptance_gate` | Gate was added or upgraded | Gate ID + domain |
| `knowledge_pitfall` | Pattern that could recur | `docs/knowledge/pitfalls/<id>.md` |
| `knowledge_invariant` | Hidden constraint now documented | `docs/knowledge/invariants/<id>.md` |
| `knowledge_playbook` | Recurring fix workflow emerged | `docs/knowledge/playbooks/<id>.md` |
| `skill_update` | Skill contract or interaction format needs extension | Which skill + what changed |
| `no_growth_needed` | Truly isolated one-off with no pattern | Reason why |

If the agent discovers the interaction contract format is insufficient (Phase 1b
fallback), the growth decision MUST be `skill_update` targeting
`pt-defect-closure` with the proposed format extension.

### Growth verification

After recording the growth asset:

1. Verify the asset file exists and matches the template
2. Verify the `owns:` frontmatter covers the affected paths
3. Report: growth decision + asset path + reason

---

## Output

- Root cause analysis (from debug phase)
- Classification: Behavior | UI/Interaction | Typo
- Interaction contract (for UI defects)
- Fix at the correct architectural layer
- Acceptance Gate(s) injected (domain/feature + Gate definition + evidence)
- Growth decision + asset path
- Closure report: bug → fix → Gate → growth → pass

---

## Anti-Patterns

Never:
- Fix a bug without checking which layer owns the state
- Fix a UI defect without writing an interaction contract
- Skip prototype sync for UI changes
- Skip Phase 4 growth assessment
- Add a Gate that only checks the happy path (it must verify the bug scenario)
- Skip acceptance injection "because it's a small fix"
- Use `pt-acceptance-infra-engineering` for business-domain injection
- Treat product implementation as the design source when it differs from prototype
- Let the interaction contract format limitation block the fix — record the gap and proceed