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
	if strings.TrimSpace(input.IdentityID) == "" {
		return nil, errors.New("identity_id_required")
	}
	if strings.TrimSpace(input.OperationID) == "" {
		return nil, errors.New("refresh_operation_id_required")
	}
	current, err := u.Store.LoadCredential(ctx, input.IdentityID)
	if err != nil {
		return nil, err
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
		return nil, err
	}
	return u.Store.ReplaceCredential(ctx, entity.CredentialRefresh{
		IdentityID:  input.IdentityID,
		OperationID: input.OperationID,
		Tokens:      *tokens,
		RefreshedAt: u.Clock.Now(),
	})
}
