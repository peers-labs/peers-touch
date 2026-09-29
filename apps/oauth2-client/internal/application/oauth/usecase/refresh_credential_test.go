package usecase

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
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

func refreshUseCase(store *memory.Store, provider *refreshProvider, now time.Time) RefreshCredentialUseCase {
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
	calls  int
	tokens entity.TokenSet
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

func (p *refreshProvider) RefreshToken(context.Context, string, port.ProviderConfig) (*entity.TokenSet, error) {
	p.calls++
	tokens := p.tokens
	return &tokens, nil
}
