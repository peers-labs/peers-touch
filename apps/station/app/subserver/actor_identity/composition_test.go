package actor_identity_test

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	actoridentityhttp "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/interface/http"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var actorIdentityTestTime = time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)

type actorIdentityTestComposition struct {
	db      *gorm.DB
	handler *actoridentityhttp.Handler
}

func newActorIdentityTestComposition(t *testing.T) actorIdentityTestComposition {
	t.Helper()

	dsn := fmt.Sprintf(
		"file:actor-identity-%s?mode=memory&cache=shared&_busy_timeout=5000",
		uuid.NewString(),
	)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)

	repository, err := persistence.NewRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	service, err := application.NewService(
		repository,
		"station-a",
		func() time.Time {
			return actorIdentityTestTime
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	handler, err := actoridentityhttp.NewHandler(service)
	if err != nil {
		t.Fatal(err)
	}

	return actorIdentityTestComposition{
		db:      db,
		handler: handler,
	}
}

// TestActorIdentityTestCompositionCanonicalLifecycle verifies the canonical end-to-end lifecycle.
func TestActorIdentityTestCompositionCanonicalLifecycle(t *testing.T) {
	composition := newActorIdentityTestComposition(t)
	authenticated := actoridentityhttp.AuthenticatedActor{
		PTID:     "ptid:p:alice",
		DeviceID: "alice-desktop",
	}
	actorPrivate := deterministicPrivateKey(0x11)
	request := signedEnrollmentRequest(
		t,
		authenticated.PTID,
		"alice@example.test",
		authenticated.DeviceID,
		"Alice Desktop",
		actorPrivate,
		deterministicPublicKey(0x21),
		3,
	)

	enrolled, err := composition.handler.Enroll(context.Background(), authenticated, request)
	if err != nil {
		t.Fatal(err)
	}
	assertCanonicalDevice(
		t,
		enrolled.GetDevice(),
		authenticated.PTID,
		authenticated.DeviceID,
		actormodel.ActorDeviceStatus_ACTOR_DEVICE_STATUS_ACTIVE,
		3,
	)

	listed, err := composition.handler.List(
		context.Background(),
		authenticated,
		&actormodel.ListActorDevicesRequest{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.GetDevices()) != 1 {
		t.Fatalf("listed device count = %d, want 1", len(listed.GetDevices()))
	}
	assertCanonicalDevice(
		t,
		listed.GetDevices()[0],
		authenticated.PTID,
		authenticated.DeviceID,
		actormodel.ActorDeviceStatus_ACTOR_DEVICE_STATUS_ACTIVE,
		3,
	)

	otherActor := actoridentityhttp.AuthenticatedActor{
		PTID:     "ptid:p:bob",
		DeviceID: "bob-desktop",
	}
	otherDevices, err := composition.handler.List(
		context.Background(),
		otherActor,
		&actormodel.ListActorDevicesRequest{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(otherDevices.GetDevices()) != 0 {
		t.Fatalf("cross-actor list leaked devices: %+v", otherDevices.GetDevices())
	}
	if _, err := composition.handler.Revoke(
		context.Background(),
		otherActor,
		&actormodel.RevokeActorDeviceRequest{
			DeviceId:               authenticated.DeviceID,
			ObservedProfileVersion: 3,
		},
	); !domain.IsCode(err, domain.ErrorCodeDeviceNotFound) {
		t.Fatalf("cross-actor revoke error = %v", err)
	}

	revoked, err := composition.handler.Revoke(
		context.Background(),
		authenticated,
		&actormodel.RevokeActorDeviceRequest{
			DeviceId:               authenticated.DeviceID,
			ObservedProfileVersion: 3,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	assertCanonicalDevice(
		t,
		revoked.GetDevice(),
		authenticated.PTID,
		authenticated.DeviceID,
		actormodel.ActorDeviceStatus_ACTOR_DEVICE_STATUS_REVOKED,
		3,
	)
	if revoked.GetDevice().GetRevokedAt() == nil ||
		!revoked.GetDevice().GetRevokedAt().AsTime().Equal(actorIdentityTestTime) {
		t.Fatalf("unexpected revocation timestamp: %v", revoked.GetDevice().GetRevokedAt())
	}

	replayed, err := composition.handler.Revoke(
		context.Background(),
		authenticated,
		&actormodel.RevokeActorDeviceRequest{
			DeviceId:               authenticated.DeviceID,
			ObservedProfileVersion: 3,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(revoked.GetDevice(), replayed.GetDevice()) {
		t.Fatalf("revoke replay changed terminal response: first=%v second=%v", revoked, replayed)
	}

	if _, err := composition.handler.Enroll(
		context.Background(),
		authenticated,
		request,
	); !domain.IsCode(err, domain.ErrorCodeDeviceRevoked) {
		t.Fatalf("revoked enrollment replay error = %v", err)
	}

	var row persistence.ActorDeviceModel
	if err := composition.db.
		Where("ptid = ? AND device_id = ?", authenticated.PTID, authenticated.DeviceID).
		First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if !row.Revoked || row.VerificationSource == 0 {
		t.Fatalf("unexpected persisted lifecycle row: %+v", row)
	}
}

// TestActorIdentityTestCompositionRejectsInvalidProofBeforeMutation verifies fail-closed proof checks.
func TestActorIdentityTestCompositionRejectsInvalidProofBeforeMutation(t *testing.T) {
	tests := []struct {
		name          string
		mutate        func(*actormodel.EnrollActorDeviceRequest)
		authenticated actoridentityhttp.AuthenticatedActor
		wantCode      domain.ErrorCode
	}{
		{
			name: "forged signature",
			mutate: func(request *actormodel.EnrollActorDeviceRequest) {
				request.ActorCrossSignature[0] ^= 0xff
			},
			authenticated: actoridentityhttp.AuthenticatedActor{
				PTID:     "ptid:p:alice",
				DeviceID: "alice-desktop",
			},
			wantCode: domain.ErrorCodeInvalidProof,
		},
		{
			name:   "actor binding mismatch",
			mutate: func(*actormodel.EnrollActorDeviceRequest) {},
			authenticated: actoridentityhttp.AuthenticatedActor{
				PTID:     "ptid:p:mallory",
				DeviceID: "alice-desktop",
			},
			wantCode: domain.ErrorCodeUnauthorized,
		},
		{
			name:   "device binding mismatch",
			mutate: func(*actormodel.EnrollActorDeviceRequest) {},
			authenticated: actoridentityhttp.AuthenticatedActor{
				PTID:     "ptid:p:alice",
				DeviceID: "mallory-device",
			},
			wantCode: domain.ErrorCodeUnauthorized,
		},
		{
			name: "fingerprint mismatch",
			mutate: func(request *actormodel.EnrollActorDeviceRequest) {
				request.Certificate.ActorIdentityKeyFingerprint[0] ^= 0xff
			},
			authenticated: actoridentityhttp.AuthenticatedActor{
				PTID:     "ptid:p:alice",
				DeviceID: "alice-desktop",
			},
			wantCode: domain.ErrorCodeInvalidProof,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			composition := newActorIdentityTestComposition(t)
			request := signedEnrollmentRequest(
				t,
				"ptid:p:alice",
				"alice@example.test",
				"alice-desktop",
				"Alice Desktop",
				deterministicPrivateKey(0x31),
				deterministicPublicKey(0x41),
				1,
			)
			test.mutate(request)

			_, err := composition.handler.Enroll(
				context.Background(),
				test.authenticated,
				request,
			)
			assertHandlerDomainError(t, err, test.wantCode, 0)

			var count int64
			if err := composition.db.Model(&persistence.ActorDeviceModel{}).
				Count(&count).Error; err != nil {
				t.Fatal(err)
			}
			if count != 0 {
				t.Fatalf("invalid enrollment persisted %d device rows", count)
			}
		})
	}
}

// TestActorIdentityTestCompositionFencesIdentityProfileAndDeviceRotation verifies continuity fences.
func TestActorIdentityTestCompositionFencesIdentityProfileAndDeviceRotation(t *testing.T) {
	composition := newActorIdentityTestComposition(t)
	ctx := context.Background()
	actorPrivate := deterministicPrivateKey(0x51)
	authenticated := actoridentityhttp.AuthenticatedActor{
		PTID:     "ptid:p:alice",
		DeviceID: "alice-desktop",
	}
	initial := signedEnrollmentRequest(
		t,
		authenticated.PTID,
		"alice@example.test",
		authenticated.DeviceID,
		"Alice Desktop",
		actorPrivate,
		deterministicPublicKey(0x61),
		2,
	)
	if _, err := composition.handler.Enroll(ctx, authenticated, initial); err != nil {
		t.Fatal(err)
	}

	staleAuth := actoridentityhttp.AuthenticatedActor{
		PTID:     authenticated.PTID,
		DeviceID: "alice-mobile",
	}
	stale := signedEnrollmentRequest(
		t,
		staleAuth.PTID,
		"alice@example.test",
		staleAuth.DeviceID,
		"Alice Mobile",
		actorPrivate,
		deterministicPublicKey(0x62),
		1,
	)
	if _, err := composition.handler.Enroll(ctx, staleAuth, stale); !domain.IsCode(
		err,
		domain.ErrorCodeStaleProfileVersion,
	) {
		t.Fatalf("stale profile enrollment error = %v", err)
	}

	conflictingIdentity := signedEnrollmentRequest(
		t,
		authenticated.PTID,
		"alice@example.test",
		"alice-tablet",
		"Alice Tablet",
		deterministicPrivateKey(0x52),
		deterministicPublicKey(0x63),
		3,
	)
	if _, err := composition.handler.Enroll(
		ctx,
		actoridentityhttp.AuthenticatedActor{
			PTID:     authenticated.PTID,
			DeviceID: "alice-tablet",
		},
		conflictingIdentity,
	); !domain.IsCode(err, domain.ErrorCodeIdentityConflict) {
		t.Fatalf("identity continuity error = %v", err)
	}

	rotated := signedEnrollmentRequest(
		t,
		authenticated.PTID,
		"alice@example.test",
		authenticated.DeviceID,
		"Alice Desktop",
		actorPrivate,
		deterministicPublicKey(0x64),
		3,
	)
	if _, err := composition.handler.Enroll(
		ctx,
		authenticated,
		rotated,
	); !domain.IsCode(err, domain.ErrorCodeDeviceConflict) {
		t.Fatalf("device rotation error = %v", err)
	}

	validSecond := signedEnrollmentRequest(
		t,
		staleAuth.PTID,
		"alice@example.test",
		staleAuth.DeviceID,
		"Alice Mobile",
		actorPrivate,
		deterministicPublicKey(0x62),
		2,
	)
	if _, err := composition.handler.Enroll(ctx, staleAuth, validSecond); err != nil {
		t.Fatalf("failed transaction advanced profile version: %v", err)
	}

	thirdAuth := actoridentityhttp.AuthenticatedActor{
		PTID:     authenticated.PTID,
		DeviceID: "alice-tablet",
	}
	validThird := signedEnrollmentRequest(
		t,
		thirdAuth.PTID,
		"alice@example.test",
		thirdAuth.DeviceID,
		"Alice Tablet",
		actorPrivate,
		deterministicPublicKey(0x63),
		3,
	)
	if _, err := composition.handler.Enroll(ctx, thirdAuth, validThird); err != nil {
		t.Fatalf("monotonic profile advance failed: %v", err)
	}

	for _, version := range []uint64{2, 4} {
		_, err := composition.handler.Revoke(
			ctx,
			authenticated,
			&actormodel.RevokeActorDeviceRequest{
				DeviceId:               authenticated.DeviceID,
				ObservedProfileVersion: version,
			},
		)
		wantCode := domain.ErrorCodeStaleProfileVersion
		if version > 3 {
			wantCode = domain.ErrorCodeFutureProfileVersion
		}
		if !domain.IsCode(err, wantCode) {
			t.Fatalf("revoke version=%d error=%v, want %s", version, err, wantCode)
		}
	}
}

// TestActorIdentityUpgradesCompatibleUnverifiedRowsAtomically verifies legacy row adoption.
func TestActorIdentityUpgradesCompatibleUnverifiedRowsAtomically(t *testing.T) {
	t.Run("compatible row", func(t *testing.T) {
		composition := newActorIdentityTestComposition(t)
		createdAt := actorIdentityTestTime.Add(-time.Hour)
		unverified := persistence.ActorDeviceModel{
			PTID:              "ptid:p:alice",
			ActorAccount:      "alice@example.test",
			ActorKind:         int32(actormodel.ActorKind_ACTOR_KIND_PERSON),
			DeviceID:          "alice-desktop",
			Label:             "Legacy Desktop",
			HomeStationPeerID: "station-a",
			PublicKey:         []byte{},
			ProfileVersion:    2,
			CreatedAt:         createdAt,
		}
		if err := composition.db.Create(&unverified).Error; err != nil {
			t.Fatal(err)
		}

		authenticated := actoridentityhttp.AuthenticatedActor{
			PTID:     unverified.PTID,
			DeviceID: unverified.DeviceID,
		}
		request := signedEnrollmentRequest(
			t,
			authenticated.PTID,
			unverified.ActorAccount,
			authenticated.DeviceID,
			"Verified Desktop",
			deterministicPrivateKey(0x81),
			deterministicPublicKey(0x82),
			2,
		)
		response, err := composition.handler.Enroll(
			context.Background(),
			authenticated,
			request,
		)
		if err != nil {
			t.Fatalf("upgrade unverified actor device: %v", err)
		}
		if response.GetDevice().GetActivationSequence() != unverified.ID {
			t.Fatalf(
				"activation sequence = %d, want existing row %d",
				response.GetDevice().GetActivationSequence(),
				unverified.ID,
			)
		}

		var persisted persistence.ActorDeviceModel
		if err := composition.db.First(&persisted, unverified.ID).Error; err != nil {
			t.Fatal(err)
		}
		if persisted.VerificationSource == 0 ||
			persisted.SigningKeyID == "" ||
			len(persisted.PublicKey) != ed25519.PublicKeySize ||
			persisted.Revoked ||
			!persisted.CreatedAt.Equal(createdAt) {
			t.Fatalf("unverified row was not upgraded in place: %+v", persisted)
		}
	})

	t.Run("conflicting row rolls back", func(t *testing.T) {
		composition := newActorIdentityTestComposition(t)
		unverified := persistence.ActorDeviceModel{
			PTID:              "ptid:p:alice",
			ActorAccount:      "alice@example.test",
			ActorKind:         int32(actormodel.ActorKind_ACTOR_KIND_PERSON),
			DeviceID:          "alice-desktop",
			Label:             "Legacy Desktop",
			HomeStationPeerID: "station-a",
			PublicKey:         bytes.Repeat([]byte{0xff}, ed25519.PublicKeySize),
			ProfileVersion:    2,
			CreatedAt:         actorIdentityTestTime.Add(-time.Hour),
		}
		if err := composition.db.Create(&unverified).Error; err != nil {
			t.Fatal(err)
		}

		authenticated := actoridentityhttp.AuthenticatedActor{
			PTID:     unverified.PTID,
			DeviceID: unverified.DeviceID,
		}
		request := signedEnrollmentRequest(
			t,
			authenticated.PTID,
			unverified.ActorAccount,
			authenticated.DeviceID,
			"Verified Desktop",
			deterministicPrivateKey(0x91),
			deterministicPublicKey(0x92),
			2,
		)
		if _, err := composition.handler.Enroll(
			context.Background(),
			authenticated,
			request,
		); !domain.IsCode(err, domain.ErrorCodeDeviceConflict) {
			t.Fatalf("conflicting unverified upgrade error = %v", err)
		}

		var persisted persistence.ActorDeviceModel
		if err := composition.db.First(&persisted, unverified.ID).Error; err != nil {
			t.Fatal(err)
		}
		if persisted.VerificationSource != 0 ||
			!bytes.Equal(persisted.PublicKey, unverified.PublicKey) {
			t.Fatalf("conflicting upgrade mutated actor device: %+v", persisted)
		}
		var identities int64
		if err := composition.db.Model(&persistence.ActorIdentityModel{}).
			Count(&identities).Error; err != nil {
			t.Fatal(err)
		}
		if identities != 0 {
			t.Fatalf("conflicting upgrade retained %d identity rows", identities)
		}
	})
}

// TestActorIdentityTestCompositionConcurrentRetriesRemainSingleLifecycle verifies retry idempotency.
func TestActorIdentityTestCompositionConcurrentRetriesRemainSingleLifecycle(t *testing.T) {
	composition := newActorIdentityTestComposition(t)
	authenticated := actoridentityhttp.AuthenticatedActor{
		PTID:     "ptid:p:alice",
		DeviceID: "alice-desktop",
	}
	request := signedEnrollmentRequest(
		t,
		authenticated.PTID,
		"alice@example.test",
		authenticated.DeviceID,
		"Alice Desktop",
		deterministicPrivateKey(0x71),
		deterministicPublicKey(0x72),
		1,
	)

	const workers = 16
	enrollmentSequences := make(chan int64, workers)
	errorsChannel := make(chan error, workers)
	var enrollWait sync.WaitGroup
	enrollWait.Add(workers)
	for index := 0; index < workers; index++ {
		go func() {
			defer enrollWait.Done()

			response, err := composition.handler.Enroll(
				context.Background(),
				authenticated,
				request,
			)
			if err != nil {
				errorsChannel <- err

				return
			}
			enrollmentSequences <- response.GetDevice().GetActivationSequence()
		}()
	}
	enrollWait.Wait()
	close(enrollmentSequences)
	close(errorsChannel)
	for err := range errorsChannel {
		t.Fatalf("concurrent enrollment failed: %v", err)
	}

	var activationSequence int64
	for sequence := range enrollmentSequences {
		if sequence <= 0 {
			t.Fatalf("invalid activation sequence: %d", sequence)
		}
		if activationSequence == 0 {
			activationSequence = sequence
		}
		if sequence != activationSequence {
			t.Fatalf(
				"concurrent retry allocated another sequence: got=%d want=%d",
				sequence,
				activationSequence,
			)
		}
	}

	var revokeWait sync.WaitGroup
	revokeWait.Add(workers)
	revokeErrors := make(chan error, workers)
	for index := 0; index < workers; index++ {
		go func() {
			defer revokeWait.Done()

			_, err := composition.handler.Revoke(
				context.Background(),
				authenticated,
				&actormodel.RevokeActorDeviceRequest{
					DeviceId:               authenticated.DeviceID,
					ObservedProfileVersion: 1,
				},
			)
			if err != nil {
				revokeErrors <- err
			}
		}()
	}
	revokeWait.Wait()
	close(revokeErrors)
	for err := range revokeErrors {
		t.Fatalf("concurrent revocation failed: %v", err)
	}

	listed, err := composition.handler.List(
		context.Background(),
		authenticated,
		&actormodel.ListActorDevicesRequest{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.GetDevices()) != 1 ||
		listed.GetDevices()[0].GetStatus() !=
			actormodel.ActorDeviceStatus_ACTOR_DEVICE_STATUS_REVOKED {
		t.Fatalf("unexpected terminal lifecycle: %+v", listed.GetDevices())
	}

	var count int64
	if err := composition.db.Model(&persistence.ActorDeviceModel{}).
		Where("ptid = ? AND device_id = ?", authenticated.PTID, authenticated.DeviceID).
		Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("concurrent retries persisted %d rows, want 1", count)
	}
}

// TestActorIdentityInterfaceOwnsCanonicalPathsAndTypedErrors verifies boundary metadata.
func TestActorIdentityInterfaceOwnsCanonicalPathsAndTypedErrors(t *testing.T) {
	if actoridentityhttp.EnrollPath != "/device/enroll" ||
		actoridentityhttp.ListPath != "/device/list" ||
		actoridentityhttp.RevokePath != "/device/revoke" {
		t.Fatalf(
			"unexpected paths: enroll=%s list=%s revoke=%s",
			actoridentityhttp.EnrollPath,
			actoridentityhttp.ListPath,
			actoridentityhttp.RevokePath,
		)
	}

	composition := newActorIdentityTestComposition(t)
	_, err := composition.handler.List(
		context.Background(),
		actoridentityhttp.AuthenticatedActor{},
		&actormodel.ListActorDevicesRequest{},
	)
	assertHandlerDomainError(
		t,
		err,
		domain.ErrorCodeUnauthorized,
		http.StatusUnauthorized,
	)
}

// TestActorIdentityPersistenceUsesCanonicalTablesAndColumns verifies explicit schema ownership.
func TestActorIdentityPersistenceUsesCanonicalTablesAndColumns(t *testing.T) {
	composition := newActorIdentityTestComposition(t)

	if (&persistence.ActorDeviceModel{}).TableName() != "actor_devices" {
		t.Fatal("ActorDeviceModel must own actor_devices")
	}
	if (&persistence.ActorIdentityModel{}).TableName() != "actor_identity_keys" {
		t.Fatal("ActorIdentityModel must own actor_identity_keys")
	}
	for _, column := range []string{
		"id",
		"ptid",
		"actor_acct",
		"actor_kind",
		"device_id",
		"label",
		"home_station_peer_id",
		"signing_key_id",
		"public_key",
		"profile_version",
		"verification_source",
		"revoked",
		"created_at",
		"revoked_at",
	} {
		if !composition.db.Migrator().HasColumn(&persistence.ActorDeviceModel{}, column) {
			t.Fatalf("actor_devices is missing explicit column %s", column)
		}
	}
}

func signedEnrollmentRequest(
	t *testing.T,
	ptid string,
	account string,
	deviceID string,
	label string,
	actorPrivate ed25519.PrivateKey,
	devicePublic ed25519.PublicKey,
	profileVersion uint64,
) *actormodel.EnrollActorDeviceRequest {
	t.Helper()

	actorPublic := actorPrivate.Public().(ed25519.PublicKey)
	actorFingerprint := sha256.Sum256(actorPublic)
	deviceFingerprint := sha256.Sum256(devicePublic)
	certificate := &actormodel.ActorDeviceCertificate{
		FormatVersion: domain.DeviceCertificateFormatVersion,
		Device: &actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: ptid,
				Acct: account,
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
			DeviceId: deviceID,
		},
		ActorIdentityPublicKey:      append([]byte(nil), actorPublic...),
		ActorIdentityKeyFingerprint: append([]byte(nil), actorFingerprint[:]...),
		DeviceSigningPublicKey:      append([]byte(nil), devicePublic...),
		SigningKeyId:                hex.EncodeToString(deviceFingerprint[:]),
		ObservedProfileVersion:      profileVersion,
	}
	canonicalBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(certificate)
	if err != nil {
		t.Fatal(err)
	}

	return &actormodel.EnrollActorDeviceRequest{
		Certificate:         certificate,
		Label:               label,
		ActorCrossSignature: ed25519.Sign(actorPrivate, canonicalBytes),
	}
}

func deterministicPrivateKey(seed byte) ed25519.PrivateKey {
	return ed25519.NewKeyFromSeed(bytes.Repeat([]byte{seed}, ed25519.SeedSize))
}

func deterministicPublicKey(seed byte) ed25519.PublicKey {
	privateKey := deterministicPrivateKey(seed)

	return privateKey.Public().(ed25519.PublicKey)
}

func assertCanonicalDevice(
	t *testing.T,
	device *actormodel.ActorDevice,
	ptid string,
	deviceID string,
	status actormodel.ActorDeviceStatus,
	profileVersion uint64,
) {
	t.Helper()

	if device == nil ||
		device.GetRef() == nil ||
		device.GetRef().GetActor() == nil ||
		device.GetRef().GetActor().GetPtid() != ptid ||
		device.GetRef().GetActor().GetKind() != actormodel.ActorKind_ACTOR_KIND_PERSON ||
		device.GetRef().GetDeviceId() != deviceID ||
		device.GetStatus() != status ||
		device.GetProfileVersion() != profileVersion ||
		device.GetActivationSequence() <= 0 ||
		device.GetEnrolledAt() == nil ||
		!device.GetEnrolledAt().IsValid() ||
		len(device.GetActorIdentityKeyFingerprint()) != sha256.Size ||
		len(device.GetDeviceSigningPublicKey()) != ed25519.PublicKeySize {
		t.Fatalf("unexpected canonical device: %+v", device)
	}
}

func assertHandlerDomainError(
	t *testing.T,
	err error,
	wantCode domain.ErrorCode,
	wantHTTPStatus int,
) {
	t.Helper()

	if !domain.IsCode(err, wantCode) {
		t.Fatalf("error = %v, want domain code %s", err, wantCode)
	}
	if wantHTTPStatus == 0 {
		return
	}
	var handlerError *server.HandlerError
	if !errors.As(err, &handlerError) {
		t.Fatalf("error = %T, want *server.HandlerError", err)
	}
	if handlerError.Code != wantHTTPStatus {
		t.Fatalf("HTTP status = %d, want %d", handlerError.Code, wantHTTPStatus)
	}
}
