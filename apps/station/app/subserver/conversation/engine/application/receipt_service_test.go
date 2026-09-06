package application_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/infrastructure"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestSubmitDeliveryReceiptQueuesTypedReceiptIdempotently(t *testing.T) {
	ctx := context.Background()
	now := time.Unix(1_700_000_000, 0).UTC()
	db, service := newDeliveryReceiptFixture(t, now)
	request := &chat.SubmitConversationReceiptRequest{
		ConversationId: "conversation-1",
		MessageId:      "message-1",
		DeviceId:       "bob-1",
		ReceiptType:    chat.ReceiptType_RECEIPT_TYPE_DELIVERED,
	}
	sender := &chat.CryptoEndpoint{Ptid: "ptid:bob", DeviceId: "bob-1"}

	for range 2 {
		if _, err := service.SubmitDeliveryReceipt(ctx, sender, request); err != nil {
			t.Fatal(err)
		}
	}

	var queued []infrastructure.DeviceQueueItemModel
	if err := db.Order("recipient_device_id ASC").Find(&queued).Error; err != nil {
		t.Fatal(err)
	}
	if len(queued) != 2 {
		t.Fatalf("queued items = %d, want 2", len(queued))
	}
	for index, item := range queued {
		wantDevice := []string{"alice-1", "alice-2"}[index]
		if item.RecipientPTID != "ptid:alice" || item.RecipientDeviceID != wantDevice {
			t.Fatalf(
				"recipient = %s/%s, want ptid:alice/%s",
				item.RecipientPTID,
				item.RecipientDeviceID,
				wantDevice,
			)
		}
		if item.PayloadType != int32(chat.DeviceQueuePayloadType_DEVICE_QUEUE_PAYLOAD_TYPE_DEVICE_RECEIPT) {
			t.Fatalf("payload type = %d", item.PayloadType)
		}
		var receipt chat.MessageReceipt
		if err := proto.Unmarshal(item.OpaquePayload, &receipt); err != nil {
			t.Fatal(err)
		}
		if receipt.ConversationId != request.ConversationId ||
			receipt.MessageId != request.MessageId ||
			receipt.Ptid != sender.Ptid ||
			receipt.DeviceId != sender.DeviceId ||
			receipt.ReceiptType != chat.ReceiptType_RECEIPT_TYPE_DELIVERED {
			t.Fatalf("unexpected receipt: %+v", receipt)
		}
	}
}

func TestSubmitDeliveryReceiptRejectsNonMemberDevice(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	_, service := newDeliveryReceiptFixture(t, now)
	_, err := service.SubmitDeliveryReceipt(
		context.Background(),
		&chat.CryptoEndpoint{Ptid: "ptid:bob", DeviceId: "bob-2"},
		&chat.SubmitConversationReceiptRequest{
			ConversationId: "conversation-1",
			MessageId:      "message-1",
			DeviceId:       "bob-2",
			ReceiptType:    chat.ReceiptType_RECEIPT_TYPE_DELIVERED,
		},
	)
	if !errors.Is(err, messaging.ErrSenderUnauthorized) {
		t.Fatalf("error = %v, want ErrSenderUnauthorized", err)
	}
}

func TestSubmitActorReadAtomicallyPersistsAndQueuesCursor(t *testing.T) {
	ctx := context.Background()
	now := time.Unix(1_700_000_000, 0).UTC()
	db, service := newDeliveryReceiptFixture(t, now)
	cursor := &chat.ActorReadCursor{
		ConversationId:   "conversation-1",
		ReaderPtid:       "ptid:bob",
		LastReadSequence: 3,
	}
	request := &chat.SubmitMessagingReceiptRequest{
		Kind:      chat.MessagingReceiptKind_MESSAGING_RECEIPT_KIND_ACTOR_READ,
		ActorRead: cursor,
	}
	sender := &chat.CryptoEndpoint{Ptid: "ptid:bob", DeviceId: "bob-1"}

	for range 2 {
		if _, err := service.SubmitReceipt(ctx, sender, request); err != nil {
			t.Fatal(err)
		}
	}

	readCursors, err := infrastructure.NewReadCursorRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	persisted, err := readCursors.GetReadCursor(ctx, "conversation-1", "ptid:bob")
	if err != nil {
		t.Fatal(err)
	}
	if persisted.LastReadSequence != 3 {
		t.Fatalf("last read sequence = %d, want 3", persisted.LastReadSequence)
	}
	var queued []infrastructure.DeviceQueueItemModel
	if err := db.
		Where(
			"conversation_id = ? AND payload_type = ?",
			cursor.ConversationId,
			chat.DeviceQueuePayloadType_DEVICE_QUEUE_PAYLOAD_TYPE_DEVICE_RECEIPT,
		).
		Order("recipient_device_id ASC").
		Find(&queued).Error; err != nil {
		t.Fatal(err)
	}
	if len(queued) != 2 {
		t.Fatalf("queued read cursor items = %d, want 2", len(queued))
	}
	for _, item := range queued {
		const prefix = "read:"
		if !strings.HasPrefix(item.EventID, prefix) {
			t.Fatalf("queued event ID = %q, want %q prefix", item.EventID, prefix)
		}
		digest := strings.TrimPrefix(item.EventID, prefix)
		if len(digest) != 56 {
			t.Fatalf("queued event digest length = %d, want 56", len(digest))
		}
		if _, err := hex.DecodeString(digest); err != nil {
			t.Fatalf("queued event digest = %q, want hexadecimal: %v", digest, err)
		}
		if item.EventID != queued[0].EventID {
			t.Fatalf("queued event ID = %q, want shared ID %q", item.EventID, queued[0].EventID)
		}
		var received chat.ActorReadCursor
		if err := proto.Unmarshal(item.OpaquePayload, &received); err != nil {
			t.Fatal(err)
		}
		if !proto.Equal(&received, cursor) {
			t.Fatalf("queued cursor = %+v, want %+v", &received, cursor)
		}
	}
}

func TestSubmitActorReadRejectsNonMemberDeviceWithoutMutation(t *testing.T) {
	ctx := context.Background()
	now := time.Unix(1_700_000_000, 0).UTC()
	db, service := newDeliveryReceiptFixture(t, now)
	_, err := service.SubmitReceipt(
		ctx,
		&chat.CryptoEndpoint{Ptid: "ptid:bob", DeviceId: "bob-2"},
		&chat.SubmitMessagingReceiptRequest{
			Kind: chat.MessagingReceiptKind_MESSAGING_RECEIPT_KIND_ACTOR_READ,
			ActorRead: &chat.ActorReadCursor{
				ConversationId:   "conversation-1",
				ReaderPtid:       "ptid:bob",
				LastReadSequence: 3,
			},
		},
	)
	if !errors.Is(err, messaging.ErrSenderUnauthorized) {
		t.Fatalf("error = %v, want ErrSenderUnauthorized", err)
	}
	var count int64
	if err := db.Model(&infrastructure.ReadCursorModel{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("read cursor rows = %d, want 0", count)
	}
}

func newDeliveryReceiptFixture(
	t *testing.T,
	now time.Time,
) (*gorm.DB, *application.ReceiptService) {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:messaging-receipt-service-"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&touchactor.ActorIdentityRecord{}, &touchactor.DeviceRecord{}); err != nil {
		t.Fatal(err)
	}
	uow, err := infrastructure.NewAuthorityUnitOfWork(db, messaging.QueueLimits{
		MaxUnackedItems: 100,
		MaxUnackedBytes: 1024 * 1024,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := uow.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	readCursors, err := infrastructure.NewReadCursorRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := readCursors.AutoMigrate(); err != nil {
		t.Fatal(err)
	}

	devicesByActor := map[string][]string{
		"ptid:alice": {"alice-1", "alice-2"},
		"ptid:bob":   {"bob-1", "bob-2"},
	}
	manifestRepository, err := infrastructure.NewEndpointManifestRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	for actor, deviceIDs := range devicesByActor {
		identityKey := bytes.Repeat([]byte{byte(len(actor))}, 32)
		identityHash := sha256.Sum256(identityKey)
		if err := db.Create(&touchactor.ActorIdentityRecord{
			PTID:           actor,
			PublicKey:      identityKey,
			Fingerprint:    identityHash[:],
			ProfileVersion: 1,
			CreatedAt:      now,
			UpdatedAt:      now,
		}).Error; err != nil {
			t.Fatal(err)
		}
		endpoints := make([]*chat.FederatedEndpointManifestEntry, 0, len(deviceIDs))
		for _, deviceID := range deviceIDs {
			if err := db.Create(&touchactor.DeviceRecord{
				Ptid:               actor,
				DeviceID:           deviceID,
				HomeStationPeerID:  "station:local",
				SigningKeyID:       "key:" + deviceID,
				PublicKey:          bytes.Repeat([]byte{byte(len(deviceID))}, 32),
				ProfileVersion:     1,
				VerificationSource: 1,
				CreatedAt:          now,
			}).Error; err != nil {
				t.Fatal(err)
			}
			endpoints = append(endpoints, &chat.FederatedEndpointManifestEntry{
				Endpoint:     &chat.CryptoEndpoint{Ptid: actor, DeviceId: deviceID},
				SigningKeyId: "key:" + deviceID,
			})
		}
		manifest := &chat.FederatedEndpointManifest{
			FormatVersion:          application.EndpointManifestFormatVersion,
			ManifestId:             "manifest:" + actor,
			ActorPtid:              actor,
			HomeStationId:          "station:local",
			DirectoryVersion:       1,
			ActiveEndpoints:        endpoints,
			IssuedAt:               timestamppb.New(now),
			ExpiresAt:              timestamppb.New(now.Add(time.Hour)),
			ActorIdentityPublicKey: identityKey,
			ActorProfileVersion:    1,
		}
		manifestBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(manifest)
		if err != nil {
			t.Fatal(err)
		}
		manifestHash := sha256.Sum256(manifestBytes)
		if err := manifestRepository.SaveVerifiedManifest(
			context.Background(),
			manifest,
			manifestBytes,
			manifestHash[:],
		); err != nil {
			t.Fatal(err)
		}
	}

	if err := db.Create(&infrastructure.AuthorityConversationModel{
		ConversationID:  "conversation-1",
		Kind:            int32(messaging.AuthorityConversationKindDirect),
		CurrentSequence: 10,
		MembershipEpoch: 1,
		Active:          true,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&[]infrastructure.AuthorityMemberModel{
		{
			ConversationID: "conversation-1",
			PTID:           "ptid:alice",
			Role:           "owner",
			Active:         true,
			JoinedSequence: 1,
		},
		{
			ConversationID: "conversation-1",
			PTID:           "ptid:bob",
			Role:           "member",
			Active:         true,
			JoinedSequence: 1,
		},
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&[]infrastructure.AuthorityMemberDeviceModel{
		{
			ConversationID: "conversation-1",
			PTID:           "ptid:alice",
			DeviceID:       "alice-1",
			Active:         true,
			JoinedSequence: 1,
		},
		{
			ConversationID: "conversation-1",
			PTID:           "ptid:alice",
			DeviceID:       "alice-2",
			Active:         true,
			JoinedSequence: 1,
		},
		{
			ConversationID: "conversation-1",
			PTID:           "ptid:bob",
			DeviceID:       "bob-1",
			Active:         true,
			JoinedSequence: 1,
		},
	}).Error; err != nil {
		t.Fatal(err)
	}
	service, err := application.NewReceiptService(
		uow,
		"station:local",
		func() time.Time { return now },
	)
	if err != nil {
		t.Fatal(err)
	}
	return db, service
}
