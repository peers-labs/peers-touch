---
name: pt-small-fix-discipline
description: >
  Behavioral discipline for handling "small" problems (bug fixes, small tweaks,
  "just quickly change X") without patching symptoms. Use whenever a request
  feels small enough to fix inline. Forces you to locate the governing spec,
  fix at the correct architectural layer instead of the symptom site, keep the
  change surgical, and self-grade the result before claiming done.
---

# pt-small-fix-discipline

Small problems are where architecture quietly rots. The pressure is to patch the
symptom and move on. This skill makes four things reflexive: **know the spec,
fix at the right layer, cut surgically, then grade yourself.** Inspired by
[andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills),
adapted to this repo's doc hierarchy and Bug Fix Protocol (AGENTS.md §3, §6).

**Tradeoff:** biased toward correctness over speed. For genuinely trivial edits
(typo, one-line rename, comment fix) use judgment. For anything that touches
behavior, control flow, or data ownership, apply it.

## 1. Locate the governing spec first

**Never fix code you have not located within the project's rules.** Know which
layer owns this change and read it before editing:

- `AGENTS.md` — Iron Laws (§5), Bug Fix Protocol (§6), doc hierarchy (§3).
- `docs/README.md` — entry point to find the right source document.
- The layered sources (constrain top-down): architecture (`docs/architecture/`,
  `docs/global/architecture.md`) → platform (`docs/client/*`, `docs/station/`)
  → spec (`docs/global/coding-guide/`).
- The relevant `docs/.agent/<platform>.md` for the platform you are touching.
- `docs/knowledge/` invariants / pitfalls / playbooks whose `owns:` covers your
  path (this is what `pt-read-before-edit` automates — run it, don't skip it).

## 2. Fix the layer, not the symptom

**Find where the defect actually lives in the architecture. Do not patch where it surfaces.**

- Ask *why* the symptom is possible, not just *how* to silence it.
- Identify the layer that should own this concern (ownership, persistence,
  contract, boundary). Fix it there, once, for all callers.
- If the same bug could recur in a sibling branch/runtime/path, you are at the
  wrong layer — go up.
- Remove dead code the defect exposed as part of the root fix (AGENTS.md §6.1).
- If the fix crosses layers or needs a new contract (more than one of desktop
  web / desktop rust / station / model / packages), STOP — it is no longer a
  small fix. Escalate to `pt-architecture-execution-methodology` and write the
  design under `docs/` first (Large Requirement Protocol, AGENTS.md §3).

## 3. Surgical changes

**Touch only what the fix requires. Clean up only your own mess.**

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken. Match existing style.
- Don't add error handling, config, or abstraction beyond the fix (AGENTS.md §7).
- Remove imports/vars/functions that YOUR change orphaned; leave pre-existing
  dead code unless the root fix demands removing it.
- If you spot unrelated problems, mention them — don't fold them in.

## 4. Grade yourself before claiming done

**Run this rubric out loud. Any NO on 1–4 means go back — don't ship it.**

1. **Spec located** — I named and read the doc/layer that governs this change.
2. **Root, not patch** — the fix sits at the layer that owns the concern, not the
   symptom site; a new caller/branch can't reopen the same hole.
3. **Surgical** — every changed line traces to the request; no drive-by edits.
4. **No same-source siblings left** — I checked for the same defect in parallel
   paths/runtimes and either fixed or explicitly flagged them.
5. **Verified** — I stated success criteria and confirmed them (test/build/manual
   per AGENTS.md §10), not just "looks right".

End with one line: **root cause / where the fix lives / what I verified / what I
deliberately left out.** If you can't write that line cleanly, the fix isn't done.

## Composition with other skills

| Other skill | Order |
|-------------|-------|
| `pt-read-before-edit` | Invoke it as part of rule §1 before the first edit. |
| `pt-architecture-execution-methodology` | Escalate to it when §2 crosses layers. |
| `pt-dev-workflow` | For multi-phase tasks, that skill drives; this one governs each small change inside it. |
| `pt-github-commit` / `pt-github-pr` | Run later in the commit/PR lifecycle. |
