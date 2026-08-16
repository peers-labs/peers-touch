// Package profile owns the wire-format and signing/verification rules for
// federated actor profile envelopes. It is the content-side counterpart of
// the locator package:
//
//	locator (frame/core/plugin/native/federation/locator)
//	   stores DHT pointers — "which station owns this handle?"
//
//	profile (frame/touch/federation/profile)
//	   transports signed profile snapshots — "what does this actor look
//	   like right now?"
//
// Layered responsibility:
//
//   - record.go: deterministic protobuf canonicalisation, Sign/Verify of
//     ActorProfileEnvelope using the same federation Ed25519 key the
//     locator uses. Pure functions, no I/O.
//   - builder.go: end-to-end "load actor row → project to ActorProfile →
//     sign envelope" helper for the home-station endpoint. Reads from
//     the touch DB and the federation key cache.
//
// Receivers verify envelopes against the signing_key_pem they previously
// pinned via the matching locator record (TOFU). A profile envelope whose
// signing_key_pem disagrees with the locator's pinned key MUST be
// rejected by the resolver — that is enforced one layer up, in
// frame/touch/federation/resolver.
package profile
