// Package cache owns the persistence side of federation actor profile
// caching. It is the single seam between the resolver's read-through /
// write-through logic and the touch_actor table.
//
// Two mirrored operations:
//
//   Lookup(ctx, handle)   - returns a cached row iff it is still fresh
//                            (Now < CachedUntilUnixMs) AND its locator
//                            seq is at least as new as what the locator
//                            DHT would yield. Returns ErrCacheMiss
//                            otherwise so the resolver knows to fall
//                            through to the network path.
//
//   Upsert(ctx, in)        - writes a verified envelope back into the
//                            touch_actor row keyed by FederatedHandle.
//                            Idempotent — repeated upserts of identical
//                            envelopes are no-ops; older-seq envelopes
//                            are rejected so a buggy caller cannot
//                            silently downgrade the cache.
//
// The package deliberately exposes a tiny surface. It does NOT verify
// signatures (that is fedprofile.Verify's job upstream) or perform DHT
// lookups (that is locator.NewLookup's). It is the pure local-state
// adapter; the resolver wires the layers together.
//
// Why touch_actor instead of a sibling table? Because the desktop UI
// already loads peer profiles via touch_actor (avatar / display name /
// bio). Storing the cache there means a single SELECT renders both
// local and remote actors with no special-casing in the UI layer.
package cache
