# Mobile Social Desktop Parity - Decisions

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-10-06 | **Updated**: 2026-10-06
> **Owner**: Mobile / Social / Client Architecture

---

## Decision Index

| ID | Decision | Status |
|---|---|---|
| MPS-D01 | Parity means semantic user-result parity, not pixel parity | accepted |
| MPS-D02 | One Mobile Social facade owns product projection and intents | accepted |
| MPS-D03 | Station and canonical Proto remain the only business truth | accepted |
| MPS-D04 | Mobile Rust owns security, authenticated transport and durability | accepted |
| MPS-D05 | Public and private Social compose into one experience projection | accepted |
| MPS-D06 | Mobile is Feed-first; only context-changing tasks navigate | accepted |
| MPS-D07 | iOS, Android and Desktop interoperability are all required | accepted |
| MPS-D08 | Cross-Station Social reuses shared Federation delivery only | accepted |
| MPS-D09 | Cutover removes fallback, parallel stores and partial Audience behavior | accepted |
| MPS-D10 | Existing Mobile Shell prototype is amended instead of creating a second shell | accepted |
| MPS-D11 | Verified plaintext may reach Web; private key material may not | accepted |
| MPS-D12 | All canonical content kinds render; authoring is capability-gated | accepted |
| MPS-D13 | Recovery secrets enter through a Native-only secure-input capability | accepted |

## MPS-D01: Semantic Parity

**Status**: accepted
**Date**: 2026-10-06

### Context

Desktop and Mobile have different input, navigation and window constraints.

### Decision

Preserve capability, permission, state, recovery and interoperability outcomes; adapt controls and layout to Mobile.

### Rationale

Users need equivalent results and trust guarantees, not Desktop chrome at phone width.

### Alternatives Considered

Pixel parity was rejected because it imports hover, popover and window patterns that reduce touch and accessibility quality.

### Consequences

Screenshots differ across platforms while receiver-perspective assertions remain identical.

## MPS-D02: One Mobile Social Facade

**Status**: accepted
**Date**: 2026-10-06

### Context

Mobile exposes public Moments gateways and a separate private runtime.

### Decision

One facade composes owner projections and dispatches canonical Social intents.

### Rationale

Pages need one state model while underlying security and lifecycle owners remain separate.

### Alternatives Considered

Page-level branching and two Social stores were rejected because they create split truth and inconsistent recovery.

### Consequences

Facade integration is mandatory before UI parity and adds no new persistence.

## MPS-D03: Station And Proto Truth

**Status**: accepted
**Date**: 2026-10-06

### Context

Audience, Circle, Post and interaction already have canonical owners and Proto contracts.

### Decision

Social, Actor and Conversation Station owners plus `model/domain/` remain authoritative.

### Rationale

Mobile is a projection client and cannot redefine shared business meaning.

### Alternatives Considered

Mobile-specific Audience/Circle models and locally inferred policy were rejected.

### Consequences

Unsupported canonical capability is hidden or explicitly unavailable, never emulated.

## MPS-D04: Rust Security And Transport Owner

**Status**: accepted
**Date**: 2026-10-06

### Context

Web gateways still carry authenticated Social calls while private Social already relies on Rust.

### Decision

All authenticated Social transport crosses typed Tauri commands; Rust owns credentials, private crypto, durable command/draft stores and media handles.

### Rationale

This preserves one security, retry and scope-fencing boundary.

### Alternatives Considered

Direct Web fetch and Web crypto were rejected because they expose credentials/key material and duplicate retry policy.

### Consequences

Existing Web gateway callers require a hard cut; verified plaintext projections may still render in Web.

## MPS-D05: One Experience Projection

**Status**: accepted
**Date**: 2026-10-06

### Context

Privacy is an Audience property, but current Mobile public and private projections are disconnected.

### Decision

Home and Detail join public and private resources by canonical identity into one immutable generation-scoped projection.

### Rationale

Users should not navigate to a separate product to read private content.

### Alternatives Considered

A separate Private Moments tab was rejected because it duplicates feed/detail behavior.

### Consequences

Composition dedupes by Post identity; ordering and ranking remain Station-owned.

## MPS-D06: Mobile-Native Information Architecture

**Status**: accepted
**Date**: 2026-10-06

### Context

Desktop tabs and popovers are not appropriate for phone-width interaction.

### Decision

Home/Explore, Moment reading, comments and replies remain one continuous Feed surface. Image/video uses
a temporary overlay. Search/Profile/Circles and large target/member selection may navigate because they
change task context. Moment Detail is reserved for direct links, notification targets and blocking recovery.
Composer/Audience/Reaction and edits use sheets or dedicated pickers.

### Rationale

This preserves semantics and mobile context while avoiding navigation churn for ordinary reading and
interaction.

### Alternatives Considered

The Desktop four-tab toolbar, desktop popovers, and a child page for every comment/media action were rejected.

### Consequences

Inline thread exclusivity, overlay focus restoration and Feed anchor preservation become explicit Mobile
acceptance alongside the smaller set of true routes.

## MPS-D07: Dual Mobile OS And Interop Proof

**Status**: accepted
**Date**: 2026-10-06

### Context

The current Mobile Shell uses iOS Simulator as canonical proof and defers cross-Station Social.

### Decision

Full parity requires iOS Simulator, one USB-authorized physical Android device,
and all Desktop/iOS/Android two-Station directions. Android Emulator evidence
does not satisfy this Plan Run.

### Rationale

Claiming “Mobile” from iOS-only or same-Station evidence overstates readiness.

### Alternatives Considered

iOS-only canonical proof was retained only for explicit iOS-scoped claims, not aggregate parity.

### Consequences

Missing Android or interop infrastructure blocks the aggregate claim. It parks
only `MPS-RC02`, `MPS-RC05`, `MPS-RC06`, and `MPS-RC07`; dependency-independent
iOS and two-Station cells continue and may establish only an explicit iOS-scoped
claim.

## MPS-D08: No Social-Specific Transport

**Status**: accepted
**Date**: 2026-10-06

### Context

Cross-Station Social already uses the shared Federation outbox/inbox and source authority.

### Decision

Mobile consumes that path through its Home Station and never creates a direct remote client or Social transport.

### Rationale

One transport preserves authentication, ordering, dedupe and failure ownership.

### Alternatives Considered

Mobile direct remote Station reads, P2P and a Social relay were rejected.

### Consequences

Mobile exposes Home Station outage semantics and shared durable replay.

## MPS-D09: Atomic Hard Cut

**Status**: accepted
**Date**: 2026-10-06

### Context

Parallel public/private paths and partial Audience support would preserve split behavior.

### Decision

Each capability switches once to typed Rust ports; old authenticated Web fetch, manual Audience subset and private/public fallback are deleted in the same change.

### Rationale

One target path is easier to prove and prevents permanent compatibility debt.

### Alternatives Considered

Dual dispatch, dual write and permanent adapters were rejected.

### Consequences

Implementation needs fail-closed zero-reference gates and cannot claim partial parity.

## MPS-D10: Amend The Existing Mobile Shell Prototype

**Status**: accepted
**Date**: 2026-10-06

### Context

Social is a first-level capability inside the existing Mobile Shell.

### Decision

Extend `packages/prototypes/mobile/chat/`, move its ledger state through
`pending-review`, and set it to `confirmed` only after explicit Owner approval.

### Rationale

A second isolated Social shell would split navigation, tokens and lifecycle assumptions.

### Alternatives Considered

A new standalone Mobile Social prototype was rejected.

### Consequences

The confirmed baseline remains historical evidence. The Owner confirmed the
Social parity amendment on 2026-10-06, so implementation may use it as the UI
reference while Native proof remains separate.

## MPS-D11: Web Plaintext Boundary

**Status**: accepted
**Date**: 2026-10-06

### Context

The Tauri Web mainline must render private content without receiving long-lived secret material.

### Decision

Rust may publish verified, current-scope plaintext view projections to Web. Root keys, recovery masters, Content PreKey private material, raw grants and credentials never cross.

### Rationale

This preserves one Web UI mainline and one Native security boundary.

### Alternatives Considered

An independent native Social UI and Web-side decryption were rejected.

### Consequences

Teardown and generation fencing must prove plaintext projection removal.

## MPS-D12: Canonical Content Rendering And Capability-Gated Authoring

**Status**: accepted
**Date**: 2026-10-06

### Context

Desktop and the private Social runtime can receive text, image, video, link, poll, repost and location,
while current visible composer controls do not necessarily create every kind.

### Decision

Mobile renders all seven canonical kinds through one public/private content projection. A create action
appears only when the current canonical capability snapshot advertises that operation and its owner is ready.

### Rationale

Read parity must not depend on which client authored a resource, while displaying unsupported creation
controls would promise a path that cannot commit.

### Alternatives Considered

Rendering unknown kinds as text and exposing all canonical create controls unconditionally were rejected
because both hide capability gaps and can lose content semantics.

### Consequences

Unknown kinds fail closed. Acceptance separately proves seven-kind rendering and capability-gated creation.

## MPS-D13: Native-Only Recovery Secret Entry

**Status**: accepted
**Date**: 2026-10-06

### Context

The current Mobile private Social recovery command accepts the 24-word phrase from
TypeScript and exposes the same field through the Web Acceptance registry. This
violates MSP-J06 and MPS-D11 even though Rust zeroizes the value after IPC.

### Decision

Mobile Web submits only the current scope, recovery epoch and Post identity. A
dedicated iOS/Android secure-input plugin presents a masked native control and
returns the phrase once to Mobile Rust. Rust validates the current
Station/PTID/device/generation and recovery-required state before prompting,
validates BIP39, derives and stores the wrapped recovery master, performs the
recovery read, zeroizes the phrase, and returns only a sanitized projection.

The Web Acceptance registry may initiate the operation but cannot accept,
return, serialize or log a phrase or secret handle. An Acceptance build may
bind one process-scoped native secret-channel reference at launch. Appium
invokes a native accessibility action that fills the masked control from that
channel; neither the phrase nor the reference crosses Web or an Appium
send-keys payload, and neither enters evidence. One prompt is active at a time;
cancel, invalid input, stale generation and teardown are typed terminal
outcomes that retain no partial key reference or plaintext.

### Rationale

This keeps the product UI in the existing Web mainline while preserving the
Native secret boundary required by MPS-D04 and MPS-D11.

### Alternatives Considered

- Web password fields, React state and Web secure storage were rejected because
  the phrase still enters JavaScript memory and IPC JSON.
- A raw phrase or opaque phrase handle in the Acceptance action was rejected
  because the Harness would become a secret transport.
- A complete independent native Social recovery screen was rejected because it
  duplicates product UI and violates the one-Web-mainline decision.
- Reusing the permissions or secure-storage plugin was rejected because secret
  entry is neither permission policy nor persistence ownership.

### Consequences

Mobile gains one narrow reusable native secure-input plugin and a Rust-only
plugin handle. The old phrase-bearing TypeScript, Tauri and Acceptance
contracts are deleted atomically. iOS and Android source plus native runtime
evidence are required before recovery parity is proven.
