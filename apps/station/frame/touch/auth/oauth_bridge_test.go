package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"testing"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

func signedOAuthBridgeRequest(secret string) *model.OAuthBridgeRequest {
	request := &model.OAuthBridgeRequest{
		Provider:       "github",
		ProviderUserId: "oauth-user",
		Email:          "oauth-user@test.invalid",
		Ts:             time.Now().UTC().Format(time.RFC3339),
	}
	message := fmt.Sprintf("%s:%s:%s:%s",
		request.GetProvider(),
		request.GetProviderUserId(),
		request.GetEmail(),
		request.GetTs(),
	)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(message))
	request.Sig = hex.EncodeToString(mac.Sum(nil))
	return request
}

func TestVerifyBridgeSignatureFailsClosedWithoutSecret(t *testing.T) {
	for name, secret := range map[string]string{
		"missing":    "",
		"whitespace": " \t ",
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("PEERS_OAUTH_BRIDGE_SECRET", secret)
			if err := VerifyBridgeSignature(signedOAuthBridgeRequest("unused")); !errors.Is(err, ErrBridgeSecretMissing) {
				t.Fatalf("VerifyBridgeSignature() error = %v, want %v", err, ErrBridgeSecretMissing)
			}
		})
	}
}

func TestVerifyBridgeSignatureRejectsMissingAndIncorrectSignature(t *testing.T) {
	const secret = "station-oauth-bridge-test-secret"
	t.Setenv("PEERS_OAUTH_BRIDGE_SECRET", secret)

	for name, signature := range map[string]string{
		"missing":   "",
		"malformed": "not-hex",
		"incorrect": hex.EncodeToString(make([]byte, sha256.Size)),
	} {
		t.Run(name, func(t *testing.T) {
			request := signedOAuthBridgeRequest(secret)
			request.Sig = signature
			if err := VerifyBridgeSignature(request); !errors.Is(err, ErrBridgeSignatureInvalid) {
				t.Fatalf("VerifyBridgeSignature() error = %v, want %v", err, ErrBridgeSignatureInvalid)
			}
		})
	}
}

func TestVerifyBridgeSignatureAcceptsOAuthClientCanonicalMessage(t *testing.T) {
	const secret = " station-oauth-bridge-test-secret "
	t.Setenv("PEERS_OAUTH_BRIDGE_SECRET", secret)

	if err := VerifyBridgeSignature(signedOAuthBridgeRequest(secret)); err != nil {
		t.Fatalf("VerifyBridgeSignature() error = %v", err)
	}
}

func TestGenerateOAuthPasswordPassesActorValidation(t *testing.T) {
	password, err := generateOAuthPassword()
	if err != nil {
		t.Fatalf("generateOAuthPassword() error = %v", err)
	}

	request := &model.ActorSignRequest{
		Name:     "oauth-user",
		Email:    "oauth-user@test.invalid",
		Password: password,
	}
	if err := request.Check(); err != nil {
		t.Fatalf("generated OAuth password failed actor validation: %v", err)
	}
	if got, want := len(password), 19; got != want {
		t.Fatalf("generated OAuth password length = %d, want %d", got, want)
	}
}

func TestOAuthProfileBootstrapUsesProviderAvatarOnlyWhenCanonicalAvatarMissing(t *testing.T) {
	identity := &coreauth.OAuth2Identity{
		AvatarURL: " https://avatars.example.test/oauth.png ",
	}

	request, ok := oauthProfileBootstrapRequest(
		&db.Actor{Icon: ""},
		identity,
		7,
	)
	if !ok || request.Avatar == nil {
		t.Fatal("missing Station avatar must produce an OAuth bootstrap mutation")
	}
	if got, want := *request.Avatar, "https://avatars.example.test/oauth.png"; got != want {
		t.Fatalf("bootstrap avatar = %q, want %q", got, want)
	}
	if request.ObservedRevision != 7 {
		t.Fatalf("observed revision = %d, want 7", request.ObservedRevision)
	}

	if _, ok := oauthProfileBootstrapRequest(
		&db.Actor{Icon: "https://station.example.test/custom.png"},
		identity,
		8,
	); ok {
		t.Fatal("existing Station avatar must remain authoritative")
	}
}
