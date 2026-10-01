package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/usecase"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
	recordcrypto "github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/crypto"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/persistence/memory"
)

func TestOAuthCallbackRedirectsProviderDenialWithoutCode(t *testing.T) {
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
	handler := OAuthHandler{
		HandleCallback: usecase.HandleCallbackUseCase{
			Sites: callbackSites{"main": {
				SiteID:   "main",
				ErrorURL: "https://app.example/error",
			}},
			Store:         store,
			Fingerprinter: recordcrypto.NewFingerprinter([]byte("audit-key-that-is-long-enough-12345")),
			Clock:         callbackClock{now: now.Add(time.Minute)},
		},
	}
	request := httptest.NewRequest(
		http.MethodGet,
		"/callback?state=denied-state&error=access_denied&error_description=private",
		nil,
	)
	recorder := httptest.NewRecorder()

	handler.CallbackWithProvider(recorder, request, valueobject.ProviderGitHub)

	if recorder.Code != http.StatusFound {
		t.Fatalf("unexpected denial status: %d body=%s", recorder.Code, recorder.Body.String())
	}
	redirect, err := url.Parse(recorder.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if redirect.Host != "127.0.0.1:43123" ||
		redirect.Query().Get("session_id") != "lp-123" ||
		redirect.Query().Get("error") != "provider_access_denied" ||
		redirect.Query().Has("error_description") {
		t.Fatalf("unsafe denial redirect: %s", redirect)
	}
}

type callbackSites map[string]usecase.SiteConfig

func (s callbackSites) Get(siteID string) (usecase.SiteConfig, bool) {
	site, ok := s[siteID]
	return site, ok
}

type callbackClock struct {
	now time.Time
}

func (c callbackClock) Now() time.Time {
	return c.now
}
