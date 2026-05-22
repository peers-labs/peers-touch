---
kind: invariant | pitfall | playbook   # pick exactly one — delete the others
title: <one-line, human-readable; 60 chars max>
status: active                          # or: deprecated | superseded-by:<relative-path>
owns:                                   # repo paths this knowledge governs (machine-read by read-before-edit skill)
  - PLACEHOLDER/path/to/file.ext        # replace with real repo-relative path
  - PLACEHOLDER/path/to/dir/
referenced-by:                          # other knowledge files that link here
  - PLACEHOLDER-other-knowledge-file.md
related:                                # external context: ADR / architecture doc / issue tracker
  - PLACEHOLDER-decision-or-arch-doc.md
detected: YYYY-MM-DD
---

<!-- ============================================================ -->
<!-- DELETE THE BLOCKS YOU DON'T NEED FOR YOUR `kind`               -->
<!-- ============================================================ -->

<!-- ────────────────────  for kind: invariant  ──────────────────── -->

# <Same as `title` above>

## What must hold

<One paragraph stating the invariant in its strongest form. Use "MUST" / "MUST NOT".>

## Why this is non-negotiable

<2-4 paragraphs. Explain the system property that fails if the invariant is violated. Cite specific failure modes you've reasoned about — race, deadlock, data loss, spec violation, security gap. Avoid hand-waving.>

## How to verify

<A grep / metric / test / lint that will catch a violation. Each item must be runnable.>

- `rg <pattern> <path>` — must return zero hits
- `<test name>` in `<file>` — must pass
- metric `<name>` — must stay below `<threshold>`

## Crosswalks

- See pitfall `<pitfalls/foo.md>` for the bug that revealed the need for this invariant.
- See playbook `<playbooks/bar.md>` for how to add new code that respects this.

<!-- ───────────────────────  for kind: pitfall  ──────────────────── -->

# <Same as `title` above>

## Symptom

<What was observed. Be concrete: stack trace, log line, metric divergence, user-facing complaint.>

## Root cause

<One paragraph naming the system property that allowed the bug. Should be the kind of statement another invariant could be derived from.>

## Mitigation

### What was done in code

<Bullet list of file:line-level changes. Cite commit / PR.>

### What guards against regression

<grep, lint, test, metric — at least one machine-checkable. If purely human review, say so explicitly.>

## How to detect a recurrence

<Concrete — a future engineer should be able to copy-paste this command.>

## Crosswalks

- Invariant `<invariants/foo.md>` formalises the constraint this pitfall failed to honour.
- Playbook `<playbooks/bar.md>` builds the safe path into the standard procedure.

<!-- ──────────────────────  for kind: playbook  ──────────────────── -->

# <Same as `title` above>

## When to use

<Trigger conditions. Be specific — "you are adding a new X that needs Y" beats "anytime you touch Z".>

## Pre-conditions

- [ ] <something that must be true before starting>
- [ ] <e.g. proto schema reviewed in a separate PR>

## Steps

1. **<Verb-first step>** — <one paragraph; cite file paths>
   - <sub-step or check>
2. **<Verb-first step>** — <…>
3. ...

## Verification

<Numbered checklist that the implementer fills in at the end. Each item must be runnable or grep-able.>

- [ ] `<command>` succeeds.
- [ ] `<test name>` passes.
- [ ] metric `<name>` shows traffic.
- [ ] no new entry in `pitfalls/`.

## Crosswalks

- Invariants this playbook automatically respects: `<invariants/...>`
- Pitfalls this playbook avoids: `<pitfalls/...>`
