package infrastructure_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/infrastructure"
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
	followers, err := infrastructure.NewFollowerRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	memberships, err := application.NewMembershipReader(
		uow,
		followers,
		"station:local",
	)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0).UTC()
	for index, ptid := range []string{"ptid:zara", "ptid:bob"} {
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
		verifiedGenesisDevice("ptid:zara", "zara-desktop", now),
		verifiedGenesisDevice("ptid:zara", "zara-phone", now),
	}
	if err := db.Create(&devices).Error; err != nil {
		t.Fatal(err)
	}
	service, err := application.NewConversationService(
		uow,
		memberships,
		"station:local",
		messaging.FederationFrameSignFunc(func(context.Context, *chat.MessagingFederationFrame) error {
			return nil
		}),
		testMixedEndpointManifestResolver(t, db, now),
		func() time.Time { return now },
	)
	if err != nil {
		t.Fatal(err)
	}
	creator := &chat.CryptoEndpoint{Ptid: "ptid:zara", DeviceId: "zara-desktop"}
	first, err := service.CreateDirect(ctx, creator, "ptid:bob")
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := service.CreateDirect(ctx, creator, "ptid:bob")
	if err != nil {
		t.Fatal(err)
	}
	if first.ConversationId != replayed.ConversationId ||
		first.OwnerPtid != creator.Ptid ||
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
	if len(queueItems) != 2 {
		t.Fatalf("local queue items = %d, want 2", len(queueItems))
	}
	for _, item := range queueItems {
		var delivery chat.DeviceEventDelivery
		if err := proto.Unmarshal(item.OpaquePayload, &delivery); err != nil {
			t.Fatal(err)
		}
		if delivery.GetEvent().GetConversationCreated() == nil ||
			delivery.PayloadKind != chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_CONVERSATION_STATE ||
			len(delivery.SenderActorIdentityPublicKey) != 32 {
			t.Fatalf("invalid genesis delivery: %+v", &delivery)
		}
	}
	var outbox []infrastructure.FederationOutboxModel
	if err := db.Find(&outbox).Error; err != nil {
		t.Fatal(err)
	}
	if len(outbox) != 2 {
		t.Fatalf("federation outbox rows = %d, want device and projection rows", len(outbox))
	}
	var deviceFrame *chat.MessagingFederationFrame
	var projectionFrame *chat.MessagingFederationFrame
	for _, row := range outbox {
		frame := &chat.MessagingFederationFrame{}
		if err := proto.Unmarshal(row.FrameBytes, frame); err != nil {
			t.Fatal(err)
		}
		switch frame.PayloadType {
		case chat.MessagingFederationPayloadType_MESSAGING_FEDERATION_PAYLOAD_TYPE_DEVICE_QUEUE_BATCH:
			deviceFrame = frame
		case chat.MessagingFederationPayloadType_MESSAGING_FEDERATION_PAYLOAD_TYPE_FOLLOWER_PROJECTION:
			projectionFrame = frame
		}
	}
	if deviceFrame == nil || projectionFrame == nil {
		t.Fatalf("missing device/projection frame: device=%v projection=%v", deviceFrame, projectionFrame)
	}
	var batch chat.FederatedDeviceQueueBatch
	if err := proto.Unmarshal(deviceFrame.OpaquePayload, &batch); err != nil {
		t.Fatal(err)
	}
	if len(batch.Writes) != 1 ||
		batch.Writes[0].Recipient.GetPtid() != "ptid:bob" ||
		batch.Writes[0].Recipient.GetDeviceId() != "bob-desktop" {
		t.Fatalf("remote queue batch = %+v", batch.Writes)
	}
	var projection chat.MessagingFollowerProjection
	if err := proto.Unmarshal(projectionFrame.OpaquePayload, &projection); err != nil {
		t.Fatal(err)
	}
	created := projection.GetConversationEvent().GetConversationCreated()
	if projection.FormatVersion != application.MessagingFollowerProjectionFormatVersion ||
		projection.AuthorityStationId != "station:local" ||
		projection.TargetHomeStationId != "station:remote" ||
		created == nil ||
		len(created.Members) != 2 ||
		created.Members[0].HomeStationId == "" ||
		created.Members[1].HomeStationId == "" {
		t.Fatalf("follower creation projection = %+v", &projection)
	}
	var grants []infrastructure.EventProjectionGrantModel
	if err := db.Find(&grants).Error; err != nil {
		t.Fatal(err)
	}
	if len(grants) != 1 ||
		grants[0].EventID != projection.ConversationEvent.EventId ||
		grants[0].TargetHomeStationID != "station:remote" {
		t.Fatalf("creation projection grants = %+v", grants)
	}
	if _, err := followers.CreateConversation(ctx, &messaging.FollowerConversation{
		ConversationID:        "remote-group",
		AuthorityStationID:    "station:remote",
		AuthoritySigningKeyID: "remote-key",
		Kind:                  messaging.AuthorityConversationKindGroup,
		Name:                  "Remote group",
		OwnerPTID:             "ptid:bob",
		CurrentSequence:       3,
		CurrentEventHash:      bytes.Repeat([]byte{7}, sha256.Size),
		MembershipEpoch:       1,
		MlsEpoch:              1,
		State:                 messaging.FollowerConversationStateActive,
		UpdatedAt:             now,
	}); err != nil {
		t.Fatal(err)
	}
	for _, member := range []*messaging.FollowerMember{
		{
			ConversationID: "remote-group",
			PTID:           "ptid:bob",
			HomeStationID:  "station:remote",
			Role:           "owner",
			Active:         true,
			JoinedSequence: 1,
		},
		{
			ConversationID: "remote-group",
			PTID:           "ptid:zara",
			HomeStationID:  "station:local",
			Role:           "member",
			Active:         true,
			JoinedSequence: 1,
		},
	} {
		if err := followers.UpsertMember(ctx, member); err != nil {
			t.Fatal(err)
		}
	}
	views, err := service.List(ctx, creator)
	if err != nil {
		t.Fatal(err)
	}
	if len(views) != 2 ||
		views[0].ConversationId != first.ConversationId ||
		views[1].ConversationId != "remote-group" ||
		views[1].AuthorityStationId != "station:remote" {
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
