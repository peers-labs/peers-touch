package auth

import (
	"testing"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

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
