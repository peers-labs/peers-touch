package weixin

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
)

func TestExchangeReturnsRefreshableTokenSet(t *testing.T) {
	tokenReceivedAt := time.Date(2026, 9, 30, 1, 0, 0, 0, time.UTC)
	currentTime := tokenReceivedAt
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			if r.URL.Query().Get("code") != "code" {
				t.Fatal("authorization code missing")
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"access-secret","refresh_token":"refresh-secret","openid":"openid","unionid":"unionid","scope":"snsapi_login","expires_in":7200}`))
		case "/userinfo":
			currentTime = tokenReceivedAt.Add(30 * time.Minute)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"openid":"openid","unionid":"unionid","nickname":"Alice"}`))
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
	provider.now = func() time.Time { return currentTime }
	grant, err := provider.ExchangeCode(context.Background(), "code", "unused", port.ProviderConfig{
		ClientID:     "client",
		ClientSecret: "provider-secret",
		RedirectURI:  "https://broker.example/callback",
	})
	if err != nil {
		t.Fatal(err)
	}
	if grant.Identity.ProviderUserID != "openid" ||
		grant.Identity.UnionID != "unionid" ||
		grant.Tokens.AccessToken != "access-secret" ||
		grant.Tokens.RefreshToken != "refresh-secret" ||
		grant.Tokens.TokenType != "Bearer" ||
		grant.Tokens.Scope != "snsapi_login" ||
		!grant.Tokens.ObtainedAt.Equal(tokenReceivedAt) ||
		grant.Tokens.AccessExpiresAt == nil ||
		!grant.Tokens.AccessExpiresAt.Equal(tokenReceivedAt.Add(2*time.Hour)) {
		t.Fatalf("unexpected grant: %#v", grant)
	}
}

func TestRefreshToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("grant_type") != "refresh_token" ||
			r.URL.Query().Get("refresh_token") != "refresh-old" ||
			r.URL.Query().Get("appid") != "client" {
			t.Fatalf("unexpected refresh query: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"access-new","refresh_token":"refresh-new","openid":"openid","scope":"snsapi_login","expires_in":3600}`))
	}))
	defer server.Close()

	provider := NewWithEndpoints(server.Client(), Endpoints{Refresh: server.URL})
	now := time.Date(2026, 9, 30, 2, 0, 0, 0, time.UTC)
	provider.now = func() time.Time { return now }
	tokens, err := provider.RefreshToken(context.Background(), "refresh-old", port.ProviderConfig{
		ClientID: "client",
	})
	if err != nil {
		t.Fatal(err)
	}
	if tokens.AccessToken != "access-new" ||
		tokens.RefreshToken != "refresh-new" ||
		tokens.TokenType != "Bearer" ||
		tokens.Scope != "snsapi_login" ||
		tokens.AccessExpiresAt == nil ||
		!tokens.AccessExpiresAt.Equal(now.Add(time.Hour)) {
		t.Fatalf("unexpected refresh result: %#v", tokens)
	}
}

func TestRefreshTokenRedactsProviderResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"errcode":40030,"errmsg":"refresh-old is invalid"}`))
	}))
	defer server.Close()

	provider := NewWithEndpoints(server.Client(), Endpoints{Refresh: server.URL})
	_, err := provider.RefreshToken(context.Background(), "refresh-old", port.ProviderConfig{
		ClientID: "client",
	})
	if err == nil || err.Error() != "weixin_token_invalid" {
		t.Fatalf("unexpected sanitized error: %v", err)
	}
}
