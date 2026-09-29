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
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			if r.URL.Query().Get("code") != "code" {
				t.Fatal("authorization code missing")
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"access-secret","refresh_token":"refresh-secret","openid":"openid","unionid":"unionid","scope":"snsapi_login","expires_in":7200}`))
		case "/userinfo":
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
	now := time.Date(2026, 9, 30, 1, 0, 0, 0, time.UTC)
	provider.now = func() time.Time { return now }
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
		grant.Tokens.RefreshToken != "refresh-secret" ||
		grant.Tokens.AccessExpiresAt == nil ||
		!grant.Tokens.AccessExpiresAt.Equal(now.Add(2*time.Hour)) {
		t.Fatalf("unexpected grant: %#v", grant)
	}
}
