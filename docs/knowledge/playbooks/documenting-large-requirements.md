---
kind: playbook
title: Documenting Large Requirements
status: active
owns:
  - AGENTS.md
  - docs/
referenced-by:
  - AGENTS.md
related:
  - docs/README.md
  - docs/global/architecture-document-standard.md
detected: 2026-06-16
---

# Documenting Large Requirements

## When to use

Use this playbook whenever a user request is a module-level demand, architecture-level demand, large feature rebuild, cross-layer capability, major UI / UX workflow redesign, or external-product benchmark implementation.

Examples:

- Rebuild Agent capability with LobeHub as the blueprint.
- Redesign a Desktop module that changes runtime ownership, persistence, service APIs, or page structure.
- Migrate a Station capability into a new domain subserver.
- Add a capability that spans Desktop Web, Desktop Rust, Station, and shared packages.

Do not use this playbook for small bug fixes, local copy changes, or narrow component-only changes unless they modify module ownership or public contracts.

## Pre-conditions

- [ ] Identify the affected domain and platforms.
- [ ] Read `docs/README.md` to find the formal documentation layer.
- [ ] If the work touches Desktop, read `docs/.agent/desktop.md` and its linked source documents.
- [ ] If the work is architecture landing, migration, or domain decomposition, use the architecture execution methodology.

## Steps

1. **Choose the formal docs home** — Pick the highest layer that owns the decision.
   - Cross-layer boundary or capability: `docs/architecture/<domain>/`
   - Desktop-only implementation: `docs/client/desktop/`
   - Station-only implementation: `docs/station/`
   - Coding convention: `docs/global/coding-guide/`
   - Historical research: `docs/context/`

2. **Promote working notes** — If `.trae/documents/` contains useful investigation or a draft plan, convert the durable decisions into `docs/`.
   - `.trae/documents/` may keep the working draft.
   - It must not be the only record of the large requirement.

3. **Write the design document** — The design must define scope, background, target architecture, domain responsibilities, capability requirements, and related documents.
   - Use `docs/global/architecture-document-standard.md` for metadata and structure when creating architecture documents.
   - Prefer a stable module-level file name over a session-specific title.

4. **Write the execution plan** — If delivery spans phases or multiple owners, add an execution plan under the nearest `execution-plans/` directory.
   - Include phases, target files, acceptance criteria, and verification commands.
   - Keep implementation status updated as phases land.

5. **Update discoverability** — Update the nearest `README.md` and, when the document becomes a current source, update `docs/README.md`.
   - A future engineer should find the document from `docs/README.md` without knowing the chat history.

6. **Report formal paths before implementation** — Tell the user where the formal design and execution plan live.
   - Do this before large implementation begins, or immediately when a missing formal doc is discovered.

## Verification

- [ ] `rg -n "<new-doc-name>|<capability-name>" docs/README.md docs/architecture docs/client docs/station` finds the formal document.
- [ ] The nearest directory `README.md` links to the new design or plan.
- [ ] `.trae/documents/` is not the only place containing the durable design.
- [ ] The final response lists the formal docs paths.

## Crosswalks

- This playbook operationalizes `AGENTS.md` Large Requirement Documentation Protocol.
- This playbook keeps `docs/README.md` as the entry point for current source-of-truth documents.
