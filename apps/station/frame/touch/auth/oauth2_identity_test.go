package auth

import (
	"context"
	"errors"
	"testing"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	touchdb "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestBindOAuthIdentityPreservesActorOwnershipAndPrimaryStatus(t *testing.T) {
	database, err := gorm.Open(
		sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.AutoMigrate(&touchdb.OAuth2IdentityBinding{}); err != nil {
		t.Fatal(err)
	}
	identity := &coreauth.OAuth2Identity{
		ProviderID:     "github",
		ProviderUserID: "42",
		Username:       "alice",
		Email:          "alice@example.test",
		EmailVerified:  true,
	}
	if err := bindOAuthIdentity(
		context.Background(),
		database,
		100,
		identity,
		true,
	); err != nil {
		t.Fatal(err)
	}
	identity.DisplayName = "Alice Updated"
	if err := bindOAuthIdentity(
		context.Background(),
		database,
		100,
		identity,
		false,
	); err != nil {
		t.Fatal(err)
	}
	if err := bindOAuthIdentity(
		context.Background(),
		database,
		200,
		identity,
		false,
	); !errors.Is(err, coreauth.ErrOAuthIdentityConflict) {
		t.Fatalf("identity ownership transfer returned %v", err)
	}

	var stored touchdb.OAuth2IdentityBinding
	if err := database.First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.ActorID != 100 ||
		!stored.IsPrimary ||
		!stored.EmailVerified ||
		stored.DisplayName != "Alice Updated" {
		t.Fatalf("OAuth identity binding was corrupted: %#v", stored)
	}
}
