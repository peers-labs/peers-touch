---
kind: invariant
title: Client UI edits must load UI Identity first
status: active
owns:
  - apps/desktop/src/pages/
  - apps/desktop/src/components/
  - apps/desktop/src/App.tsx
  - apps/mobile/src/
  - packages/prototypes/
  - docs/client/common/ui-identity/
  - docs/client/common/ux-design-methodology.md
  - docs/client/desktop/
  - docs/client/mobile/
referenced-by:
  - docs/client/common/ui-identity/README.md
  - docs/knowledge/playbooks/ux-case-to-contract.md
related:
  - docs/client/common/ui-identity/README.md
  - docs/client/common/ux-design-methodology.md
detected: 2026-06-18
---

# Client UI edits must load UI Identity first

## What must hold

Any agent or human editing client UI code, client UI prototypes, reviewing UI screenshots, designing UI/UX, or fixing layout/boundary/button/style issues MUST read the shared UI Identity contract before proposing or applying changes. For module-specific UI, they MUST also read the closest module contract and relevant shared pattern.

Required baseline:

- `docs/client/common/ux-design-methodology.md`
- `docs/client/common/ui-identity/README.md`
- Relevant `docs/client/common/ui-identity/modules/<module>/`
- Relevant `docs/client/common/ui-identity/patterns/`
- Platform refinement under `docs/client/desktop/` or `docs/client/mobile/` when implementation is platform-specific

## Why this is non-negotiable

Peers Touch UI is not allowed to drift into assembled component-library defaults. Without a loaded UI Identity contract, agents tend to fix visible defects locally: a button becomes black because it "looks primary", a feed card gets another border because the boundary is unclear, or a comment thread becomes a stack of unrelated panels.

Those local choices break product identity. They also make later UX review depend on a human remembering to remind the agent.

The invariant makes UI Identity part of path-based read-before-edit behavior. When known UI paths are edited, the guardrail should be loaded automatically; when the task is screenshot/design-oriented, agents must manually apply the same rule even before choosing files.

## How to verify

- `rg "ui-identity" AGENTS.md docs/.agent docs/client docs/knowledge` — must show agent entry, client docs, and knowledge cross-links.
- `rg "apps/desktop/src/pages/|apps/desktop/src/components/|apps/mobile/src/|packages/prototypes/" docs/knowledge/invariants/client-ui-identity-before-edit.md` — must show existing UI code and prototype paths covered by `owns:`.
- For a Social UI change, the implementation report must cite `docs/client/common/ui-identity/modules/social/README.md` or `docs/client/common/ui-identity/modules/social/desktop.md`.
- For any new client UI module, a module contract must be added or an existing module contract must be cited as intentionally reused.

## Crosswalks

- See `docs/client/common/ui-identity/README.md` for the shared Peers Touch UI Identity.
- See `docs/client/common/ux-design-methodology.md` for how raw UX defects become reusable contracts.
- See `docs/knowledge/playbooks/ux-case-to-contract.md` for the standard workflow.
