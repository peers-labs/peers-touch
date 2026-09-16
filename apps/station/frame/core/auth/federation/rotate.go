package federation

import (
	"context"
	"errors"
	"time"
)

// DefaultDualSignGrace is the canonical window during which the
// `prev` slot is preserved after a rotation. 24h is short enough
// that operator-driven rotations have a single-day audit window
// to react to issues, long enough that a federated request in
// flight against an old kid is overwhelmingly likely to have
// completed before the prev row evaporates.
//
// Note: the verifier currently does NOT use prev — every inbound
// token carries its own JWK header and is TOFU-pinned at the
// receiver. The prev slot exists as a defence-in-depth artefact
// for the future case where receivers fetch publickeys out-of-
// band; keeping the slot now means we do not have to schema-
// migrate when that becomes useful.
const DefaultDualSignGrace = 24 * time.Hour

// RotateLocalKey is the dashboard-facing entry point for rotating
// this station's signing keypair. Steps:
//
//  1. Mint a fresh LocalKey via MintLocalKey.
//  2. Atomically Rotate the KeyStore: archive the outgoing public
//     key under stationPeerID, demote current → prev, then write
//     the new key into current. Identical-kid generation is refused.
//  3. Reset the supplied KeyCache so the next Mint observes the
//     new key without waiting on the recheckTTL clock.
//
// The cache argument may be nil — useful for the dashboard's
// out-of-band rotation surface where the cache lives in a
// separate process and will pick the change up on its own
// recheckTTL pass. When non-nil, the reset is best-effort;
// failure to reset does not roll back the persisted rotation.
func RotateLocalKey(
	ctx context.Context,
	stationPeerID string,
	store KeyStore,
	cache *KeyCache,
) (*RotateResult, error) {
	if store == nil {
		return nil, errors.New("federation: rotate: nil key store")
	}
	fresh, err := MintLocalKey(time.Now())
	if err != nil {
		return nil, err
	}
	res, err := store.Rotate(ctx, stationPeerID, fresh)
	if err != nil {
		return nil, err
	}
	if cache != nil {
		cache.ResetForTest()
	}
	return res, nil
}

// FinalizePrevKey clears the `prev` slot when its rotation
// timestamp is older than `grace`. Returns:
//
//   - cleared = true when a prev row existed and was older than
//     `grace`; false when prev was empty or still inside the
//     window.
//   - the prev kid that was cleared (empty when cleared=false),
//     so the caller can include it in audit logs.
//
// The worker that calls this on a schedule typically uses
// DefaultDualSignGrace; tests may pass shorter values for
// determinism.
func FinalizePrevKey(ctx context.Context, store KeyStore, grace time.Duration) (bool, string, error) {
	if store == nil {
		return false, "", errors.New("federation: finalize: nil key store")
	}
	prev, err := store.Load(ctx, SlotPrev)
	if err != nil {
		if errors.Is(err, ErrNoLocalKey) {
			return false, "", nil
		}
		return false, "", err
	}
	cutoff := time.Now().Add(-grace)
	if prev.UpdatedAt.IsZero() || prev.UpdatedAt.After(cutoff) {
		return false, "", nil
	}
	cleared, err := store.ClearPrev(ctx, prev.Kid, prev.UpdatedAt)
	if err != nil {
		return false, "", err
	}
	if !cleared {
		return false, "", nil
	}
	return true, prev.Kid, nil
}
