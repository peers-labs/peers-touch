# Mobile Social Desktop Parity - Experience Contract

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-06 | **Updated**: 2026-10-06
> **Owner**: Mobile Product / Social Product

---

## 1. Journey Index

| ID | Journey | Capabilities |
|---|---|---|
| `MSP-J01` | Read Home and Explore | C01, C02, C03, C10, C12 |
| `MSP-J02` | Search and inspect a person | C01, C04 |
| `MSP-J03` | Manage Circles | C01, C05 |
| `MSP-J04` | Publish with an explicit Audience | C05, C06, C09, C10, C11 |
| `MSP-J05` | Read and interact with a Moment | C02, C03, C07, C08, C09 |
| `MSP-J06` | Recover private history on a new device | C09, C11 |
| `MSP-J07` | Survive cross-Station outage and unknown outcomes | C08, C10, C11 |
| `MSP-J08` | Delete, block, and converge revocation | C04, C07, C09, C10 |
| `MSP-J09` | Background, restart, and switch scope | C11, C12 |
| `MSP-J10` | Interoperate across Desktop, iOS, and Android | C02..C12 |

## 2. `MSP-J01`: Read Home And Explore

1. User opens the Moments bottom tab; Home appears from the current runtime projection.
2. Refresh and pagination preserve already verified content and scroll context.
3. User switches to Explore without changing the bottom-tab identity.
4. Explore shows only public content and exposes the canonical sort options.
5. Tapping author opens Profile. Reading content, comments, replies, image and video remains in the
   current Feed context; only direct link, notification targeting or blocking recovery opens Detail.

Recovery:

- empty, filtered-empty, hidden-by-policy, unavailable and source-unavailable are distinct;
- existing verified remote content may remain readable offline, but new interaction is disabled;
- stale content is visibly reconciling and never presented as current after revocation.

## 3. `MSP-J02`: Search And Inspect A Person

1. User opens Search from Moments.
2. Search resolves local and federated actors through canonical identity.
3. Result rows show human identity first and source/relationship as quiet trust metadata.
4. User opens Profile, reads authored posts, follows/unfollows, messages an eligible friend, or manages Block.
5. Returning restores query and result position.

No-result, malformed handle, no active Federation, remote unavailable, hidden discoverability and
permission denial have different recovery actions. Missing data never fabricates blocked/friend state.

## 4. `MSP-J03`: Manage Circles

1. User opens Circles and sees publisher-private lists.
2. User creates or edits name/description in a BottomSheet.
3. User opens a Circle and searches actors in a full-screen member picker.
4. Add/remove actions show pending and authoritative readback.
5. Delete is in a separated danger group and requires confirmation.

Circle membership does not imply friendship. Remote actor resolution failure keeps the edit surface
intact and does not partially mutate the member set.

## 5. `MSP-J04`: Publish With An Explicit Audience

1. User opens the composer BottomSheet and enters text/media.
2. Audience is visible before Publish and can select all canonical kinds.
3. Complex Audience selection opens a full-screen picker and returns the exact canonical target.
4. Public content uses the normal typed publish path.
5. Private content runs recipient/device/remote readiness through Mobile Rust before explicit submit.
6. Text and image creation are required; video/link/poll/repost/location creation appears only when the
   canonical capability snapshot advertises that operation and its required owner is ready.
7. The composer preserves draft, media handles and Audience across failure, background and restart.
8. Source commit produces a local Moment identity; the current Moments tab returns to Home and expands
   that item in place, while remote delivery remains pending/retrying until confirmed.

Failure:

- unsupported or incomplete Audience blocks submit without changing to PUBLIC;
- unavailable recipient, oversized Audience or invalid Group keeps the draft and names the correction;
- lost response becomes unknown outcome and checks authoritative status before retry;
- private plaintext never enters public staging or logging.

## 6. `MSP-J05`: Read And Interact

1. From Home or Explore, user expands one Moment thread in place; opening another collapses the prior thread.
2. Authorization and private decryption complete before verified plaintext becomes visible.
3. Up to 10 comments are visible by default. Additional comments stay folded behind one count-aware action;
   the reply composer appears only on explicit comment intent and remains attached to the root Moment.
4. Reaction picker offers the canonical five types and supports unreact.
5. Pending state belongs to the affected action; failures preserve comment text or restore reaction state.
6. Image/video opens a temporary media overlay after actor/device/object-bound grant and local integrity
   verification; closing it restores the exact Feed anchor.
7. Direct links, notification targets and blocking recovery may open an exception Detail route using the
   same projection and thread surface; Back restores the originating scope and anchor.
8. Text, image, video, link, poll, repost and location use one canonical content-kind mapping for
   public and private resources; unsupported or unknown kinds fail closed rather than rendering as text.

An expired token enters re-authentication. Unauthorized private content uses uniform not-found behavior.
Integrity failure returns no partial plaintext.

## 7. `MSP-J06`: Recover Private History

1. Bob installs or resets a Native Mobile device.
2. Historical private content shows recovery-required, not blank or corrupt content.
3. Bob completes the existing trusted recovery journey.
4. The device obtains authorized history, including a Moment never opened on the old device.
5. Revoked devices and invalidated audiences receive no new envelope.

Recovery phrase and root material never enter Mobile Web state or screenshots.

## 8. `MSP-J07`: Cross-Station Outage And Unknown Outcomes

1. Alice submits a remote Audience and source Station commits.
2. Remote Station becomes unavailable; Alice sees pending/retrying tied to one Moment identity.
3. Durable replay delivers exactly one projection after recovery.
4. Bob submits Comment/Reaction while source is unavailable; the action remains pending/unknown by command ID.
5. Reconcile resolves to committed, retryable-no-commit, terminal, or still unknown without duplication.

The client never creates another Moment or interaction to escape an unknown result.

## 9. `MSP-J08`: Delete, Block, And Revocation

1. Author deletes a Moment from the card action sheet, or either actor blocks/removes the relationship
   from the Profile danger group.
2. New feed/detail/comment/media/recovery requests stop.
3. Native clients receive ordered invalidation and clear ordinary plaintext projection/cache.
4. The affected surface transitions to deleted-or-revoked with no hidden retry path.
5. Copy explains that exported, screenshot or maliciously saved content cannot be remotely erased.

## 10. `MSP-J09`: Background, Restart, And Scope Switch

- Background preserves drafts and verified bounded projections; push only marks stale.
- Resume revalidates Station/session and reconciles before writes reopen.
- Process restart restores encrypted draft/private command state and derives pages from runtime projection.
- Station/account switch hides the old tree immediately, fences callbacks, clears plaintext projection and
  key references, then opens the new gate/scope.
- A draft may be retained only as quarantined content bound to its original Station/PTID and explicitly named.

## 11. `MSP-J10`: Cross-Platform Interoperation

Required directions:

1. Desktop Alice -> iOS Bob.
2. iOS Alice -> Desktop Bob.
3. Android Alice -> Desktop Bob.
4. Desktop Alice -> Android Bob.
5. iOS Alice -> Android Bob.
6. Android Alice -> iOS Bob.

Each direction covers publish/read, comment, reaction, media, restart, recovery, delete/block and
source outage on two real Stations. Equivalent visible outcomes are required; platform chrome may differ.
