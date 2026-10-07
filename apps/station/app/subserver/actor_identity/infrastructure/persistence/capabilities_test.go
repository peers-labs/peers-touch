package persistence_test

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"testing"
	"time"

	actoridentityapp "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestBuildLocalEndpointManifestUsesCanonicalDeviceOrdering(t *testing.T) {
	database, err := gorm.Open(
		sqlite.Open("file:actor-manifest-ordering?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	repository, err := persistence.NewRepository(database)
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.AutoMigrate(); err != nil {
		t.Fatal(err)
	}

	now := time.Date(2026, time.October, 6, 6, 0, 0, 0, time.UTC)
	actorPTID := "ptid:v1:actor:peers:p:bob:1220d112c4e53405d2df5b04355bc8cbde006d6f11db84bba1414bddd0d98ca55d2f"
	stationPeerID := "12D3KooWGbjzdMwmdtq5YieHxHdA7j5LpepGYmjGcLVWGrWcWKKW"
	actorSeed := [ed25519.SeedSize]byte{0x11}
	actorPrivateKey := ed25519.NewKeyFromSeed(actorSeed[:])
	actorPublicKey := actorPrivateKey.Public().(ed25519.PublicKey)
	actorFingerprint := sha256.Sum256(actorPublicKey)
	if err := database.Create(&persistence.ActorIdentityModel{
		PTID:           actorPTID,
		PublicKey:      append([]byte(nil), actorPublicKey...),
		Fingerprint:    append([]byte(nil), actorFingerprint[:]...),
		ProfileVersion: 1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error; err != nil {
		t.Fatal(err)
	}

	deviceIDs := []string{
		"01M47X1W1YJ3ZEVW7D1C5C93ND",
		"-REm7MBgiOfN35_UmrY_wH20Wpcq-7Kg9XK2YVroibc",
	}
	for index, deviceID := range deviceIDs {
		deviceSeed := [ed25519.SeedSize]byte{byte(0x21 + index)}
		devicePublicKey := ed25519.NewKeyFromSeed(deviceSeed[:]).
			Public().(ed25519.PublicKey)
		signingKeyID := sha256.Sum256(devicePublicKey)
		if err := database.Create(&persistence.ActorDeviceModel{
			PTID:               actorPTID,
			ActorAccount:       "bob@p.t",
			ActorKind:          int32(actormodel.ActorKind_ACTOR_KIND_PERSON),
			DeviceID:           deviceID,
			Label:              "Bob Device",
			HomeStationPeerID:  stationPeerID,
			SigningKeyID:       hex.EncodeToString(signingKeyID[:]),
			PublicKey:          append([]byte(nil), devicePublicKey...),
			ProfileVersion:     1,
			VerificationSource: int32(actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION),
			CreatedAt:          now,
		}).Error; err != nil {
			t.Fatal(err)
		}
	}

	manifest, err := repository.BuildLocalEndpointManifestSnapshot(
		context.Background(),
		&actormodel.ActorRef{
			Ptid: actorPTID,
			Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
		},
		stationPeerID,
		now,
		now.Add(time.Minute),
	)
	if err != nil {
		t.Fatal(err)
	}
	stationSeed := [ed25519.SeedSize]byte{0x31}
	stationPrivateKey := ed25519.NewKeyFromSeed(stationSeed[:])
	if err := actoridentityapp.SignEndpointManifest(
		manifest,
		"station-signing-key",
		stationPrivateKey,
	); err != nil {
		t.Fatal(err)
	}
	if err := actoridentityapp.ValidateEndpointManifest(
		manifest,
		actorPTID,
		stationPeerID,
		now,
	); err != nil {
		t.Fatal(err)
	}

	got := []string{
		manifest.GetActiveEndpoints()[0].GetEndpoint().GetDeviceId(),
		manifest.GetActiveEndpoints()[1].GetEndpoint().GetDeviceId(),
	}
	want := []string{
		"-REm7MBgiOfN35_UmrY_wH20Wpcq-7Kg9XK2YVroibc",
		"01M47X1W1YJ3ZEVW7D1C5C93ND",
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("device order = %v, want %v", got, want)
		}
	}
}
