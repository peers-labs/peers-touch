package infrastructure

import (
	"context"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

type FederationFrameSigner struct {
	keys *authfed.KeyCache
}

func NewFederationFrameSigner(keys *authfed.KeyCache) (*FederationFrameSigner, error) {
	if keys == nil {
		return nil, fmt.Errorf("messaging: federation frame signer requires Station keys")
	}
	return &FederationFrameSigner{keys: keys}, nil
}

func (s *FederationFrameSigner) SignFederationFrame(
	ctx context.Context,
	frame *chat.MessagingFederationFrame,
) error {
	key, err := s.keys.Get(ctx)
	if err != nil {
		return err
	}
	return application.SignFederationFrame(frame, key.Kid, key.Priv)
}

func (s *FederationFrameSigner) SignEndpointManifest(
	ctx context.Context,
	manifest *chat.FederatedEndpointManifest,
) error {
	key, err := s.keys.Get(ctx)
	if err != nil {
		return err
	}
	return application.SignEndpointManifest(manifest, key.Kid, key.Priv)
}

func (s *FederationFrameSigner) VerifyLocalEndpointManifest(
	ctx context.Context,
	manifest *chat.FederatedEndpointManifest,
	expectedHomeStationID string,
	now time.Time,
) error {
	key, err := s.keys.Get(ctx)
	if err != nil {
		return err
	}
	if manifest == nil {
		return messaging.ErrEndpointManifestInvalid
	}
	return application.VerifyEndpointManifest(
		manifest,
		manifest.ActorPtid,
		expectedHomeStationID,
		key.Kid,
		key.Pub,
		now,
	)
}

var _ messaging.FederationFrameSigner = (*FederationFrameSigner)(nil)
var _ messaging.EndpointManifestSigner = (*FederationFrameSigner)(nil)
var _ messaging.LocalEndpointManifestVerifier = (*FederationFrameSigner)(nil)
