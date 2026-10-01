package usecase

import (
	"context"
	"errors"
	"fmt"
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
	identityID := strings.TrimSpace(input.IdentityID)
	if identityID == "" {
		return nil, errors.New("identity_id_required")
	}
	operationID := strings.TrimSpace(input.OperationID)
	if operationID == "" {
		return nil, errors.New("refresh_operation_id_required")
	}
	claim, err := u.Store.ClaimCredentialRefresh(
		ctx,
		identityID,
		operationID,
		u.Clock.Now(),
	)
	if err != nil {
		return nil, err
	}
	switch claim.State {
	case entity.CredentialRefreshClaimCommitted:
		return &claim.Credential, nil
	case entity.CredentialRefreshClaimUncertain:
		return nil, repository.ErrCredentialRefreshUncertain
	case entity.CredentialRefreshClaimAcquired:
	default:
		return nil, repository.ErrRecordCorrupt
	}
	current := claim.Credential
	if current.RefreshToken == "" {
		return u.releaseRefreshClaim(ctx, claim, repository.ErrCredentialNotRefreshable)
	}
	site, ok := u.Sites.Get(current.SiteID)
	if !ok {
		return u.releaseRefreshClaim(ctx, claim, errors.New("unknown_site"))
	}
	config, ok := site.Providers[current.Provider]
	if !ok {
		return u.releaseRefreshClaim(ctx, claim, errors.New("provider_not_enabled"))
	}
	provider, ok := u.Providers[current.Provider]
	if !ok {
		return u.releaseRefreshClaim(ctx, claim, errors.New("provider_gateway_missing"))
	}
	tokens, err := provider.RefreshToken(ctx, current.RefreshToken, config)
	if err != nil {
		return u.markRefreshUncertain(ctx, claim, PublicErrorCode(err))
	}
	if tokens == nil || strings.TrimSpace(tokens.AccessToken) == "" {
		return u.markRefreshUncertain(ctx, claim, "provider_refresh_failed")
	}
	replaced, err := u.Store.ReplaceCredential(ctx, entity.CredentialRefresh{
		IdentityID:         identityID,
		OperationID:        operationID,
		ClaimID:            claim.ClaimID,
		ExpectedGeneration: current.Generation,
		Tokens:             *tokens,
		RefreshedAt:        u.Clock.Now(),
	})
	if err == nil {
		return replaced, nil
	}
	resolved, resolveErr := u.Store.ClaimCredentialRefresh(
		ctx,
		identityID,
		operationID,
		u.Clock.Now(),
	)
	if resolveErr == nil && resolved.State == entity.CredentialRefreshClaimCommitted {
		return &resolved.Credential, nil
	}
	return u.markRefreshUncertain(ctx, claim, PublicErrorCode(err))
}

func (u RefreshCredentialUseCase) releaseRefreshClaim(
	ctx context.Context,
	claim *entity.CredentialRefreshClaim,
	cause error,
) (*entity.OAuthCredential, error) {
	if err := u.Store.ReleaseCredentialRefreshClaim(ctx, *claim); err != nil {
		return nil, repository.ErrCredentialRefreshUncertain
	}
	return nil, cause
}

func (u RefreshCredentialUseCase) markRefreshUncertain(
	ctx context.Context,
	claim *entity.CredentialRefreshClaim,
	errorCode string,
) (*entity.OAuthCredential, error) {
	if err := u.Store.MarkCredentialRefreshUncertain(
		ctx,
		*claim,
		errorCode,
		u.Clock.Now(),
	); err != nil {
		return nil, fmt.Errorf(
			"%w: persist refresh uncertainty: %v",
			repository.ErrCredentialRefreshUncertain,
			err,
		)
	}
	return nil, repository.ErrCredentialRefreshUncertain
}
