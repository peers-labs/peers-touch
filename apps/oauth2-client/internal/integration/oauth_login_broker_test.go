package integration_test

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/usecase"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
	recordcrypto "github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/crypto"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/persistence/memory"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/interfaces/http/handler"
)

func TestOAuthLoginBrokerCrossInstanceHTTPJourney(t *testing.T) {
	runOAuthHTTPJourney(t)
}

func TestOAuthLoginBrokerJourney(t *testing.T) {
	store := runOAuthHTTPJourney(t)
	auth, err := handler.NewBasicAuthenticator(
		"operator",
		"pbkdf2-sha256$100000$MDEyMzQ1Njc4OWFiY2RlZg==$pnq3X8b0RCPy3QPbc4tMRNkzzR3dLJBRf6HfSFzQh1Y=",
		false,
	)
	if err != nil {
		t.Fatal(err)
	}
	admin := &handler.AdminHandler{Store: store, Auth: auth}
	adminServer := httptest.NewServer(http.HandlerFunc(admin.Page))
	defer adminServer.Close()

	unauthorized, err := adminServer.Client().Get(adminServer.URL)
	if err != nil {
		t.Fatal(err)
	}
	_ = unauthorized.Body.Close()
	if unauthorized.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unexpected unauthenticated status: %d", unauthorized.StatusCode)
	}

	request, err := http.NewRequest(http.MethodGet, adminServer.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.SetBasicAuth("operator", "correct-password")
	response, err := adminServer.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK ||
		!strings.Contains(string(body), "Alice") ||
		!strings.Contains(string(body), "Present") {
		t.Fatalf("unexpected operator response: status=%d body=%s", response.StatusCode, body)
	}
	for _, secret := range []string{"access-secret", "refresh-secret", "state-secret", "verifier-secret"} {
		if strings.Contains(string(body), secret) {
			t.Fatalf("operator response leaked %q", secret)
		}
	}
}

func runOAuthHTTPJourney(t *testing.T) *memory.Store {
	t.Helper()
	store := memory.NewStore()
	provider := &httpJourneyProvider{}
	now := time.Date(2026, 9, 30, 2, 0, 0, 0, time.UTC)
	sites := integrationSites{"main": {
		SiteID:          "main",
		SuccessURL:      "https://app.example/success",
		ErrorURL:        "https://app.example/error",
		AllowedReturnTo: []string{"peers-touch://oauth/callback"},
		BridgeSecret:    "bridge-secret",
		Providers: map[valueobject.Provider]port.ProviderConfig{
			valueobject.ProviderGitHub: {
				ClientID:     "client",
				ClientSecret: "provider-secret",
				RedirectURI:  "https://broker.example/api/oauth/github/callback",
			},
		},
	}}
	providers := map[valueobject.Provider]port.ProviderGateway{
		valueobject.ProviderGitHub: provider,
	}

	startContainer := &handler.OAuthHandler{
		StartAuth: usecase.StartAuthUseCase{
			Sites:     sites,
			Store:     store,
			Providers: providers,
			Clock:     integrationClock{now: now},
		},
	}
	callbackContainer := &handler.OAuthHandler{
		HandleCallback: usecase.HandleCallbackUseCase{
			Sites:         sites,
			Store:         store,
			Providers:     providers,
			Fingerprinter: recordcrypto.NewFingerprinter([]byte("integration-audit-key-32-bytes!!")),
			Clock:         integrationClock{now: now.Add(time.Minute)},
		},
	}

	startServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		startContainer.StartWithProvider(w, r, valueobject.ProviderGitHub)
	}))
	defer startServer.Close()
	callbackServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callbackContainer.CallbackWithProvider(w, r, valueobject.ProviderGitHub)
	}))
	defer callbackServer.Close()

	client := startServer.Client()
	client.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	startURL := startServer.URL + "?" + url.Values{
		"site_id":   {"main"},
		"return_to": {"peers-touch://oauth/callback?request=123"},
	}.Encode()
	startResponse, err := client.Get(startURL)
	if err != nil {
		t.Fatal(err)
	}
	defer startResponse.Body.Close()
	if startResponse.StatusCode != http.StatusFound {
		t.Fatalf("unexpected start status: %d", startResponse.StatusCode)
	}
	providerRedirect, err := url.Parse(startResponse.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	state := providerRedirect.Query().Get("state")
	if state == "" || providerRedirect.Query().Get("code_challenge") == "" {
		t.Fatalf("start redirect omitted state or PKCE: %s", providerRedirect)
	}

	callbackURL := callbackServer.URL + "?" + url.Values{
		"state": {state},
		"code":  {"one-time-code"},
	}.Encode()
	callbackResponse, err := client.Get(callbackURL)
	if err != nil {
		t.Fatal(err)
	}
	defer callbackResponse.Body.Close()
	if callbackResponse.StatusCode != http.StatusFound {
		t.Fatalf("unexpected callback status: %d", callbackResponse.StatusCode)
	}
	success, err := url.Parse(callbackResponse.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if success.Scheme != "peers-touch" ||
		success.Query().Get("request") != "123" ||
		success.Query().Get("provider_user_id") != "provider-user" ||
		success.Query().Get("bridge_version") != "v1" ||
		success.Query().Get("sig") == "" ||
		success.Query().Get("state") != "" {
		t.Fatalf("unexpected success redirect: %s", success)
	}

	replayResponse, err := client.Get(callbackURL)
	if err != nil {
		t.Fatal(err)
	}
	defer replayResponse.Body.Close()
	if replayResponse.StatusCode != http.StatusFound {
		t.Fatalf("unexpected replay status: %d", replayResponse.StatusCode)
	}
	replay, err := url.Parse(replayResponse.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if replay.Query().Get("error") != "state_consumed" ||
		strings.Contains(replay.String(), state) {
		t.Fatalf("unexpected replay redirect: %s", replay)
	}
	if provider.exchangeCalls.Load() != 1 {
		t.Fatalf("replayed callback reached provider %d times", provider.exchangeCalls.Load())
	}

	snapshot, err := store.AdminSnapshot(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Identities) != 1 ||
		snapshot.Identities[0].LoginCount != 1 ||
		!snapshot.Identities[0].HasRefreshToken ||
		len(snapshot.Events) != 2 {
		t.Fatalf("unexpected durable readback: %#v", snapshot)
	}
	return store
}

type integrationSites map[string]usecase.SiteConfig

func (s integrationSites) Get(siteID string) (usecase.SiteConfig, bool) {
	site, ok := s[siteID]
	return site, ok
}

type integrationClock struct {
	now time.Time
}

func (c integrationClock) Now() time.Time {
	return c.now
}

type httpJourneyProvider struct {
	exchangeCalls atomic.Int32
}

func (*httpJourneyProvider) Provider() valueobject.Provider {
	return valueobject.ProviderGitHub
}

func (*httpJourneyProvider) AuthorizeURL(state, verifier string, _ port.ProviderConfig) (string, error) {
	if state == "" || verifier == "" {
		return "", errors.New("missing_oauth_correlation")
	}
	return "https://provider.example/authorize?" + url.Values{
		"state":          {state},
		"code_challenge": {verifier},
	}.Encode(), nil
}

func (p *httpJourneyProvider) ExchangeCode(_ context.Context, code, verifier string, _ port.ProviderConfig) (*entity.AuthorizationGrant, error) {
	p.exchangeCalls.Add(1)
	if code != "one-time-code" || verifier == "" {
		return nil, errors.New("provider_exchange_failed")
	}
	return &entity.AuthorizationGrant{
		Identity: entity.ProviderIdentity{
			ProviderUserID: "provider-user",
			Username:       "alice",
			DisplayName:    "Alice",
			Email:          "alice@example.com",
			EmailVerified:  true,
		},
		Tokens: entity.TokenSet{
			AccessToken:  "access-secret",
			RefreshToken: "refresh-secret",
			TokenType:    "Bearer",
			Scope:        "read:user",
			ObtainedAt:   time.Date(2026, 9, 30, 2, 1, 0, 0, time.UTC),
		},
	}, nil
}

func (*httpJourneyProvider) RefreshToken(context.Context, string, port.ProviderConfig) (*entity.TokenSet, error) {
	return nil, errors.New("not_implemented")
}
