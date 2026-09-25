---
name: "pt-skill-author"
description: "Guides Peers-Touch project skill creation and cleanup. Invoke when adding, renaming, reviewing, or updating any pt-* project skill."
---

# PT Skill Author

Use this project skill after the generic `skill-creator` when creating or
editing Peers-Touch skills. It defines Peers-Touch-specific skill governance,
not the generic SKILL.md format.

## Invoke When

- Creating a new Peers-Touch project skill.
- Renaming, splitting, merging, or deleting a project skill.
- Reviewing whether a project skill is too broad, redundant, stale, or overlaps
  another skill.
- Updating skill references in docs, scripts, gates, or other skills.

## Naming

- Every Peers-Touch project skill name and directory must start with `pt-`.
- Canonical source path: `tooling/skills/pt-<name>/SKILL.md`.
- Host-private locations such as `.trae/skills`, `.cursor/skills`, and
  `.agents/skills` are runtime projections only; never edit them as sources.
- Do not use unprefixed project skill names.
- Avoid duplicated branding such as `pt-peers-touch-*`; use `pt-*`.

## Authoring Rules

- Make the `description` action-oriented and trigger-oriented: what it does,
  and when to invoke it.
- Keep the body focused on execution rules, not background explanation.
- Prefer hard choices, workflows, and output requirements over prose.
- Do not duplicate generic `skill-creator` instructions.
- Do not create a skill when an existing `pt-*` skill already owns the behavior;
  update or narrow the existing skill instead.
- State explicit non-goals when they prevent misuse.

## Required Shape

Use this compact structure unless a skill genuinely needs more:

- `Invoke When`
- `Core Rule` or `Required Discipline`
- `Workflow`
- `Verification` or `Output`
- `Anti-Patterns`

## Reference Hygiene

When a skill is added, renamed, or removed, update all relevant references:

- `AGENTS.md` skill table.
- Other `tooling/skills/**` files.
- Architecture docs, execution plans, quality gates, scripts, fixtures, and
  evidence files that mention the skill name or path.

## Verification

Run these checks before reporting:

- Verify each supported host projects `tooling/skills/` into its own
  discoverable runtime location without introducing a second tracked copy.
- `git diff --check -- tooling/skills AGENTS.md`
- Search for stale unprefixed names when renaming a skill.

Report only the exact scope changed and any remaining stale references.

## Anti-Patterns

Never:

- Add a Peers-Touch skill without the `pt-` prefix.
- Leave `name:` frontmatter different from the directory name.
- Edit a host-private projection instead of `tooling/skills`.
- Add long background sections that do not change agent behavior.
- Hide a skill rename from scripts or quality gates that hardcode the old path.
