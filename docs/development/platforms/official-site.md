# Official Site Development

> **Status**: active
> **Scope**: `apps/official-site/`

The official site is the public product website and the user-facing home for
product, roadmap, installation, and architecture presentation. It does not
replace repository engineering documents.

## Read First

1. `apps/official-site/README.md`, when present
2. [Project identity](../../global/project-identity.md)
3. [System architecture](../../global/architecture.md)
4. the product or architecture source represented by the page

Public installation content must remain consistent with
[Release Distribution](../../architecture/engineering/release-distribution/README.md).

## Run

```bash
pnpm --dir apps/official-site run dev
```

## Check

```bash
pnpm --dir apps/official-site run check
pnpm --dir apps/official-site run build
```

Visual or interactive changes also require browser verification at representative
desktop and mobile viewports. Architecture pages must preserve one model across
languages and keep visible claims traceable to current repository sources.

## Boundaries

- The website explains the product; architecture documents own engineering
  contracts.
- English and Chinese pages share structure and interaction state.
- Public download and install links must not claim availability before the
  corresponding verified Release exists.
- Generated images and visual assets remain inspectable and accessible.
