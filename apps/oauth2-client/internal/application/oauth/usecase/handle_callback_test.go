package usecase

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/port"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
	recordcrypto "github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/crypto"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/persistence/memory"
)

func TestHandleCallbackCompletesOnceAndRejectsReplay(t *testing.T) {
	store := memory.NewStore()
	now := time.Date(2026, 9, 30, 1, 0, 0, 0, time.UTC)
	session := entity.AuthSession{
		State:     "state-secret",
		SiteID:    "main",
		Provider:  valueobject.ProviderGitHub,
		ReturnTo:  "http://127.0.0.1:43123/callback?session_id=lp-test&purpose=account_login",
		Verifier:  "verifier-secret",
		CreatedAt: now,
		ExpiresAt: now.Add(10 * time.Minute),
	}
	if err := store.CreateAuthorization(context.Background(), session); err != nil {
		t.Fatal(err)
	}
	provider := &callbackProvider{}
	useCase := HandleCallbackUseCase{
		Sites: staticSites{"main": {
			SiteID:       "main",
			SuccessURL:   "https://app.example/success",
			ErrorURL:     "https://app.example/error",
			BridgeSecret: "bridge-secret",
			Providers: map[valueobject.Provider]port.ProviderConfig{
				valueobject.ProviderGitHub: {ClientID: "client"},
			},
		}},
		Store:         store,
		Providers:     map[valueobject.Provider]port.ProviderGateway{valueobject.ProviderGitHub: provider},
		Fingerprinter: recordcrypto.NewFingerprinter([]byte("audit-key-that-is-long-enough-12345")),
		Clock:         fixedClock{now: now.Add(time.Minute)},
	}
	first, err := useCase.Execute(context.Background(), HandleCallbackInput{
		Provider: valueobject.ProviderGitHub,
		State:    session.State,
		Code:     "code-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	replay, err := useCase.Execute(context.Background(), HandleCallbackInput{
		Provider: valueobject.ProviderGitHub,
		State:    session.State,
		Code:     "code-secret",
	})
	if err == nil || replay == nil || !strings.Contains(replay.RedirectURL, "error=state_consumed") {
		t.Fatalf("callback replay was not rejected: output=%#v err=%v", replay, err)
	}
	if provider.exchangeCalls != 1 {
		t.Fatalf("callback replay reached provider: calls=%d", provider.exchangeCalls)
	}
	parsed, _ := url.Parse(first.RedirectURL)
	if parsed.Query().Get("provider_user_id") != "42" || parsed.Query().Get("sig") == "" {
		t.Fatalf("unexpected success redirect: %s", first.RedirectURL)
	}
	values := parsed.Query()
	signature := values.Get("sig")
	values.Del("sig")
	values.Del("session_id")
	mac := hmac.New(sha256.New, []byte("bridge-secret"))
	_, _ = mac.Write([]byte(values.Encode()))
	if signature != hex.EncodeToString(mac.Sum(nil)) ||
		values.Get("bridge_version") != "v1" ||
		values.Get("purpose") != "account_login" ||
		values.Get("assertion_id") == "" ||
		values.Get("receiver_id") != "lp-test" ||
		values.Get("email_verified") != "true" {
		t.Fatalf("bridge signature does not cover canonical callback fields")
	}
	snapshot, err := store.AdminSnapshot(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Identities) != 1 || snapshot.Identities[0].LoginCount != 1 {
		t.Fatalf("unexpected identity projection: %#v", snapshot.Identities)
	}
}

func TestCanonicalBridgePayloadMatchesSharedGoldenVector(t *testing.T) {
	values := map[string]string{
		"bridge_version":   "v1",
		"site_id":          "default",
		"purpose":          "account_login",
		"assertion_id":     strings.Repeat("a", 64),
		"receiver_id":      "lp-test",
		"receiver_challenge": "YldFvi9dnPnO1KMwjEHki8bjxSoF5-7xwsrPIniWNjs",
		"provider":         "github",
		"provider_user_id": "42",
		"union_id":         "union-42",
		"username":         "alice",
		"display_name":     "Alice Example",
		"avatar_url":       "https://example.test/avatar.png",
		"email":            "alice@example.test",
		"email_verified":   "true",
		"ts":               "2026-10-01T00:00:00Z",
	}
	const expectedPayload = "assertion_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&avatar_url=https%3A%2F%2Fexample.test%2Favatar.png&bridge_version=v1&display_name=Alice+Example&email=alice%40example.test&email_verified=true&provider=github&provider_user_id=42&purpose=account_login&receiver_challenge=YldFvi9dnPnO1KMwjEHki8bjxSoF5-7xwsrPIniWNjs&receiver_id=lp-test&site_id=default&ts=2026-10-01T00%3A00%3A00Z&union_id=union-42&username=alice"
	if payload := canonicalBridgePayload(values); payload != expectedPayload {
		t.Fatalf("canonical payload mismatch:\n%s", payload)
	}
	mac := hmac.New(sha256.New, []byte("bridge-secret"))
	_, _ = mac.Write([]byte(expectedPayload))
	if signature := hex.EncodeToString(mac.Sum(nil)); signature != "490b711f99b1d8842f252b1ca09bc2784de89797aebc744d013012b70ee35867" {
		t.Fatalf("golden signature mismatch: %s", signature)
	}
}

func TestHandleCallbackErrorUsesTransactionSiteAndOmitsState(t *testing.T) {
	store := memory.NewStore()
	now := time.Date(2026, 9, 30, 1, 0, 0, 0, time.UTC)
	if err := store.CreateAuthorization(context.Background(), entity.AuthSession{
		State:     "state-secret",
		SiteID:    "main",
		Provider:  valueobject.ProviderGitHub,
		Verifier:  "verifier",
		CreatedAt: now.Add(-time.Hour),
		ExpiresAt: now.Add(-time.Minute),
	}); err != nil {
		t.Fatal(err)
	}
	useCase := HandleCallbackUseCase{
		Sites: staticSites{
			"main": {
				SiteID:     "main",
				SuccessURL: "https://app.example/success",
				ErrorURL:   "https://app.example/error",
				Providers: map[valueobject.Provider]port.ProviderConfig{
					valueobject.ProviderGitHub: {ClientID: "client"},
				},
			},
			"attacker": {
				SiteID:   "attacker",
				ErrorURL: "https://attacker.example/error",
			},
		},
		Store:         store,
		Providers:     map[valueobject.Provider]port.ProviderGateway{valueobject.ProviderGitHub: &callbackProvider{}},
		Fingerprinter: recordcrypto.NewFingerprinter([]byte("audit-key-that-is-long-enough-12345")),
		Clock:         fixedClock{now: now},
	}
	output, err := useCase.Execute(context.Background(), HandleCallbackInput{
		Provider: valueobject.ProviderGitHub,
		State:    "state-secret",
		Code:     "code-secret",
	})
	if err == nil || output == nil {
		t.Fatalf("expected redirectable failure, got output=%#v err=%v", output, err)
	}
	if !strings.HasPrefix(output.RedirectURL, "https://app.example/error?") ||
		strings.Contains(output.RedirectURL, "state-secret") ||
		strings.Contains(output.RedirectURL, "code-secret") {
		t.Fatalf("unsafe error redirect: %s", output.RedirectURL)
	}
}

func TestHandleCallbackProviderDenialUsesTransactionReturnToAndConsumesState(t *testing.T) {
	store := memory.NewStore()
	now := time.Date(2026, 10, 1, 1, 0, 0, 0, time.UTC)
	session := entity.AuthSession{
		State:     "denied-state",
		SiteID:    "main",
		Provider:  valueobject.ProviderGitHub,
		ReturnTo:  "http://127.0.0.1:43123/callback?session_id=lp-123",
		Verifier:  "verifier",
		CreatedAt: now,
		ExpiresAt: now.Add(10 * time.Minute),
	}
	if err := store.CreateAuthorization(context.Background(), session); err != nil {
		t.Fatal(err)
	}
	provider := &callbackProvider{}
	useCase := HandleCallbackUseCase{
		Sites: staticSites{"main": {
			SiteID:     "main",
			SuccessURL: "https://app.example/success",
			ErrorURL:   "https://app.example/error",
			Providers: map[valueobject.Provider]port.ProviderConfig{
				valueobject.ProviderGitHub: {ClientID: "client"},
			},
		}},
		Store:         store,
		Providers:     map[valueobject.Provider]port.ProviderGateway{valueobject.ProviderGitHub: provider},
		Fingerprinter: recordcrypto.NewFingerprinter([]byte("audit-key-that-is-long-enough-12345")),
		Clock:         fixedClock{now: now.Add(time.Minute)},
	}

	output, err := useCase.Execute(context.Background(), HandleCallbackInput{
		Provider:      valueobject.ProviderGitHub,
		State:         session.State,
		ProviderError: "access_denied",
	})
	if err == nil || err.Error() != "provider_access_denied" || output == nil {
		t.Fatalf("unexpected denial result: output=%#v err=%v", output, err)
	}
	redirect, parseErr := url.Parse(output.RedirectURL)
	if parseErr != nil {
		t.Fatal(parseErr)
	}
	if redirect.Host != "127.0.0.1:43123" ||
		redirect.Path != "/callback" ||
		redirect.Query().Get("session_id") != "lp-123" ||
		redirect.Query().Get("error") != "provider_access_denied" {
		t.Fatalf("denial did not use transaction receiver: %s", output.RedirectURL)
	}
	if provider.exchangeCalls != 0 {
		t.Fatalf("provider denial attempted code exchange: %d", provider.exchangeCalls)
	}
	consumed, loadErr := store.FindAuthorization(context.Background(), session.State)
	if loadErr != nil {
		t.Fatal(loadErr)
	}
	if consumed == nil || !consumed.IsConsumed() {
		t.Fatalf("denied authorization remained reusable: %#v", consumed)
	}
	snapshot, snapshotErr := store.AdminSnapshot(context.Background(), 10)
	if snapshotErr != nil {
		t.Fatal(snapshotErr)
	}
	if len(snapshot.Events) != 2 ||
		snapshot.Events[0].ErrorCode != "provider_access_denied" {
		t.Fatalf("denial audit missing: %#v", snapshot.Events)
	}
}

type callbackProvider struct {
	exchangeCalls int
}

func (*callbackProvider) Provider() valueobject.Provider {
	return valueobject.ProviderGitHub
}

func (*callbackProvider) AuthorizeURL(string, string, port.ProviderConfig) (string, error) {
	panic("not used")
}

func (p *callbackProvider) ExchangeCode(_ context.Context, _, verifier string, _ port.ProviderConfig) (*entity.AuthorizationGrant, error) {
	p.exchangeCalls++
	if verifier != "verifier-secret" {
		tokens := entity.TokenSet{}
		return &entity.AuthorizationGrant{Tokens: tokens}, nil
	}
	return &entity.AuthorizationGrant{
		Identity: entity.ProviderIdentity{
			ProviderUserID: "42",
			Username:       "alice",
			Email:          "alice@example.com",
			EmailVerified:  true,
		},
		Tokens: entity.TokenSet{
			AccessToken:  "access-secret",
			RefreshToken: "refresh-secret",
			TokenType:    "Bearer",
			ObtainedAt:   time.Date(2026, 9, 30, 1, 1, 0, 0, time.UTC),
		},
	}, nil
}

func (*callbackProvider) RefreshToken(context.Context, string, port.ProviderConfig) (*entity.TokenSet, error) {
	panic("not used")
}
