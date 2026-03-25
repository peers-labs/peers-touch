package auth

import (
	"context"
	"errors"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
)

type OAuth2Orchestrator struct {
	oauth2     *coreauth.OAuth2Service
	config     coreauth.OAuth2ConfigSource
	stateStore *OAuth2StateStore
}

func NewOAuth2Orchestrator(
	oauth2 *coreauth.OAuth2Service,
	config coreauth.OAuth2ConfigSource,
	stateStore *OAuth2StateStore,
) *OAuth2Orchestrator {
	return &OAuth2Orchestrator{
		oauth2:     oauth2,
		config:     config,
		stateStore: stateStore,
	}
}

func (o *OAuth2Orchestrator) BindIdentityAndToken(
	ctx context.Context,
	actorID uint64,
	identity *coreauth.OAuth2Identity,
	token *coreauth.OAuth2TokenState,
	primary bool,
) error {
	if identity == nil || token == nil {
		return ErrOAuth2ProviderError
	}
	if err := o.stateStore.BindActor(ctx, actorID, identity, primary); err != nil {
		return err
	}
	if token.Status == "" {
		token.Status = coreauth.OAuth2TokenStatusActive
	}
	return o.stateStore.SaveByActorProvider(ctx, actorID, token)
}

func (o *OAuth2Orchestrator) EnsureFreshToken(
	ctx context.Context,
	actorID uint64,
	providerID coreauth.OAuth2ProviderID,
) (*coreauth.OAuth2TokenState, error) {
	token, err := o.stateStore.GetByActorProvider(ctx, actorID, providerID)
	if err != nil {
		return nil, err
	}
	if token == nil {
		return nil, ErrOAuth2ReauthRequired
	}
	if token.Status == coreauth.OAuth2TokenStatusReauthRequired {
		return nil, ErrOAuth2ReauthRequired
	}
	if !needsRefresh(token, 5*time.Minute) {
		return token, nil
	}
	if token.RefreshToken == "" {
		_ = o.stateStore.MarkReauthRequired(ctx, actorID, providerID, "missing_refresh_token")
		return nil, ErrOAuth2ReauthRequired
	}
	cfg, err := o.config.GetProviderConfig(ctx, providerID)
	if err != nil || cfg == nil {
		_ = o.stateStore.MarkReauthRequired(ctx, actorID, providerID, "missing_provider_config")
		if err != nil {
			return nil, err
		}
		return nil, ErrOAuth2ReauthRequired
	}
	adapter := o.oauth2.Adapter(providerID)
	if adapter == nil {
		_ = o.stateStore.MarkReauthRequired(ctx, actorID, providerID, "missing_oauth2_adapter")
		return nil, ErrOAuth2ReauthRequired
	}
	refreshed, err := adapter.RefreshToken(ctx, *cfg, token.RefreshToken)
	if err != nil {
		_ = o.stateStore.MarkReauthRequired(ctx, actorID, providerID, err.Error())
		return nil, errors.Join(ErrOAuth2ReauthRequired, err)
	}
	refreshed.ProviderID = providerID
	refreshed.Status = coreauth.OAuth2TokenStatusActive
	refreshed.LastRefreshAtUnix = time.Now().UTC().Unix()
	refreshed.LastError = ""
	if err := o.stateStore.SaveByActorProvider(ctx, actorID, refreshed); err != nil {
		return nil, err
	}
	return refreshed, nil
}

func needsRefresh(token *coreauth.OAuth2TokenState, threshold time.Duration) bool {
	if token == nil || token.ExpiresAtUnix <= 0 {
		return true
	}
	expireAt := time.Unix(token.ExpiresAtUnix, 0)
	return time.Until(expireAt) <= threshold
}
