// Package resolver is the read-side of the federated user-discovery
// loop. Given a federated handle ("@user@host"), it returns a verified
// ActorProfileEnvelope along with the locator pointer that authenticated
// the home station's signing key.
//
// Two paths:
//
//  1. Local fast-path
//     Handle's host == local station's domain → bypass the network and
//     build the envelope directly from the touch DB. The envelope is
//     still signed so callers see a uniform return shape; clients that
//     cache locally and remotely can use the same code path.
//
//  2. Remote path
//     Handle's host != local station's domain → look up the locator
//     record in the federation DHT, find a relay we can forward
//     through, GET /actor/federation/profile?handle=... via
//     /relay/forward/<peer_id>/..., and verify the returned envelope
//     against the signing_key_pem the locator record pinned (TOFU).
//
// Verified remote envelopes are written through to the federation profile
// cache. Device signing-key persistence remains exclusively owned by Actor
// Identity and is not performed by this resolver.
package resolver
