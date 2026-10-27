# EDX-H04: Inspect And Install A Marketplace Package

## Starting Context

The Desktop Marketplace has a verified catalog snapshot containing ordinary,
high-risk and revoked packages. The user opens one package detail before
deciding whether to install it.

## User Goal

Understand package provenance and risk, install only when current policy allows
it, and avoid accidental mutation for a revoked or high-risk package.

## Required Sources

- `apps/desktop/src/pages/marketplace/PackageCard.tsx:42-199`
- `apps/desktop/src/pages/MarketplacePage.tsx:269-355`
- `apps/desktop/src/pages/MarketplacePage.tsx:362-430`
- `apps/desktop/src/pages/MarketplacePage.tsx:475-517`
- `apps/desktop/src/pages/MarketplacePage.tsx:603-710`
- `tooling/acceptance/features/agent-trusted-package-catalog.yaml:1-55`
- `docs/architecture/domains/agent/modern-chat-agent/decisions.md:1571-1668`

## States To Walk

- verified ordinary package;
- high-risk package requiring confirmation;
- user cancels or confirms the high-risk action;
- revoked or policy-blocked package;
- package detail loaded;
- install success or failure;
- catalog source stale or partially unavailable.

## Review Boundary

Review the visible trust, risk, policy, revocation and confirmation journey for
an existing catalog package. Adding a new source, signature implementation,
target-authority persistence and native Gate proof are outside this case.

Return the JSON ReviewResult required by `rubric.md`.
