# Mobile Social Desktop Parity - Product Feasibility

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-06 | **Updated**: 2026-10-06
> **Owner**: Mobile Product / Social Product

---

## 1. Feasibility Matrix

| Capability | Existing foundation | Missing closure | Smallest executable proof |
|---|---|---|---|
| `MSP-C01` Social navigation | Mobile descriptor navigation and Moments tab | Feed-local thread/media plus Moments-owned Search/Profile/Circles and exception Detail routes | expand comments/media without route; open each true route and verify anchor/focus |
| `MSP-C02` Home feed | `momentsFeedStore`, typed timeline, private projection engine | one composed public/private feed projection and trust metadata | Alice public/private posts appear once in Bob feed after reconcile |
| `MSP-C03` Explore | public timeline gateway and Desktop sort contract | Mobile scope/sort UI and separate public cursor | switch sort, paginate, open/return without Home cursor mutation |
| `MSP-C04` Search/profile | federated people search, profile cache/update, Desktop Profile view | Moments Search/Profile routes, authored-post feed, follow relation actions | remote actor search -> profile -> follow -> authored post |
| `MSP-C05` Circles/audience | canonical Proto, Desktop Circle/Audience implementation | Mobile Circle gateway/runtime/pages and full Audience intent mapping | create Circle, add remote friend, publish Circle post, non-member denied |
| `MSP-C06` Composer/media | Mobile native media staging, encrypted draft, public composer, private engine; Desktop/private runtime render seven canonical content kinds | single composer facade choosing canonical public/private path; seven-kind renderer; video/link/location/poll/repost create capability gating | publish text+image to every supported Audience; render all seven kinds; unsupported create actions remain absent/unavailable |
| `MSP-C07` Moment thread/comments | public detail/comments/replies/delete and private comments engine | one selected inline thread plus exception Detail reuse and private comment wiring | public/private inline comment/reply preserves Feed anchor, survives reload and denies unauthorized reader |
| `MSP-C08` Reactions | public optimistic rollback; Desktop private reaction contract | Mobile private reaction Native command/projection and unknown outcome UI | Bob remote reaction commits exactly once after response loss |
| `MSP-C09` Private trust/recovery | Mobile Rust private publish/read/media/comment/recovery and prekey readiness | UI facade, recovery entry, verified plaintext lifecycle, device revoke handling | Bob2 recovers unseen Moment; revoked Bob1 cannot fetch new envelope |
| `MSP-C10` Cross-Station | accepted Cross-Station Social/Federation contracts | Mobile remote status projection and two-Station runtime evidence | source outage -> pending/retry -> one receiver projection -> revoke |
| `MSP-C11` Lifecycle/isolation | runtime registry, generation fencing, encrypted drafts, teardown | Social facade coordination and plaintext projection purge proof | background/restart restores; Station switch shows zero old-scope data |
| `MSP-C12` Native quality | iOS Acceptance Harness, Appium, bounded list, UI Identity | Android required cell, Social AX/keyboard/safe-area/performance scenarios | same Journey on iOS+Android with DOM/AX/screenshot/timing evidence |

## 2. Verified Foundations

- Mobile private Social lifecycle performs initial endpoint and actor-recovery PreKey reconciliation.
- Mobile private publication has a distinct prepared state and readback-first unknown-outcome recovery.
- Mobile public Moments has bounded feed/comment stores, detail readback and reaction rollback.
- Mobile draft persistence is Station/PTID scoped and survives process restart.
- Mobile profile/people search supports canonical PTID and Federation context.
- Cross-Station Social already defines source authority, viewer-scoped projection, durable delivery,
  interaction return, invalidation and recovery.

These facts prove feasibility, not product completion.

## 3. Unproven Areas

- Private Reaction has no complete Mobile product path.
- Mobile Circles and full Audience selection have no product UI/runtime integration.
- Home feed does not yet compose private Native projections with public feed semantics.
- Android physical-device and Desktop↔Mobile two-Station Acceptance remain
  required and unproven.
- The Owner confirmed the Mobile Social prototype amendment on 2026-10-06;
  prototype evidence does not replace Native proof.

## 4. Feasibility Gate

No required capability depends on a new business authority, transport or cryptographic primitive.
Every missing closure is a Mobile integration, projection, UI, typed-port or evidence gap over existing
canonical owners. The architecture may proceed without inventing a second Social stack.
