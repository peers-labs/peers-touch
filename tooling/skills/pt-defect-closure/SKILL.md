---
name: "pt-defect-closure"
description: "Closes the defect loop: debug → fix → acceptance injection. Invoke for bug fixes that need regression coverage added to the affected module."
stage: "cross-stage"
requires: ["identified bug", "affected module path"]
produces: ["root cause analysis", "fix", "acceptance gap analysis", "acceptance Gate + evidence"]
---

# Defect Closure

When a bug is found and fixed, this skill ensures the fix is not just patched
but also protected by acceptance regression coverage. A fix without a Gate is
"probably fixed."

## Invoke When

- A bug has been identified (reproducible or reported)
- The fix touches behavior, control flow, or data ownership
- User wants regression protection after the fix

Do not invoke for:
- Typos, comment fixes, or purely cosmetic changes
- Features or new capabilities (use `pt-acceptance-engineering` ADD mode)

## Core Rule

Every bug fix that touches behavior MUST leave behind an acceptance Gate
that proves the bug is fixed and won't regress.

## Workflow

### Phase 1: Debug & Fix

1. **Locate governing spec** — `pt-small-fix-discipline` §1: which layer owns this?
2. **Layer-ownership audit** — `pt-god-view` §3.3.1: is the fix at the correct layer?
3. **Debug** — use `TRAE-debugger` workflow: hypothesize → instrument → reproduce → analyze
4. **Fix** — surgical, at the correct layer, no patches

### Phase 2: Acceptance Injection

After the fix is verified:

1. **Identify the affected module** — which domain/feature/capability does this bug belong to?
2. **Check existing coverage** — does the module already have acceptance contracts?
3. **Dispatch to `pt-acceptance-engineering`**:
   - No existing contract → `ADD` mode: create a new acceptance contract
   - Existing contract with gap → `COMPLETE` mode: add a Gate that proves the bug is fixed
   - The Gate MUST include: reproduction scenario, expected behavior, regression signal
4. **Run the Gate** — verify it passes with the fix, would fail without it

### Phase 3: Verify

1. Run the acceptance Gate against the fixed code → must pass
2. Run the acceptance Gate against the unfixed code (conceptually) → must fail
3. Report: bug fixed, acceptance Gate added, regression protected

## Output

- Root cause analysis (from debug phase)
- Fix at the correct architectural layer
- Acceptance Gate(s) injected (domain/feature + Gate definition + evidence)
- Closure report: bug → fix → Gate → pass

## Anti-Patterns

Never:
- Fix a bug without checking which layer owns the state
- Add a Gate that only checks the happy path (it must verify the bug scenario)
- Skip acceptance injection "because it's a small fix"
- Use `pt-acceptance-infra-engineering` for business-domain injection