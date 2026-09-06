package infrastructure

import (
	"context"
	"fmt"
	"strings"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	federationresolver "github.com/peers-labs/peers-touch/station/frame/touch/federation/resolver"
	actordb "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

type federatedActorResolveFunc func(
	context.Context,
	string,
) (*federationresolver.Resolved, error)

type FederationPeerTrustResolver struct {
	db        *gorm.DB
	peerKeys  authfed.PeerKeyStore
	resolveBy federatedActorResolveFunc
}

func NewFederationPeerTrustResolver(
	db *gorm.DB,
	peerKeys authfed.PeerKeyStore,
) (*FederationPeerTrustResolver, error) {
	return newFederationPeerTrustResolver(
		db,
		peerKeys,
		func(
			ctx context.Context,
			handle string,
		) (*federationresolver.Resolved, error) {
			return federationresolver.New(federationresolver.Config{
				SkipCache: true,
				PeerKeys:  peerKeys,
			}).ResolveByHandle(ctx, handle, nil, nil)
		},
	)
}

func newFederationPeerTrustResolver(
	db *gorm.DB,
	peerKeys authfed.PeerKeyStore,
	resolveBy federatedActorResolveFunc,
) (*FederationPeerTrustResolver, error) {
	if db == nil || peerKeys == nil || resolveBy == nil {
		return nil, fmt.Errorf("messaging: federation peer trust dependencies are invalid")
	}
	return &FederationPeerTrustResolver{
		db:        db,
		peerKeys:  peerKeys,
		resolveBy: resolveBy,
	}, nil
}

func (r *FederationPeerTrustResolver) EnsurePeerTrust(
	ctx context.Context,
	homeStationID string,
	actorPTID string,
) error {
	if strings.TrimSpace(homeStationID) == "" || strings.TrimSpace(actorPTID) == "" {
		return messaging.ErrEndpointManifestInvalid
	}
	var actor actordb.Actor
	if err := r.db.WithContext(ctx).
		Select("ptid", "federated_handle", "home_station_peer_id", "origin").
		Where("ptid = ? AND origin = ?", actorPTID, touchactor.OriginRemoteCached).
		First(&actor).Error; err != nil {
		return mapNotFound(err)
	}
	if actor.FederatedHandle == "" || actor.HomeStationPeerID != homeStationID {
		return messaging.ErrEndpointManifestConflict
	}

	resolved, err := r.resolveBy(ctx, actor.FederatedHandle)
	if err != nil {
		return fmt.Errorf(
			"messaging: resolve federation trust actor=%s: %w",
			actorPTID,
			err,
		)
	}
	if resolved == nil ||
		resolved.Envelope == nil ||
		resolved.Locator == nil ||
		resolved.Envelope.GetProfile() == nil ||
		resolved.Envelope.GetProfile().GetPeersTouch() == nil ||
		resolved.Envelope.GetProfile().GetPeersTouch().GetNetworkId() != actorPTID ||
		resolved.Envelope.GetHomeStationPeerId() != homeStationID ||
		resolved.Locator.GetHomeStationPeerId() != homeStationID {
		return messaging.ErrEndpointManifestConflict
	}

	peerKey, err := r.peerKeys.Get(ctx, homeStationID)
	if err != nil {
		return err
	}
	if peerKey == nil ||
		peerKey.Kid != resolved.Locator.GetSigningKeyKid() ||
		strings.TrimSpace(peerKey.PubPEM) !=
			strings.TrimSpace(resolved.Locator.GetSigningKeyPem()) {
		return messaging.ErrEndpointManifestSignature
	}
	return nil
}

var _ messaging.FederationPeerTrustResolver = (*FederationPeerTrustResolver)(nil)
