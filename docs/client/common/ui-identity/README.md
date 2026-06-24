# Client UI Identity

> Status: Canonical client-level UI identity contract.
> Audience: Product designers, client engineers, reviewers, and AI agents.
> Updated: 2026-06-18.

## 1. Purpose

Peers Touch UI must feel like one product across Desktop, Mobile, Social, Chat, Agent, Applets, Auth, Settings, and Station management.

This directory defines the shared UI identity that every client module inherits before adding module-specific refinements.

It exists because a feature can be functionally correct and still feel assembled from unrelated component libraries. UI identity prevents that drift.

## 2. Position In The Docs Hierarchy

This is a client platform-layer source of truth.

Constraint direction:

```text
docs/architecture/
  -> docs/client/common/ui-identity/
      -> docs/client/common/ui-identity/modules/<module>/
          -> docs/client/desktop/ or docs/client/mobile/
              -> code
```

Rules:

- Architecture documents define product/system boundaries.
- UI Identity defines shared visual, spatial, and interaction language.
- Module UI Identity refines the shared language for domain-specific surfaces.
- Desktop/Mobile documents define platform adaptation only; they must not redefine the product style.
- Code implements the closest applicable contract and must not create one-off styles without updating the contract.

## 3. Peers Touch UI ID

Peers Touch uses **Quiet Protocol Minimalism**:

- Quiet: low-noise surfaces, calm motion, disciplined accent colors.
- Protocol: identity, station, audience, trust, and privacy states are visible when they affect user decisions.
- Minimalism: structure is clear without heavy borders, dashboard chrome, or decorative density.
- Human-first: social and collaboration flows prioritize readable human activity before system metadata.
- Verifiable: UI states expose data source, processing path, and trust boundary when relevant.

## 4. Reading Order

1. [foundations.md](./foundations.md) — product-level UI identity and visual philosophy.
2. [tokens.md](./tokens.md) — shared token decisions for color, radius, spacing, type, border, shadow, and motion.
3. [layout.md](./layout.md) — shell, content rail, page density, and responsive layout rules.
4. [components.md](./components.md) — shared component anatomy and style constraints.
5. [interaction.md](./interaction.md) — state, feedback, loading, failure, and optimistic interaction rules.
6. [accessibility.md](./accessibility.md) — focus, keyboard, contrast, hover, and reduced-motion requirements.
7. [review-checklist.md](./review-checklist.md) — UI review checklist for humans and AI agents.

## 5. Module Contracts

Module contracts live under [modules/](./modules/).

Each module may define:

- Domain-specific visual tone.
- Required information hierarchy.
- Module-specific surfaces and component anatomy.
- Desktop/Mobile refinements when platform behavior differs.
- Acceptance states for incomplete, loading, error, empty, trust, and extreme-data cases.

Current module contracts:

- [Social](./modules/social/README.md) — Human federated social activity, feed, detail, composer, reaction, comments, and moderation states.
- [Auth](./modules/auth/README.md) — Sign-in, account selection, PIN, re-auth, and the federated mesh backdrop as ambient education.

## 6. Shared Patterns

Shared patterns live under [patterns/](./patterns/).

Patterns are reusable surface contracts across modules:

- [feed.md](./patterns/feed.md) — activity feed surfaces.
- [composer.md](./patterns/composer.md) — post, reply, prompt, and message composition surfaces.
- [trust-state.md](./patterns/trust-state.md) — identity, station, audience, moderation, permission, and risk states.

## 7. Implementation Rules

- Use LobeUI first for Desktop UI primitives.
- Use antd only when the component is necessary and visually normalized into this identity.
- Do not mix component-library defaults directly on one surface.
- Do not define raw visual values in page code when a token or shared component rule exists.
- Do not make user-facing UI text outside the i18n system.
- Do not hide trust, audience, station, or privacy state when it changes what the user can safely do.

## 8. AI Agent Checklist

Before editing client UI:

- [ ] Read this file.
- [ ] Read the closest module contract under `modules/`.
- [ ] Read the closest shared pattern under `patterns/`.
- [ ] Identify the page's content bounds, action bounds, and trust-state bounds.
- [ ] Confirm LobeUI-first implementation or document why antd is required.
- [ ] Validate normal, loading, disabled, empty, error, overflow, and narrow-window states.
- [ ] If a screenshot reveals a reusable issue, follow `docs/knowledge/playbooks/ux-case-to-contract.md`.
