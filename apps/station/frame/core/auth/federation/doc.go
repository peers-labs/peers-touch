// Package federation owns cross-station token issuance for the
// entire framework.
//
// Until this package existed, every subserver that needed to
// sign a request "addressed to another station" (OSS for cross-
// station file pulls, future chat for cross-station message
// delivery, future moments for cross-station post fetch) had to
// reimplement the full Ed25519 + JWK-pinned-TOFU stack. They all
// produced subtly different code; the OSS variant alone was 502
// lines plus its own meta-row keys plus its own peer-key table.
//
// federation collapses that to one shared implementation:
//
//   - LocalKey   — the station's signing keypair (Ed25519). One
//                  pair per station, regardless of which subserver
//                  mints. Receivers identify the station, not the
//                  subserver.
//   - KeyStore   — persistence + lifecycle for LocalKey. Two
//                  slots: `current` (used to mint) and `prev`
//                  (preserved across rotation for receivers that
//                  cached the old kid). Atomic rotation lives
//                  here.
//   - KeyCache   — process-local in-memory cache wrapping
//                  KeyStore. Periodically peeks the persisted
//                  current-kid so dashboard-driven rotation is
//                  observed within `recheckTTL`.
//   - PeerKey    — cached public key of a remote peer station,
//                  with TOFU/pin semantics.
//   - PeerKeyStore — persistence for the peer-key cache. Strict:
//                    a kid mismatch always rejects, pinned or
//                    not. Operators rotate trust by explicitly
//                    forgetting + re-TOFUing.
//   - Mint       — `Mint(ctx, MintRequest{scope, iss, aud, sub,
//                  claims, ttl})`. Routes through the scope
//                  registry (TTL clamp + audience check + claim
//                  allow-list) before signing.
//   - Verify     — `Verify(ctx, token, ExpectedAud)`. Parses
//                  header, runs PeerKey TOFU, verifies signature,
//                  validates registered claims, returns typed
//                  VerifiedClaims to the caller.
//
// Each subserver's only obligation is:
//
//  1. `scope.MustRegister(...)` once at Init time — declares the
//     issuance policy.
//  2. `federation.Mint(ctx, MintRequest{Scope: "<my-scope>", ...})`
//     to sign.
//  3. Use the `wrapper.RequireFederationToken("<my-scope>")`
//     server.Wrapper on inbound handlers — federation does the
//     verify, the handler reads `federation.GetVerifiedClaims(ctx)`
//     to make business-policy decisions (chat-session participation,
//     moments visibility, etc).
//
// Out of scope for this package:
//
//   - Per-claim semantic validation (oss_key correctness, chat
//     session participation, etc). Those are *business* rules
//     that live in the subserver. federation only guarantees
//     cryptographic + policy correctness.
//   - End-user JWTs (subject access tokens). Those continue to
//     route through `auth.Provider` / `auth.NewJWTProvider`.
//   - Refresh-token issuance / rotation. Out of scope for v1;
//     federation tokens are short-lived enough that rotation is
//     simply "mint a new one".
package federation
