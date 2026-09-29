package google

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/provider/common"
)

func TestAuthorizeAndExchangeUsePKCEAndReturnTokenSet(t *testing.T) {
	var tokenForm url.Values
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			body, _ := io.ReadAll(r.Body)
			tokenForm, _ = url.ParseQuery(string(body))
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"access-secret","refresh_token":"refresh-secret","token_type":"Bearer","scope":"openid email","expires_in":1800}`))
		case "/userinfo":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"sub":"subject","name":"Alice","given_name":"Ali","email":"alice@example.com","email_verified":true}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := NewWithEndpoints(server.Client(), Endpoints{
		Authorize: server.URL + "/authorize",
		Token:     server.URL + "/token",
		UserInfo:  server.URL + "/userinfo",
	})
	now := time.Date(2026, 9, 30, 1, 0, 0, 0, time.UTC)
	provider.now = func() time.Time { return now }
	cfg := port.ProviderConfig{
		ClientID:     "client",
		ClientSecret: "provider-secret",
		RedirectURI:  "https://broker.example/callback",
		Scope:        "openid email",
	}
	authorizeURL, err := provider.AuthorizeURL("state", "verifier", cfg)
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(authorizeURL)
	if parsed.Query().Get("code_challenge") != common.PKCEChallenge("verifier") ||
		parsed.Query().Get("code_challenge_method") != "S256" {
		t.Fatalf("PKCE challenge missing from %s", authorizeURL)
	}
	grant, err := provider.ExchangeCode(context.Background(), "code", "verifier", cfg)
	if err != nil {
		t.Fatal(err)
	}
	if tokenForm.Get("code_verifier") != "verifier" {
		t.Fatalf("exchange omitted verifier: %v", tokenForm)
	}
	if grant.Identity.ProviderUserID != "subject" ||
		grant.Tokens.RefreshToken != "refresh-secret" ||
		grant.Tokens.AccessExpiresAt == nil ||
		!grant.Tokens.AccessExpiresAt.Equal(now.Add(30*time.Minute)) {
		t.Fatalf("unexpected grant: %#v", grant)
	}
}
