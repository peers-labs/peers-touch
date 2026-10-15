# Mobile Social Desktop Parity - Integration

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-10-06 | **Updated**: 2026-10-06
> **Owner**: Mobile / Social / Client Architecture

---

## 1. Existing-To-Target Mapping

| Existing source | Retain | Target integration |
|---|---|---|
| `features/social/momentsFeedStore.ts` | bounded public feed/detail/reaction projection | becomes public input to `MobileSocialFacade` |
| `runtimes/momentsProjectionDescriptor.ts` | lifecycle and projection owner | delegates Social product snapshot through facade |
| `runtimes/privateMomentsRuntime.ts` | private lifecycle and Native commands | becomes private input/port; no page imports |
| `services/gateways/momentsGateway.ts` | generated message mapping | authenticated calls move behind typed Rust port |
| `pages/MomentsPage.tsx` | Mobile feed shell and bounded rendering | Home/Explore scope host only |
| `pages/moments/MomentComposer.tsx` | media/draft interaction | composer facade + full Audience + private readiness |
| `MomentFeedItem.tsx` | content/reaction/comment anatomy | canonical trust/private/delivery state surface |
| `MomentCommentsSection.tsx` | comment projection/composer | one selected inline Feed thread; exception Detail reuses the same section |
| `features/social/socialStore.ts` | profiles, relationships, people search | Profile/Search/Circle identity support |
| `src-tauri/src/social/` | private Social engine | extends typed public/private/interaction adapter; no second engine |
| phrase-bearing Web/Tauri/Acceptance recovery action | deleted | Web starts recovery without a secret; native plugin returns the phrase only to Rust |
| Desktop Moments pages/components | product semantics only | parity ledger and acceptance reference |

## 2. New Integration Boundaries

### Web facade

One session-scoped facade:

- composes public/private projections;
- exposes Home/Explore/selected-thread/exception-Detail/Profile/Circle/Composer snapshots;
- dispatches typed intent;
- owns no persistence or auth credential.

### Rust adapter

One adapter:

- accepts generated or schema-validated typed intents;
- performs authenticated Station requests;
- calls existing private Social engine for private work;
- returns sanitized projections and typed state/error;
- owns purge and exact-scope readback.

### Native secure input

One narrow plugin:

- presents platform-native masked recovery input;
- prevents concurrent prompts and bounds the prompt lifetime;
- returns the submitted phrase only through its Rust plugin handle;
- clears native input state after submit, cancel, expiry or teardown;
- owns no recovery derivation, persistence, business state or Web command.

### Navigation

The existing Mobile navigation store gains Moments-owned route descriptors. Social store selections are
readback context only and never route authority.

## 3. Cross-Module Mapping

| Capability | Governing owner | Mobile consumer |
|---|---|---|
| Audience/Post/Comment/Reaction/Circle | Station Social | Rust Social adapter |
| Group Audience membership | Conversation authority | readiness resolver |
| Actor/profile/relationship/block | Actor + Social | Social facade/profile routes |
| encryption/envelope/object | Secure Content | Mobile private engine |
| cross-Station delivery | Federation + source Social | status projection/reconcile |
| command/draft durability | Mobile reliability | Social facade status |
| access/session/generation | Mobile lifecycle | every Social scope |
| navigation/focus/scroll | Mobile navigation | Moments pages |

No row gains a second semantic or persistence owner.

## 4. Atomic Cutovers

1. Public authenticated Social transport moves from Web bearer fetch to typed Rust ports.
2. Composer moves from three Mobile audiences to canonical Audience without parallel subset mode.
3. Feed and exception Detail move from public-only page state to one composed projection; ordinary
   comment/media interaction remains Feed-local.
4. Private comments/reactions/media/recovery become facade actions; public fallback is deleted.
5. The phrase-bearing `storeRecoveryPhrase` Web/Tauri/Acceptance path is deleted
   in the same cut that activates native secure input.
6. Profile/Search/Circles and exception Detail route identity moves to descriptor navigation. Expanded
   Feed thread and media overlay remain bounded presentation state, never business truth.
7. Cross-Station Mobile Acceptance becomes a separate required package; the existing Mobile Shell plan remains
   historical same-Station evidence and is not retroactively rewritten.

Each cutover requires zero-reference gates for the old production path.

## 5. Impact Surface

Expected implementation areas:

- `apps/mobile/src/app/navigation/`
- `apps/mobile/src/features/social/`
- `apps/mobile/src/pages/MomentsPage.tsx`
- `apps/mobile/src/pages/moments/`
- `apps/mobile/src/runtimes/`
- `apps/mobile/src/services/mobileCommands.ts`
- `apps/mobile/src-tauri/src/social/`
- `apps/mobile/src-tauri/src/platform/secure_input.rs`
- `apps/mobile/src-tauri/plugins/secure-input/`
- Mobile i18n catalogs
- `model/domain/social/` only when a genuine canonical contract gap is proven
- Mobile business Acceptance scenarios/environments/gates

Retained upstream areas:

- Station Social Cross-Station implementation;
- shared Federation transport;
- Secure Content core;
- existing Mobile lifecycle/navigation/reliability frameworks.

## 6. Migration And Compatibility

This design authorizes a target-state hard cut, not a compatibility period:

- no Web/Rust dual dispatch;
- no public/private dual write;
- no copied Desktop store;
- no old Audience subset after the full selector activates;
- no alias route or response-shape fallback;
- generated compatibility ingress, if required by repository policy, remains bounded at the canonical adapter.

Existing local drafts are migrated only when exact Station/PTID/schema ownership is verifiable; otherwise
they are quarantined and require explicit discard.

## 7. Acceptance Integration

The future Acceptance package must:

- reuse exact-source Mobile build and Appium runtime identity;
- require the currently USB-authorized physical Android device and reject
  Android Emulator substitution;
- reuse the existing two-Station Social environment and shared Federation services;
- drive only production UI/typed Harness actions;
- enter recovery material only through the native masked control; the runtime
  owner may bind a single-use process-scoped native secret channel and Appium
  may trigger its native autofill action, while Web Harness inputs/outputs and
  Appium payloads recursively reject phrases and channel references;
- capture receiver perspective, Station readback, OSS/key absence and cleanup;
- keep functional Journey proof before broad Acceptance.

## 8. Documentation Alignment

This module narrows no Social Core security promise. It changes Mobile from deferred to required in the
Social product contract and adds Mobile-specific architecture/evidence without copying Cross-Station
delivery design.
