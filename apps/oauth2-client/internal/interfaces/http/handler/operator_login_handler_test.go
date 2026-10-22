package handler

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
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
	"github.com/peers-labs/peers-touch/oauth2-client/model/operatorlogin"
	"google.golang.org/protobuf/proto"
)

func TestOperatorHandoffHTTPRedemptionIsAuthenticatedAndOneUse(t *testing.T) {
	now := time.Date(2026, 10, 18, 14, 0, 0, 0, time.UTC)
	receiverVerifier := bytes.Repeat([]byte{0x31}, 32)
	challenge := sha256.Sum256(receiverVerifier)
	callbackURL := "https://control.example.test/api/admin/auth/callback"
	returnTo, _ := url.Parse(callbackURL)
	query := returnTo.Query()
	query.Set("login_attempt_id", "attempt-123456789")
	query.Set(
		"receiver_challenge",
		base64.RawURLEncoding.EncodeToString(challenge[:]),
	)
	returnTo.RawQuery = query.Encode()
	privateKey := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x41}, 32))
	config := &usecase.OperatorLoginSiteConfig{
		Audience:          "x-config-admin",
		CallbackURL:       callbackURL,
		SigningKeyID:      "operator-key-1",
		SigningPrivateKey: privateKey,
		RedeemSecret:      []byte("redeem-secret-with-at-least-32-bytes"),
	}
	store := memory.NewStore()
	service := usecase.OperatorLoginService{
		Store:         store,
		Fingerprinter: recordcrypto.NewFingerprinter(bytes.Repeat([]byte{0x51}, 32)),
		Clock:         callbackClock{now: now},
		Random:        bytes.NewReader(bytes.Repeat([]byte{0x61}, 32)),
	}
	code, _, err := service.Issue(
		context.Background(),
		config,
		&entity.AuthSession{
			State:    "oauth-state",
			SiteID:   "x-config",
			Provider: valueobject.ProviderGitHub,
			ReturnTo: returnTo.String(),
		},
		&entity.OAuthIdentity{
			Provider:       valueobject.ProviderGitHub,
			ProviderUserID: "subject-42",
		},
	)
	if err != nil {
		t.Fatalf("issue handoff: %v", err)
	}
	handler := OAuthHandler{
		OperatorLogin: service,
		Sites: operatorSiteRegistry{site: usecase.SiteConfig{
			SiteID:        "x-config",
			OperatorLogin: config,
		}},
	}
	requestBody, _ := (proto.MarshalOptions{Deterministic: true}).Marshal(
		&operatorlogin.RedeemOperatorLoginHandoffRequest{
			HandoffCode:      code,
			ReceiverVerifier: receiverVerifier,
			Audience:         config.Audience,
			SiteId:           "x-config",
		},
	)
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/oauth/operator/redeem",
		bytes.NewReader(requestBody),
	)
	request.Header.Set("Authorization", "Bearer "+string(config.RedeemSecret))
	request.Header.Set("Content-Type", "application/protobuf")
	recorder := httptest.NewRecorder()
	handler.RedeemOperatorLogin(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("redeem status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	response := &operatorlogin.RedeemOperatorLoginHandoffResponse{}
	if err := proto.Unmarshal(recorder.Body.Bytes(), response); err != nil ||
		response.GetAssertion() == nil {
		t.Fatalf("invalid redemption response: %v", err)
	}
	if recorder.Header().Get("Cache-Control") != "no-store" ||
		recorder.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("missing secret-redaction headers: %v", recorder.Header())
	}

	replay := httptest.NewRequest(
		http.MethodPost,
		"/api/oauth/operator/redeem",
		bytes.NewReader(requestBody),
	)
	replay.Header = request.Header.Clone()
	replayRecorder := httptest.NewRecorder()
	handler.RedeemOperatorLogin(replayRecorder, replay)
	if replayRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("handoff replay returned %d", replayRecorder.Code)
	}
}

type operatorSiteRegistry struct {
	site usecase.SiteConfig
}

func (r operatorSiteRegistry) Get(siteID string) (usecase.SiteConfig, bool) {
	return r.site, siteID == r.site.SiteID
}
