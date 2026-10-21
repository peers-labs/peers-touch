# Cross-Client Runtime Architecture

> **Status**: active
> **Version**: v1.3
> **Created**: 2026-10-16 | **Updated**: 2026-10-20
> **Owner**: Client Platform Team
> **Module**: Desktop and Mobile client runtime boundaries

---

## 1. Document Scope

This module defines the authoritative relationship among:

- Desktop, Android, and iOS release targets;
- the Desktop and Mobile client forms;
- portable Rust cores embedded by those clients;
- shared TypeScript logic and policy-neutral UI primitives;
- platform hosts, runtime ports, and presentation policy;
- reuse admission and justified divergence;
- Client-local state, Model contracts, and Station business authority.

It does not own:

- shared business rules or durable cross-device truth, owned by Station;
- shared wire and domain semantics, owned by `model/domain/`;
- page/runtime scheduling, platform lifecycle details, or domain-specific
  portable-core semantics, owned by their respective modules.

## 2. Canonical Relationship

- **Release targets**: Desktop, Android, and iOS.
- **Client forms**: Desktop and Mobile. Android and iOS are hosts of the Mobile
  form, not independent products.
- **Reusable client semantics**: shared headless TypeScript assets and embedded
  portable Rust cores.
- **Runtime authority**: Station owns shared business truth.
- **Contract substrate**: Model owns shared wire meaning and has no runtime
  process.

Desktop, Android, and iOS are three release targets. They are not three
independent product architectures. Android and iOS are two OS hosts for one
Mobile product and must share the same Mobile product state model,
presentation contract, and runtime semantics.

A portable Rust core is an embedded library with one instance/store per
installation, never a service or shared business authority.

The runtime relationship is Client ↔ Station. Proto-first contract authoring
does not place Model between them.

## 3. Reuse Rule

New client capability follows one rule:

```text
reuse existing owner
  -> extend existing shared asset
  -> extract before the second implementation lands
  -> specialize only at Presentation Policy or Platform Host
```

Expected cross-client contracts, protocol/security logic, and product-entity
semantics are shared from the first implementation. A second implementation
with the same semantics is forbidden unless an accepted divergence record
names the variation axis, owner, evidence, and review trigger.

## 4. Orthogonal Variation Axes

Cross-client behavior varies on two independent axes:

1. **Runtime Port**: how the runtime reaches OS, host, storage, network,
   cryptography, clock, notification, and lifecycle capabilities.
2. **Presentation Policy**: how the product maps shared semantics into Desktop
   or Mobile navigation, layout, interaction, and visibility.

OS-specific code implements runtime ports. It must not fork business
semantics. Desktop/Mobile presentation policy may differ even when both use
the same portable core.

## 5. Document Map

| Document | Responsibility |
|---|---|
| [architecture.svg](./architecture.svg) | Canonical reuse topology |
| [design.md](./design.md) | System boundaries, dependency direction, and invariants |
| [decisions.md](./decisions.md) | Accepted architecture decisions |
| [data-model.md](./data-model.md) | Client form, host, core, port, policy, capability, and evidence models |
| [module-layout.md](./module-layout.md) | Current repository mapping and allowed dependency direction |
| [integration.md](./integration.md) | Integration with Model, Station, Frontend Runtime, Desktop, Mobile, and domain cores |
| [reference-analysis.md](./reference-analysis.md) | External architecture evidence used as design input |
| [Unified Client Architecture Plan](./execution-plans/20261017-unified-client-architecture/plan.md) | Candidate implementation graph for platform hosts, portable cores, shared client semantics, and runtime-cell proof; Mobile Applet Kernel remains a separate design dependency |
| [Outcome Comparison](./execution-plans/20261017-unified-client-architecture/outcome-comparison.md) | Human-readable user, product, architecture, technology, and quality/operations effects with evidence-bound actual results |
