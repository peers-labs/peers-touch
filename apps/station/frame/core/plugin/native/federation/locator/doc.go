// Package locator implements the federated user-discovery layer that turns a
// human-readable handle ("@alice@station-1.example") into a verified pointer
// at the actor's home station, persisted in the libp2p DHT under a dedicated
// /pst-actor/<handle> namespace.
//
// Layered responsibility (see docs/architecture/federation/* — TODO when the
// resolver lands):
//
//	┌────────────────────────────────────────────────────────────────────┐
//	│ Identity & Visibility (Actor proto, touch_actor row)               │
//	│   Owner: frame/touch/actor                                         │
//	│   Drives: visibility flag, handle materialisation                  │
//	├────────────────────────────────────────────────────────────────────┤
//	│ Locator                       ◀── you are here                     │
//	│   Owner: frame/core/plugin/native/federation/locator               │
//	│   Drives: signed DHT records, publish / lookup / tombstone         │
//	├────────────────────────────────────────────────────────────────────┤
//	│ Resolver                                                           │
//	│   Owner: TBD (Phase C — frame/core/plugin/native/federation/resolver)│
//	│   Drives: handle → ActorProfile via /relay/forward HTTP            │
//	└────────────────────────────────────────────────────────────────────┘
//
// Hard rules enforced here:
//
//  1. Records are ALWAYS signed with the station's federation Ed25519 key
//     (frame/core/auth/federation.LocalKey). The same key signs federation
//     JWTs, so receivers that already TOFU-pinned the station's signing key
//     can verify locator records with no extra trust step.
//
//  2. The DHT record value is the BINARY proto serialisation of
//     pb.ActorLocatorRecord — NOT JSON. Receivers parse strictly; any
//     deviation aborts the validator and the libp2p layer drops the record.
//
//  3. The DHT key is "/pst-actor/<handle>" with the handle lower-cased.
//     The namespace is registered alongside the existing "pst" peer-record
//     namespace via federation.LocatorValidator(); both the bootstrap
//     subserver's DHT and the registry's DHT MUST install it on creation.
//     Without the validator on a node, that node will reject every actor
//     record it sees — silent black-hole — and the operator surface symptom
//     is "PutValue / GetValue: invalid key prefix".
//
//  4. The publisher refuses to publish records whose handle does not match
//     the local station's identity (peer.ID + domain). This is a defensive
//     layer: the actor write path can only ask the publisher to broadcast
//     local rows. Cross-station re-publication of cached rows is forbidden
//     and would split-brain the DHT.
package locator
