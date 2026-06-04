// builder.go — end-to-end "load actor row → sign envelope" helper for the
// home-station endpoint. Sits at the seam between actor/profile.go (DB
// projection) and record.go (signing). The resolver does NOT call into
// builder; only the home-station HTTP handler does.

package profile

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	fednode "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile/pb"
	modelpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// ErrHandleNotLocal is returned by Build when the requested handle does not
// belong to the local station. The caller (HTTP handler) maps this to a
// 404 — the resolver in another station will already have asked the right
// home station via the locator record, so a wrong-station hit is either a
// stale cache or a buggy client.
var ErrHandleNotLocal = errors.New("profile: handle does not belong to this station")

// LocalProfileFetcher loads an actor profile from the local touch DB and
// returns it as the ActorProfile proto used by ActorProfileEnvelope.
//
// Defining this as an interface keeps the builder package free of a
// dependency on frame/touch/actor (which would create a cycle —
// actor depends on profile via federation_profile.go). The HTTP handler
// in actor/ provides the concrete implementation.
type LocalProfileFetcher interface {
	// FetchByLocalHandle loads the profile of the local actor whose
	// preferred_username is `localHandle`. Returns ErrHandleNotLocal if
	// no such local row exists.
	FetchByLocalHandle(ctx context.Context, localHandle string) (*modelpb.ActorProfile, error)
}

// BuildInput carries the request parameters for Build.
type BuildInput struct {
	// Handle is the federated handle requested by the caller (e.g.
	// "alice@host.example"). Build canonicalises it; the resolver
	// canonicalises before calling, so this is a defensive duplicate.
	Handle string

	// Fetcher loads the profile body. Implementations live in actor/.
	Fetcher LocalProfileFetcher

	// Keys is the federation key cache that holds the station's signing
	// key. Reused across calls; Build does not take ownership.
	Keys *authfed.KeyCache

	// TTL overrides DefaultTTL. Zero falls back to the package default.
	TTL time.Duration

	// Now overrides time.Now (tests). Zero falls back to time.Now().
	Now func() time.Time
}

// Build resolves a local actor by its federated handle, projects it
// through the supplied fetcher, and signs an ActorProfileEnvelope using
// the station's federation Ed25519 key.
//
// Errors:
//   - ErrHandleNotLocal — the handle's host portion does not match the
//     local station's domain, or no local row exists for the local part
//   - locator.ErrInvalidKey — the supplied handle is malformed
//   - any wrapped key-cache / DB error
func Build(ctx context.Context, in BuildInput) (*pb.ActorProfileEnvelope, []byte, error) {
	if in.Fetcher == nil {
		return nil, nil, errors.New("profile: nil fetcher")
	}
	if in.Keys == nil {
		return nil, nil, errors.New("profile: nil key cache")
	}

	canon, err := locator.CanonicalHandle(in.Handle)
	if err != nil {
		return nil, nil, fmt.Errorf("profile: build: %w", err)
	}

	id := fednode.LocalIdentitySnapshot()
	if id.StationPeerID == "" || strings.TrimSpace(id.StationDomain) == "" {
		return nil, nil, errors.New("profile: build: local station identity not registered")
	}

	parts := strings.SplitN(canon, "@", 2)
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return nil, nil, fmt.Errorf("profile: build: malformed canonical handle %q", canon)
	}
	localPart, host := parts[0], parts[1]
	if !strings.EqualFold(host, id.StationDomain) {
		return nil, nil, fmt.Errorf("%w: handle host %q != local %q", ErrHandleNotLocal, host, id.StationDomain)
	}

	body, err := in.Fetcher.FetchByLocalHandle(ctx, localPart)
	if err != nil {
		return nil, nil, err
	}
	if body == nil {
		return nil, nil, ErrHandleNotLocal
	}

	localKey, err := in.Keys.Get(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("profile: build: load station key: %w", err)
	}

	now := time.Now()
	if in.Now != nil {
		now = in.Now()
	}

	return Sign(SignInput{
		Handle:            canon,
		HomeStationPeerID: id.StationPeerID.String(),
		HomeStationDomain: id.StationDomain,
		Profile:           body,
		Now:               now,
		TTL:               in.TTL,
		LocalKey:          localKey,
	})
}
