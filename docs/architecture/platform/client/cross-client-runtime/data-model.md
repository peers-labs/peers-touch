# Cross-Client Runtime Architecture - Data Model

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-10-16 | **Updated**: 2026-10-20
> **Owner**: Client Platform Team
> **Module**: Desktop and Mobile client runtime boundaries

---

## 1. Client Form and Release Target

```ts
type ClientFormId = 'desktop' | 'mobile';
type ReleaseTargetId = 'desktop' | 'android' | 'ios';

interface ClientForm {
  id: ClientFormId;
  presentationPolicy: 'desktop' | 'mobile';
  releaseTargets: readonly ReleaseTargetId[];
}
```

Canonical values:

```text
desktop -> [desktop]
mobile  -> [android, ios]
```

`ReleaseTargetId` identifies build, packaging, signing, distribution, and
native evidence. It does not create a separate product state model.

## 2. Reusable Asset

```ts
type ReuseLayer =
  | 'model-contract'
  | 'portable-rust-core'
  | 'shared-ts-core'
  | 'shared-ui-primitive'
  | 'presentation-policy'
  | 'platform-adapter';

interface ReusableAsset {
  capabilityId: string;
  layer: ReuseLayer;
  semanticOwner: string;
  canonicalRoots: readonly string[];
  consumers: readonly string[];
  allowedDependencies: readonly string[];
  evidenceGates: readonly string[];
}
```

`ReuseLayer` is a classification label, not an ordered stack. In particular,
`model-contract` denotes a cross-runtime schema boundary, not a runtime above
the consuming clients or Station.

Rules:

- `capabilityId` is globally unique in architecture governance.
- `canonicalRoots` identify one current implementation owner.
- `consumers` are explicit; import presence alone does not grant ownership.
- Model and Station capabilities remain owned by their domain modules.
- Presentation policy and platform adapters are reusable assets only within
  their declared variation axis.

## 3. Platform Host

```ts
interface PlatformHost {
  releaseTarget: ReleaseTargetId;
  processModel: 'tauri-desktop' | 'tauri-mobile';
  owns: readonly [
    'process-lifecycle',
    'plugin-registration',
    'os-callbacks',
    'packaging',
    'release-identity',
  ];
  ports: readonly RuntimePortBinding[];
}
```

The host is an adapter boundary. It does not own Model contracts, Station
policy, or cross-device business state.

## 4. Portable Core

```ts
interface PortableCoreDescriptor {
  id: string;
  semanticOwner: string;
  crateRoots: readonly string[];
  contractInputs: readonly string[];
  requiredPorts: readonly RuntimePortId[];
  localStore?: LocalStoreDescriptor;
  consumers: readonly ClientFormId[];
}

interface LocalStoreDescriptor {
  scope: 'device-installation' | 'signed-in-identity';
  encryption: 'required' | 'not-applicable';
  schemaOwner: string;
  migrationOwner: string;
}
```

Rules:

- A core descriptor identifies an embedded library boundary.
- `consumers` declares intended reuse, not proof of integration.
- A local store is never shared directly across installations.
- Cross-device convergence uses Station protocols.

## 5. Runtime Port

```ts
type RuntimePortId =
  | 'clock'
  | 'random'
  | 'network'
  | 'secure-storage'
  | 'file-storage'
  | 'key-material'
  | 'notifications'
  | 'background-execution'
  | 'deep-link'
  | 'lifecycle'
  | 'telemetry';

interface RuntimePortBinding {
  port: RuntimePortId;
  contractOwner: string;
  adapterOwner: string;
  releaseTarget: ReleaseTargetId;
  availability: 'required' | 'optional' | 'unsupported';
}
```

Ports are capability-shaped. They must not expose a generic command runner,
untyped JSON tunnel, global host object, or unrestricted FFI handle.

## 6. Presentation Policy

```ts
interface PresentationPolicy {
  id: 'desktop' | 'mobile';
  owns: readonly [
    'navigation',
    'layout',
    'interaction',
    'visibility',
    'platform-degradation-copy',
  ];
  consumes: readonly [
    'runtime-projections',
    'admission-projections',
    'station-policy',
  ];
}
```

Android and iOS use the `mobile` policy. Host-specific visual components are
allowed only when required by an OS capability or platform convention and must
preserve the same Mobile product state transition.

## 7. Capability Fact

```ts
type CapabilityFactState =
  | 'available'
  | 'unavailable'
  | 'denied'
  | 'restricted'
  | 'unsupported'
  | 'unknown';

interface CapabilityFact {
  capability: string;
  releaseTarget: ReleaseTargetId;
  state: CapabilityFactState;
  observedAt: string;
  source: string;
  detail?: string;
}
```

Capability facts are observations. They do not grant business permission.

## 8. Admission Projection

```ts
type AdmissionState =
  | 'available'
  | 'degraded'
  | 'blocked'
  | 'unknown';

interface AdmissionProjection {
  capability: string;
  state: AdmissionState;
  reasons: readonly string[];
  facts: readonly CapabilityFact[];
  stationPolicyRevision?: string;
  runtimeRevision: string;
  evaluatedAt: string;
}
```

Rules:

- `unknown` facts cannot produce `available`.
- A denied OS permission and a Station policy denial remain distinguishable.
- Presentation consumes the projection and does not reimplement admission.

## 9. Authority Record

```ts
type AuthorityLayer =
  | 'model'
  | 'station'
  | 'portable-core'
  | 'client-runtime'
  | 'platform-host'
  | 'presentation-policy';

interface AuthorityRecord {
  stateId: string;
  authority: AuthorityLayer;
  scope: 'shared-contract' | 'cross-device' | 'device-local' | 'observation';
  owner: string;
  persistence?: string;
  reconciliation?: string;
}
```

Every durable state introduced by a client module must be classifiable by this
record. Ambiguous authority is an architecture defect.

Secure Content authority mapping:

```text
operation state/lease/readback decision -> portable-core / secure-content-core
object transfer checkpoint             -> portable-core / secure-content-core
encrypted row and descriptor bytes     -> client-runtime Host store adapter
audience/grant/resource outcome         -> station / Social
visible publish/read projection         -> client-runtime / Social runtime
```

The Host may persist a portable record but cannot redefine its transition.

## 10. Reuse Admission

```ts
type ReuseDisposition =
  | 'reuse'
  | 'extend'
  | 'extract'
  | 'form-specialize'
  | 'host-specialize';

interface ReuseAdmission {
  requestedCapability: string;
  candidates: readonly string[];
  disposition: ReuseDisposition;
  selectedCapabilityId: string;
  targetRoot: string;
  consumers: readonly string[];
  divergenceDecisionId?: string;
}
```

Validation rules:

- `candidates` comes from architecture capabilities and workspace manifests.
- `reuse` and `extend` target an existing canonical root.
- `extract` completes before the second consumer merges.
- `form-specialize` is limited to Desktop/Mobile Presentation Policy.
- `host-specialize` is limited to Desktop/Android/iOS host or port behavior.
- A parallel target requires `divergenceDecisionId`.

### 10.1 Shared TypeScript semantic record

```ts
interface SharedClientSemantic {
  capabilityId:
    | 'client.chat.headless'
    | 'client.media-security.headless'
    | 'client.storage.headless';
  ownerRoot: string;
  semantics: readonly (
    | 'projection'
    | 'selector'
    | 'codec'
    | 'storage-scope'
    | 'reconciliation'
    | 'retry'
    | 'capability-admission'
  )[];
  consumers: readonly ['desktop', 'mobile'];
  presentationOwners?: readonly [
    'client.chat.presentation.desktop',
    'client.chat.presentation.mobile',
  ];
}
```

The record is projected through `architecture-modules.json`; it is not a
second registry. A Form wrapper may bind Host transport, lifecycle and
geometry, but shared transition, codec, selector or retry semantics remain in
the registered `client-*` owner.

## 11. Divergence Record

```ts
type DivergenceAxis =
  | 'presentation-policy'
  | 'os-capability'
  | 'runtime-constraint'
  | 'security-boundary';

interface DivergenceRecord {
  capabilityId: string;
  axis: DivergenceAxis;
  canonicalRoot: string;
  implementations: readonly {
    capabilityId: string;
    root: string;
    consumers: readonly string[];
    evidenceGates: readonly string[];
  }[];
  rationale: string;
  decisionId: string;
  reviewTrigger: string;
}
```

Canonical persistence:

```text
docs/architecture/engineering/architecture-governance/
  architecture-modules.json -> reuseDivergences[]
```

Validation rules:

- an adapter or shell that implements one shared port/policy contract is not a
  semantic divergence;
- one of the accepted axes must explain the difference;
- the record cannot introduce a second business or contract authority;
- each implementation has its own registered capability whose dependencies
  include the canonical capability;
- every implementation root directly binds its consumers and evidence cells;
- implementation roots and consumers have registered architecture owners;
- implementation roots, consumers, and evidence Gates are covered by that
  implementation capability;
- evidence Gate IDs also resolve through the Acceptance Gate registry;
- review trigger is mandatory even for permanent platform divergence;
- removing the differentiating constraint deletes the parallel implementation.
- `capabilityId`, `canonicalRoot`, paths, and `decisionId` are validated against
  the current architecture registry.

## 12. Evidence Cell

```ts
type EvidenceStatus = 'PROVEN' | 'UNPROVEN' | 'FAILED' | 'STALE';
type RuntimeMode =
  | 'desktop-native-dev'
  | 'desktop-packaged'
  | 'android-native'
  | 'ios-native';

interface ClientEvidenceCell {
  capability: string;
  releaseTarget: ReleaseTargetId;
  runtimeMode: RuntimeMode;
  sourceRevision: string;
  status: EvidenceStatus;
  gateId: string;
  artifacts: readonly string[];
  observedAt?: string;
}
```

Validation rules:

- `releaseTarget` and `runtimeMode` must agree.
- Artifacts must bind to `sourceRevision`.
- A cell cannot inherit status from another release target.
- An absent cell is `UNPROVEN`.
- A Mobile-wide claim is an aggregate over required Android and iOS cells.
