---
name: pt-refactor-discipline
description: >
  Discipline for debt-free refactoring and re-architecture. Invoke whenever you
  propose or perform a structural change — replacing a design, moving ownership,
  reworking a subsystem, or removing "historical baggage". Forces the change to
  land clean: one source of truth (no split-brain), the old path fully deleted,
  the governing design docs and knowledge updated in the SAME change, and no
  compatibility shims, dead code, or half-migrations left behind.
---

# pt-refactor-discipline

You are always allowed to *propose* a better structure. Legacy is never a reason
to keep a bad design. But the license to change anything comes with one
non-negotiable price: **land it clean or do not start.** A refactor that leaves
two implementations, a doc that no longer matches the code, or a "migrate the
rest later" TODO is worse than the original problem — it is debt with interest.

This skill governs the large end of change. Its sibling
[`pt-small-fix-discipline`](../pt-small-fix-discipline/SKILL.md) governs the
small end. If the change is genuinely small and behavior-local, use that one.

**Core stance:** fail-closed on debt. Correctness and single-source integrity
over speed. If you cannot finish the cut in this change, scope it down to a
slice you *can* finish cleanly, and land that slice whole.

## Invoke When

- You want to replace or redesign an existing structure, contract, or ownership
  boundary instead of patching around it.
- You are removing "historical baggage": dead abstractions, compat layers,
  duplicated sources of truth, or a design that the code has outgrown.
- A bug root-causes to a design flaw and the honest fix is structural, not local.
- A change will touch more than one layer (desktop web / desktop rust / station /
  model / packages / applets) or move a concern from one owner to another.

## The Four Laws

### 1. Propose freely, execute deliberately

- Raise the refactor the moment you see the root design is wrong — do not smuggle
  a redesign inside an unrelated task, and do not silently keep bad structure.
- Before large execution, state root cause → target design → blast radius and
  bind the work to accepted product/architecture/Plan sources. An explicit
  fix/continue/execute request authorizes non-destructive work inside that
  envelope; do not create a repeated user approval boundary at every Task or
  review.
- For any cross-layer or module-level change, design the target first with
  [`pt-architecture-design-methodology`](../pt-architecture-design-methodology/SKILL.md),
  and decompose the landing with
  [`pt-architecture-execution-methodology`](../pt-architecture-execution-methodology/SKILL.md).
- Run the required agent-led review/remediation loop. Escalate only destructive
  or irreversible work, missing external authorization/resources, or a
  material semantic choice that accepted sources cannot resolve.

### 2. One source of truth — no split-brain (不脑裂)

- Never leave two implementations of the same concern "for now". The new path and
  the old path must not coexist at the end of the change.
- Never leave a doc that contradicts the code. If the code moved, the governing
  doc moves in the *same* change (see Law 4).
- When you introduce the replacement, migrate **every** call site / consumer /
  reference to it, then delete the original. Reconcile before you finish, not
  "in a follow-up".
- If two truths genuinely must coexist temporarily (e.g. a data migration
  window), that is an architecture decision: write it down with an explicit
  removal trigger and owner, or do not do it.

### 3. No debt left behind (不留债务)

Forbidden outputs of a "finished" refactor:

- Compatibility shims, `_deprecated` / `_old` / `_v2` names kept alongside the
  original, re-export bridges, or feature flags that exist only to avoid finishing.
- Dead code, orphaned exports, unused imports/vars, or commented-out old code —
  delete it, do not fossilize it (AGENTS.md: no backwards-compat hacks).
- "TODO: migrate the rest", half-updated call sites, or a rename applied in some
  files but not others.
- Silent behavior gaps: if the new design drops a capability, that is a product
  decision to surface, not a gap to hide.

Delete the old thing. Trust version control for history — do not keep corpses in
the tree.

### 4. Docs and knowledge move with the code

The design is part of the change, not a chore after it. In the same change:

- **Design docs** live in the layer that owns the boundary and are edited **in
  place** (they are authoritative, not append-only). Follow the hierarchy
  top-down: architecture (`docs/architecture/`, `docs/global/architecture.md`) →
  platform (`docs/client/*`, `docs/station/`) → spec (`docs/global/coding-guide/`).
  For module-/architecture-level work, write or update the formal doc under
  `docs/` and add/refresh the execution plan (AGENTS.md §3 Large Requirement
  Protocol; use [`pt-plan-and-document`](../pt-plan-and-document/SKILL.md) to place it).
- **Proto contracts** change first when data models change — proto-first, never
  hand-edit generated files, regenerate via the correct build path (AGENTS.md §5).
- **Knowledge layer** (`docs/knowledge/`) is the one place that is *append-only*:
  supersede stale invariants/pitfalls/playbooks with
  `status: superseded-by:<path>`, never delete them. Add a pitfall entry if the
  old design caused a bug you are now removing.
- **Directory READMEs** for every directory you restructured (AGENTS.md §8).

This is how "no split-brain" holds over time: the doc that governs a path and the
code on that path are updated by the same hand, in the same change.

## Workflow

1. **Locate the governing source.** Run
   [`pt-read-before-edit`](../pt-read-before-edit/SKILL.md); read the design doc
   and `owns:` knowledge for every path in scope. Name the current source of truth.
2. **Design the target.** Define the new boundary/ownership/contract and *what
   the old one becomes* (deleted, merged, superseded). Pass the project
   architecture and plan review loop; request human input only for a DWF-D20
   hard-boundary decision (Law 1).
3. **Inventory the blast radius.** Enumerate every consumer, call site, doc,
   test, fixture, gate, and script that references the thing you are replacing.
   This list is your definition of done for the cut.
4. **Land the cut whole.** Introduce the replacement, migrate the entire
   inventory, delete the old path, update docs/proto/knowledge/READMEs in the
   same change. No item from step 3 left pointing at the old world.
5. **Prove it's clean.** Search the tree for the old symbol/path/doc — zero live
   references outside version history. Run the platform gates (AGENTS.md §10).
   If UI/UX behavior changed, run
   [`pt-prototype-sync-guardian`](../pt-prototype-sync-guardian/SKILL.md).
6. **Audit for debt.** Use [`pt-quality-check`](../pt-quality-check/SKILL.md) /
   [`pt-completion-auditor`](../pt-completion-auditor/SKILL.md) to confirm no
   shim, no orphan, no doc drift, no overclaim.

## Verification — grade before claiming done

Run this rubric out loud. Any NO means it is not done.

1. **Single truth** — exactly one implementation and one governing doc for the
   concern; the old one is gone, not parked beside the new one.
2. **Fully migrated** — every consumer from the step-3 inventory points at the
   new path; a tree-wide search for the old symbol/path returns only history.
3. **No shims / no dead code** — no compat bridge, no `_old`/`_deprecated`, no
   orphaned exports, no "migrate later" TODO.
4. **Docs synced in-change** — design doc edited in place, proto regenerated if
   models changed, knowledge superseded (not deleted), READMEs updated.
5. **Verified** — stated success criteria confirmed via gates/tests/manual, not
   "looks right". Dropped capabilities surfaced, not hidden.

End with one line: **what was replaced / where the single source now lives / what
was deleted / which docs moved with it / what I verified.** If you cannot write
that line cleanly, the refactor isn't done — finish it or scope it down.

## Composition

| Skill | Relationship |
|-------|--------------|
| [`pt-small-fix-discipline`](../pt-small-fix-discipline/SKILL.md) | The lower boundary. If the change is small and behavior-local, use it instead. |
| [`pt-architecture-design-methodology`](../pt-architecture-design-methodology/SKILL.md) | Design the target boundary/contract before executing (Law 1). |
| [`pt-architecture-execution-methodology`](../pt-architecture-execution-methodology/SKILL.md) | Decompose a multi-phase landing into ordered, verifiable delivery. |
| [`pt-plan-and-document`](../pt-plan-and-document/SKILL.md) | Place the formal design doc / execution plan in the right `docs/` layer. |
| [`pt-read-before-edit`](../pt-read-before-edit/SKILL.md) | Load `owns:` knowledge before the first edit (Workflow step 1). |
| [`pt-prototype-sync-guardian`](../pt-prototype-sync-guardian/SKILL.md) | Realign prototypes when the refactor changes visible behavior. |
| [`pt-quality-check`](../pt-quality-check/SKILL.md) / [`pt-completion-auditor`](../pt-completion-auditor/SKILL.md) | Prove no debt before merge. |

## Anti-Patterns

Never:

- Keep the old and new implementation side by side "until the next PR".
- Add a compat shim, re-export bridge, or `_deprecated` alias to avoid updating
  call sites.
- Update the code but not the design doc, or the doc but not the code.
- Rename/move in some files and leave the rest pointing at the old name.
- Delete a `docs/knowledge/` entry instead of marking it `superseded-by`.
- Claim a refactor "done" while a tree-wide search still finds live references to
  the thing you replaced.
- Use "no historical baggage" as license to start a cut you cannot finish clean.
