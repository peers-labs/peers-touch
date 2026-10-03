package usecase

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/repository"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/persistence/memory"
)

func TestRefreshCredentialReturnsCommittedDuplicateWithoutProviderCall(t *testing.T) {
	store, identityID, now := seededRefreshStore(t)
	provider := &refreshProvider{
		tokens: entity.TokenSet{
			AccessToken: "access-new",
			TokenType:   "Bearer",
			Scope:       "openid email",
			ObtainedAt:  now.Add(time.Hour),
		},
	}
	claimObserved := false
	provider.onRefresh = func() {
		claim, err := store.ClaimCredentialRefresh(
			context.Background(),
			identityID,
			"refresh-1",
			now.Add(time.Hour),
		)
		if err != nil {
			t.Fatal(err)
		}
		claimObserved = claim.State == entity.CredentialRefreshClaimUncertain
	}
	useCase := refreshUseCase(store, provider, now.Add(time.Hour))

	first, err := useCase.Execute(context.Background(), RefreshCredentialInput{
		IdentityID:  identityID,
		OperationID: "refresh-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := useCase.Execute(context.Background(), RefreshCredentialInput{
		IdentityID:  identityID,
		OperationID: "refresh-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if provider.calls != 1 {
		t.Fatalf("duplicate operation called provider %d times", provider.calls)
	}
	if !claimObserved {
		t.Fatal("provider was called before the durable refresh claim")
	}
	if first.Generation != 2 || second.Generation != 2 ||
		first.AccessToken != "access-new" ||
		second.LastRefreshOperationID != "refresh-1" {
		t.Fatalf("duplicate refresh did not converge: first=%#v second=%#v", first, second)
	}
	snapshot, err := store.AdminSnapshot(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	refreshEvents := 0
	for _, event := range snapshot.Events {
		if event.EventType == entity.AuditCredentialRefreshed {
			refreshEvents++
		}
	}
	if refreshEvents != 1 {
		t.Fatalf("expected one refresh audit event, got %d", refreshEvents)
	}
	t.Run(
		"provider failure becomes durable uncertainty",
		assertRefreshCredentialMarksProviderFailureUncertain,
	)
}

func assertRefreshCredentialMarksProviderFailureUncertain(t *testing.T) {
	store, identityID, now := seededRefreshStore(t)
	providerErr := errors.New("provider_temporarily_unavailable")
	provider := &refreshProvider{err: providerErr}

	useCase := refreshUseCase(store, provider, now.Add(time.Hour))
	credential, err := useCase.Execute(
		context.Background(),
		RefreshCredentialInput{
			IdentityID:  identityID,
			OperationID: "refresh-without-winner",
		},
	)
	if credential != nil ||
		!errors.Is(err, repository.ErrCredentialRefreshUncertain) ||
		provider.calls != 1 {
		t.Fatalf("provider failure was not fenced: credential=%#v err=%v calls=%d", credential, err, provider.calls)
	}
	credential, err = useCase.Execute(context.Background(), RefreshCredentialInput{
		IdentityID:  identityID,
		OperationID: "refresh-without-winner",
	})
	if credential != nil ||
		!errors.Is(err, repository.ErrCredentialRefreshUncertain) ||
		provider.calls != 1 {
		t.Fatalf("uncertain retry reached provider: credential=%#v err=%v calls=%d", credential, err, provider.calls)
	}
	snapshot, snapshotErr := store.AdminSnapshot(context.Background(), 10)
	if snapshotErr != nil {
		t.Fatal(snapshotErr)
	}
	uncertainEvents := 0
	for _, event := range snapshot.Events {
		if event.EventType == entity.AuditCredentialRefreshUncertain {
			uncertainEvents++
		}
	}
	if uncertainEvents != 1 {
		t.Fatalf("expected one uncertain refresh audit, got %d", uncertainEvents)
	}
}

func TestRefreshCredentialReleasesClaimBeforeProviderCall(t *testing.T) {
	store, identityID, now := seededRefreshStore(t)
	provider := &refreshProvider{tokens: entity.TokenSet{
		AccessToken: "access-after-config-fix",
		ObtainedAt:  now.Add(2 * time.Hour),
	}}
	input := RefreshCredentialInput{
		IdentityID:  identityID,
		OperationID: "refresh-after-config-fix",
	}
	misconfigured := RefreshCredentialUseCase{
		Sites:     staticSites{},
		Store:     store,
		Providers: map[valueobject.Provider]port.ProviderGateway{},
		Clock:     fixedClock{now: now.Add(time.Hour)},
	}
	if credential, err := misconfigured.Execute(context.Background(), input); credential != nil || err == nil || err.Error() != "unknown_site" {
		t.Fatalf("unexpected pre-provider failure: credential=%#v err=%v", credential, err)
	}
	if provider.calls != 0 {
		t.Fatalf("pre-provider failure called provider %d times", provider.calls)
	}

	credential, err := refreshUseCase(store, provider, now.Add(2*time.Hour)).Execute(
		context.Background(),
		input,
	)
	if err != nil {
		t.Fatal(err)
	}
	if provider.calls != 1 ||
		credential.AccessToken != "access-after-config-fix" ||
		credential.LastRefreshOperationID != input.OperationID {
		t.Fatalf("released refresh did not recover: credential=%#v calls=%d", credential, provider.calls)
	}
}

func TestRefreshCredentialReportsUncertaintyPersistenceFailure(t *testing.T) {
	baseStore, identityID, now := seededRefreshStore(t)
	store := &markUncertainFailureStore{Store: baseStore}
	provider := &refreshProvider{err: errors.New("provider_temporarily_unavailable")}

	credential, err := refreshUseCase(store, provider, now.Add(time.Hour)).Execute(
		context.Background(),
		RefreshCredentialInput{
			IdentityID:  identityID,
			OperationID: "refresh-uncertainty-write-failed",
		},
	)
	if credential != nil ||
		!errors.Is(err, repository.ErrCredentialRefreshUncertain) ||
		!strings.Contains(err.Error(), repository.ErrStorageUnavailable.Error()) {
		t.Fatalf("uncertainty persistence failure was hidden: credential=%#v err=%v", credential, err)
	}
}

func TestRefreshCredentialRemembersEarlierOperation(t *testing.T) {
	store, identityID, now := seededRefreshStore(t)
	provider := &refreshProvider{tokens: entity.TokenSet{
		AccessToken: "access-a",
		ObtainedAt:  now.Add(time.Hour),
	}}
	useCase := refreshUseCase(store, provider, now.Add(time.Hour))

	first, err := useCase.Execute(context.Background(), RefreshCredentialInput{
		IdentityID: identityID, OperationID: "refresh-a",
	})
	if err != nil {
		t.Fatal(err)
	}
	provider.tokens = entity.TokenSet{
		AccessToken: "access-b",
		ObtainedAt:  now.Add(2 * time.Hour),
	}
	second, err := useCase.Execute(context.Background(), RefreshCredentialInput{
		IdentityID: identityID, OperationID: "refresh-b",
	})
	if err != nil {
		t.Fatal(err)
	}
	provider.tokens = entity.TokenSet{
		AccessToken: "must-not-be-used",
		ObtainedAt:  now.Add(3 * time.Hour),
	}
	replayed, err := useCase.Execute(context.Background(), RefreshCredentialInput{
		IdentityID: identityID, OperationID: "refresh-a",
	})
	if err != nil {
		t.Fatal(err)
	}
	if provider.calls != 2 || first.Generation != 2 || second.Generation != 3 ||
		replayed.Generation != 3 || replayed.AccessToken != "access-b" {
		t.Fatalf("non-consecutive duplicate did not converge: calls=%d first=%#v second=%#v replayed=%#v", provider.calls, first, second, replayed)
	}
	snapshot, err := store.AdminSnapshot(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	refreshEvents := 0
	for _, event := range snapshot.Events {
		if event.EventType == entity.AuditCredentialRefreshed {
			refreshEvents++
		}
	}
	if refreshEvents != 2 {
		t.Fatalf("expected two refresh audit events, got %d", refreshEvents)
	}
}

func TestRefreshCredentialPreservesOmittedRefreshToken(t *testing.T) {
	store, identityID, now := seededRefreshStore(t)
	provider := &refreshProvider{
		tokens: entity.TokenSet{
			AccessToken: "access-new",
			TokenType:   "Bearer",
			Scope:       "openid email",
			ObtainedAt:  now.Add(time.Hour),
		},
	}
	credential, err := refreshUseCase(store, provider, now.Add(time.Hour)).Execute(
		context.Background(),
		RefreshCredentialInput{
			IdentityID:  identityID,
			OperationID: "refresh-2",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if credential.RefreshToken != "refresh-old" {
		t.Fatalf("refresh token was not retained: %#v", credential)
	}
}

func TestRefreshCredentialResolvesCommittedLostStoreResponseWithoutSecondProviderCall(t *testing.T) {
	baseStore, identityID, now := seededRefreshStore(t)
	store := &lostReplacementResponseStore{Store: baseStore}
	provider := &refreshProvider{tokens: entity.TokenSet{
		AccessToken: "access-final",
		ObtainedAt:  now.Add(2 * time.Hour),
	}}
	credential, err := refreshUseCase(store, provider, now.Add(2*time.Hour)).Execute(
		context.Background(),
		RefreshCredentialInput{
			IdentityID:  identityID,
			OperationID: "refresh-after-conflict",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if provider.calls != 1 ||
		len(provider.refreshTokens) != 1 ||
		provider.refreshTokens[0] != "refresh-old" {
		t.Fatalf("lost store response repeated provider refresh: %#v", provider.refreshTokens)
	}
	if credential.Generation != 2 ||
		credential.AccessToken != "access-final" ||
		credential.RefreshToken != "refresh-old" {
		t.Fatalf("unexpected credential after lost response recovery: %#v", credential)
	}
}

func seededRefreshStore(t *testing.T) (*memory.Store, string, time.Time) {
	t.Helper()
	store := memory.NewStore()
	now := time.Date(2026, 9, 30, 3, 0, 0, 0, time.UTC)
	session := entity.AuthSession{
		State:     "refresh-state",
		SiteID:    "main",
		Provider:  valueobject.ProviderGoogle,
		Verifier:  "verifier",
		CreatedAt: now,
		ExpiresAt: now.Add(10 * time.Minute),
	}
	if err := store.CreateAuthorization(context.Background(), session); err != nil {
		t.Fatal(err)
	}
	identity, err := store.CompleteAuthorization(context.Background(), entity.AuthorizationCompletion{
		State:        session.State,
		CompletionID: "login-1",
		Identity: entity.ProviderIdentity{
			ProviderUserID: "subject",
		},
		Tokens: entity.TokenSet{
			AccessToken:  "access-old",
			RefreshToken: "refresh-old",
			TokenType:    "Bearer",
			Scope:        "openid email",
			ObtainedAt:   now,
		},
		CompletedAt: now.Add(time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	return store, identity.IdentityID, now
}

func refreshUseCase(store repository.OAuthStore, provider *refreshProvider, now time.Time) RefreshCredentialUseCase {
	return RefreshCredentialUseCase{
		Sites: staticSites{"main": {
			SiteID: "main",
			Providers: map[valueobject.Provider]port.ProviderConfig{
				valueobject.ProviderGoogle: {
					ClientID:     "client",
					ClientSecret: "secret",
				},
			},
		}},
		Store: store,
		Providers: map[valueobject.Provider]port.ProviderGateway{
			valueobject.ProviderGoogle: provider,
		},
		Clock: fixedClock{now: now},
	}
}

type refreshProvider struct {
	calls         int
	refreshTokens []string
	tokens        entity.TokenSet
	err           error
	onRefresh     func()
}

func (*refreshProvider) Provider() valueobject.Provider {
	return valueobject.ProviderGoogle
}

func (*refreshProvider) AuthorizeURL(string, string, port.ProviderConfig) (string, error) {
	panic("not used")
}

func (*refreshProvider) ExchangeCode(context.Context, string, string, port.ProviderConfig) (*entity.AuthorizationGrant, error) {
	panic("not used")
}

func (p *refreshProvider) RefreshToken(_ context.Context, refreshToken string, _ port.ProviderConfig) (*entity.TokenSet, error) {
	p.calls++
	p.refreshTokens = append(p.refreshTokens, refreshToken)
	if p.onRefresh != nil {
		p.onRefresh()
	}
	if p.err != nil {
		return nil, p.err
	}
	tokens := p.tokens
	return &tokens, nil
}

type lostReplacementResponseStore struct {
	*memory.Store
	injected bool
}

type markUncertainFailureStore struct {
	*memory.Store
}

func (s *markUncertainFailureStore) MarkCredentialRefreshUncertain(
	context.Context,
	entity.CredentialRefreshClaim,
	string,
	time.Time,
) error {
	return repository.ErrStorageUnavailable
}

func (s *lostReplacementResponseStore) ReplaceCredential(
	ctx context.Context,
	refresh entity.CredentialRefresh,
) (*entity.OAuthCredential, error) {
	if !s.injected {
		s.injected = true
		if _, err := s.Store.ReplaceCredential(ctx, refresh); err != nil {
			return nil, err
		}
		return nil, repository.ErrStorageUnavailable
	}
	return s.Store.ReplaceCredential(ctx, refresh)
}
