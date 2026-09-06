package infrastructure_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
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
	service, err := application.NewAuthorityService(
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
	actorMembers := []infrastructure.AuthorityMemberModel{
		{
			ConversationID: conversationID,
			PTID:           "alice",
			Role:           "owner",
			Active:         true,
			JoinedSequence: 1,
		},
		{
			ConversationID: conversationID,
			PTID:           "bob",
			Role:           "member",
			Active:         true,
			JoinedSequence: 1,
		},
	}
	if err := db.Create(&actorMembers).Error; err != nil {
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
		CommandId:          commandID,
		ConversationId:     conversationID,
		AuthorityStationId: "station:local",
		Sender:             &chat.CryptoEndpoint{Ptid: "alice", DeviceId: "alice-1"},
		ClientTimestamp:    timestamppb.New(time.Unix(1_700_000_000, 0)),
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
		ConversationId:     command.ConversationId,
		Sender:             command.Sender,
		AuthorityStationId: command.AuthorityStationId,
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
	descriptor := seedAttachmentObject(
		t,
		db,
		command.ConversationId,
		command.GetSendMessage().MessageId,
	)
	command.GetSendMessage().Attachments = []*chat.EncryptedObjectDescriptor{descriptor}
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
	var grantCount int64
	if err := db.Model(&infrastructure.AttachmentGrantModel{}).
		Where("object_id = ?", descriptor.ObjectId).
		Count(&grantCount).Error; err != nil {
		t.Fatal(err)
	}
	if grantCount != 2 {
		t.Fatalf("attachment grants = %d, want 2 actor grants", grantCount)
	}
	var object infrastructure.AttachmentObjectModel
	if err := db.First(&object, "object_id = ?", descriptor.ObjectId).Error; err != nil {
		t.Fatal(err)
	}
	if object.State != messaging.AttachmentObjectStateAttached ||
		object.EventID != event.EventId {
		t.Fatalf("attached object lifecycle = %+v, event=%s", object, event.EventId)
	}
	var grants []infrastructure.AttachmentGrantModel
	if err := db.Where("object_id = ?", descriptor.ObjectId).Find(&grants).Error; err != nil {
		t.Fatal(err)
	}
	for _, grant := range grants {
		if grant.EventID != event.EventId {
			t.Fatalf("grant event binding = %+v, event=%s", grant, event.EventId)
		}
	}
	granted, err := infrastructure.NewAttachmentRepository(db).GetGrantedObject(
		ctx,
		command.ConversationId,
		descriptor.ObjectId,
		"bob",
	)
	if err != nil || granted.MessageID != command.GetSendMessage().MessageId {
		t.Fatalf("bob attachment grant = %+v, err = %v", granted, err)
	}
}

func seedAttachmentObject(
	t *testing.T,
	db *gorm.DB,
	conversationID string,
	messageID string,
) *chat.EncryptedObjectDescriptor {
	t.Helper()
	now := time.Unix(1_700_000_000, 0).UTC()
	upload := attachmentUploadFixture(now)
	upload.UploadID = uuid.NewString()
	upload.IdempotencyKey = uuid.NewString()
	upload.ConversationID = conversationID
	upload.MessageID = messageID
	repository := infrastructure.NewAttachmentRepository(db)
	if _, _, err := repository.CreateUpload(context.Background(), upload); err != nil {
		t.Fatal(err)
	}
	descriptor := &chat.EncryptedObjectDescriptor{
		ObjectId:              uuid.NewString(),
		StorageRef:            uuid.NewString(),
		CiphertextSize:        upload.Object.CiphertextSize,
		CiphertextSha256:      upload.Object.CiphertextSha256,
		MediaType:             upload.Object.MediaType,
		ChunkSize:             upload.Object.ChunkSize,
		ChunkCount:            upload.Object.ChunkCount,
		EncryptionSuite:       upload.Object.EncryptionSuite,
		TagSize:               upload.Object.TagSize,
		NonceStrategy:         upload.Object.NonceStrategy,
		ChunkCiphertextSha256: upload.Object.ChunkCiphertextSha256,
	}
	if err := repository.CompleteUpload(
		context.Background(),
		upload.UploadID,
		upload.Generation,
		&messaging.AttachmentObject{
			Descriptor:     descriptor,
			StorageKey:     "objects/" + descriptor.StorageRef,
			UploaderPTID:   "alice",
			ConversationID: conversationID,
			MessageID:      messageID,
			CreatedAt:      now,
		},
		now,
	); err != nil {
		t.Fatal(err)
	}
	return descriptor
}

func TestAuthorityCommitAtomicallyPartitionsRemoteHomeStationDelivery(t *testing.T) {
	db, service := newAuthorityFixture(t, messaging.QueueLimits{
		MaxUnackedItems: 100,
		MaxUnackedBytes: 1024 * 1024,
	})
	seedDirectConversation(t, db, "direct-federated")
	if err := db.Model(&touchactor.DeviceRecord{}).
		Where("ptid = ? AND device_id = ?", "bob", "bob-1").
		Update("home_station_peer_id", "station:remote").Error; err != nil {
		t.Fatal(err)
	}
	command := directCommand("direct-federated", "command-federated")
	bindSendPlan(t, service, command)

	event, err := service.Submit(context.Background(), command)
	if err != nil {
		t.Fatal(err)
	}
	if len(event.DeliveryCommitments) != 3 {
		t.Fatalf("delivery commitments = %d, want 3", len(event.DeliveryCommitments))
	}
	var queueCount int64
	if err := db.Model(&infrastructure.DeviceQueueItemModel{}).Count(&queueCount).Error; err != nil {
		t.Fatal(err)
	}
	if queueCount != 2 {
		t.Fatalf("local queue rows = %d, want 2", queueCount)
	}
	var outbox infrastructure.FederationOutboxModel
	if err := db.First(&outbox).Error; err != nil {
		t.Fatal(err)
	}
	if outbox.SourceStationID != "station:local" ||
		outbox.TargetStationID != "station:remote" ||
		outbox.State != "pending" {
		t.Fatalf("federation outbox = %+v", outbox)
	}
	frame := &chat.MessagingFederationFrame{}
	if err := proto.Unmarshal(outbox.FrameBytes, frame); err != nil {
		t.Fatal(err)
	}
	batch := &chat.FederatedDeviceQueueBatch{}
	if err := proto.Unmarshal(frame.OpaquePayload, batch); err != nil {
		t.Fatal(err)
	}
	if frame.EventId != event.EventId ||
		frame.AuthoritySequence != event.Sequence ||
		len(batch.Writes) != 1 ||
		batch.Writes[0].Recipient.Ptid != "bob" ||
		batch.Writes[0].Recipient.DeviceId != "bob-1" {
		t.Fatalf("federation frame = %+v batch=%+v", frame, batch)
	}
}

func TestQueueQuotaRollsBackEntireAuthorityCommit(t *testing.T) {
	db, service := newAuthorityFixture(t, messaging.QueueLimits{
		MaxUnackedItems: 100,
		MaxUnackedBytes: 1,
	})
	seedDirectConversation(t, db, "direct-quota")

	command := directCommand("direct-quota", "command-quota")
	command.GetSendMessage().Attachments = []*chat.EncryptedObjectDescriptor{
		seedAttachmentObject(
			t,
			db,
			command.ConversationId,
			command.GetSendMessage().MessageId,
		),
	}
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
		"grants":   &infrastructure.AttachmentGrantModel{},
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

func TestRemovedActorKeepsHistoricalAttachmentGrantButGetsNoFutureGrant(t *testing.T) {
	db, service := newAuthorityFixture(t, messaging.QueueLimits{
		MaxUnackedItems: 100,
		MaxUnackedBytes: 1024 * 1024,
	})
	const conversationID = "direct-attachment-removal"
	seedDirectConversation(t, db, conversationID)
	ctx := context.Background()
	attachments := infrastructure.NewAttachmentRepository(db)

	historicalCommand := directCommand(conversationID, "command-before-removal")
	historicalDescriptor := seedAttachmentObject(
		t,
		db,
		conversationID,
		historicalCommand.GetSendMessage().MessageId,
	)
	historicalCommand.GetSendMessage().Attachments =
		[]*chat.EncryptedObjectDescriptor{historicalDescriptor}
	bindSendPlan(t, service, historicalCommand)
	if _, err := service.Submit(ctx, historicalCommand); err != nil {
		t.Fatal(err)
	}

	if err := db.Model(&infrastructure.AuthorityMemberModel{}).
		Where("conversation_id = ? AND ptid = ?", conversationID, "bob").
		Updates(map[string]any{"active": false, "left_sequence": 2}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&infrastructure.AuthorityMemberDeviceModel{}).
		Where("conversation_id = ? AND ptid = ?", conversationID, "bob").
		Updates(map[string]any{"active": false, "left_sequence": 2}).Error; err != nil {
		t.Fatal(err)
	}

	historical, err := attachments.GetGrantedObject(
		ctx,
		conversationID,
		historicalDescriptor.ObjectId,
		"bob",
	)
	if err != nil || historical.Descriptor.ObjectId != historicalDescriptor.ObjectId {
		t.Fatalf("historical grant=%+v err=%v", historical, err)
	}

	futureCommand := directCommand(conversationID, "command-after-removal")
	futureCommand.GetSendMessage().DirectPayloads =
		futureCommand.GetSendMessage().DirectPayloads[:1]
	futureDescriptor := seedAttachmentObject(
		t,
		db,
		conversationID,
		futureCommand.GetSendMessage().MessageId,
	)
	futureCommand.GetSendMessage().Attachments =
		[]*chat.EncryptedObjectDescriptor{futureDescriptor}
	bindSendPlan(t, service, futureCommand)
	if _, err := service.Submit(ctx, futureCommand); err != nil {
		t.Fatal(err)
	}

	if _, err := attachments.GetGrantedObject(
		ctx,
		conversationID,
		futureDescriptor.ObjectId,
		"bob",
	); !errors.Is(err, messaging.ErrAttachmentNotGranted) {
		t.Fatalf("removed actor future grant error=%v", err)
	}
	if _, err := attachments.GetGrantedObject(
		ctx,
		conversationID,
		futureDescriptor.ObjectId,
		"alice",
	); err != nil {
		t.Fatalf("active actor future grant error=%v", err)
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
			ConversationId:     command.ConversationId,
			Sender:             command.Sender,
			AuthorityStationId: command.AuthorityStationId,
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
		CommandId:          "group-command-1",
		ConversationId:     "group-1",
		AuthorityStationId: "station:local",
		Sender:             &chat.CryptoEndpoint{Ptid: "alice", DeviceId: "alice-1"},
		ClientTimestamp:    timestamppb.New(time.Unix(1_700_000_000, 0)),
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
