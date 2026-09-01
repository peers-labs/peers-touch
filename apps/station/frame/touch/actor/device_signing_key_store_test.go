package actor

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
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
	active, err := store.IsVerifiedActive(ctx, "alice", "device-1")
	if err != nil || !active {
		t.Fatalf("verified device active=%v error=%v", active, err)
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
	active, err = store.IsVerifiedActive(ctx, "alice", "legacy-device")
	if err != nil || active {
		t.Fatalf("unverified device active=%v error=%v", active, err)
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
	if err := store.Revoke(ctx, "alice", "missing-device"); !errors.Is(
		err,
		ErrDeviceSigningKeyNotFound,
	) {
		t.Fatalf("missing device revoke error=%v, want ErrDeviceSigningKeyNotFound", err)
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

func TestDeviceStoreEnrollsOnlyCrossSignedContinuousIdentity(t *testing.T) {
	ctx := context.Background()
	store := newDeviceSigningKeyTestStore(t)
	actorPublic, actorPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	devicePublic, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	certificate := []byte("deterministic-device-certificate")
	identityHash := sha256.Sum256(actorPublic)
	deviceHash := sha256.Sum256(devicePublic)
	input := VerifiedLocalDeviceEnrollment{
		PTID:                      "ptid:test:alice",
		DeviceID:                  "alice-device-1",
		Label:                     "Alice Desktop",
		HomeStationPeerID:         "station-a",
		ActorIdentityPublicKey:    actorPublic,
		ActorIdentityFingerprint:  identityHash[:],
		DeviceSigningPublicKey:    devicePublic,
		SigningKeyID:              hex.EncodeToString(deviceHash[:]),
		ProfileVersion:            1,
		CanonicalCertificateBytes: certificate,
		ActorCrossSignature:       ed25519.Sign(actorPrivate, certificate),
	}
	if err := store.EnrollVerifiedLocal(ctx, input); err != nil {
		t.Fatal(err)
	}
	if err := store.EnrollVerifiedLocal(ctx, input); err != nil {
		t.Fatalf("idempotent enrollment failed: %v", err)
	}
	resolved, err := store.ResolveSigningKey(
		ctx,
		input.PTID,
		input.DeviceID,
		input.SigningKeyID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(resolved.Ed25519PublicKey, devicePublic) {
		t.Fatal("verified device signing key mismatch")
	}

	secondPublic, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	secondHash := sha256.Sum256(secondPublic)
	second := input
	second.DeviceID = "alice-device-2"
	second.DeviceSigningPublicKey = secondPublic
	second.SigningKeyID = hex.EncodeToString(secondHash[:])
	second.CanonicalCertificateBytes = []byte("second-device-certificate")
	second.ActorCrossSignature = ed25519.Sign(actorPrivate, second.CanonicalCertificateBytes)
	if err := store.EnrollVerifiedLocal(ctx, second); err != nil {
		t.Fatalf("same actor identity could not enroll second device: %v", err)
	}

	forged := input
	forged.DeviceID = "forged-device"
	forged.CanonicalCertificateBytes = []byte("forged-certificate")
	if err := store.EnrollVerifiedLocal(ctx, forged); !errors.Is(err, ErrDeviceEnrollmentProof) {
		t.Fatalf("forged proof error=%v, want ErrDeviceEnrollmentProof", err)
	}
	if _, err := store.ResolveSigningKey(
		ctx,
		forged.PTID,
		forged.DeviceID,
		forged.SigningKeyID,
	); !errors.Is(err, ErrDeviceSigningKeyNotFound) {
		t.Fatalf("forged enrollment persisted: %v", err)
	}

	otherActorPublic, otherActorPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	otherIdentityHash := sha256.Sum256(otherActorPublic)
	identityConflict := second
	identityConflict.DeviceID = "alice-device-3"
	identityConflict.ActorIdentityPublicKey = otherActorPublic
	identityConflict.ActorIdentityFingerprint = otherIdentityHash[:]
	identityConflict.CanonicalCertificateBytes = []byte("identity-conflict")
	identityConflict.ActorCrossSignature = ed25519.Sign(
		otherActorPrivate,
		identityConflict.CanonicalCertificateBytes,
	)
	if err := store.EnrollVerifiedLocal(
		ctx,
		identityConflict,
	); !errors.Is(err, ErrActorIdentityConflict) {
		t.Fatalf("identity conflict error=%v, want ErrActorIdentityConflict", err)
	}

	if err := store.Revoke(ctx, input.PTID, input.DeviceID); err != nil {
		t.Fatal(err)
	}
	if err := store.EnrollVerifiedLocal(
		ctx,
		input,
	); !errors.Is(err, ErrDeviceSigningKeyConflict) {
		t.Fatalf("revoked replay error=%v, want ErrDeviceSigningKeyConflict", err)
	}
}
