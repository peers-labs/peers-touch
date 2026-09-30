package usecase

import (
	"context"
	"errors"
	"strings"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/repository"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
)

const maxCredentialRefreshAttempts = 3

type RefreshCredentialInput struct {
	IdentityID  string
	OperationID string
}

type RefreshCredentialUseCase struct {
	Sites     SiteRegistry
	Store     repository.OAuthStore
	Providers map[valueobject.Provider]port.ProviderGateway
	Clock     Clock
}

func (u RefreshCredentialUseCase) Execute(ctx context.Context, input RefreshCredentialInput) (*entity.OAuthCredential, error) {
	identityID := strings.TrimSpace(input.IdentityID)
	if identityID == "" {
		return nil, errors.New("identity_id_required")
	}
	operationID := strings.TrimSpace(input.OperationID)
	if operationID == "" {
		return nil, errors.New("refresh_operation_id_required")
	}
	for attempt := 0; attempt < maxCredentialRefreshAttempts; attempt++ {
		current, completed, err := u.Store.LoadCredentialForRefresh(
			ctx,
			identityID,
			operationID,
		)
		if err != nil {
			return nil, err
		}
		if completed {
			return current, nil
		}
		if current.RefreshToken == "" {
			return nil, repository.ErrCredentialNotRefreshable
		}
		site, ok := u.Sites.Get(current.SiteID)
		if !ok {
			return nil, errors.New("unknown_site")
		}
		config, ok := site.Providers[current.Provider]
		if !ok {
			return nil, errors.New("provider_not_enabled")
		}
		provider, ok := u.Providers[current.Provider]
		if !ok {
			return nil, errors.New("provider_gateway_missing")
		}
		tokens, err := provider.RefreshToken(ctx, current.RefreshToken, config)
		if err != nil {
			return u.resolveRefreshFailure(ctx, identityID, operationID, err)
		}
		if tokens == nil || strings.TrimSpace(tokens.AccessToken) == "" {
			return u.resolveRefreshFailure(
				ctx,
				identityID,
				operationID,
				errors.New("provider_refresh_failed"),
			)
		}
		replaced, err := u.Store.ReplaceCredential(ctx, entity.CredentialRefresh{
			IdentityID:         identityID,
			OperationID:        operationID,
			ExpectedGeneration: current.Generation,
			Tokens:             *tokens,
			RefreshedAt:        u.Clock.Now(),
		})
		if errors.Is(err, repository.ErrCredentialGeneration) {
			continue
		}
		return replaced, err
	}
	return nil, repository.ErrCredentialGeneration
}

func (u RefreshCredentialUseCase) resolveRefreshFailure(
	ctx context.Context,
	identityID string,
	operationID string,
	providerErr error,
) (*entity.OAuthCredential, error) {
	current, completed, err := u.Store.LoadCredentialForRefresh(
		ctx,
		identityID,
		operationID,
	)
	if err != nil {
		return nil, err
	}
	if completed {
		return current, nil
	}
	return nil, providerErr
}
