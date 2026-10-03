package integration_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	healthhandler "github.com/peers-labs/peers-touch/oauth2-client/api/healthz"
	githubcallback "github.com/peers-labs/peers-touch/oauth2-client/api/oauth/github/callback"
	githubstart "github.com/peers-labs/peers-touch/oauth2-client/api/oauth/github/start"
	googlecallback "github.com/peers-labs/peers-touch/oauth2-client/api/oauth/google/callback"
	googlestart "github.com/peers-labs/peers-touch/oauth2-client/api/oauth/google/start"
	weixincallback "github.com/peers-labs/peers-touch/oauth2-client/api/oauth/weixin/callback"
	weixinstart "github.com/peers-labs/peers-touch/oauth2-client/api/oauth/weixin/start"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/usecase"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/repository"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
	recordcrypto "github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/crypto"
	githubstore "github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/persistence/github"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/interfaces/http/handler"
)

func TestOAuthLoginBrokerCrossInstanceHTTPJourney(t *testing.T) {
	runOAuthHTTPJourney(t)
}

func TestOAuthVercelRoutesMatchHandlers(t *testing.T) {
	handlers := map[string]http.HandlerFunc{
		"/api/healthz":               healthhandler.Handler,
		"/api/oauth/github/start":    githubstart.Handler,
		"/api/oauth/github/callback": githubcallback.Handler,
		"/api/oauth/google/start":    googlestart.Handler,
		"/api/oauth/google/callback": googlecallback.Handler,
		"/api/oauth/weixin/start":    weixinstart.Handler,
		"/api/oauth/weixin/callback": weixincallback.Handler,
	}
	content, err := os.ReadFile("../../vercel.json")
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		Routes []struct {
			Source      string `json:"src"`
			Destination string `json:"dest"`
		} `json:"routes"`
	}
	if err := json.Unmarshal(content, &config); err != nil {
		t.Fatal(err)
	}
	configured := make(map[string]string, len(config.Routes))
	for _, route := range config.Routes {
		configured[route.Source] = route.Destination
	}
	for route, routeHandler := range handlers {
		if routeHandler == nil {
			t.Fatalf("route %s has no compiled handler", route)
		}
		if configured[route] != route {
			t.Fatalf("route %s is not mapped to itself: %q", route, configured[route])
		}
	}
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

func runOAuthHTTPJourney(t *testing.T) repository.OAuthStore {
	t.Helper()
	fixture := newIntegrationGitDataFixture(t)
	startStore := fixture.newStore(t)
	callbackStore := fixture.newStore(t)
	adminStore := fixture.newStore(t)
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
			Store:     startStore,
			Providers: providers,
			Clock:     integrationClock{now: now},
		},
	}
	callbackContainer := &handler.OAuthHandler{
		HandleCallback: usecase.HandleCallbackUseCase{
			Sites:         sites,
			Store:         callbackStore,
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

	snapshot, err := adminStore.AdminSnapshot(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Identities) != 1 ||
		snapshot.Identities[0].LoginCount != 1 ||
		!snapshot.Identities[0].HasRefreshToken ||
		len(snapshot.Events) != 2 {
		t.Fatalf("unexpected durable readback: %#v", snapshot)
	}
	return adminStore
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

type integrationGitDataFixture struct {
	t      *testing.T
	server *httptest.Server

	mu            sync.Mutex
	head          string
	commitTrees   map[string]string
	commitParents map[string]string
	trees         map[string]map[string]string
	blobs         map[string][]byte
	privateKeyPEM []byte
	sequence      int
}

func newIntegrationGitDataFixture(t *testing.T) *integrationGitDataFixture {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	fixture := &integrationGitDataFixture{
		t:             t,
		head:          "commit-0",
		commitTrees:   map[string]string{"commit-0": "tree-0"},
		commitParents: map[string]string{"commit-0": ""},
		trees:         map[string]map[string]string{"tree-0": {}},
		blobs:         make(map[string][]byte),
		privateKeyPEM: pem.EncodeToMemory(&pem.Block{
			Type:  "RSA PRIVATE KEY",
			Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
		}),
	}
	fixture.server = httptest.NewServer(http.HandlerFunc(fixture.serveHTTP))
	t.Cleanup(fixture.server.Close)
	return fixture
}

func (f *integrationGitDataFixture) newStore(t *testing.T) *githubstore.Store {
	t.Helper()
	auth, err := githubstore.NewAppAuthenticator(
		f.server.URL,
		"1",
		2,
		f.privateKeyPEM,
		f.server.Client(),
	)
	if err != nil {
		t.Fatal(err)
	}
	codec, err := recordcrypto.NewCodec(
		"v1",
		map[string][]byte{"v1": bytes.Repeat([]byte{1}, 32)},
	)
	if err != nil {
		t.Fatal(err)
	}
	client, err := githubstore.NewClient(
		f.server.URL,
		"owner",
		"repo",
		"data",
		auth,
		f.server.Client(),
	)
	if err != nil {
		t.Fatal(err)
	}
	store, err := githubstore.NewStore(
		client,
		codec,
		recordcrypto.NewFingerprinter(bytes.Repeat([]byte{3}, 32)),
		recordcrypto.NewFingerprinter(bytes.Repeat([]byte{4}, 32)),
	)
	if err != nil {
		t.Fatal(err)
	}
	return store
}

func (f *integrationGitDataFixture) serveHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")

	if r.URL.Path == "/app/installations/2/access_tokens" &&
		r.Method == http.MethodPost {
		authorization := strings.TrimPrefix(
			r.Header.Get("Authorization"),
			"Bearer ",
		)
		if len(strings.Split(authorization, ".")) != 3 {
			f.t.Errorf("installation token request did not use an App JWT")
		}
		writeIntegrationJSON(w, map[string]any{
			"token":      "installation-token",
			"expires_at": time.Now().Add(time.Hour).UTC(),
		})
		return
	}

	const repoPrefix = "/repos/owner/repo"
	if !strings.HasPrefix(r.URL.Path, repoPrefix) ||
		r.Header.Get("Authorization") != "Bearer installation-token" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	repositoryPath := strings.TrimPrefix(r.URL.Path, repoPrefix)
	switch {
	case repositoryPath == "/git/ref/heads/data" && r.Method == http.MethodGet:
		writeIntegrationJSON(w, map[string]any{
			"object": map[string]string{"sha": f.head},
		})
	case strings.HasPrefix(repositoryPath, "/git/commits/") &&
		r.Method == http.MethodGet:
		sha := strings.TrimPrefix(repositoryPath, "/git/commits/")
		writeIntegrationJSON(w, map[string]any{
			"tree": map[string]string{"sha": f.commitTrees[sha]},
		})
	case strings.HasPrefix(repositoryPath, "/git/trees/") &&
		r.Method == http.MethodGet:
		treeSHA := strings.TrimPrefix(repositoryPath, "/git/trees/")
		entries := make([]map[string]string, 0, len(f.trees[treeSHA]))
		for recordPath, sha := range f.trees[treeSHA] {
			entries = append(entries, map[string]string{
				"path": recordPath,
				"type": "blob",
				"mode": "100644",
				"sha":  sha,
			})
		}
		writeIntegrationJSON(w, map[string]any{
			"truncated": false,
			"tree":      entries,
		})
	case strings.HasPrefix(repositoryPath, "/git/blobs/") &&
		r.Method == http.MethodGet:
		sha := strings.TrimPrefix(repositoryPath, "/git/blobs/")
		writeIntegrationJSON(w, map[string]string{
			"encoding": "base64",
			"content":  base64.StdEncoding.EncodeToString(f.blobs[sha]),
		})
	case repositoryPath == "/git/blobs" && r.Method == http.MethodPost:
		var input struct {
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			http.Error(w, "invalid blob", http.StatusBadRequest)
			return
		}
		content, err := base64.StdEncoding.DecodeString(input.Content)
		if err != nil {
			http.Error(w, "invalid blob", http.StatusBadRequest)
			return
		}
		sha := f.next("blob")
		f.blobs[sha] = content
		writeIntegrationJSON(w, map[string]string{"sha": sha})
	case repositoryPath == "/git/trees" && r.Method == http.MethodPost:
		var input struct {
			BaseTree string `json:"base_tree"`
			Tree     []struct {
				Path string `json:"path"`
				SHA  string `json:"sha"`
			} `json:"tree"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			http.Error(w, "invalid tree", http.StatusBadRequest)
			return
		}
		next := make(map[string]string, len(f.trees[input.BaseTree])+len(input.Tree))
		for recordPath, sha := range f.trees[input.BaseTree] {
			next[recordPath] = sha
		}
		for _, entry := range input.Tree {
			next[entry.Path] = entry.SHA
		}
		sha := f.next("tree")
		f.trees[sha] = next
		writeIntegrationJSON(w, map[string]string{"sha": sha})
	case repositoryPath == "/git/commits" && r.Method == http.MethodPost:
		var input struct {
			Tree    string   `json:"tree"`
			Parents []string `json:"parents"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil ||
			len(input.Parents) != 1 {
			http.Error(w, "invalid commit", http.StatusBadRequest)
			return
		}
		sha := f.next("commit")
		f.commitTrees[sha] = input.Tree
		f.commitParents[sha] = input.Parents[0]
		writeIntegrationJSON(w, map[string]string{"sha": sha})
	case repositoryPath == "/git/refs/heads/data" &&
		r.Method == http.MethodPatch:
		var input struct {
			SHA   string `json:"sha"`
			Force bool   `json:"force"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil ||
			input.Force ||
			f.commitParents[input.SHA] != f.head {
			http.Error(w, "conflict", http.StatusUnprocessableEntity)
			return
		}
		f.head = input.SHA
		writeIntegrationJSON(w, map[string]string{"ref": "refs/heads/data"})
	default:
		http.NotFound(w, r)
	}
}

func (f *integrationGitDataFixture) next(prefix string) string {
	f.sequence++
	return fmt.Sprintf("%s-%d", prefix, f.sequence)
}

func writeIntegrationJSON(w http.ResponseWriter, value any) {
	if err := json.NewEncoder(w).Encode(value); err != nil {
		panic(err)
	}
}
