package infrastructure_test

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/infrastructure"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestDeviceEnrollmentActivatesOnlyVerifiedCertificate(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:messaging-device-"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	repository, err := infrastructure.NewDeviceRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_800_000_000, 0).UTC()
	service, err := application.NewDeviceService(
		repository,
		"station:local",
		func() time.Time { return now },
	)
	if err != nil {
		t.Fatal(err)
	}
	request := signedDeviceEnrollmentRequest(
		t,
		"ptid:test:alice",
		"alice-device",
	)

	response, err := service.Enroll(
		context.Background(),
		"ptid:test:alice",
		"alice-device",
		request,
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.Device == nil ||
		response.Device.Status != chat.MessagingDeviceStatus_MESSAGING_DEVICE_STATUS_ACTIVE ||
		response.Device.Endpoint == nil ||
		response.Device.Endpoint.Ptid != "ptid:test:alice" ||
		response.Device.Endpoint.DeviceId != "alice-device" ||
		!response.Device.EnrolledAt.AsTime().Equal(now) {
		t.Fatalf("unexpected active device: %+v", response.Device)
	}
	active, err := infrastructure.NewDeviceDirectory(db).IsActiveDevice(
		context.Background(),
		"ptid:test:alice",
		"alice-device",
	)
	if err != nil || !active {
		t.Fatalf("verified enrollment is not queue-active: active=%v err=%v", active, err)
	}

	forged := signedDeviceEnrollmentRequest(
		t,
		"ptid:test:alice",
		"forged-device",
	)
	forged.ActorCrossSignature[0] ^= 0xff
	if _, err := service.Enroll(
		context.Background(),
		"ptid:test:alice",
		"forged-device",
		forged,
	); !errors.Is(err, touchactor.ErrDeviceEnrollmentProof) {
		t.Fatalf("forged enrollment error=%v, want ErrDeviceEnrollmentProof", err)
	}
	active, err = infrastructure.NewDeviceDirectory(db).IsActiveDevice(
		context.Background(),
		"ptid:test:alice",
		"forged-device",
	)
	if err != nil || active {
		t.Fatalf("forged enrollment became active: active=%v err=%v", active, err)
	}

	if _, err := service.Enroll(
		context.Background(),
		"ptid:test:mallory",
		"alice-device",
		request,
	); err == nil {
		t.Fatal("authenticated PTID mismatch was accepted")
	}
}

func signedDeviceEnrollmentRequest(
	t *testing.T,
	ptid string,
	deviceID string,
) *chat.EnrollMessagingDeviceRequest {
	t.Helper()
	actorPublic, actorPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	devicePublic, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	identityHash := sha256.Sum256(actorPublic)
	deviceHash := sha256.Sum256(devicePublic)
	certificate := &chat.MessagingDeviceCertificate{
		FormatVersion:               application.MessagingDeviceCertificateFormatVersion,
		Ptid:                        ptid,
		DeviceId:                    deviceID,
		ActorIdentityPublicKey:      actorPublic,
		ActorIdentityKeyFingerprint: identityHash[:],
		DeviceSigningPublicKey:      devicePublic,
		SigningKeyId:                hex.EncodeToString(deviceHash[:]),
		ObservedProfileVersion:      1,
	}
	certificateBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(certificate)
	if err != nil {
		t.Fatal(err)
	}
	return &chat.EnrollMessagingDeviceRequest{
		Certificate:         certificate,
		Label:               "Desktop",
		ActorCrossSignature: ed25519.Sign(actorPrivate, certificateBytes),
	}
}
