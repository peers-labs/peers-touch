package httpinterface

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/model/operatorlogin"
	"github.com/peers-labs/peers-touch/x-config/internal/application/operatorauth"
	"github.com/peers-labs/peers-touch/x-config/internal/infrastructure/operatorstore"
	"google.golang.org/protobuf/proto"
)

func TestOperatorAuthHTTPFlowEnforcesCSRFAndRevocation(t *testing.T) {
	var timingLog bytes.Buffer
	previousLogOutput := log.Writer()
	log.SetOutput(&timingLog)
	t.Cleanup(func() {
		log.SetOutput(previousLogOutput)
	})
	now := time.Now().UTC()
	privateKey := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x66}, 32))
	config := operatorauth.Config{
		SiteID:         "x-config",
		Audience:       "x-config-admin",
		BrokerStartURL: "https://oauth.example.test/api/oauth/github/start",
		CallbackURL:    "https://control.example.test/api/admin/auth/callback",
		ConsoleURL:     "https://control.example.test/",
		Provider:       "github",
		SigningKeys: map[string]ed25519.PublicKey{
			"key-1": privateKey.Public().(ed25519.PublicKey),
		},
		AllowedSubjects: map[string]struct{}{
			"github\x00subject-42": {},
		},
	}
	handler := &AuthHandler{
		SecureCookies: true,
		Service: operatorauth.Service{
			Config: config,
			Store:  operatorstore.NewMemoryStore(),
			Redeemer: handlerRedeemer{
				privateKey: privateKey,
				now:        now,
			},
			Clock:  handlerClock{now: now},
			Random: bytes.NewReader(bytes.Repeat([]byte{0x77}, 256)),
		},
	}

	startRecorder := httptest.NewRecorder()
	handler.Start(
		startRecorder,
		httptest.NewRequest(http.MethodGet, "/api/admin/auth/start", nil),
	)
	if startRecorder.Code != http.StatusFound {
		t.Fatalf("start status = %d, body=%s", startRecorder.Code, startRecorder.Body.String())
	}
	if !strings.Contains(
		startRecorder.Header().Get("Server-Timing"),
		"operator-attempt-store;dur=",
	) {
		t.Fatalf("start timing is missing: %v", startRecorder.Header())
	}
	var attemptCookie *http.Cookie
	for _, cookie := range startRecorder.Result().Cookies() {
		if cookie.Name == loginAttemptCookie {
			attemptCookie = cookie
		}
	}
	if attemptCookie == nil || !attemptCookie.HttpOnly || !attemptCookie.Secure {
		t.Fatalf("attempt cookie is not protected: %#v", attemptCookie)
	}
	authorizeURL, _ := url.Parse(startRecorder.Header().Get("Location"))
	returnTo, _ := url.Parse(authorizeURL.Query().Get("return_to"))
	attemptID := returnTo.Query().Get("login_attempt_id")

	callbackRequest := httptest.NewRequest(
		http.MethodGet,
		"/api/admin/auth/callback?code=one-use-code&login_attempt_id="+
			url.QueryEscape(attemptID),
		nil,
	)
	callbackRequest.AddCookie(attemptCookie)
	callbackRecorder := httptest.NewRecorder()
	handler.Callback(callbackRecorder, callbackRequest)
	if callbackRecorder.Code != http.StatusSeeOther ||
		callbackRecorder.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("callback status = %d, headers=%v body=%s", callbackRecorder.Code, callbackRecorder.Header(), callbackRecorder.Body.String())
	}
	for _, metric := range []string{
		"operator-attempt-read;dur=",
		"oauth-redeem;dur=",
		"operator-session-commit;dur=",
	} {
		if !strings.Contains(
			callbackRecorder.Header().Get("Server-Timing"),
			metric,
		) {
			t.Fatalf(
				"callback timing %q is missing: %v",
				metric,
				callbackRecorder.Header(),
			)
		}
	}
	var session, csrf *http.Cookie
	for _, cookie := range callbackRecorder.Result().Cookies() {
		switch cookie.Name {
		case sessionCookie:
			session = cookie
		case csrfCookie:
			csrf = cookie
		}
	}
	if session == nil || csrf == nil || !session.HttpOnly || csrf.HttpOnly {
		t.Fatalf("session cookies are invalid: session=%#v csrf=%#v", session, csrf)
	}

	sessionRequest := httptest.NewRequest(
		http.MethodGet,
		"/api/admin/auth/session",
		nil,
	)
	sessionRequest.AddCookie(session)
	sessionRecorder := httptest.NewRecorder()
	handler.Session(sessionRecorder, sessionRequest)
	if sessionRecorder.Code != http.StatusOK {
		t.Fatalf("session readback failed: %d %s", sessionRecorder.Code, sessionRecorder.Body.String())
	}
	if !strings.Contains(
		sessionRecorder.Header().Get("Server-Timing"),
		"operator-session-read;dur=",
	) {
		t.Fatalf("session timing is missing: %v", sessionRecorder.Header())
	}

	badLogout := httptest.NewRequest(http.MethodPost, "/api/admin/auth/logout", nil)
	badLogout.AddCookie(session)
	badLogout.AddCookie(csrf)
	badLogoutRecorder := httptest.NewRecorder()
	handler.Logout(badLogoutRecorder, badLogout)
	if badLogoutRecorder.Code != http.StatusForbidden {
		t.Fatalf("logout without CSRF header returned %d", badLogoutRecorder.Code)
	}

	logout := httptest.NewRequest(http.MethodPost, "/api/admin/auth/logout", nil)
	logout.AddCookie(session)
	logout.AddCookie(csrf)
	logout.Header.Set("X-CSRF-Token", csrf.Value)
	logoutRecorder := httptest.NewRecorder()
	handler.Logout(logoutRecorder, logout)
	if logoutRecorder.Code != http.StatusNoContent {
		t.Fatalf("logout failed: %d %s", logoutRecorder.Code, logoutRecorder.Body.String())
	}

	revokedRequest := httptest.NewRequest(
		http.MethodGet,
		"/api/admin/auth/session",
		nil,
	)
	revokedRequest.AddCookie(session)
	revokedRecorder := httptest.NewRecorder()
	handler.Session(revokedRecorder, revokedRequest)
	if revokedRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("revoked session readback returned %d", revokedRecorder.Code)
	}
	replayRecorder := httptest.NewRecorder()
	handler.Callback(
		replayRecorder,
		httptest.NewRequest(
			http.MethodGet,
			"/api/admin/auth/callback?code=replayed&login_attempt_id=replayed",
			nil,
		),
	)
	if replayRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("callback replay without attempt cookie returned %d", replayRecorder.Code)
	}
	logged := timingLog.String()
	for _, expected := range []string{
		"metric=operator-attempt-store",
		"metric=operator-attempt-read",
		"metric=oauth-redeem",
		"metric=operator-session-commit",
		"metric=operator-session-read",
		"event=csrf outcome=rejected",
		"event=logout outcome=success",
		"event=callback outcome=rejected",
	} {
		if !strings.Contains(logged, expected) {
			t.Fatalf("sanitized auth log is missing %q: %s", expected, logged)
		}
	}
	for _, forbidden := range []string{
		attemptID,
		session.Value,
		csrf.Value,
		"one-use-code",
		"subject-42",
	} {
		if strings.Contains(logged, forbidden) {
			t.Fatalf("sanitized auth log exposed private material")
		}
	}
}

type handlerClock struct {
	now time.Time
}

func (c handlerClock) Now() time.Time {
	return c.now
}

type handlerRedeemer struct {
	privateKey ed25519.PrivateKey
	now        time.Time
}

func (r handlerRedeemer) Redeem(
	_ context.Context,
	request operatorauth.RedeemRequest,
) (*operatorlogin.SignedOperatorLoginAssertion, error) {
	challenge := sha256.Sum256(request.ReceiverVerifier)
	statement := &operatorlogin.OperatorLoginAssertionStatement{
		SchemaVersion:     1,
		Purpose:           operatorlogin.OperatorLoginPurpose_OPERATOR_LOGIN_PURPOSE_OPERATOR_LOGIN,
		Audience:          request.Audience,
		SiteId:            request.SiteID,
		AssertionId:       "assertion-http-1",
		Provider:          "github",
		ProviderSubject:   "subject-42",
		ReceiverChallenge: challenge[:],
		IssuedAtUnixMs:    r.now.UnixMilli(),
		ExpiresAtUnixMs:   r.now.Add(time.Minute).UnixMilli(),
	}
	statementBytes, _ := (proto.MarshalOptions{Deterministic: true}).Marshal(
		statement,
	)
	signed := append(
		[]byte("peers-touch/operator-login/v1\x00"),
		statementBytes...,
	)
	return &operatorlogin.SignedOperatorLoginAssertion{
		SigningKeyId:     "key-1",
		StatementBytes:   statementBytes,
		Ed25519Signature: ed25519.Sign(r.privateKey, signed),
	}, nil
}

func TestOperatorAuthPrivateHTTPOriginDropsSecureCookieFlag(t *testing.T) {
	now := time.Now().UTC()
	privateKey := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x67}, 32))
	config := operatorauth.Config{
		SiteID:           "corpstable",
		Audience:         "client-control-admin",
		BrokerStartURL:   "https://broker.example.test/api/oauth/github/start",
		CallbackURL:      "http://10.37.221.38:18082/api/admin/auth/callback",
		ConsoleURL:       "http://10.37.221.38:18082/",
		Provider:         "github",
		AllowPrivateHTTP: true,
		SigningKeys:      map[string]ed25519.PublicKey{"key-1": privateKey.Public().(ed25519.PublicKey)},
		AllowedSubjects:  map[string]struct{}{"github\x00subject-42": {}},
	}
	handler := &AuthHandler{
		SecureCookies: false,
		Service: operatorauth.Service{
			Config:   config,
			Store:    operatorstore.NewMemoryStore(),
			Redeemer: handlerRedeemer{privateKey: privateKey, now: now},
			Clock:    handlerClock{now: now},
			Random:   bytes.NewReader(bytes.Repeat([]byte{0x88}, 256)),
		},
	}
	startRecorder := httptest.NewRecorder()
	handler.Start(
		startRecorder,
		httptest.NewRequest(http.MethodGet, "/api/admin/auth/start", nil),
	)
	if startRecorder.Code != http.StatusFound {
		t.Fatalf("start status = %d, body=%s", startRecorder.Code, startRecorder.Body.String())
	}
	var attemptCookie *http.Cookie
	for _, cookie := range startRecorder.Result().Cookies() {
		if cookie.Name == loginAttemptCookie {
			attemptCookie = cookie
		}
	}
	if attemptCookie == nil || !attemptCookie.HttpOnly || attemptCookie.Secure {
		t.Fatalf("private-origin attempt cookie must not carry Secure: %#v", attemptCookie)
	}
}
