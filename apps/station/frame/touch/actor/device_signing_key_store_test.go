package actor

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"testing"

	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newDeviceSigningKeyTestStore(t *testing.T) *DeviceStore {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	store := NewDeviceStore(db)
	if err := store.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	return store
}

func TestDeviceStoreResolvesOnlyVerifiedSigningKeys(t *testing.T) {
	ctx := context.Background()
	store := newDeviceSigningKeyTestStore(t)
	publicKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RegisterLocal(
		ctx,
		"alice",
		"device-1",
		"desktop",
		"station-a",
		"key-1",
		publicKey,
		1,
	); err != nil {
		t.Fatal(err)
	}
	resolved, err := store.ResolveSigningKey(ctx, "alice", "device-1", "key-1")
	if err != nil {
		t.Fatal(err)
	}
	if resolved.HomeStationPeerId != "station-a" ||
		!ed25519.PublicKey(resolved.Ed25519PublicKey).Equal(publicKey) {
		t.Fatalf("resolved key mismatch: %+v", resolved)
	}
	if err := store.RegisterLocal(
		ctx,
		"alice",
		"device-1",
		"renamed desktop",
		"station-a",
		"",
		nil,
		0,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ResolveSigningKey(ctx, "alice", "device-1", "key-1"); err != nil {
		t.Fatalf("unverified re-registration erased verified key: %v", err)
	}
	otherPublicKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RegisterLocal(
		ctx,
		"alice",
		"device-1",
		"desktop",
		"station-a",
		"key-2",
		otherPublicKey,
		2,
	); !errors.Is(err, ErrDeviceSigningKeyConflict) {
		t.Fatalf("unproven key rotation error = %v, want conflict", err)
	}

	if err := store.RegisterLocal(
		ctx,
		"alice",
		"legacy-device",
		"desktop",
		"station-a",
		"",
		nil,
		0,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ResolveSigningKey(
		ctx,
		"alice",
		"legacy-device",
		"",
	); !errors.Is(err, ErrDeviceSigningKeyNotFound) {
		t.Fatalf("unverified legacy key resolved: %v", err)
	}

	if err := store.Revoke(ctx, "alice", "device-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ResolveSigningKey(
		ctx,
		"alice",
		"device-1",
		"key-1",
	); !errors.Is(err, ErrDeviceSigningKeyNotFound) {
		t.Fatalf("revoked key resolved: %v", err)
	}
}

func TestDeviceStoreAcceptsVerifiedRemoteProjection(t *testing.T) {
	ctx := context.Background()
	store := newDeviceSigningKeyTestStore(t)
	publicKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertVerifiedRemote(ctx, &model.VerifiedActorDeviceSigningKey{
		ActorPtid:          "bob",
		ActorDeviceId:      "device-b",
		HomeStationPeerId:  "station-b",
		SigningKeyId:       "key-b",
		Ed25519PublicKey:   publicKey,
		ProfileVersion:     3,
		VerificationSource: model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE,
		ValidFromUnixMs:    1_800_000_000_000,
	}); err != nil {
		t.Fatal(err)
	}
	resolved, err := store.ResolveSigningKey(ctx, "bob", "device-b", "key-b")
	if err != nil {
		t.Fatal(err)
	}
	if resolved.ProfileVersion != 3 ||
		resolved.VerificationSource != model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE {
		t.Fatalf("remote projection mismatch: %+v", resolved)
	}
}
