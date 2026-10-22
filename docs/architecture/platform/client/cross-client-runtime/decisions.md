# Cross-Client Runtime Architecture - Decisions

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-10-16 | **Updated**: 2026-10-20
> **Owner**: Client Platform Team
> **Module**: Desktop and Mobile client runtime boundaries

---

## Decision Index

| ID | Decision | Status |
|---|---|---|
| CCR-D01 | Two client forms and three release targets | accepted |
| CCR-D02 | Portable Rust cores are embedded libraries, not authorities | accepted |
| CCR-D03 | Runtime ports and presentation policy are orthogonal | accepted |
| CCR-D04 | Android and iOS are hosts of one Mobile product | accepted |
| CCR-D05 | Authority follows state meaning, not implementation language | accepted |
| CCR-D06 | Capability facts produce explicit admission projections | accepted |
| CCR-D07 | Internal hard cuts and external compatibility are separate policies | accepted |
| CCR-D08 | Evidence is tracked by capability and runtime cell | accepted |
| CCR-D09 | Reuse-first classification precedes platform implementation | accepted |
| CCR-D10 | Shared extraction happens before the second consumer lands | accepted |
| CCR-D11 | Architecture capability registry is the reuse inventory | accepted |
| CCR-D12 | Parallel implementations require an accepted divergence record | accepted |
| CCR-D13 | Shared UI is headless-first across client forms | accepted |

## CCR-D01: Two client forms and three release targets

**Status**: accepted
**Date**: 2026-10-16

### Context

Desktop, Android, and iOS are separately shipped artifacts, but Android and
iOS consume one Mobile product/runtime tree.

### Decision

Peers Touch has two client forms: Desktop and Mobile. It ships three release
targets: Desktop, Android, and iOS.

### Rationale

Client form captures product/runtime shape; release target captures build,
packaging, distribution, and native proof. Conflating them creates duplicate
Mobile architecture.

### Alternatives Considered

- Three independent client forms: rejected because Android and iOS share one
  Mobile product contract.
- One universal client form: rejected because Desktop and Mobile have distinct
  lifecycle and presentation policy.

### Consequences

- Android and iOS do not become independent top-level client architectures.
- Build, signing, packaging, provider, and native integration evidence remain
  release-target specific.
- Product navigation groups Android and iOS under Mobile.

## CCR-D02: Portable Rust cores are embedded libraries, not authorities

**Status**: accepted
**Date**: 2026-10-16

### Context

Desktop and Mobile already consume reusable Rust libraries, but library reuse
can be mistaken for a third runtime service or a new authority layer.

### Decision

A portable Rust core is linked into a client runtime and called through a
typed boundary. It is not a daemon, sidecar, network service, product shell,
or cross-device business authority.

### Rationale

Embedded libraries share difficult semantics without introducing deployment,
network, or split-authority complexity.

### Alternatives Considered

- Shared local daemon: rejected because it changes deployment and failure
  topology.
- Duplicate per-client implementations: rejected for security/protocol logic
  where semantic drift is material.

### Consequences

- Every client installation owns an independent core instance and local store.
- Station remains the only owner of shared business outcomes.
- Core APIs are designed as library contracts with explicit runtime ports.

## CCR-D03: Runtime ports and presentation policy are orthogonal

**Status**: accepted
**Date**: 2026-10-16

### Context

Platform capability differences and Desktop/Mobile interaction differences
change for different reasons and have different owners.

### Decision

Platform capability adaptation and product presentation are independent axes.
Runtime ports adapt host capabilities. Presentation policy adapts interaction
and layout for Desktop or Mobile.

### Rationale

Separating the axes permits shared semantics with platform-specific capability
adapters and product-form-specific interaction.

### Alternatives Considered

- One platform abstraction that owns both: rejected because it couples OS APIs
  to product UX.
- Identical presentation on every target: rejected because Desktop and Mobile
  interaction constraints differ.

### Consequences

- Android/iOS adapters cannot define separate Mobile product semantics.
- Shared core reuse does not require Desktop and Mobile UI identity.
- OS host work and product presentation work can be reviewed independently.

## CCR-D04: Android and iOS are hosts of one Mobile product

**Status**: accepted
**Date**: 2026-10-16

### Context

Separate Android and iOS hosts are necessary, but separate feature/state trees
would create product drift.

### Decision

Mobile has one product state model, lifecycle contract, navigation model, and
acceptance contract. Android and iOS provide OS-specific hosts and runtime
ports.

### Rationale

One Mobile contract preserves product consistency while keeping OS integration
and release proof honest.

### Alternatives Considered

- Independent Android/iOS products: rejected because it duplicates product and
  runtime authority.
- Hide platform gaps behind fallback success: rejected because it makes
  readiness claims unverifiable.

### Consequences

- A feature is not Mobile-complete until every required OS cell is proven.
- Platform degradation must be explicit in capability/admission state.
- Shared Mobile code remains the default; native divergence needs a capability
  boundary and owner.

## CCR-D05: Authority follows state meaning, not implementation language

**Status**: accepted
**Date**: 2026-10-16

### Context

Rust, native code, and durable local storage can each appear authoritative even
when the represented state has narrower scope.

### Decision

Ownership is assigned from the semantic scope of state:

- Model owns shared contract meaning.
- Station owns shared business truth.
- A portable core owns its device-local protocol or security state.
- A client runtime owns device-local orchestration and projections.
- A host owns observations about OS capabilities.

### Rationale

Semantic scope gives a stable ownership rule across language and storage
changes.

### Alternatives Considered

- Language-based ownership: rejected because implementation language is not a
  state contract.
- Persistence-based ownership: rejected because local durability does not
  create cross-device truth.

### Consequences

Rust does not imply authority. Native code does not imply product ownership.
Durable local state does not imply shared business truth.

## CCR-D06: Capability facts produce explicit admission projections

**Status**: accepted
**Date**: 2026-10-16

### Context

Raw permission and plugin values do not include Station policy, runtime
readiness, or product degradation rules.

### Decision

Hosts emit typed capability facts. Client runtime policy combines those facts
with runtime readiness, Station policy, and product policy to produce an
`AdmissionProjection` for presentation.

### Rationale

An explicit projection keeps host observation separate from product decision
and makes unknown/degraded behavior testable.

### Alternatives Considered

- UI reads raw permission state: rejected because admission logic fragments.
- Plugin decides feature availability: rejected because plugins do not own
  product or Station policy.

### Consequences

- UI does not infer eligibility from raw permission or plugin values.
- Unknown, stale, denied, unsupported, and degraded states remain distinct.
- Capability evidence can be traced from host observation to visible behavior.

## CCR-D07: Internal hard cuts and external compatibility are separate policies

**Status**: accepted
**Date**: 2026-10-16

### Context

Internal ownership cleanup and released wire/data compatibility have different
consumers and failure costs.

### Decision

Internal ownership changes replace the old path completely. External wire,
persisted-data, deep-link, and released plugin compatibility is preserved or
migrated through an explicit versioned policy.

### Rationale

Internal dual paths create split authority, while external contracts may
require migration windows that cannot be removed atomically.

### Alternatives Considered

- Preserve every old internal path: rejected because it creates permanent
  duplicate owners.
- Hard-break all external data/wire contracts: rejected because released
  consumers and persisted state require explicit migration.

### Consequences

- No internal dual-write, duplicate owner, or permanent compatibility facade.
- Data migrations and wire compatibility remain first-class delivery work.
- Git history carries obsolete architecture descriptions; active documents do
  not.

## CCR-D08: Evidence is tracked by capability and runtime cell

**Status**: accepted
**Date**: 2026-10-16

### Context

Shared source, simulator, emulator, packaged, and physical runs prove different
behavior. Evidence is not transferable across OS hosts.

### Decision

Every support or readiness claim binds to:

```text
capability x release target x runtime mode x source revision
```

### Rationale

The cell identity prevents a narrow test from being promoted into a wider
platform or product claim.

### Alternatives Considered

- One aggregate Mobile pass/fail bit: rejected because it hides missing
  platform cells.
- Shared-core tests as release proof: rejected because they do not execute host
  integration.

### Consequences

- Android, iOS, Desktop development, and Desktop packaged proof are distinct.
- Portable-core tests do not prove host integration.
- Missing, mismatched, or stale evidence is `UNPROVEN`.
- A whole-Mobile claim requires every required Android and iOS cell.

## CCR-D09: Reuse-first classification precedes platform implementation

**Status**: accepted
**Date**: 2026-10-17

### Context

Desktop and Mobile share React/TypeScript and Rust, but language similarity
alone does not determine whether a contract, runtime, component, or adapter
should be shared.

### Decision

Every new client capability is classified across independent placement axes
before a platform implementation is created:

- cross-process or cross-device contract boundary: Model contract;
- host-neutral protocol, security, state, or persistence: portable Rust core;
- renderer-neutral client semantics: shared TypeScript core;
- policy-neutral entity anatomy and actions: shared UI primitive;
- Desktop/Mobile interaction differences: Presentation Policy;
- OS capability and lifecycle differences: Platform Host adapter.

These axes are not an ordered runtime stack. A capability may require artifacts
on multiple axes while each semantic decision retains one canonical owner.

### Rationale

The classification places semantics at the narrowest canonical owner whose
lifecycle and variation axis match the behavior, while keeping real
product-form and OS differences explicit. It prevents contract authoring order
from being mistaken for runtime topology or visual priority.

### Alternatives Considered

- Let the first platform choose placement: rejected because repository layout
  would depend on delivery order.
- Share everything using the common language: rejected because common syntax
  does not imply common lifecycle or presentation semantics.

### Consequences

- New client work must identify its reuse-layer disposition.
- Review rejects unclassified platform-local implementations.
- Cross-runtime features may require a shared contract before consuming
  implementations, but that authoring dependency does not make Model a runtime
  intermediary.

## CCR-D10: Shared extraction happens before the second consumer lands

**Status**: accepted
**Date**: 2026-10-17

### Context

Waiting until two complete implementations exist makes extraction expensive and
allows behavior to drift.

### Decision

A second consumer must reuse or extract the canonical shared asset before
merge. Cross-client contract, identity, protocol, security, persistence, and
state-machine semantics are shared from the first implementation when their
cross-client scope is already known.

### Rationale

This prevents duplication without forcing speculative abstractions for
single-owner implementation details.

### Alternatives Considered

- Extract after duplication appears: rejected because the duplicate already
  creates two behavior owners.
- Extract every first implementation: rejected because local mechanics may
  never gain a second semantic consumer.

### Consequences

- The second consumer carries extraction work when no canonical asset exists.
- First implementations with accepted cross-client scope cannot remain
  platform-local.
- Local code may stay local only while its semantics and consumer scope remain
  local.

## CCR-D11: Architecture capability registry is the reuse inventory

**Status**: accepted
**Date**: 2026-10-17

### Context

Creating a separate package catalog would duplicate owner, contract-root,
consumer, dependency, and evidence data already modeled by architecture
governance.

### Decision

`architecture-modules.json` is the sole positive registry for reusable client
capabilities. Workspace manifests are implementation evidence. Governance
derives Desktop/Mobile shared direct dependencies and fails when no registered
capability covers their canonical package or crate.

### Rationale

One registry keeps architecture ownership and package reuse synchronized and
avoids a second manually maintained inventory.

### Alternatives Considered

- Add a standalone shared-package registry: rejected because it would duplicate
  architecture capability ownership.
- Rely on workspace manifests only: rejected because manifests do not identify
  semantic owner, contract roots, or evidence.

### Consequences

- Reusable package manifests and consuming app manifests become governed paths.
- A shared direct dependency without capability registration fails closed.
- Transitive and third-party dependencies remain package-manager concerns.

## CCR-D12: Parallel implementations require an accepted divergence record

**Status**: accepted
**Date**: 2026-10-17

### Context

Some implementations legitimately differ by product form or OS, but an
unstructured exception becomes permanent duplication.

### Decision

An ordinary Desktop/Mobile shell or Desktop/Android/iOS adapter needs no
per-adapter record when it implements one shared Presentation Policy or runtime
port contract without changing semantics. Any parallel semantic implementation
outside those contracts requires an accepted `DivergenceRecord` naming the
canonical capability, variation axis, implementation capabilities/roots,
consumers, evidence, and review/deletion trigger. Each implementation
capability explicitly depends on the canonical capability. The accepted
decision owns the semantic justification;
`architecture-modules.json.reuseDivergences` carries its
machine-validated projection beside the capability inventory.

### Rationale

The record keeps intentional specialization distinguishable from accidental
duplication and puts the proof burden on the fork.

### Alternatives Considered

- Allow platform teams to document exceptions locally: rejected because no
  cross-client reviewer can discover or compare them.
- Prohibit all parallel implementations: rejected because Presentation Policy
  and OS capability behavior genuinely differ.

### Consequences

- Schedule, team ownership, and language preference cannot justify a fork.
- Permanent divergence still requires a review trigger.
- Unregistered parallel semantic owners or behavior are architecture defects.
- Removing, moving, or superseding a divergence updates or deletes its registry
  record in the same change.

## CCR-D13: Shared UI is headless-first across client forms

**Status**: accepted
**Date**: 2026-10-17

### Context

Desktop and Mobile both use React, but layout density, navigation, focus,
gesture, keyboard, safe-area, and window semantics differ.

### Decision

Product-entity semantics, state derivation, actions, accessibility labels,
tokens, and stable markers are shared first. A React component is shared only
when its anatomy and interaction contract are policy-neutral; otherwise
Desktop and Mobile compose separate shells over the shared headless asset.
Android and iOS always consume the same Mobile component tree.

### Rationale

Headless-first reuse removes duplicated product logic without forcing Desktop
and Mobile into one compromised presentation.

### Alternatives Considered

- Share all React components: rejected because presentation policy would leak
  into condition-heavy universal components.
- Share only visual tokens: rejected because entity semantics and actions would
  still be duplicated.

### Consequences

- `packages/ui/desktop` remains Desktop-specific.
- A cross-client UI package is admitted only with two policy-neutral consumers.
- Entity identity can be shared even when its Desktop/Mobile shell is not.
