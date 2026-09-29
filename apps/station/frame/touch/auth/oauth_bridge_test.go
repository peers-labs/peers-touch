package auth

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
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
