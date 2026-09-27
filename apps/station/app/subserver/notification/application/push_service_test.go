package application_test

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"testing"

	"github.com/oklog/ulid/v2"
	"github.com/peers-labs/peers-touch/station/app/subserver/notification/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/notification/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/notification/infrastructure"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPushRegistrationLifecycleIsBoundRedactedAndIdempotent(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	repo := infrastructure.NewGormRepo(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatalf("migrate notification schema: %v", err)
	}
	protector, err := infrastructure.NewPushCredentialProtector("push-test-root-secret")
	if err != nil {
		t.Fatalf("create protector: %v", err)
	}
	service := application.NewService(repo, protector)

	installEpoch := sha256.Sum256([]byte("install-1"))
	firstToken := bytes.Repeat([]byte{0x41}, 32)
	input := domain.RegisterPushDeviceInput{
		RequestID:             ulid.Make().String(),
		ActorPTID:             "ptid:alice",
		DeviceID:              "alice-phone",
		LifecycleGeneration:   7,
		AppInstallEpochSHA256: installEpoch[:],
		Environment:           domain.PushEnvironmentDevelopment,
		Binding: domain.PushProviderBinding{
			Channel:   domain.PushChannelAPNS,
			APNSToken: firstToken,
			APNSTopic: "com.peers.touch.mobile",
		},
	}

	created, err := service.RegisterPush("alice-phone", input)
	if err != nil {
		t.Fatalf("register push: %v", err)
	}
	if created.Outcome != domain.RegisterPushDeviceOutcomeCreated ||
		created.Registration.ActorPTID != "ptid:alice" ||
		created.Registration.DeviceID != "alice-phone" {
		t.Fatalf("created result = %+v", created)
	}

	replayed, err := service.RegisterPush("alice-phone", input)
	if err != nil {
		t.Fatalf("replay register: %v", err)
	}
	if replayed.Outcome != created.Outcome ||
		replayed.Registration.RegistrationID != created.Registration.RegistrationID {
		t.Fatalf("replayed result = %+v, want %+v", replayed, created)
	}

	conflictingRequest := input
	conflictingRequest.Binding.APNSToken = bytes.Repeat([]byte{0x42}, 32)
	if _, err := service.RegisterPush("alice-phone", conflictingRequest); !errors.Is(
		err,
		domain.ErrPushIdempotencyConflict,
	) {
		t.Fatalf("request conflict error = %v", err)
	}

	rotatedInput := conflictingRequest
	rotatedInput.RequestID = ulid.Make().String()
	rotated, err := service.RegisterPush("alice-phone", rotatedInput)
	if err != nil {
		t.Fatalf("rotate registration: %v", err)
	}
	if rotated.Outcome != domain.RegisterPushDeviceOutcomeRotated ||
		rotated.Registration.RegistrationID != created.Registration.RegistrationID ||
		bytes.Equal(
			rotated.Registration.ProviderBindingSHA256,
			created.Registration.ProviderBindingSHA256,
		) {
		t.Fatalf("rotated result = %+v", rotated)
	}

	hijackInput := rotatedInput
	hijackInput.RequestID = ulid.Make().String()
	hijackInput.DeviceID = "alice-tablet"
	if _, err := service.RegisterPush("alice-tablet", hijackInput); !errors.Is(
		err,
		domain.ErrPushProviderConflict,
	) {
		t.Fatalf("provider conflict error = %v", err)
	}

	registrations, err := service.ListPushRegistrations("ptid:alice")
	if err != nil {
		t.Fatalf("list registrations: %v", err)
	}
	if len(registrations) != 1 ||
		registrations[0].RegistrationID != created.Registration.RegistrationID {
		t.Fatalf("registrations = %+v", registrations)
	}

	var stored infrastructure.PushRegistrationModel
	if err := db.First(&stored).Error; err != nil {
		t.Fatalf("load stored registration: %v", err)
	}
	if bytes.Contains(stored.ProviderCiphertext, rotatedInput.Binding.APNSToken) {
		t.Fatal("provider token persisted in plaintext")
	}
	plaintext, err := protector.Open(
		registrations[0],
		domain.ProtectedPushBinding{
			Fingerprint: stored.ProviderBindingHMAC,
			Ciphertext:  stored.ProviderCiphertext,
			Nonce:       stored.ProviderNonce,
			KeyVersion:  stored.CredentialKeyVersion,
		},
	)
	if err != nil {
		t.Fatalf("open protected binding: %v", err)
	}
	if !bytes.Contains(plaintext, rotatedInput.Binding.APNSToken) {
		t.Fatal("decrypted binding does not contain the registered token")
	}
	clear(plaintext)

	wrongEpoch := sha256.Sum256([]byte("install-2"))
	unregister := domain.UnregisterPushDeviceInput{
		RequestID:             ulid.Make().String(),
		ActorPTID:             "ptid:alice",
		DeviceID:              "alice-phone",
		LifecycleGeneration:   8,
		RegistrationID:        created.Registration.RegistrationID,
		AppInstallEpochSHA256: wrongEpoch[:],
	}
	if _, err := service.UnregisterPush("alice-phone", unregister); !errors.Is(
		err,
		domain.ErrPushInstallConflict,
	) {
		t.Fatalf("install conflict error = %v", err)
	}

	unregister.RequestID = ulid.Make().String()
	unregister.AppInstallEpochSHA256 = installEpoch[:]
	removed, err := service.UnregisterPush("alice-phone", unregister)
	if err != nil {
		t.Fatalf("unregister push: %v", err)
	}
	if removed.Outcome != domain.UnregisterPushDeviceOutcomeRemoved {
		t.Fatalf("unregister outcome = %v", removed.Outcome)
	}
	replayedRemoval, err := service.UnregisterPush("alice-phone", unregister)
	if err != nil {
		t.Fatalf("replay unregister: %v", err)
	}
	if replayedRemoval.Outcome != domain.UnregisterPushDeviceOutcomeRemoved {
		t.Fatalf("replayed unregister = %+v", replayedRemoval)
	}
}

func TestPushRegistrationRejectsAuthenticatedDeviceMismatch(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	repo := infrastructure.NewGormRepo(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatalf("migrate notification schema: %v", err)
	}
	protector, err := infrastructure.NewPushCredentialProtector("push-test-root-secret")
	if err != nil {
		t.Fatalf("create protector: %v", err)
	}
	service := application.NewService(repo, protector)
	installEpoch := sha256.Sum256([]byte("install"))

	_, err = service.RegisterPush("authenticated-device", domain.RegisterPushDeviceInput{
		RequestID:             ulid.Make().String(),
		ActorPTID:             "ptid:alice",
		DeviceID:              "forged-device",
		LifecycleGeneration:   1,
		AppInstallEpochSHA256: installEpoch[:],
		Environment:           domain.PushEnvironmentProduction,
		Binding: domain.PushProviderBinding{
			Channel:  domain.PushChannelFCM,
			FCMToken: "provider-token",
		},
	})
	if !errors.Is(err, application.ErrPushDeviceMismatch) {
		t.Fatalf("device mismatch error = %v", err)
	}
}

func TestPushCredentialRootRotationInvalidatesRegistrations(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	repo := infrastructure.NewGormRepo(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatalf("migrate notification schema: %v", err)
	}
	first, _ := infrastructure.NewPushCredentialProtector("first-root")
	second, _ := infrastructure.NewPushCredentialProtector("second-root")
	if err := repo.ActivatePushCredentialKey(first.KeyVersion(), first.KeyIdentity()); err != nil {
		t.Fatalf("activate first key: %v", err)
	}
	service := application.NewService(repo, first)
	installEpoch := sha256.Sum256([]byte("install"))
	_, err = service.RegisterPush("alice-phone", domain.RegisterPushDeviceInput{
		RequestID:             ulid.Make().String(),
		ActorPTID:             "ptid:alice",
		DeviceID:              "alice-phone",
		LifecycleGeneration:   1,
		AppInstallEpochSHA256: installEpoch[:],
		Environment:           domain.PushEnvironmentProduction,
		Binding: domain.PushProviderBinding{
			Channel:  domain.PushChannelFCM,
			FCMToken: "provider-token",
		},
	})
	if err != nil {
		t.Fatalf("register push: %v", err)
	}
	if err := repo.ActivatePushCredentialKey(second.KeyVersion(), second.KeyIdentity()); err != nil {
		t.Fatalf("rotate key: %v", err)
	}
	registrations, err := repo.ListPushRegistrations("ptid:alice")
	if err != nil {
		t.Fatalf("list registrations: %v", err)
	}
	if len(registrations) != 0 {
		t.Fatalf("registrations survived credential key rotation: %+v", registrations)
	}
}
