// federation_profile.go — touch-side glue between the federation
// profile builder and the local actor write path.
//
// The fetcher implements fedprofile.LocalProfileFetcher by reusing the
// existing GetWebProfile pipeline (DB row → ActorProfile proto). Living
// in the actor package keeps the implementation close to the data it
// reads; the Hertz handler lives one level up under frame/touch/ so it
// can reuse the package's response helpers.

package actor

import (
	"context"
	"errors"

	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	fedprofile "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile"
	modelpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/gorm"
)

// FederationProfileFetcher returns a fetcher that resolves local-handle
// → ActorProfile via the existing web profile path. Callers (the touch
// HTTP handler) instantiate one per request with the client's baseURL
// so the embedded ActivityPub `url` field stays correct under proxy
// configurations.
func FederationProfileFetcher(baseURL string) fedprofile.LocalProfileFetcher {
	return federationProfileFetcher{baseURL: baseURL}
}

type federationProfileFetcher struct {
	baseURL string
}

func (f federationProfileFetcher) FetchByLocalHandle(ctx context.Context, localHandle string) (*modelpb.ActorProfile, error) {
	resp, err := GetWebProfile(ctx, localHandle, f.baseURL)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fedprofile.ErrHandleNotLocal
		}
		return nil, err
	}
	if resp == nil {
		return nil, fedprofile.ErrHandleNotLocal
	}
	return WebProfileToActorProfileProto(resp), nil
}

// FederationKeyCache exposes the node-level federation key cache to
// other touch-layer packages (notably the federation profile HTTP
// handler) without making them re-derive the keystore wiring.
//
// Thin pass-through to `authfed.Singleton()` — the singleton owns the
// rotation fan-out so all federation consumers see a kid flip in
// bounded time off a single recheck ticker. This wrapper is kept
// only as a stable touch-layer alias; future call sites may import
// authfed directly.
func FederationKeyCache() *authfed.KeyCache {
	return authfed.Singleton()
}
