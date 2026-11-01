# Execution Plan — Self-Direct Conversation (Saved Messages)

Date: 2026-10-31
Design: `docs/architecture/domains/chat/lifecycle/self-direct.md`
Branch: pr170-combined (peers-relay)

## Vertical slices

### SD-1 Station identity + domain

- [x] `valueobject.SelfDirectConversationID(ptid)` + single dispatch helper
      for direct id computation (pair vs self).
- [x] `aggregate.CreateDirect` accepts one-participant self input;
      `validateDirectInvariant` generalises to 1(self)/2(pair).
- [x] Tests: id determinism/collision space; singleton genesis; invariant
      1/2/0/3 matrix; self id mismatch rejected.

### SD-2 Station application + production + gate

- [x] `createDirect` self branch: Local scope, own-actor routes only,
      federation claim rejected; `validateExistingDirect` singleton shape;
      `existingDirectCanReopen` extended.
- [x] `handleCreateDirectConversation` HTTP branch (peer == authenticated).
- [x] Gate allows target == subject under Local scope; no friendship
      precondition. The gate contract is error/nil with no allow-reason
      channel, so the allow is plain nil, not a typed reason.
- [x] Composition tests: singleton genesis, replay idempotency, delivery-set
      equality for one and two own endpoints, federation claim rejected.

### SD-3 Messaging core + Desktop Rust

- [x] Remove client `peer == self` rejection (desktop, keep mobile guarded
      until its UI lands).
- [x] `messaging-core` outbox: allow zero peer sessions when the sole required
      endpoint is the local one (public-event-only command); keep pairwise
      sessions to other own devices; unit test covers the singleton fan-out.
- [x] Inbox/bootstrap reviewed: Direct sessions bind by endpoint
      (ptid+device) and carry no actor-inequality guard, so own-other-device
      ciphertext reuses the pair path. Real two-device delivery remains an
      SD-5 acceptance obligation.

### SD-4 Desktop UI

- [x] Fixed "Saved Messages" contact entry (above the collapsible categories)
      routed through the canonical `openDirectConversation(peer=self)` path;
      title/avatar resolve from the authenticated profile with a localised
      fallback (`directConversationDisplayName`).
- [x] Message header/detail panel: self identity card; presence dot, call
      actions, peer profile fetch and the safety-number section are hidden;
      background, search and local settings remain.
- [x] i18n en/zh-CN; leftover `127.0.0.1:7782` debug probes removed from
      ChatContactsPanel.
- [x] TS tests for the singleton projection and the display-name fallback.

### SD-5 Verification + docs

- [x] gofmt + focused `go test ./subserver/conversation/...`;
      `cargo test --lib` messaging-core; desktop `tsc`, eslint delta and
      vitest green.
- [ ] Native acceptance: self create/send/reopen, attachment, unread stays
      zero, two-device delivery where harness permits.
- [x] Knowledge pitfall entry; architecture README linkage.

## Constraints

- No new conversation kind, no parallel pipeline, no local-only notes store.
- No friendship/self-follow side effects.
- Federation never carries a self-direct.
- Old-client compatibility is read-tolerant; guards hide unsupported UI.
