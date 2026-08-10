package infrastructure

import (
	"context"
	"fmt"

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

var _ messaging.FederationFrameSigner = (*FederationFrameSigner)(nil)
