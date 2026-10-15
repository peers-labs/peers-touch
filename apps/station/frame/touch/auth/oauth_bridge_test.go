package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	oauthbridge "github.com/peers-labs/peers-touch/station/frame/touch/model/oauthbridge"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestVerifyBridgeSignatureUsesCanonicalV1Payload(t *testing.T) {
	t.Setenv("PEERS_OAUTH_BRIDGE_SECRET", "bridge-secret")
	req := validBridgeRequest()
	signBridgeRequest(req, "bridge-secret")

	if err := VerifyBridgeSignature(req); err != nil {
		t.Fatalf("valid bridge assertion rejected: %v", err)
	}

	req.Username = "mallory"
	if err := VerifyBridgeSignature(req); !errors.Is(err, ErrBridgeSignatureInvalid) {
		t.Fatalf("modified signed field returned %v", err)
	}
}

func TestCanonicalBridgePayloadMatchesSharedGoldenVector(t *testing.T) {
	req := validBridgeRequest()
	req.Ts = "2026-10-01T00:00:00Z"
	const expectedPayload = "assertion_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&avatar_url=https%3A%2F%2Fexample.test%2Favatar.png&bridge_version=v1&display_name=Alice+Example&email=alice%40example.test&email_verified=true&provider=github&provider_user_id=42&purpose=account_login&receiver_challenge=YldFvi9dnPnO1KMwjEHki8bjxSoF5-7xwsrPIniWNjs&receiver_id=lp-test&site_id=default&ts=2026-10-01T00%3A00%3A00Z&union_id=union-42&username=alice"
	if payload := canonicalBridgePayload(req); payload != expectedPayload {
		t.Fatalf("canonical payload mismatch:\n%s", payload)
	}
	mac := hmac.New(sha256.New, []byte("bridge-secret"))
	_, _ = mac.Write([]byte(expectedPayload))
	if signature := hex.EncodeToString(mac.Sum(nil)); signature != "490b711f99b1d8842f252b1ca09bc2784de89797aebc744d013012b70ee35867" {
		t.Fatalf("golden signature mismatch: %s", signature)
	}
}

func TestVerifyBridgeSignatureFailsClosed(t *testing.T) {
	req := validBridgeRequest()
	signBridgeRequest(req, "bridge-secret")

	t.Setenv("PEERS_OAUTH_BRIDGE_SECRET", "")
	if err := VerifyBridgeSignature(req); !errors.Is(err, ErrBridgeSecretMissing) {
		t.Fatalf("missing secret returned %v", err)
	}

	t.Setenv("PEERS_OAUTH_BRIDGE_SECRET", "bridge-secret")
	req.BridgeVersion = "v2"
	if err := VerifyBridgeSignature(req); !errors.Is(err, ErrBridgeVersionInvalid) {
		t.Fatalf("unsupported version returned %v", err)
	}

	req = validBridgeRequest()
	req.EmailVerified = false
	if err := VerifyBridgeSignature(req); !errors.Is(err, ErrBridgeRequestInvalid) {
		t.Fatalf("unverified email returned %v", err)
	}

	req = validBridgeRequest()
	req.Ts = time.Now().UTC().Add(-bridgeTimestampWindow - time.Minute).Format(time.RFC3339)
	signBridgeRequest(req, "bridge-secret")
	if err := VerifyBridgeSignature(req); !errors.Is(err, ErrBridgeTimestampExpired) {
		t.Fatalf("stale assertion returned %v", err)
	}

	req = validBridgeRequest()
	req.Sig = "not-hex"
	if err := VerifyBridgeSignature(req); !errors.Is(err, ErrBridgeSignatureInvalid) {
		t.Fatalf("malformed signature returned %v", err)
	}

	req = validBridgeRequest()
	req.Purpose = "connector"
	signBridgeRequest(req, "bridge-secret")
	if err := VerifyBridgeSignature(req); !errors.Is(err, ErrBridgePurposeInvalid) {
		t.Fatalf("invalid purpose returned %v", err)
	}

	req = validBridgeRequest()
	req.ReceiverVerifier = "wrong-verifier"
	signBridgeRequest(req, "bridge-secret")
	if err := VerifyBridgeSignature(req); !errors.Is(err, ErrBridgeRequestInvalid) {
		t.Fatalf("invalid receiver proof returned %v", err)
	}
}

func TestSyntheticOAuthEmailIsStableAndProviderScoped(t *testing.T) {
	first := syntheticOAuthEmail("github", "42")
	if first != syntheticOAuthEmail("github", "42") {
		t.Fatal("synthetic email is not stable")
	}
	if first == syntheticOAuthEmail("google", "42") {
		t.Fatal("synthetic email is not provider scoped")
	}
	if len(first) < len("@identity.invalid") || first[len(first)-len("@identity.invalid"):] != "@identity.invalid" {
		t.Fatalf("synthetic email does not use reserved domain: %s", first)
	}
}

func TestBridgeIdentityAllowsMissingEmailWithoutClaimingVerification(t *testing.T) {
	identity, err := bridgeIdentity(&oauthbridge.BrokerOAuthBridgeRequest{
		Provider:       "github",
		ProviderUserId: "42",
		Username:       "alice",
	})
	if err != nil {
		t.Fatal(err)
	}
	if identity.Email != "" || identity.EmailVerified {
		t.Fatalf("missing email became trusted identity data: %#v", identity)
	}
}

func TestFindOrRegisterOAuthActorReusesSyntheticEmailAfterBindingFailure(t *testing.T) {
	identity := &coreauth.OAuth2Identity{
		ProviderID:     "github",
		ProviderUserID: "42",
		Username:       "alice",
	}
	var stored *db.Actor
	signups := 0
	findByEmail := func(_ context.Context, email string) (*db.Actor, error) {
		if stored == nil || stored.Email != email {
			return nil, gorm.ErrRecordNotFound
		}
		return stored, nil
	}
	signUp := func(_ context.Context, req *model.ActorSignRequest, _ string) error {
		signups++
		stored = &db.Actor{
			ID:                42,
			PTID:              "ptid:v1:actor:peers:p:alice:fingerprint",
			PreferredUsername: req.GetName(),
			Email:             req.GetEmail(),
		}
		return nil
	}

	first, err := findOrRegisterOAuthActorWith(
		context.Background(),
		identity,
		"https://station.test",
		findByEmail,
		func(_ context.Context, base string) (string, error) { return base, nil },
		signUp,
	)
	if err != nil {
		t.Fatal(err)
	}
	second, err := findOrRegisterOAuthActorWith(
		context.Background(),
		identity,
		"https://station.test",
		findByEmail,
		func(_ context.Context, base string) (string, error) { return base, nil },
		signUp,
	)
	if err != nil {
		t.Fatal(err)
	}
	if signups != 1 || first.ID != second.ID || first.Email != syntheticOAuthEmail("github", "42") {
		t.Fatalf("synthetic-email retry created a duplicate actor: first=%#v second=%#v signups=%d", first, second, signups)
	}
}

func TestFindOrRegisterOAuthActorConflictsOnVerifiedEmailInsteadOfMerging(t *testing.T) {
	existingActor := &db.Actor{
		ID:                7,
		PTID:              "ptid:v1:actor:peers:p:original:fingerprint",
		PreferredUsername: "original",
		Email:             "shared@example.test",
	}
	identity := &coreauth.OAuth2Identity{
		ProviderID:     "google",
		ProviderUserID: "999",
		Username:       "someone",
		Email:          "shared@example.test",
		EmailVerified:  true,
	}
	signups := 0
	findByEmail := func(_ context.Context, email string) (*db.Actor, error) {
		if email == "shared@example.test" {
			return existingActor, nil
		}
		return nil, gorm.ErrRecordNotFound
	}
	signUp := func(context.Context, *model.ActorSignRequest, string) error {
		signups++
		return nil
	}

	_, err := findOrRegisterOAuthActorWith(
		context.Background(),
		identity,
		"https://station.test",
		findByEmail,
		func(_ context.Context, base string) (string, error) { return base, nil },
		signUp,
	)
	var errResp *model.ErrorResponse
	if !errors.As(err, &errResp) || errResp.Code != model.ErrorCode_ERROR_CODE_ACTOR_EXISTS {
		t.Fatalf("expected ACTOR_EXISTS conflict, got %v", err)
	}
	if signups != 0 {
		t.Fatalf("conflict must not create an actor, signups=%d", signups)
	}
}

func TestFindOrRegisterOAuthActorCreatesIndependentActorWhenEmailFree(t *testing.T) {
	identity := &coreauth.OAuth2Identity{
		ProviderID:     "google",
		ProviderUserID: "999",
		Username:       "brand-new",
		Email:          "fresh@example.test",
		EmailVerified:  true,
	}
	var stored *db.Actor
	findByEmail := func(_ context.Context, email string) (*db.Actor, error) {
		if stored == nil || stored.Email != email {
			return nil, gorm.ErrRecordNotFound
		}
		return stored, nil
	}
	signUp := func(_ context.Context, req *model.ActorSignRequest, _ string) error {
		stored = &db.Actor{
			ID:                99,
			PTID:              "ptid:v1:actor:peers:p:brand-new:fingerprint",
			PreferredUsername: req.GetName(),
			Email:             req.GetEmail(),
		}
		return nil
	}

	created, err := findOrRegisterOAuthActorWith(
		context.Background(),
		identity,
		"https://station.test",
		findByEmail,
		func(_ context.Context, base string) (string, error) { return base, nil },
		signUp,
	)
	if err != nil {
		t.Fatal(err)
	}
	if created.ID != 99 || created.Email != "fresh@example.test" {
		t.Fatalf("independent actor was not created: %#v", created)
	}
}

func TestNormalizedOAuthUsernameFitsStationHandleContract(t *testing.T) {
	cases := []struct {
		name string
		raw  string
	}{
		{name: "mixed case and spaces", raw: "Alice Example"},
		{name: "non ascii display name", raw: "示例用户"},
		{name: "short provider handle", raw: "ab"},
		{name: "long provider handle", raw: "this-provider-handle-is-longer-than-twenty"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			first := normalizedOAuthUsername("github", "provider-user-42", tc.raw)
			second := normalizedOAuthUsername("github", "provider-user-42", tc.raw)
			if first != second {
				t.Fatalf("normalization is not stable: %q != %q", first, second)
			}
			if len(first) < 5 || len(first) > 20 {
				t.Fatalf("normalized handle has invalid length: %q", first)
			}
			for _, char := range first {
				if !(char >= 'a' && char <= 'z' ||
					char >= '0' && char <= '9' ||
					char == '.' ||
					char == '_' ||
					char == '-') {
					t.Fatalf("normalized handle contains invalid character %q: %q", char, first)
				}
			}
		})
	}
	if normalizedOAuthUsername("github", "42", "") ==
		normalizedOAuthUsername("google", "42", "") {
		t.Fatal("provider-scoped fallback handles collided")
	}
}

func TestConsumeOAuthBridgeAssertionRejectsReplay(t *testing.T) {
	database, err := gorm.Open(
		sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.AutoMigrate(&db.OAuthBridgeAssertion{}); err != nil {
		t.Fatal(err)
	}
	req := validBridgeRequest()
	if err := consumeOAuthBridgeAssertion(context.Background(), database, req); err != nil {
		t.Fatal(err)
	}
	if err := consumeOAuthBridgeAssertion(
		context.Background(),
		database,
		req,
	); !errors.Is(err, ErrBridgeAssertionReplayed) {
		t.Fatalf("replayed assertion returned %v", err)
	}
	var stored db.OAuthBridgeAssertion
	if err := database.First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.ID == req.AssertionId || stored.Purpose != "account_login" {
		t.Fatalf("assertion was stored without hashing or purpose binding: %#v", stored)
	}
}

func TestOAuthIdentityBindingPreservesEmailVerification(t *testing.T) {
	identity := rowToIdentity(&db.OAuth2IdentityBinding{
		ProviderID:     "github",
		ProviderUserID: "42",
		Email:          "alice@example.test",
		EmailVerified:  true,
	})
	if identity.Email != "alice@example.test" || !identity.EmailVerified {
		t.Fatalf("email verification was lost in persistence mapping: %#v", identity)
	}
}

func TestOAuthBridgePurposeCannotCrossRoutes(t *testing.T) {
	loginRequest := validBridgeRequest()
	loginRequest.Purpose = "connector_link"
	if err := ConsumeOAuthBridgeAssertion(
		context.Background(),
		loginRequest,
	); !errors.Is(err, ErrBridgePurposeInvalid) {
		t.Fatalf("connector assertion entered account login: %v", err)
	}

	connectorRequest := validBridgeRequest()
	if err := BindOAuthConnector(
		context.Background(),
		connectorRequest,
		&db.Actor{},
	); !errors.Is(err, ErrBridgePurposeInvalid) {
		t.Fatalf("account assertion entered connector link: %v", err)
	}
}

func validBridgeRequest() *oauthbridge.BrokerOAuthBridgeRequest {
	return &oauthbridge.BrokerOAuthBridgeRequest{
		BridgeVersion:     "v1",
		SiteId:            "default",
		Purpose:           "account_login",
		AssertionId:       strings.Repeat("a", 64),
		ReceiverId:        "lp-test",
		ReceiverChallenge: "YldFvi9dnPnO1KMwjEHki8bjxSoF5-7xwsrPIniWNjs",
		ReceiverVerifier:  "receiver-verifier",
		Provider:          "github",
		ProviderUserId:    "42",
		UnionId:           "union-42",
		Username:          "alice",
		DisplayName:       "Alice Example",
		AvatarUrl:         "https://example.test/avatar.png",
		Email:             "alice@example.test",
		EmailVerified:     true,
		Ts:                time.Now().UTC().Format(time.RFC3339),
	}
}

func signBridgeRequest(req *oauthbridge.BrokerOAuthBridgeRequest, secret string) {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(canonicalBridgePayload(req)))
	req.Sig = hex.EncodeToString(mac.Sum(nil))
}
