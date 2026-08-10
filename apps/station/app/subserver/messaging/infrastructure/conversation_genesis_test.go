package infrastructure_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/infrastructure"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestDirectConversationGenesisIsAtomicAndIdempotent(t *testing.T) {
	ctx := context.Background()
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&touchactor.DeviceRecord{},
		&touchactor.ActorIdentityRecord{},
	); err != nil {
		t.Fatal(err)
	}
	uow, err := infrastructure.NewAuthorityUnitOfWork(db, messaging.QueueLimits{
		MaxUnackedItems: 100,
		MaxUnackedBytes: 1 << 20,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := uow.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0).UTC()
	for index, ptid := range []string{"ptid:alice", "ptid:bob"} {
		publicKey := bytes.Repeat([]byte{byte(index + 1)}, 32)
		fingerprint := sha256.Sum256(publicKey)
		if err := db.Create(&touchactor.ActorIdentityRecord{
			PTID:           ptid,
			PublicKey:      publicKey,
			Fingerprint:    fingerprint[:],
			ProfileVersion: 1,
			CreatedAt:      now,
			UpdatedAt:      now,
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	devices := []touchactor.DeviceRecord{
		verifiedGenesisDevice("ptid:alice", "alice-desktop", now),
		verifiedGenesisDevice("ptid:alice", "alice-phone", now),
		verifiedGenesisDevice("ptid:bob", "bob-desktop", now),
	}
	if err := db.Create(&devices).Error; err != nil {
		t.Fatal(err)
	}
	service, err := application.NewConversationService(
		uow,
		"station:local",
		messaging.FederationFrameSignFunc(func(context.Context, *chat.MessagingFederationFrame) error {
			return nil
		}),
		testEndpointManifestResolver(t, db, now),
		func() time.Time { return now },
	)
	if err != nil {
		t.Fatal(err)
	}
	creator := &chat.CryptoEndpoint{Ptid: "ptid:alice", DeviceId: "alice-desktop"}
	first, err := service.CreateDirect(ctx, creator, "ptid:bob")
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := service.CreateDirect(ctx, creator, "ptid:bob")
	if err != nil {
		t.Fatal(err)
	}
	if first.ConversationId != replayed.ConversationId ||
		len(first.MemberPtids) != 2 ||
		first.MembershipEpoch != 1 {
		t.Fatalf("direct views mismatch: first=%+v replay=%+v", first, replayed)
	}
	var eventCount int64
	if err := db.Model(&infrastructure.AuthorityEventModel{}).Count(&eventCount).Error; err != nil {
		t.Fatal(err)
	}
	if eventCount != 1 {
		t.Fatalf("authority events = %d, want 1", eventCount)
	}
	var queueItems []infrastructure.DeviceQueueItemModel
	if err := db.Order("recipient_ptid, recipient_device_id").Find(&queueItems).Error; err != nil {
		t.Fatal(err)
	}
	if len(queueItems) != 3 {
		t.Fatalf("queue items = %d, want 3", len(queueItems))
	}
	for _, item := range queueItems {
		var delivery chat.DeviceEventDelivery
		if err := proto.Unmarshal(item.OpaquePayload, &delivery); err != nil {
			t.Fatal(err)
		}
		if delivery.GetEvent().GetConversationCreated() == nil ||
			delivery.PayloadKind != chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_CONVERSATION_STATE ||
			len(delivery.SenderActorIdentityPublicKey) != 32 {
			t.Fatalf("invalid genesis delivery: %+v", delivery)
		}
	}
	views, err := service.List(ctx, creator)
	if err != nil {
		t.Fatal(err)
	}
	if len(views) != 1 || views[0].ConversationId != first.ConversationId {
		t.Fatalf("conversation list = %+v", views)
	}

}

func verifiedGenesisDevice(
	ptid string,
	deviceID string,
	createdAt time.Time,
) touchactor.DeviceRecord {
	return touchactor.DeviceRecord{
		Ptid:               ptid,
		DeviceID:           deviceID,
		HomeStationPeerID:  "station:local",
		SigningKeyID:       "key:" + deviceID,
		PublicKey:          bytes.Repeat([]byte{1}, 32),
		ProfileVersion:     1,
		VerificationSource: int32(actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION),
		CreatedAt:          createdAt,
	}
}
