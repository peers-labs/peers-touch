package auth

import (
	"context"
	"errors"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
)

var (
	GlobalOAuth2StateStore  = NewOAuth2StateStore()
	GlobalOAuth2Orchestrator *OAuth2Orchestrator
)

func InitOAuth2Orchestrator(config coreauth.OAuth2ConfigSource, adapters []coreauth.OAuth2Adapter) {
	svc := coreauth.NewOAuth2Service(adapters)
	GlobalOAuth2Orchestrator = NewOAuth2Orchestrator(svc, config, GlobalOAuth2StateStore)
}

func UpsertOAuth2ConnectionProvider(ctx context.Context, provider *coreauth.ConnectionProvider) error {
	return GlobalOAuth2StateStore.UpsertProvider(ctx, provider)
}

func ListOAuth2ConnectionProviders(ctx context.Context) ([]*coreauth.ConnectionProvider, error) {
	return GlobalOAuth2StateStore.ListProviders(ctx)
}

func BindOAuth2Identity(
	ctx context.Context,
	actorID uint64,
	identity *coreauth.OAuth2Identity,
	token *coreauth.OAuth2TokenState,
	primary bool,
) error {
	if GlobalOAuth2Orchestrator == nil {
		return errors.New("oauth2 orchestrator not initialized")
	}
	return GlobalOAuth2Orchestrator.BindIdentityAndToken(ctx, actorID, identity, token, primary)
}

func EnsureOAuth2Token(
	ctx context.Context,
	actorID uint64,
	providerID coreauth.OAuth2ProviderID,
) (*coreauth.OAuth2TokenState, error) {
	if GlobalOAuth2Orchestrator == nil {
		return nil, errors.New("oauth2 orchestrator not initialized")
	}
	return GlobalOAuth2Orchestrator.EnsureFreshToken(ctx, actorID, providerID)
}
