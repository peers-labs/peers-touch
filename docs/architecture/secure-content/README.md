# Secure Content

> **Status**: active
> **Version**: v1.6
> **Created**: 2026-09-13 | **Updated**: 2026-10-04
> **Owner**: Architecture Team
> **Module**: `model/domain/secure_content/`, `packages/secure-content-core/`, `apps/station/app/internal/securecontent/`

---

## 1. Document Scope

This document set defines:

- the reusable client cryptography and Station validation/state-machine kernel for
  end-to-end encrypted content;
- the boundary between domain authorization and shared encryption/byte-transfer
  mechanics;
- canonical payload, object, key-envelope, upload, grant, and recovery contracts;
- the Social Private Moments integration and the Chat attachment migration;
- the hard-cut obligations that remove Social's bespoke media crypto and the
  Chat-namespaced generic crypto/validation implementation while retaining
  Conversation-owned object authority.

This document set does not define:

- Social audience semantics or user journeys, which are owned by
  [`../social/product-definition.md`](../social/product-definition.md);
- Conversation membership, ordering, receipts, or message encryption;
- Actor Device lifecycle or Key Exchange authority;
- physical OSS backend implementation;
- implementation phases, which require an accepted architecture and a separate
  execution plan.

## 2. Verified Problem

Current source has reusable primitives but not a reusable security boundary:

- `messaging-core` owns mature chunk encryption, descriptor validation, transfer
  checkpoints, and private-content codecs under Chat-specific protobuf types.
- Social duplicates chunk encryption in Desktop `oss.rs`.
- Social seals media keys through the WebRTC signaling envelope instead of a
  content-key contract.
- private Post bodies and comments are plaintext in Station storage.
- Social uploads private media ciphertext with `public` OSS visibility.
- authorized Post responses carry full audience key-envelope and custom-recipient
  metadata.
- public-readable Social point GET routes do not parse optional JWT identity.

The result is partial cryptographic reuse with separate lifecycle, authorization,
wire, storage, and recovery behavior.

## 3. Design Goals

1. One portable implementation for encrypted payloads and large opaque objects.
2. Social and Conversation retain their own object sessions, grants, persistence,
   transactions, audit, and public API ownership.
3. One stateless Station kernel supplies shared validation and state transitions
   without becoming another authority.
4. Station and OSS never receive private content plaintext or content keys.
5. Every recipient response is scoped to the authenticated actor and device.
6. Public and private content remain physically and behaviorally distinct.
7. Desktop and Mobile Native runtimes use the same core; Desktop has no browser runtime.
8. Old Social and Chat generic-crypto paths are deleted in one governed hard cut.

## 4. Documents

| Document | Purpose |
|---|---|
| [design.md](./design.md) | Ownership, trust boundaries, runtime topology, flows, APIs, and failure semantics |
| [decisions.md](./decisions.md) | Proposed architecture decisions and rejected alternatives |
| [data-model.md](./data-model.md) | Proto shapes, persistence model, state machines, and cryptographic bindings |
| [integration.md](./integration.md) | Social, Conversation, Identity, Key Exchange, Recovery, OSS, and client integration |
| [module-layout.md](./module-layout.md) | Target source layout, dependency direction, and deletion ownership |
| [security.md](./security.md) | Threat model, suites, one-time PreKeys, envelope binding, recovery, and secret handling |
| [operations.md](./operations.md) | Transaction ownership, retry, bounds, performance, observability, and hard-cut inventory |
| [execution-plans/20260913-secure-content-hard-cut/plan.md](./execution-plans/20260913-secure-content-hard-cut/plan.md) | Dependency-backed hard-cut plan, workstream status, acceptance scenarios, and conflict controls |
| [execution-plans/20260913-secure-content-hard-cut-review-prompt.md](./execution-plans/20260913-secure-content-hard-cut-review-prompt.md) | Independent PLAN review contract |
| [execution-plans/20260914-recovery-social-durability-amendment-review-prompt.md](./execution-plans/20260914-recovery-social-durability-amendment-review-prompt.md) | Completed independent review contract for accepted `SC-D16` and `SC-D17` |
| [execution-plans/20260914-social-object-transfer-amendment-review-prompt.md](./execution-plans/20260914-social-object-transfer-amendment-review-prompt.md) | Completed independent review contract for accepted `SC-D18` and `SC-D19` |
| [execution-plans/20260915-content-prekey-client-boundary-review-prompt.md](./execution-plans/20260915-content-prekey-client-boundary-review-prompt.md) | Completed review and Owner acceptance record for `SC-D20` and W7A |
| [execution-plans/20260916-desktop-lifecycle-evidence-amendment-review-prompt.md](./execution-plans/20260916-desktop-lifecycle-evidence-amendment-review-prompt.md) | Completed review and Owner acceptance record for `SC-D21` and W7S evidence boundary |
| [execution-plans/20260917-runtime-reset-closure-amendment-review-prompt.md](./execution-plans/20260917-runtime-reset-closure-amendment-review-prompt.md) | Completed Owner acceptance record for `SC-D22`/`SC-D23` and the W7-W12 evidence/reset correction |
| [execution-plans/20260919-canonical-schema-activation-amendment-review-prompt.md](./execution-plans/20260919-canonical-schema-activation-amendment-review-prompt.md) | Completed review and Owner acceptance record for `SC-D24` schema activation and reset ordering |
| [execution-plans/20260921-runtime-endpoint-ownership-amendment-review-prompt.md](./execution-plans/20260921-runtime-endpoint-ownership-amendment-review-prompt.md) | Completed independent review contract for accepted `SC-D28` runtime endpoint ownership |
| [execution-plans/20260924-audience-contract-amendment-review-prompt.md](./execution-plans/20260924-audience-contract-amendment-review-prompt.md) | Independent review contract for accepted `SC-D29` typed audience targets and locally enumerable v1 recipients |
| [execution-plans/20260925-dashboard-peer-trust-route-amendment-review-prompt.md](./execution-plans/20260925-dashboard-peer-trust-route-amendment-review-prompt.md) | Review contract for the W12A Dashboard federation peer route scope correction |
| [execution-plans/20260925-mobile-runtime-source-plan-amendment-review-prompt.md](./execution-plans/20260925-mobile-runtime-source-plan-amendment-review-prompt.md) | Review contract for splitting Mobile product source, platform runtime ownership, and schema activation into bounded Tasks |
| [execution-plans/20261001-desktop-social-usability-amendment-review-prompt.md](./execution-plans/20261001-desktop-social-usability-amendment-review-prompt.md) | Review contract for narrowing the active milestone to Desktop Native Social development usability |
| [execution-plans/20260913-secure-content-work-items.yaml](./execution-plans/20260913-secure-content-work-items.yaml) | Machine-shaped DevelopmentWorkItem contracts |
| [execution-plans/20260913-secure-content-journeys.yaml](./execution-plans/20260913-secure-content-journeys.yaml) | Machine-shaped DevelopmentJourney contracts and budgets |

## 5. Status

Accepted product inputs:

- [`../social/product-definition.md`](../social/product-definition.md):
  `SOC-SEC-C01` through `SOC-SEC-C09`.
- [`../social/experience-contract.md`](../social/experience-contract.md):
  `SOC-SEC-J01` through `SOC-SEC-J09`.
- [`../social/product-state-model.md`](../social/product-state-model.md).
- [`../social/acceptance-matrix.md`](../social/acceptance-matrix.md):
  `SOC-SEC-AS01` through `SOC-SEC-AS16`.

The product contract and `SC-D01` through `SC-D29` are accepted. `SC-D21`
defines deterministic Native lifecycle barriers, runtime-owner restart
continuation, and owner-provisioned fixture handles required to resume W7S; its
former Browser observation branch is retired by `DWF-D39`.
`SC-D22` and `SC-D23` were accepted by the Owner on 2026-09-17 at checkpoint
`bd8dad8b3a5e95c4f3bf002c244d605461c3517d`. They define the remaining multi-service Desktop/Mobile
Development manifest, exact product evidence boundaries, canonical
`four`/`fiveArm` profiles, and the allowlisted public-preserving W12 reset.
Implementation and destructive execution remain governed by the plan,
declarations, exact profile/scope authorization, leases, and evidence gates.
`SC-D24` was accepted by the Owner on 2026-09-19 after exact-source W7 evidence
proved that the canonical private Post writer cannot run before SC-D23 removes
retained plaintext-era `NOT NULL` columns. It authorizes a mechanical plan
amendment, not implementation or reset execution.
`SC-D29` was accepted by the Owner on 2026-09-24 after W8 exact-source evidence
proved the old numeric `Audience.target_id`, `CUSTOM_DENY(PUBLIC)`, and
single-Station W8 fixture contract could not satisfy the accepted product
boundary. W12A was reopened and prior W7/W8 source-bound evidence was
invalidated before implementation.
`SC-D20`, the
client-facing Content PreKey boundary required by W7, passed independent
security and architecture/ownership review and was accepted by the Owner on
2026-09-15. Implementation and runtime readiness remain governed by the formal
execution plan and evidence gates.

On 2026-10-01, the Owner narrowed the active hard-cut milestone to
`DESKTOP_DEVELOPMENT_USABLE`: Desktop Native private Social plus the required
two-Station schema activation. `DWF-D39` subsequently removed Desktop Browser
from all current runtime and proof contracts. Mobile, Chat product runtime,
`FINAL_CUT`, and formal release Acceptance remain explicit future scope.
