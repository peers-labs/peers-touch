# Cross-Client Runtime Architecture - Integration

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-10-16 | **Updated**: 2026-10-17
> **Owner**: Client Platform Team
> **Module**: Desktop and Mobile client runtime boundaries

---

## 1. Integration Order

```text
Model contracts
  -> Station business behavior
  -> portable core semantics
  -> Desktop/Mobile Rust composition
  -> platform host adapters
  -> runtime and admission projections
  -> Desktop/Mobile presentation
```

This is a dependency and authority order, not a startup sequence.

## 2. Model Integration

`model/domain/` owns any semantic type that crosses Station, client,
installation, or process boundaries.

Portable cores may maintain internal types optimized for protocol or security
logic. Boundary conversion must be explicit and cannot redefine the Model
meaning.

Required properties:

- generated contract consumption;
- no hand-maintained cross-client DTO twin;
- unknown enum/field behavior follows contract compatibility policy;
- core-local schema versions remain separate from wire-contract versions.

## 3. Station Integration

Station owns:

- authentication and authorization;
- shared domain policy and state transitions;
- federation and cross-device convergence;
- durable shared state and audit;
- server-side idempotency and externally visible outcomes.

Client cores and runtimes may stage, encrypt, queue, cache, or reconcile work.
They cannot convert a local outcome into a shared success before Station
confirms it.

## 4. Frontend Runtime Integration

[Frontend Runtime](../frontend-runtime/README.md) owns page/runtime lifecycle,
work admission, projection freshness, and interaction evidence.

Cross-Client Runtime adds:

- which client form or release target hosts that runtime;
- which portable core and runtime ports it composes;
- how capability facts become admission projections;
- which runtime cell must prove a product claim.

The two modules share concepts but do not duplicate owners. Frontend Runtime
does not decide Android/iOS product structure. Cross-Client Runtime does not
own page scheduling.

## 5. Desktop Integration

Desktop composes:

- Desktop presentation policy in `apps/desktop/src/`;
- Tauri Desktop host/runtime in `apps/desktop/src-tauri/`;
- portable Rust libraries through Cargo dependencies;
- Desktop-specific ports for keyring, windowing, notifications, filesystem,
  shortcuts, and process lifecycle.

Desktop-specific capability does not enter a portable core unless it can be
expressed as a narrower host-neutral semantic port.

Desktop development and packaged evidence remain distinct runtime cells.

## 6. Mobile Integration

Mobile composes:

- one shared Mobile presentation/runtime tree in `apps/mobile/src/`;
- one shared Mobile Rust runtime in `apps/mobile/src-tauri/src/`;
- Android and iOS host projects under `apps/mobile/src-tauri/gen/`;
- typed native capability plugins under `apps/mobile/src-tauri/plugins/`;
- portable Rust libraries through Cargo dependencies.

Android and iOS adapters must return the same capability fact shape and feed
the same Mobile admission/runtime projection. Platform-specific absence,
restriction, or lifecycle behavior is represented as data, not hidden behind a
false success path.

## 7. Portable Core Integration

Each portable core integration must identify:

- semantic owner;
- public library API;
- required runtime ports;
- local persistence and migration owner;
- generated Model contract inputs;
- Station interaction boundary;
- Desktop adapter;
- Mobile adapter;
- per-runtime-cell evidence.

`messaging-core` and `secure-content-core` are domain mechanism examples. Their
business and protocol decisions remain governed by their owning architecture
modules, especially [Messaging Platform](../../../domains/chat/messaging/README.md).

For Messaging, Desktop and Mobile compose the same `messaging-core` lifecycle,
inbox, outbox, reconciliation, receipt, recovery and attachment mechanisms.
Both Hosts also use `messaging-native-filesystem` for physical file facts and
actions. SQLCipher connections, concrete Station transports, native key/blob
access, event-loop scheduling and OS callbacks remain Host adapters.

For Secure Content, Desktop and Mobile compose the same
`secure-content-core` operation, PreKey, readback, recovery-continuation and
object-transfer mechanisms. Each Host keeps its SQLCipher schema adapter,
Station transport, file adapter, key-material source and lifecycle binding.
Desktop Moment/Comment and Mobile private Social business orchestration remain
Social-owned. UCA-05 deleted both legacy workers and removed Mobile Social's
manual chunk loop; `secure-content-owner-hard-cut-zero` is the source gate.
Signed iOS and physical Android behavior remains a separate runtime-cell proof.

## 8. Shared TypeScript And UI Integration

Current Desktop/Mobile shared direct TypeScript packages:

| Capability | Canonical package | Current shared semantics | Consumers |
|---|---|---|---|
| Chat/client headless semantics | `packages/client-chat-core/` | IM projection, wire codec, selector, composer admission, Chat Storage scope/reconciliation/retry | Desktop + Mobile |
| Client media-security policy | `packages/client-media-security/` | media descriptor codec, chunked encryption/decryption and commitment validation | Desktop + Mobile |
| Client storage contracts/helpers | `packages/client-storage/` | domain/scope registry, envelope codec, scoped keys and repositories | Desktop + Mobile |

`ChatStorageProjectionRuntime` is the only owner of Chat Storage measurement,
stale retention, cleanup/retention transitions, reconciliation cadence and
scope-fenced batch behavior. Desktop and Mobile bind transport, scope capture,
lifecycle and Acceptance invalidation through narrow ports; their wrappers do
not reimplement the state machine.

Wire scalar/timestamp/bytes normalization is owned by `client-chat-core`.
Desktop and Mobile DTO adapters may select different generated Model targets,
but cannot maintain separate scalar codecs. Media encryption descriptor
normalization is similarly owned by `client-media-security`.

Current visual package status:

- `packages/ui/desktop/` is Desktop-only and must not be presented as a
  cross-client UI library.
- Mobile owns its current visual composition under `apps/mobile/src/`.
- Desktop Chat geometry/composer profiles live in
  `apps/desktop/src/components/chat/chatPresentationPolicy.ts`; Mobile Chat
  equivalents live in `apps/mobile/src/pages/chat/chatPresentationPolicy.ts`.
- UI Identity defines shared product-entity anatomy and tokens, but a canonical
  cross-client implementation package does not yet exist.

New shared UI work therefore uses this order:

```text
shared entity/action semantics
  -> shared TypeScript headless asset
  -> Desktop shell + Mobile shell
  -> shared React primitive only when policy-neutral
```

Android and iOS consume the same Mobile shell; they do not create OS-specific
React component libraries.

`unified-client-shared-semantics` proves the canonical declarations,
production consumers, registry coverage and absence of Form-policy markers or
Host/UI framework imports in shared packages. It is source-only evidence and
does not replace native runtime cells.

## 9. Native Capability Integration

Canonical flow:

```text
OS API
  -> native plugin adapter
  -> typed Rust host boundary
  -> CapabilityFact
  -> runtime policy
  -> AdmissionProjection
  -> Mobile presentation
```

For operations with side effects:

```text
User intent
  -> presentation action
  -> runtime admission
  -> portable core or Station command
  -> typed host port when required
  -> result/reconciliation projection
```

Native callbacks never mutate product stores directly.

## 10. Evidence Gates

This module defines the following architecture gate identities:

| Gate | Requirement |
|---|---|
| CCR-G01 | Client form and release target mapping is explicit |
| CCR-G02 | Portable core has no host/UI dependency |
| CCR-G03 | Runtime ports are typed and capability-scoped |
| CCR-G04 | Authority records cover all durable state |
| CCR-G05 | Android and iOS consume one Mobile product contract |
| CCR-G06 | Capability facts feed explicit admission projections |
| CCR-G07 | External data/wire compatibility has a versioned policy |
| CCR-G08 | Required capability-by-runtime evidence cells are source-bound |
| CCR-G09 | Every Desktop/Mobile shared direct workspace dependency has a registered capability owner and canonical root |
| CCR-G10 | A second semantic consumer reuses or extracts the canonical asset before merge |
| CCR-G11 | Shared UI keeps Desktop/Mobile Presentation Policy outside policy-neutral primitives |
| CCR-G12 | Every parallel semantic implementation outside a shared policy/port contract has an accepted current divergence record and review trigger |

These are architecture gates. Existing product/build gates provide evidence
for individual cells; this document does not claim that a generic Android or
iOS build gate already exists. `CCR-G09` is enforced by architecture registry
validation. `CCR-G12` additionally requires every accepted record to pass the
registry's path/capability/decision validation. `CCR-G10..CCR-G12` still
require semantic review because deterministic source rules cannot decide
whether two implementations mean the same thing or whether a variation is
justified without false positives.

## 11. Change Review

A change crosses this architecture boundary when it:

- introduces a reusable client Rust library;
- introduces a reusable TypeScript package or shared UI primitive;
- adds a second Desktop/Mobile consumer for existing local semantics;
- changes Desktop/Mobile core composition;
- adds or changes a native plugin;
- creates platform-specific feature state;
- changes local persistence shared by a portable core;
- changes a capability fact or admission projection;
- makes a whole-Desktop, whole-Mobile, Android, or iOS readiness claim.

Review must identify the authority owner, variation axis, affected runtime
cells, reuse disposition, candidate canonical assets, and evidence status
before merge readiness can be claimed. A new parallel implementation without a
divergence record is rejected even when both implementations pass tests.
