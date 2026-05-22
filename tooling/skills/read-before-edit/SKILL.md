---
name: read-before-edit
description: >
  Use BEFORE editing any file in this repository. Scans the operational
  knowledge layer (docs/knowledge/) for invariants, pitfalls, and playbooks
  whose `owns:` frontmatter covers the file path being edited, and loads
  the relevant entries into the agent's context as a reviewer's voice.
  Activates automatically on any Edit / Write / StrReplace / EditNotebook
  tool invocation; humans can also run the procedure manually before a
  large refactor.
---

# read-before-edit

## Why this skill exists

The `docs/knowledge/` operational layer captures three classes of project knowledge that no other doc layer holds:

- **invariants/** — cross-cutting properties that any code touching the named paths MUST respect.
- **pitfalls/** — bugs we already paid for, with reproduction + mitigation.
- **playbooks/** — the standard operating procedure for recurring task classes.

Knowledge that nobody reads is decorative. This skill makes "consult the knowledge layer" a reflex of the editing process rather than a virtue.

## When to invoke

**Always**, before any of:

- The first Edit / Write / StrReplace / EditNotebook tool call in a turn that modifies a file in this repo.
- The first call after switching to a different file path during the same turn.
- A user request to refactor, design, or review code in a path you have not yet touched in the current session.

You do NOT need to re-run this skill for every successive edit on the same file within the same turn — once the relevant knowledge is in context, it stays.

You do NOT need to run this skill for documentation-only files (`*.md` not under `docs/knowledge/`), build output, or generated code.

## Procedure

### 1. Identify the target paths

Collect the absolute (or repo-relative) paths of every file you intend to edit in the immediate next step. Include directories if you plan to add new files there.

### 2. Scan `docs/knowledge/**/*.md` for matching `owns:` entries

```bash
# Run from the repo root. The --glob excludes scaffolding files
# (template / index / glossary) which are not knowledge entries.
rg -l --multiline 'owns:[\s\S]*?<repo-relative-path-or-prefix>' \
  --glob '!docs/knowledge/_TEMPLATE.md' \
  --glob '!docs/knowledge/README.md' \
  --glob '!docs/knowledge/glossary.md' \
  docs/knowledge/
```

A knowledge file matches when ANY of its `owns:` frontmatter entries is a prefix of (or equal to) any target path.

For example, if you are editing `apps/station/frame/touch/actor/profile.go`:
- a knowledge file with `owns: apps/station/frame/touch/actor/profile.go` → match
- a knowledge file with `owns: apps/station/frame/touch/actor/` → match (directory prefix)
- a knowledge file with `owns: apps/station/frame/touch/actor/locator_hook.go` → no match (sibling file, but its `referenced-by:` field may still link relevant context — follow if so)

### 3. Read every matched file in full

For each match, read:

- The full body of the matched knowledge file.
- Any file listed in its `referenced-by:` or `related:` frontmatter that you have not already read in the same session.

Do NOT skim. The "How to verify" section of each invariant and the "How to detect a recurrence" section of each pitfall are the load-bearing parts — they are what actually catches a regression.

### 4. Resolve glossary terms

If the matched knowledge files use a project-specific term you are unsure about (e.g. `locator_seq`, `inbox_relay_mounts`, `home_station_peer_id`), consult `docs/knowledge/glossary.md` for its precise meaning before continuing.

### 5. Apply matched knowledge as a reviewer's voice

Treat each matched knowledge file as if a senior reviewer pasted it in a PR comment that says: "Before you change this code, are you respecting the following?"

Concretely:

- Each invariant becomes a property your edit must preserve. Verify by walking through its "How to verify" section against your planned change. If a check would fail after the edit, revise the plan.
- Each pitfall becomes a regression to actively avoid. Run its "How to detect a recurrence" against your plan; if your edit pattern matches the bug shape, treat it as a STOP and reconsider.
- Each playbook becomes the procedure to follow. If your task matches a playbook's "When to use", execute the playbook's steps in order rather than improvising.

### 6. Surface conflicts to the user

If a matched invariant or pitfall would be violated by the user's request, do NOT silently rewrite the request to comply. Surface the conflict in plain language, cite the specific knowledge file, and ask the user how to proceed. The knowledge layer is a contract that BOTH parties (you and the user) consult; resolving conflicts together is the point.

## Out-of-scope (this skill does NOT)

- Edit files. It is read-only.
- Validate that the knowledge layer itself is well-formed. That is the lifecycle responsibility of whoever PR'd the knowledge file (see `docs/knowledge/README.md §4`).
- Replace `architecture-execution-methodology` or `dev-workflow`. This skill runs at a finer granularity (per-edit) than those workflow-level skills.
- Run any Bash command that mutates state. Greps and reads only.

## Failure mode to avoid

If `rg` returns no matches, that does NOT mean "no knowledge applies". It means "no knowledge has been written for this path yet". Two follow-ups in that case:

1. Do NOT auto-add a knowledge file. Knowledge entries are PR'd through the same review process as code; auto-generated entries dilute signal.
2. After completing the edit, if the change revealed a property that should have been an invariant or a near-miss that should have been a pitfall, propose adding the entry as part of the same PR (or a follow-up). See `docs/knowledge/README.md §4` for the lifecycle.

## Composition with other skills

| Other skill | Order |
|-------------|-------|
| `dev-workflow` | This skill is invoked from inside `dev-workflow`'s implementation phase, not before it. |
| `architecture-execution-methodology` | Architecture phase precedes; this skill operates per-file during execution. |
| `desktop-runtime-projections` | If editing under `apps/desktop/src/`, both skills run; this one supplies the cross-cutting knowledge layer, the other supplies the desktop-specific kernel contracts. |
| `github-pr` / `github-commit` | Run later, in the PR / commit lifecycle phase. |

## Crosswalks

- Knowledge layer entry: `docs/knowledge/README.md`.
- Frontmatter spec: `docs/knowledge/_TEMPLATE.md`.
- Top-level integration: `AGENTS.md §3` Documentation Source Hierarchy lists the knowledge layer; agents reading this file already know to expect it.
