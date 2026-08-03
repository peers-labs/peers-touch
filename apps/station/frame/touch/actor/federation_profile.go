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
	"crypto/ed25519"
	"errors"

	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	fedprofile "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile"
	profilepb "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile/pb"
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

func (f federationProfileFetcher) FetchDeviceSigningKeys(
	ctx context.Context,
	localHandle string,
) ([]*modelpb.VerifiedActorDeviceSigningKey, error) {
	actorRecord, err := GetActorByName(ctx, localHandle)
	if err != nil {
		return nil, err
	}
	if actorRecord == nil {
		return nil, fedprofile.ErrHandleNotLocal
	}
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, err
	}
	records, err := NewDeviceStore(rds).ListActive(ctx, actorRecord.PTID)
	if err != nil {
		return nil, err
	}
	keys := make([]*modelpb.VerifiedActorDeviceSigningKey, 0, len(records))
	for _, record := range records {
		if len(record.PublicKey) != ed25519.PublicKeySize ||
			record.SigningKeyID == "" ||
			record.VerificationSource != int32(modelpb.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION) {
			continue
		}
		keys = append(keys, &modelpb.VerifiedActorDeviceSigningKey{
			ActorPtid:          record.Ptid,
			ActorDeviceId:      record.DeviceID,
			HomeStationPeerId:  record.HomeStationPeerID,
			SigningKeyId:       record.SigningKeyID,
			Ed25519PublicKey:   record.PublicKey,
			ProfileVersion:     record.ProfileVersion,
			VerificationSource: modelpb.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE,
			ValidFromUnixMs:    record.CreatedAt.UnixMilli(),
		})
	}
	return keys, nil
}

// CacheVerifiedRemoteDeviceSigningKeys persists keys only after the caller has
// verified the enclosing Home Station profile envelope.
func CacheVerifiedRemoteDeviceSigningKeys(
	ctx context.Context,
	envelope *profilepb.ActorProfileEnvelope,
) error {
	if envelope == nil {
		return ErrDeviceSigningKeyNotFound
	}
	keys := envelope.DeviceSigningKeys
	if len(keys) == 0 {
		return nil
	}
	if envelope.Profile == nil ||
		envelope.Profile.PeersTouch == nil ||
		envelope.Profile.PeersTouch.NetworkId == "" {
		return ErrDeviceSigningKeyNotFound
	}
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}
	deviceStore := NewDeviceStore(rds)
	if err := deviceStore.AutoMigrate(); err != nil {
		return err
	}
	for _, key := range keys {
		if key == nil ||
			key.ActorPtid != envelope.Profile.PeersTouch.NetworkId ||
			key.HomeStationPeerId != envelope.HomeStationPeerId {
			return ErrDeviceSigningKeyConflict
		}
		if err := deviceStore.UpsertVerifiedRemote(ctx, key); err != nil {
			return err
		}
	}
	return nil
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
