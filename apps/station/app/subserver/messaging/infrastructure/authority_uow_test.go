package infrastructure_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
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
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func verifiedDeviceRecord(ptid string, deviceID string, createdAt time.Time) touchactor.DeviceRecord {
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

func newAuthorityFixture(
	t *testing.T,
	limits messaging.QueueLimits,
) (*gorm.DB, *application.AuthorityService) {
	t.Helper()
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
	uow, err := infrastructure.NewAuthorityUnitOfWork(db, limits)
	if err != nil {
		t.Fatal(err)
	}
	if err := uow.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0).UTC()
	for index, ptid := range []string{"alice", "bob"} {
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
	service, err := application.NewAuthorityService(uow, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	return db, service
}

func seedDirectConversation(t *testing.T, db *gorm.DB, conversationID string) {
	t.Helper()
	if err := db.Create(&infrastructure.AuthorityConversationModel{
		ConversationID:  conversationID,
		Kind:            int32(messaging.AuthorityConversationKindDirect),
		MembershipEpoch: 1,
		Active:          true,
	}).Error; err != nil {
		t.Fatal(err)
	}
	devices := []touchactor.DeviceRecord{
		verifiedDeviceRecord("alice", "alice-1", time.Now()),
		verifiedDeviceRecord("alice", "alice-2", time.Now()),
		verifiedDeviceRecord("bob", "bob-1", time.Now()),
	}
	if err := db.Create(&devices).Error; err != nil {
		t.Fatal(err)
	}
	members := []infrastructure.AuthorityMemberDeviceModel{
		{ConversationID: conversationID, PTID: "alice", DeviceID: "alice-1", Active: true},
		{ConversationID: conversationID, PTID: "alice", DeviceID: "alice-2", Active: true},
		{ConversationID: conversationID, PTID: "bob", DeviceID: "bob-1", Active: true},
	}
	if err := db.Create(&members).Error; err != nil {
		t.Fatal(err)
	}
}

func directCommand(conversationID, commandID string) *chat.ChatCommand {
	payload := func(ptid, deviceID, value string) *chat.PreparedEndpointPayload {
		bytes := []byte(value)
		hash := sha256.Sum256(bytes)
		return &chat.PreparedEndpointPayload{
			Recipient:     &chat.CryptoEndpoint{Ptid: ptid, DeviceId: deviceID},
			Kind:          chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_DIRECT_CIPHERTEXT,
			OpaquePayload: bytes,
			PayloadSha256: hash[:],
		}
	}
	return &chat.ChatCommand{
		CommandId:       commandID,
		ConversationId:  conversationID,
		Sender:          &chat.CryptoEndpoint{Ptid: "alice", DeviceId: "alice-1"},
		ClientTimestamp: timestamppb.New(time.Unix(1_700_000_000, 0)),
		Payload: &chat.ChatCommand_SendMessage{
			SendMessage: &chat.SendMessageIntent{
				MessageId:   "message-" + commandID,
				ContentKind: chat.MessagingContentKind_MESSAGING_CONTENT_KIND_TEXT,
				DirectPayloads: []*chat.PreparedEndpointPayload{
					payload("alice", "alice-2", "alice sender sync"),
					payload("bob", "bob-1", "bob ciphertext"),
				},
			},
		},
	}
}

func bindSendPlan(
	t *testing.T,
	service *application.AuthorityService,
	command *chat.ChatCommand,
) {
	t.Helper()
	plan, err := service.PrepareSend(context.Background(), &chat.PrepareMessagingSendRequest{
		ConversationId: command.ConversationId,
		Sender:         command.Sender,
	})
	if err != nil {
		t.Fatal(err)
	}
	command.ObservedMembershipEpoch = plan.MembershipEpoch
	command.ObservedMlsEpoch = plan.MlsEpoch
	command.DeliveryPlanSha256 = plan.DeliveryPlanSha256
}

func TestAuthorityCommitAtomicallyFansOutAndReplays(t *testing.T) {
	db, service := newAuthorityFixture(t, messaging.QueueLimits{
		MaxUnackedItems: 100,
		MaxUnackedBytes: 1024 * 1024,
	})
	seedDirectConversation(t, db, "direct-1")
	ctx := context.Background()
	command := directCommand("direct-1", "command-1")
	bindSendPlan(t, service, command)

	event, err := service.Submit(ctx, command)
	if err != nil {
		t.Fatal(err)
	}
	if event.Sequence != 1 || len(event.EventHash) != sha256.Size ||
		len(event.DeliveryCommitments) != 3 {
		t.Fatalf("committed event = %+v", event)
	}

	var rows []infrastructure.DeviceQueueItemModel
	if err := db.Order("recipient_ptid, recipient_device_id").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("queue rows = %d, want 3", len(rows))
	}
	for _, row := range rows {
		delivery := &chat.DeviceEventDelivery{}
		if err := proto.Unmarshal(row.OpaquePayload, delivery); err != nil {
			t.Fatal(err)
		}
		if delivery.Event.EventId != event.EventId ||
			delivery.Recipient.Ptid != row.RecipientPTID ||
			delivery.Recipient.DeviceId != row.RecipientDeviceID {
			t.Fatalf("delivery is not endpoint-bound: row=%+v delivery=%+v", row, delivery)
		}
		if delivery.Recipient.Ptid == "bob" &&
			string(delivery.EndpointPayload) != "bob ciphertext" {
			t.Fatalf("bob received wrong private payload %q", delivery.EndpointPayload)
		}
		if delivery.Recipient.Ptid == "alice" &&
			delivery.Recipient.DeviceId == "alice-1" {
			if delivery.PayloadKind != chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_PUBLIC_EVENT {
				t.Fatalf("sender received payload kind %v, want public marker", delivery.PayloadKind)
			}
			marker := &chat.PublicEventMarker{}
			if err := proto.Unmarshal(delivery.EndpointPayload, marker); err != nil {
				t.Fatal(err)
			}
			if marker.EventId != event.EventId ||
				marker.CommandId != command.CommandId ||
				marker.SendingEndpoint == nil ||
				marker.SendingEndpoint.Ptid != "alice" ||
				marker.SendingEndpoint.DeviceId != "alice-1" {
				t.Fatalf("sender marker binding mismatch: %+v", marker)
			}
		}
	}

	replayed, err := service.Submit(ctx, command)
	if err != nil {
		t.Fatal(err)
	}
	if replayed.EventId != event.EventId {
		t.Fatalf("replay event = %q, want %q", replayed.EventId, event.EventId)
	}
	var eventCount, receiptCount, queueCount int64
	db.Model(&infrastructure.AuthorityEventModel{}).Count(&eventCount)
	db.Model(&infrastructure.AuthorityCommandReceiptModel{}).Count(&receiptCount)
	db.Model(&infrastructure.DeviceQueueItemModel{}).Count(&queueCount)
	if eventCount != 1 || receiptCount != 1 || queueCount != 3 {
		t.Fatalf("replay duplicated state: events=%d receipts=%d queue=%d", eventCount, receiptCount, queueCount)
	}
}

func TestQueueQuotaRollsBackEntireAuthorityCommit(t *testing.T) {
	db, service := newAuthorityFixture(t, messaging.QueueLimits{
		MaxUnackedItems: 100,
		MaxUnackedBytes: 1,
	})
	seedDirectConversation(t, db, "direct-quota")

	command := directCommand("direct-quota", "command-quota")
	bindSendPlan(t, service, command)
	_, err := service.Submit(context.Background(), command)
	if !errors.Is(err, messaging.ErrQueueQuotaExceeded) {
		t.Fatalf("submit error = %v, want ErrQueueQuotaExceeded", err)
	}
	for name, model := range map[string]any{
		"events":   &infrastructure.AuthorityEventModel{},
		"receipts": &infrastructure.AuthorityCommandReceiptModel{},
		"items":    &infrastructure.DeviceQueueItemModel{},
		"lanes":    &infrastructure.DeviceQueueLaneModel{},
	} {
		var count int64
		if err := db.Model(model).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("%s survived rollback: %d", name, count)
		}
	}
	var conversation infrastructure.AuthorityConversationModel
	if err := db.First(&conversation, "conversation_id = ?", "direct-quota").Error; err != nil {
		t.Fatal(err)
	}
	if conversation.CurrentSequence != 0 {
		t.Fatalf("authority head survived rollback: %d", conversation.CurrentSequence)
	}
}

func TestRevokedDeviceReceivesNoFutureQueueItem(t *testing.T) {
	db, service := newAuthorityFixture(t, messaging.QueueLimits{
		MaxUnackedItems: 100,
		MaxUnackedBytes: 1024 * 1024,
	})
	seedDirectConversation(t, db, "direct-revoke")
	if err := db.Model(&touchactor.DeviceRecord{}).
		Where("ptid = ? AND device_id = ?", "alice", "alice-2").
		Update("revoked", true).Error; err != nil {
		t.Fatal(err)
	}
	command := directCommand("direct-revoke", "command-revoke")
	command.GetSendMessage().DirectPayloads = command.GetSendMessage().DirectPayloads[1:]
	bindSendPlan(t, service, command)

	if _, err := service.Submit(context.Background(), command); err != nil {
		t.Fatal(err)
	}
	var rows []infrastructure.DeviceQueueItemModel
	if err := db.Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("queue rows after revoke = %+v, want sender marker and bob ciphertext", rows)
	}
	for _, row := range rows {
		if row.RecipientPTID == "alice" && row.RecipientDeviceID != "alice-1" {
			t.Fatalf("revoked companion received queue item: %+v", row)
		}
	}
}

func TestStaleDeliveryPlanRejectsBeforeAuthorityMutation(t *testing.T) {
	db, service := newAuthorityFixture(t, messaging.QueueLimits{
		MaxUnackedItems: 100,
		MaxUnackedBytes: 1024 * 1024,
	})
	seedDirectConversation(t, db, "direct-stale")
	command := directCommand("direct-stale", "command-stale")
	bindSendPlan(t, service, command)
	oldPlanHash := append([]byte(nil), command.DeliveryPlanSha256...)
	if err := db.Model(&touchactor.DeviceRecord{}).
		Where("ptid = ? AND device_id = ?", "alice", "alice-2").
		Update("revoked", true).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.Submit(context.Background(), command); !errors.Is(
		err,
		messaging.ErrStaleDeliveryPlan,
	) {
		t.Fatalf("submit error=%v, want ErrStaleDeliveryPlan", err)
	}
	for name, model := range map[string]any{
		"events":   &infrastructure.AuthorityEventModel{},
		"receipts": &infrastructure.AuthorityCommandReceiptModel{},
		"items":    &infrastructure.DeviceQueueItemModel{},
	} {
		var count int64
		if err := db.Model(model).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("%s survived stale-plan rejection: %d", name, count)
		}
	}
	fresh, err := service.PrepareSend(
		context.Background(),
		&chat.PrepareMessagingSendRequest{
			ConversationId: command.ConversationId,
			Sender:         command.Sender,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(fresh.DeliveryPlanSha256, oldPlanHash) ||
		len(fresh.RequiredEndpoints) != 2 {
		t.Fatalf("fresh plan did not reflect revoke: %+v", fresh)
	}
}

func TestGroupMlsPayloadFansOutToActiveLeaves(t *testing.T) {
	db, service := newAuthorityFixture(t, messaging.QueueLimits{
		MaxUnackedItems: 100,
		MaxUnackedBytes: 1024 * 1024,
	})
	if err := db.Create(&infrastructure.AuthorityConversationModel{
		ConversationID:  "group-1",
		Kind:            int32(messaging.AuthorityConversationKindGroup),
		MembershipEpoch: 3,
		MlsEpoch:        7,
		Active:          true,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&[]touchactor.DeviceRecord{
		verifiedDeviceRecord("alice", "alice-1", time.Now()),
		verifiedDeviceRecord("alice", "alice-2", time.Now()),
		verifiedDeviceRecord("bob", "bob-1", time.Now()),
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&[]infrastructure.AuthorityMemberDeviceModel{
		{ConversationID: "group-1", PTID: "alice", DeviceID: "alice-1", Active: true},
		{ConversationID: "group-1", PTID: "alice", DeviceID: "alice-2", Active: true},
		{ConversationID: "group-1", PTID: "bob", DeviceID: "bob-1", Active: true},
	}).Error; err != nil {
		t.Fatal(err)
	}
	mlsPayload := []byte("openmls application ciphertext")
	mlsHash := sha256.Sum256(mlsPayload)
	command := &chat.ChatCommand{
		CommandId:       "group-command-1",
		ConversationId:  "group-1",
		Sender:          &chat.CryptoEndpoint{Ptid: "alice", DeviceId: "alice-1"},
		ClientTimestamp: timestamppb.New(time.Unix(1_700_000_000, 0)),
		Payload: &chat.ChatCommand_SendMessage{SendMessage: &chat.SendMessageIntent{
			MessageId:                   "group-message-1",
			ContentKind:                 chat.MessagingContentKind_MESSAGING_CONTENT_KIND_TEXT,
			MlsApplicationPayload:       mlsPayload,
			MlsApplicationPayloadSha256: mlsHash[:],
		}},
	}
	bindSendPlan(t, service, command)
	event, err := service.Submit(context.Background(), command)
	if err != nil {
		t.Fatal(err)
	}
	if event.MembershipEpoch != 3 || event.MlsEpoch != 7 ||
		len(event.DeliveryCommitments) != 3 {
		t.Fatalf("group event = %+v", event)
	}
	var rows []infrastructure.DeviceQueueItemModel
	if err := db.Order("recipient_ptid, recipient_device_id").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("group queue rows = %d, want 3", len(rows))
	}
	for _, row := range rows {
		delivery := &chat.DeviceEventDelivery{}
		if err := proto.Unmarshal(row.OpaquePayload, delivery); err != nil {
			t.Fatal(err)
		}
		if row.RecipientPTID == "alice" && row.RecipientDeviceID == "alice-1" {
			if delivery.PayloadKind != chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_PUBLIC_EVENT {
				t.Fatalf("group sender received non-marker: %+v", delivery)
			}
			continue
		}
		if delivery.PayloadKind != chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_APPLICATION ||
			string(delivery.EndpointPayload) != string(mlsPayload) {
			t.Fatalf("invalid MLS delivery: %+v", delivery)
		}
	}
}

func TestActorMembershipOwnsConversationVisibilityIndependentlyOfDeviceLeaves(t *testing.T) {
	db, _ := newAuthorityFixture(t, messaging.QueueLimits{
		MaxUnackedItems: 100,
		MaxUnackedBytes: 1024 * 1024,
	})
	repository := infrastructure.NewAuthorityRepository(db)
	ctx := context.Background()
	if err := db.Create(&infrastructure.AuthorityConversationModel{
		ConversationID:  "group-membership",
		Kind:            int32(messaging.AuthorityConversationKindGroup),
		OwnerPTID:       "alice",
		MembershipEpoch: 2,
		MlsEpoch:        2,
		Active:          true,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := repository.AddMember(ctx, "group-membership", "alice", "owner", 1); err != nil {
		t.Fatal(err)
	}
	if err := repository.AddMember(ctx, "group-membership", "bob", "member", 1); err != nil {
		t.Fatal(err)
	}
	if err := repository.AddMemberDevice(
		ctx,
		"group-membership",
		&chat.CryptoEndpoint{Ptid: "alice", DeviceId: "alice-1"},
		1,
	); err != nil {
		t.Fatal(err)
	}
	if err := repository.AddMemberDevice(
		ctx,
		"group-membership",
		&chat.CryptoEndpoint{Ptid: "bob", DeviceId: "bob-1"},
		1,
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&infrastructure.AuthorityMemberDeviceModel{}).
		Where("conversation_id = ? AND ptid = ?", "group-membership", "bob").
		Updates(map[string]any{"active": false, "left_sequence": 2}).Error; err != nil {
		t.Fatal(err)
	}

	views, err := repository.ListConversationsForActor(ctx, "bob")
	if err != nil {
		t.Fatal(err)
	}
	if len(views) != 1 ||
		len(views[0].MemberPTIDs) != 2 ||
		views[0].MemberPTIDs[0] != "alice" ||
		views[0].MemberPTIDs[1] != "bob" {
		t.Fatalf("actor-owned conversation view = %+v", views)
	}
	devices, err := repository.ListActiveMemberDevices(ctx, "group-membership")
	if err != nil {
		t.Fatal(err)
	}
	if len(devices) != 1 ||
		devices[0].Endpoint.Ptid != "alice" ||
		devices[0].Endpoint.DeviceId != "alice-1" {
		t.Fatalf("active delivery leaves = %+v", devices)
	}
}

func TestAuthorityMigrationReplacesLegacyMemberDeviceTable(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&infrastructure.AuthorityConversationModel{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&infrastructure.AuthorityConversationModel{
		ConversationID:  "legacy-group",
		Kind:            int32(messaging.AuthorityConversationKindGroup),
		OwnerPTID:       "alice",
		MembershipEpoch: 1,
		MlsEpoch:        1,
		Active:          true,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(
		`CREATE TABLE messaging_member_devices (
			conversation_id text NOT NULL,
			ptid text NOT NULL,
			device_id text NOT NULL,
			active numeric NOT NULL
		)`,
	).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(
		`INSERT INTO messaging_member_devices
			(conversation_id, ptid, device_id, active)
		 VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
		"legacy-group", "alice", "alice-1", true,
		"legacy-group", "bob", "bob-1", true,
	).Error; err != nil {
		t.Fatal(err)
	}
	if err := infrastructure.NewAuthorityRepository(db).AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	if db.Migrator().HasTable("messaging_member_devices") {
		t.Fatal("legacy member-device table still exists")
	}
	var members []infrastructure.AuthorityMemberModel
	if err := db.Order("ptid").Find(&members).Error; err != nil {
		t.Fatal(err)
	}
	if len(members) != 2 ||
		members[0].PTID != "alice" ||
		members[0].Role != "owner" ||
		members[1].PTID != "bob" ||
		members[1].Role != "member" {
		t.Fatalf("migrated actor memberships = %+v", members)
	}
	var leaves []infrastructure.AuthorityMemberDeviceModel
	if err := db.Order("ptid").Find(&leaves).Error; err != nil {
		t.Fatal(err)
	}
	if len(leaves) != 2 ||
		leaves[0].JoinedSequence != 1 ||
		leaves[1].JoinedSequence != 1 {
		t.Fatalf("migrated device leaves = %+v", leaves)
	}
}
