# Mobile Social Desktop Parity - Architecture Design

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-06 | **Updated**: 2026-10-06
> **Owner**: Mobile / Social / Client Architecture
> **Module**: `apps/mobile/`

---

## 1. Core Principles

1. **Station authority**: Social owns Post, Audience, Circle, relationship, interaction and policy truth.
2. **One Mobile facade**: Mobile Web pages consume one Social experience projection and dispatch one intent family.
3. **Rust security boundary**: Mobile Rust owns credentials, private keys, encryption/decryption, durable commands,
   opaque media and authenticated transport.
4. **Proto-first**: cross-runtime semantics reuse canonical Social, Secure Content, Federation and reliability Proto.
5. **Projection, not page ownership**: runtimes keep data fresh; pages are active-only renderers.
6. **No second transport**: cross-Station delivery remains the shared Federation outbox/inbox path.
7. **Hard cut**: no public/private fallback, parallel store, legacy JSON route or partial Audience submission.

## 2. Evidence Ledger

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| Station is Social authority | `accepted_decision` | Social Core, Cross-Station Social | accepted | none |
| Mobile mainline is Tauri Web + Rust + native plugins | `verified_fact` | `docs/client/mobile/base.md`, `apps/mobile/` | high | none |
| Public feed/detail/comment/reaction foundations exist | `verified_fact` | `momentsFeedStore.ts`, `momentsGateway.ts`, Moments pages | high | Native full-Journey evidence |
| Mobile private publish/read/media/comment/recovery exists | `verified_fact` | `privateMomentsRuntime.ts`, `src-tauri/src/social/` | high | product UI integration |
| Private Reaction Mobile path is absent | `verified_fact` | Mobile runtime/command inventory | high | implementation |
| Full Audience/Circles/Moments Search/Profile routes are absent | `verified_fact` | Mobile pages/navigation inventory | high | implementation |
| Existing Mobile plan proves cross-Station Social | `hypothesis_rejected` | MS-D27 explicitly defers it | high | new required cells |
| One facade can compose public/private projections without new authority | `proposal` | compatible canonical IDs and owners | high | implementation + Acceptance |

No irreversible topology decision depends on an unverified root-cause hypothesis.

## 3. Scope

In scope:

- Mobile Social experience facade, projection composition and typed intent ports.
- Mobile Rust Social adapter over canonical Station/Secure Content/Federation owners.
- Mobile Feed-first surfaces for Home, Explore, inline Moment thread/media, Search, Profile, Circles,
  Composer and exception Detail.
- lifecycle, cache, recovery, interop and Acceptance contracts.

Retained unchanged:

- Station Social and author Home Station authority;
- Secure Content algorithms and key ownership;
- Federation transport, ordering and dedupe;
- Mobile lifecycle kernel, navigation store, draft store and command ledger.

Deleted in target state:

- direct Mobile Web authenticated Social fetches;
- Mobile-only Audience subsets or manual domain aliases;
- separate public/private page-level state owners;
- any private-to-public or direct-remote fallback.

## 4. System Architecture

```text
Mobile Native App
┌─────────────────────────────────────────────────────────────────────┐
│ Mobile Web                                                         │
│  MobileNavigationStore                                             │
│    -> Moments Home/Explore/InlineThread/MediaOverlay               │
│    -> Search/Profile/Circles/ExceptionDetail/Composer              │
│  MobileSocialFacade                                                │
│    -> SocialExperienceProjection                                   │
│    -> SocialIntentPort                                             │
│       public/private decision from canonical Audience              │
├──────────────────────── typed Tauri boundary ──────────────────────┤
│ Mobile Rust                                                        │
│  SocialNativeAdapter                                               │
│    -> authenticated Station transport                              │
│    -> private Social engine / secure-content-core                   │
│    -> encrypted draft + durable command stores                      │
│    -> opaque media lifecycle                                        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ canonical Proto over Station API
                               ▼
Author/Viewer Home Station Social authority
  -> Social DB / policy / grants
  -> Key Exchange + Secure Content validation
  -> shared Federation outbox/inbox
  -> remote viewer-scoped projection
```

## 5. Sources Of Truth

| Truth | Owner | Mobile may do | Mobile must not do |
|---|---|---|---|
| Post/Audience/Circle/interaction | Station Social | cache/project/dispatch | redefine or infer |
| Cross-Station delivery | Federation + source Social | show state/reconcile | direct-call remote Station |
| Encryption/key/envelope | Secure Content + Mobile Rust | encrypt/decrypt/current-device projection | expose key material to Web |
| Actor/relationship/profile | Actor/Social Station owners | cache viewer projection | infer block/friend from absence |
| Durable Mobile command | Mobile Rust ledger | show status and request reconcile | persist duplicate Web outbox |
| Draft | Mobile Rust encrypted draft store | edit via typed port | use localStorage/plaintext |
| Navigation/scroll/focus | Mobile navigation/presentation memory | own bounded local state | become business truth |

## 6. Runtime Units And Lifecycle

### 6.1 `MobileSocialFacade`

Responsibility:

- expose one immutable `SocialExperienceProjection`;
- route intents by canonical Audience/resource kind;
- join public feed items and private Native projections by canonical Post ID;
- translate owner states into product state names;
- fence every completion by Station/PTID/device/generation.

It must not fetch directly, persist commands, hold keys or implement policy.

### 6.2 `SocialNativeAdapter`

Responsibility:

- execute typed authenticated Social requests;
- own private Social engine bindings and verified plaintext projection;
- persist-before-send where the operation may commit;
- check authoritative readback before replay;
- purge scope-bound plaintext and key references on teardown.

It must not become a second Social authority or Federation client.

### 6.3 Pages And Routes

- primary Moments tab: `on-visit + none`;
- Home/Explore lists: bounded/virtualized content backed by runtime projection;
- Moment comments/replies: up to 10 rows inline per item by default; overflow and one composer mount on intent;
- image/video preview: selected-only `on-visit + none` overlay with no route mutation;
- Profile/Search/Circles and exception Detail: descriptor-owned `on-visit + none`;
- Composer/Audience/Reaction/Circle edit: selected-only overlays;
- no page installs stream, timer, gateway or reconciliation owner.

## 7. Core Contracts

```ts
interface SocialExperienceProjection {
  scope: { stationPeerId: string; actorPtid: string; deviceId: string; generation: string };
  home: SocialFeedProjection;
  explore: SocialFeedProjection;
  selected?: SocialDetailProjection;
  composer: SocialComposerProjection;
  circles: SocialCircleProjection;
  runtime: SocialRuntimeProjection;
}

interface SocialIntentPort {
  refresh(scope: 'home' | 'explore'): Promise<void>;
  openPost(postId: string): Promise<void>;
  publish(intent: CanonicalMomentIntent): Promise<CommandProjection>;
  react(intent: CanonicalReactionIntent): Promise<CommandProjection>;
  comment(intent: CanonicalCommentIntent): Promise<CommandProjection>;
  mutateCircle(intent: CanonicalCircleIntent): Promise<CommandProjection>;
  recover(postId: string): Promise<void>;
  reconcile(reason: string): Promise<void>;
}
```

`Canonical*Intent` is an adapter view over generated Proto, not a new business model.

## 8. Data And Control Flow

### Publish

```text
Composer draft -> facade validates canonical Audience
  public -> Rust typed Social request
  private -> Rust prepare/readiness -> explicit submit
Station source commit -> local command projection
Federation durable delivery -> remote viewer projection
event/reconcile -> facade projection -> UI
```

### Read

```text
feed/detail request -> Rust typed read
  public -> verified Station projection
  private -> ciphertext/envelope/object descriptor -> Rust verify/decrypt
verified plaintext projection -> generation-fenced Web projection -> UI
```

### Remote interaction

```text
Mobile intent -> viewer Home Station durable command
-> shared Federation transport -> source Social authorization/commit
-> result projection -> viewer Home Station -> Mobile reconcile
```

## 9. Operational Semantics

- **Idempotency**: every may-commit write has one canonical command/resource identity.
- **Unknown outcome**: exact resource/result readback precedes retry.
- **Ordering**: source Social interaction sequence and Federation ordering remain authoritative.
- **Dedupe**: duplicate frame/command changes no projection after first valid commit.
- **Cancellation**: UI cancellation stops local intent only before durable admission; after admission it
  hides no pending truth.
- **Timeout**: timeout transitions to retryable or unknown according to owner evidence, never generic failed.
- **Backpressure**: Mobile command/draft/media bounds fail before admission with typed recovery.
- **Large payload**: content payload respects Secure Content bounds; media bytes stay out of command/event JSON.
- **Auth**: Web has no bearer token; Rust binds Station/PTID/device and rotates session material.
- **Shutdown**: generation fences callbacks; teardown drains/reconciles admitted work and purges plaintext projection.

## 10. Allowed And Forbidden Dependencies

Allowed:

```text
page -> MobileSocialFacade -> typed Tauri port -> Mobile Rust
Mobile Rust -> canonical Station owner API
Mobile Rust -> secure-content-core / encrypted stores
Station Social -> shared Federation delivery
```

Forbidden:

```text
page -> authenticated fetch
page -> private engine
Mobile Web -> root/recovery/private key
Mobile -> remote Station direct Social API
Mobile -> Social/Federation database
public path -> private plaintext fallback
private runtime -> second outbox or second command store
```

## 11. Quality Gates

- iOS and Android required native cells, not one-platform substitution.
- all six Desktop/iOS/Android interop directions.
- exact-source two-Station outage/retry/restart/revoke.
- Station/OSS/log/Web-state plaintext and key-material absence.
- seven canonical content kinds render through one public/private mapping; create controls are capability-gated.
- tap-to-visible P95 <= 100 ms for scope/profile routes and inline thread/media visibility.
- feed DOM window <= 100 items; comments default to <= 10 rows per item and expanded windows remain <= 100;
  pickers <= 100 visible rows.
- smallest/largest viewport, keyboard, safe area, max text, long locale, screen reader and reduced motion.
- cleanup returns listeners/workers/timers/object URLs/plaintext projections to baseline.

## 12. Observability

Sanitized evidence records:

- source checkpoint/build identity;
- Station/PTID/device/generation digests;
- command/resource ID, state transition and retry count;
- source/receiver projection hashes and delivery disposition;
- queue/window sizes and transition timing;
- typed failure code and owner;
- zero secrets, plaintext private content or raw key material.

## 13. Architecture Gate

Ownership, boundaries, contracts, failure semantics, forbidden dependencies and evidence requirements
are complete and accepted for execution planning. Status: `DESIGN_ACCEPTED_FOR_PLANNING`.
