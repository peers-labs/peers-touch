package usecase

import (
	"context"
	"net/url"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/persistence/memory"
)

func TestStartAuthAcceptsOnlyConfiguredReturnDestination(t *testing.T) {
	store := memory.NewStore()
	provider := &startProvider{}
	useCase := StartAuthUseCase{
		Sites: staticSites{"main": {
			SiteID:          "main",
			SuccessURL:      "https://app.example/success",
			ErrorURL:        "https://app.example/error",
			AllowedReturnTo: []string{"peers-touch://oauth/callback"},
			Providers: map[valueobject.Provider]port.ProviderConfig{
				valueobject.ProviderGitHub: {ClientID: "client"},
			},
		}},
		Store:     store,
		Providers: map[valueobject.Provider]port.ProviderGateway{valueobject.ProviderGitHub: provider},
		Clock:     fixedClock{now: time.Date(2026, 9, 30, 1, 0, 0, 0, time.UTC)},
	}

	redirect, err := useCase.Execute(context.Background(), StartAuthInput{
		SiteID:   "main",
		Provider: valueobject.ProviderGitHub,
		ReturnTo: "https://attacker.example/steal",
	})
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(redirect)
	session, err := store.FindAuthorization(context.Background(), parsed.Query().Get("state"))
	if err != nil {
		t.Fatal(err)
	}
	if session == nil || session.ReturnTo != "" {
		t.Fatalf("unapproved return_to was persisted: %#v", session)
	}

	redirect, err = useCase.Execute(context.Background(), StartAuthInput{
		SiteID:   "main",
		Provider: valueobject.ProviderGitHub,
		ReturnTo: "peers-touch://oauth/callback?request=123#fragment",
	})
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ = url.Parse(redirect)
	session, err = store.FindAuthorization(context.Background(), parsed.Query().Get("state"))
	if err != nil {
		t.Fatal(err)
	}
	if session == nil || session.ReturnTo != "peers-touch://oauth/callback?request=123" {
		t.Fatalf("approved return_to was not normalized: %#v", session)
	}
}

type staticSites map[string]SiteConfig

func (s staticSites) Get(siteID string) (SiteConfig, bool) {
	site, ok := s[siteID]
	return site, ok
}

type fixedClock struct {
	now time.Time
}

func (c fixedClock) Now() time.Time { return c.now }

type startProvider struct{}

func (*startProvider) Provider() valueobject.Provider {
	return valueobject.ProviderGitHub
}

func (*startProvider) AuthorizeURL(state, verifier string, _ port.ProviderConfig) (string, error) {
	return "https://provider.example/authorize?state=" + url.QueryEscape(state) + "&verifier=" + url.QueryEscape(verifier), nil
}

func (*startProvider) ExchangeCode(context.Context, string, string, port.ProviderConfig) (*entity.AuthorizationGrant, error) {
	panic("not used")
}

func (*startProvider) RefreshToken(context.Context, string, port.ProviderConfig) (*entity.TokenSet, error) {
	panic("not used")
}
