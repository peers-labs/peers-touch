package integration

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/oauth2-client/model/operatorlogin"
	"github.com/peers-labs/peers-touch/x-config/internal/application/operatorauth"
	"github.com/peers-labs/peers-touch/x-config/internal/infrastructure/operatorstore"
	httpinterface "github.com/peers-labs/peers-touch/x-config/internal/interfaces/http"
	"google.golang.org/protobuf/proto"
)

func TestHomeOperatorLoginLifecycle(t *testing.T) {
	now := time.Date(2026, 10, 20, 18, 0, 0, 0, time.UTC)
	privateKey := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x61}, 32))
	recordKey := bytes.Repeat([]byte{0x62}, 32)
	databasePath := filepath.Join(t.TempDir(), "operator-auth.sqlite")
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

	store := openStore(t, databasePath, recordKey)
	handler := newAuthHandler(config, store, privateKey, now)
	start := httptest.NewRecorder()
	handler.Start(
		start,
		httptest.NewRequest(http.MethodGet, "/api/admin/auth/start", nil),
	)
	if start.Code != http.StatusFound {
		t.Fatalf("start returned %d: %s", start.Code, start.Body.String())
	}
	attemptCookie := cookieNamed(
		t,
		start.Result().Cookies(),
		"peers_xcfg_login_attempt",
	)
	authorizeURL, err := url.Parse(start.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	returnTo, err := url.Parse(authorizeURL.Query().Get("return_to"))
	if err != nil {
		t.Fatal(err)
	}
	callbackPath := "/api/admin/auth/callback?code=one-use-code&login_attempt_id=" +
		url.QueryEscape(returnTo.Query().Get("login_attempt_id"))
	callbackRequest := httptest.NewRequest(
		http.MethodGet,
		callbackPath,
		nil,
	)
	callbackRequest.AddCookie(attemptCookie)
	callback := httptest.NewRecorder()
	handler.Callback(callback, callbackRequest)
	if callback.Code != http.StatusSeeOther {
		t.Fatalf(
			"callback returned %d: %s",
			callback.Code,
			callback.Body.String(),
		)
	}
	sessionCookie := cookieNamed(
		t,
		callback.Result().Cookies(),
		"peers_xcfg_session",
	)
	csrfCookie := cookieNamed(
		t,
		callback.Result().Cookies(),
		"peers_xcfg_csrf",
	)
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	store = openStore(t, databasePath, recordKey)
	handler = newAuthHandler(config, store, privateKey, now.Add(time.Minute))
	sessionRequest := httptest.NewRequest(
		http.MethodGet,
		"/api/admin/auth/session",
		nil,
	)
	sessionRequest.AddCookie(sessionCookie)
	session := httptest.NewRecorder()
	handler.Session(session, sessionRequest)
	if session.Code != http.StatusOK {
		t.Fatalf(
			"restarted session returned %d: %s",
			session.Code,
			session.Body.String(),
		)
	}

	replayRequest := httptest.NewRequest(http.MethodGet, callbackPath, nil)
	replayRequest.AddCookie(attemptCookie)
	replay := httptest.NewRecorder()
	handler.Callback(replay, replayRequest)
	if replay.Code != http.StatusUnauthorized {
		t.Fatalf("callback replay returned %d", replay.Code)
	}

	logoutRequest := httptest.NewRequest(
		http.MethodPost,
		"/api/admin/auth/logout",
		nil,
	)
	logoutRequest.AddCookie(sessionCookie)
	logoutRequest.AddCookie(csrfCookie)
	logoutRequest.Header.Set("X-CSRF-Token", csrfCookie.Value)
	logout := httptest.NewRecorder()
	handler.Logout(logout, logoutRequest)
	if logout.Code != http.StatusNoContent {
		t.Fatalf("logout returned %d: %s", logout.Code, logout.Body.String())
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	store = openStore(t, databasePath, recordKey)
	t.Cleanup(func() { _ = store.Close() })
	handler = newAuthHandler(config, store, privateKey, now.Add(2*time.Minute))
	revokedRequest := httptest.NewRequest(
		http.MethodGet,
		"/api/admin/auth/session",
		nil,
	)
	revokedRequest.AddCookie(sessionCookie)
	revoked := httptest.NewRecorder()
	handler.Session(revoked, revokedRequest)
	if revoked.Code != http.StatusUnauthorized {
		t.Fatalf("revoked session after restart returned %d", revoked.Code)
	}
}

func openStore(
	t *testing.T,
	databasePath string,
	recordKey []byte,
) *operatorstore.SQLiteStore {
	t.Helper()
	if err := os.Chmod(filepath.Dir(databasePath), 0o700); err != nil {
		t.Fatalf("secure operator directory: %v", err)
	}
	store, err := operatorstore.NewSQLiteStore(databasePath, recordKey)
	if err != nil {
		t.Fatalf("open operator store: %v", err)
	}
	return store
}

func newAuthHandler(
	config operatorauth.Config,
	store *operatorstore.SQLiteStore,
	privateKey ed25519.PrivateKey,
	now time.Time,
) *httpinterface.AuthHandler {
	return &httpinterface.AuthHandler{
		Service: operatorauth.Service{
			Config: config,
			Store:  store,
			Redeemer: integrationRedeemer{
				privateKey: privateKey,
				now:        now,
			},
			Clock:  integrationClock{now: now},
			Random: bytes.NewReader(bytes.Repeat([]byte{0x63}, 512)),
		},
	}
}

func cookieNamed(
	t *testing.T,
	cookies []*http.Cookie,
	name string,
) *http.Cookie {
	t.Helper()
	for _, cookie := range cookies {
		if cookie.Name == name {
			return cookie
		}
	}
	t.Fatalf("cookie %s not found", name)
	return nil
}

type integrationClock struct {
	now time.Time
}

func (c integrationClock) Now() time.Time {
	return c.now
}

type integrationRedeemer struct {
	privateKey ed25519.PrivateKey
	now        time.Time
}

func (r integrationRedeemer) Redeem(
	_ context.Context,
	request operatorauth.RedeemRequest,
) (*operatorlogin.SignedOperatorLoginAssertion, error) {
	challenge := sha256.Sum256(request.ReceiverVerifier)
	statement := &operatorlogin.OperatorLoginAssertionStatement{
		SchemaVersion:     1,
		Purpose:           operatorlogin.OperatorLoginPurpose_OPERATOR_LOGIN_PURPOSE_OPERATOR_LOGIN,
		Audience:          request.Audience,
		SiteId:            request.SiteID,
		AssertionId:       "assertion-integration-1",
		Provider:          "github",
		ProviderSubject:   "subject-42",
		ReceiverChallenge: challenge[:],
		IssuedAtUnixMs:    r.now.UnixMilli(),
		ExpiresAtUnixMs:   r.now.Add(time.Minute).UnixMilli(),
	}
	statementBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		statement,
	)
	if err != nil {
		return nil, err
	}
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
