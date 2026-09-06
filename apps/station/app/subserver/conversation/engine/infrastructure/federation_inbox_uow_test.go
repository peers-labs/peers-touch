package infrastructure_test

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/infrastructure"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type federationDeviceAccess struct {
	active map[string]bool
}

func (a federationDeviceAccess) IsActiveDevice(
	_ context.Context,
	ptid string,
	deviceID string,
) (bool, error) {
	return a.active[ptid+"\x00"+deviceID], nil
}

func (a federationDeviceAccess) HomeStationID(
	_ context.Context,
	_ *chat.CryptoEndpoint,
) (string, error) {
	return "station-b", nil
}

type federationAuthorityService struct{}

func (federationAuthorityService) Submit(
	context.Context,
	*chat.ChatCommand,
) (*chat.ConversationEvent, error) {
	return &chat.ConversationEvent{}, nil
}

func newFederationInboxFixture(
	t *testing.T,
	limits messaging.QueueLimits,
	devices federationDeviceAccess,
) (*gorm.DB, *application.FederationService) {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	uow := infrastructure.NewFederationInboxUnitOfWork(db, limits)
	if err := uow.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	service, err := application.NewFederationService(
		uow,
		devices,
		federationAuthorityService{},
		messaging.EndpointManifestResolveFunc(func(
			context.Context,
			string,
		) (*chat.FederatedEndpointManifest, error) {
			return testBatchManifest(), nil
		}),
		messaging.LocalEndpointManifestVerifyFunc(func(
			context.Context,
			*chat.FederatedEndpointManifest,
			string,
			time.Time,
		) error {
			return nil
		}),
		application.FederationPolicy{MaxBatchWrites: 100},
	)
	if err != nil {
		t.Fatal(err)
	}
	return db, service
}

func federatedWrite(ptid, deviceID string) *chat.FederatedDeviceQueueWrite {
	payload := []byte("delivery:" + ptid + ":" + deviceID)
	hash := sha256.Sum256(payload)
	return &chat.FederatedDeviceQueueWrite{
		Recipient:      &chat.CryptoEndpoint{Ptid: ptid, DeviceId: deviceID},
		EventId:        "event-1",
		ConversationId: "conversation-1",
		IdempotencyKey: "event-1:" + ptid + ":" + deviceID,
		PayloadType:    chat.DeviceQueuePayloadType_DEVICE_QUEUE_PAYLOAD_TYPE_CONVERSATION_EVENT,
		OpaquePayload:  payload,
		PayloadSha256:  hash[:],
	}
}

func signedBatchFrame(
	t *testing.T,
	privateKey ed25519.PrivateKey,
	frameID string,
	idempotencyKey string,
	now time.Time,
) *chat.MessagingFederationFrame {
	t.Helper()
	batchBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chat.FederatedDeviceQueueBatch{
			Writes: []*chat.FederatedDeviceQueueWrite{
				federatedWrite("ptid:alice", "active-device"),
				federatedWrite("ptid:alice", "revoked-device"),
			},
			EndpointManifests: []*chat.FederatedEndpointManifest{
				testBatchManifest(),
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(batchBytes)
	frame := &chat.MessagingFederationFrame{
		FrameId:           frameID,
		SourceStationId:   "station-a",
		TargetStationId:   "station-b",
		IdempotencyKey:    idempotencyKey,
		PayloadType:       chat.MessagingFederationPayloadType_MESSAGING_FEDERATION_PAYLOAD_TYPE_DEVICE_QUEUE_BATCH,
		ConversationId:    "conversation-1",
		EventId:           "event-1",
		AuthoritySequence: 1,
		OpaquePayload:     batchBytes,
		PayloadSha256:     hash[:],
		IssuedAt:          timestamppb.New(now),
		ExpiresAt:         timestamppb.New(now.Add(time.Minute)),
	}
	if err := application.SignFederationFrame(frame, "key-1", privateKey); err != nil {
		t.Fatal(err)
	}
	return frame
}

func testBatchManifest() *chat.FederatedEndpointManifest {
	materialHash := sha256.Sum256([]byte("device-material"))
	return &chat.FederatedEndpointManifest{
		FormatVersion:    application.EndpointManifestFormatVersion,
		ManifestId:       "manifest-1",
		ActorPtid:        "ptid:alice",
		HomeStationId:    "station-b",
		DirectoryVersion: 1,
		ActiveEndpoints: []*chat.FederatedEndpointManifestEntry{
			{
				Endpoint: &chat.CryptoEndpoint{
					Ptid:     "ptid:alice",
					DeviceId: "active-device",
				},
				SigningKeyId:         "active-key",
				PublicMaterialSha256: [][]byte{materialHash[:]},
			},
			{
				Endpoint: &chat.CryptoEndpoint{
					Ptid:     "ptid:alice",
					DeviceId: "revoked-device",
				},
				SigningKeyId:         "revoked-key",
				PublicMaterialSha256: [][]byte{materialHash[:]},
			},
		},
		IssuedAt:               timestamppb.New(time.Unix(1_700_000_000, 0).UTC()),
		ExpiresAt:              timestamppb.New(time.Unix(1_700_000_000, 0).UTC().Add(time.Minute)),
		SigningKeyId:           "station-key",
		StationSignature:       make([]byte, ed25519.SignatureSize),
		ActorIdentityPublicKey: bytes.Repeat([]byte{1}, ed25519.PublicKeySize),
		ActorProfileVersion:    1,
	}
}

func TestFederationIngestAtomicallyWritesOnlyActiveDeviceLanesAndDeduplicates(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	db, service := newFederationInboxFixture(
		t,
		messaging.QueueLimits{MaxUnackedItems: 100, MaxUnackedBytes: 1024 * 1024},
		federationDeviceAccess{active: map[string]bool{
			"ptid:alice\x00active-device": true,
		}},
	)
	now := time.Unix(1_700_000_000, 0).UTC()
	frame := signedBatchFrame(t, privateKey, "frame-1", "idempotency-1", now)
	response, err := service.Deliver(context.Background(), frame, "station-b", publicKey, now)
	if err != nil {
		t.Fatal(err)
	}
	if !response.Accepted || response.Duplicate {
		t.Fatalf("first response = %+v", response)
	}
	var queueRows []infrastructure.DeviceQueueItemModel
	if err := db.Find(&queueRows).Error; err != nil {
		t.Fatal(err)
	}
	if len(queueRows) != 1 ||
		queueRows[0].RecipientDeviceID != "active-device" ||
		queueRows[0].EventID != "event-1" {
		t.Fatalf("queue rows = %+v", queueRows)
	}
	replay, err := service.Deliver(
		context.Background(),
		frame,
		"station-b",
		publicKey,
		now.Add(2*time.Minute),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !replay.Duplicate {
		t.Fatal("exact frame replay was not identified as duplicate")
	}
	var inboxCount, queueCount int64
	db.Model(&infrastructure.FederationInboxModel{}).Count(&inboxCount)
	db.Model(&infrastructure.DeviceQueueItemModel{}).Count(&queueCount)
	if inboxCount != 1 || queueCount != 1 {
		t.Fatalf("replay duplicated state: inbox=%d queue=%d", inboxCount, queueCount)
	}
}

func TestFederationIngestConflictAndQueueFailureRollBackInbox(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	db, service := newFederationInboxFixture(
		t,
		messaging.QueueLimits{MaxUnackedItems: 100, MaxUnackedBytes: 1},
		federationDeviceAccess{active: map[string]bool{
			"ptid:alice\x00active-device": true,
		}},
	)
	now := time.Unix(1_700_000_000, 0).UTC()
	frame := signedBatchFrame(t, privateKey, "frame-1", "idempotency-1", now)
	if _, err := service.Deliver(
		context.Background(),
		frame,
		"station-b",
		publicKey,
		now,
	); !errors.Is(err, messaging.ErrQueueQuotaExceeded) {
		t.Fatalf("delivery error = %v, want ErrQueueQuotaExceeded", err)
	}
	var inboxCount, queueCount int64
	db.Model(&infrastructure.FederationInboxModel{}).Count(&inboxCount)
	db.Model(&infrastructure.DeviceQueueItemModel{}).Count(&queueCount)
	if inboxCount != 0 || queueCount != 0 {
		t.Fatalf("partial ingest survived: inbox=%d queue=%d", inboxCount, queueCount)
	}
}
