package github

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
			_, _ = w.Write([]byte(`{"access_token":"access-secret","refresh_token":"refresh-secret","token_type":"bearer","scope":"read:user","expires_in":3600}`))
		case "/user":
			if r.Header.Get("Authorization") != "Bearer access-secret" {
				t.Fatalf("unexpected authorization header")
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":42,"login":"alice","name":"Alice","email":"alice@example.com"}`))
		case "/user/emails":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[{"email":"alice@example.com","primary":true,"verified":true}]`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := NewWithEndpoints(server.Client(), Endpoints{
		Authorize: server.URL + "/authorize",
		Token:     server.URL + "/token",
		User:      server.URL + "/user",
		Emails:    server.URL + "/user/emails",
	})
	now := time.Date(2026, 9, 30, 1, 0, 0, 0, time.UTC)
	provider.now = func() time.Time { return now }
	cfg := port.ProviderConfig{
		ClientID:     "client",
		ClientSecret: "provider-secret",
		RedirectURI:  "https://broker.example/callback",
		Scope:        "read:user user:email",
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
	if grant.Identity.ProviderUserID != "42" ||
		grant.Identity.Email != "alice@example.com" ||
		!grant.Identity.EmailVerified ||
		grant.Tokens.AccessToken != "access-secret" ||
		grant.Tokens.RefreshToken != "refresh-secret" ||
		grant.Tokens.TokenType != "bearer" ||
		grant.Tokens.Scope != "read:user" ||
		grant.Tokens.AccessExpiresAt == nil ||
		!grant.Tokens.AccessExpiresAt.Equal(now.Add(time.Hour)) {
		t.Fatalf("unexpected grant: %#v", grant)
	}
}

func TestExchangeUsesVerifiedPrimaryEmailWhenProfileEmailIsPrivate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"access-secret","token_type":"bearer","scope":"read:user user:email"}`))
		case "/user":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":9007199254740993,"login":"alice","name":"Alice","email":null}`))
		case "/user/emails":
			if r.Header.Get("Authorization") != "Bearer access-secret" {
				t.Fatalf("unexpected authorization header")
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[
				{"email":"unverified@example.com","primary":true,"verified":false},
				{"email":"verified@example.com","primary":false,"verified":true},
				{"email":"primary@example.com","primary":true,"verified":true}
			]`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := NewWithEndpoints(server.Client(), Endpoints{
		Token:  server.URL + "/token",
		User:   server.URL + "/user",
		Emails: server.URL + "/user/emails",
	})
	grant, err := provider.ExchangeCode(
		context.Background(),
		"code",
		"verifier",
		port.ProviderConfig{
			ClientID:     "client",
			ClientSecret: "provider-secret",
			RedirectURI:  "https://broker.example/callback",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if grant.Identity.ProviderUserID != "9007199254740993" ||
		grant.Identity.Email != "primary@example.com" ||
		!grant.Identity.EmailVerified {
		t.Fatalf("verified primary email was not selected: %#v", grant.Identity)
	}
}

func TestExchangeOmitsEmailWhenGitHubReturnsNoVerifiedAddress(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/token":
			_, _ = w.Write([]byte(`{"access_token":"access-secret","token_type":"bearer"}`))
		case "/user":
			_, _ = w.Write([]byte(`{"id":42,"login":"alice","email":null}`))
		case "/user/emails":
			_, _ = w.Write([]byte(`[{"email":"unverified@example.com","primary":true,"verified":false}]`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := NewWithEndpoints(server.Client(), Endpoints{
		Token:  server.URL + "/token",
		User:   server.URL + "/user",
		Emails: server.URL + "/user/emails",
	})
	grant, err := provider.ExchangeCode(
		context.Background(),
		"code",
		"verifier",
		port.ProviderConfig{ClientID: "client", ClientSecret: "secret"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if grant.Identity.Email != "" || grant.Identity.EmailVerified {
		t.Fatalf("unverified email was trusted: %#v", grant.Identity)
	}
}

func TestRefreshToken(t *testing.T) {
	var tokenForm url.Values
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		tokenForm, _ = url.ParseQuery(string(body))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"access-new","token_type":"bearer","scope":"read:user","expires_in":900,"refresh_token_expires_in":7200}`))
	}))
	defer server.Close()

	provider := NewWithEndpoints(server.Client(), Endpoints{Token: server.URL})
	now := time.Date(2026, 9, 30, 2, 0, 0, 0, time.UTC)
	provider.now = func() time.Time { return now }
	tokens, err := provider.RefreshToken(context.Background(), "refresh-old", port.ProviderConfig{
		ClientID:     "client",
		ClientSecret: "provider-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	if tokenForm.Get("grant_type") != "refresh_token" ||
		tokenForm.Get("refresh_token") != "refresh-old" ||
		tokens.AccessToken != "access-new" ||
		tokens.RefreshToken != "" ||
		tokens.TokenType != "bearer" ||
		tokens.Scope != "read:user" ||
		tokens.AccessExpiresAt == nil ||
		!tokens.AccessExpiresAt.Equal(now.Add(15*time.Minute)) ||
		tokens.RefreshExpiresAt == nil ||
		!tokens.RefreshExpiresAt.Equal(now.Add(2*time.Hour)) {
		t.Fatalf("unexpected refresh result: form=%v tokens=%#v", tokenForm, tokens)
	}
}

func TestRefreshTokenRedactsProviderResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"error":"invalid_grant","refresh_token":"refresh-old"}`, http.StatusBadRequest)
	}))
	defer server.Close()

	provider := NewWithEndpoints(server.Client(), Endpoints{Token: server.URL})
	_, err := provider.RefreshToken(context.Background(), "refresh-old", port.ProviderConfig{
		ClientID:     "client",
		ClientSecret: "provider-secret",
	})
	if err == nil || err.Error() != "github_token_failed" {
		t.Fatalf("unexpected sanitized error: %v", err)
	}
}
