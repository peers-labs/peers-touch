package delivery

import (
	"context"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMigrateCommandResultItemIdentitiesNormalizesHistoricalRow(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:command-result-migration?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&DeviceQueueItemModel{}); err != nil {
		t.Fatal(err)
	}
	delivery := &chatmodel.ConversationCommandResultDelivery{
		ConversationId: "conversation-1",
		CommandId:      "command-1",
		State:          chatmodel.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_TERMINAL_REJECTED,
		Result: &chatmodel.ConversationCommandProposalResult{
			CommandId:  "command-1",
			RejectCode: chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_COMMAND_EXPIRED,
		},
	}
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(delivery)
	if err != nil {
		t.Fatal(err)
	}
	oldID := "conversation-command-result:" +
		valueobject.HashBytes(payload).String()
	oldReceiptID := "device-consumed:" + oldID
	row := DeviceQueueItemModel{
		ItemID:                  oldID,
		RecipientPTID:           "ptid:alice",
		RecipientDeviceID:       "alice-device",
		LaneSequence:            7,
		IdempotencyKey:          oldID,
		EventID:                 "event-1",
		EventSequence:           1,
		ConversationID:          delivery.GetConversationId(),
		PayloadType:             int32(chatmodel.DeviceInboxPayloadType_DEVICE_INBOX_PAYLOAD_TYPE_COMMAND_RESULT),
		OpaquePayload:           payload,
		PayloadSHA256:           federationdelivery.PayloadSHA256(payload),
		State:                   storageStateConsumed,
		FirstQueuedAt:           time.Now().UTC(),
		NextAttemptAt:           time.Now().UTC(),
		ConsumptionReceiptID:    &oldReceiptID,
		LeaseConsumerEpoch:      3,
		LastRejectConsumerEpoch: 2,
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}

	if err := MigrateCommandResultItemIdentities(context.Background(), db); err != nil {
		t.Fatal(err)
	}

	recipient := valueobject.Endpoint{
		Actor:  "ptid:alice",
		Device: "alice-device",
	}
	expectedID, err := CommandResultItemID(
		recipient,
		"conversation-1",
		"command-1",
	)
	if err != nil {
		t.Fatal(err)
	}
	var migrated DeviceQueueItemModel
	if err := db.First(&migrated, "id = ?", row.ID).Error; err != nil {
		t.Fatal(err)
	}
	if migrated.ItemID != expectedID ||
		migrated.IdempotencyKey != expectedID ||
		migrated.ConsumptionReceiptID == nil ||
		*migrated.ConsumptionReceiptID != "device-consumed:"+expectedID ||
		migrated.LaneSequence != row.LaneSequence ||
		migrated.State != row.State ||
		migrated.LeaseConsumerEpoch != row.LeaseConsumerEpoch {
		t.Fatalf("migrated row = %+v", migrated)
	}
	if err := MigrateCommandResultItemIdentities(context.Background(), db); err != nil {
		t.Fatalf("idempotent migration failed: %v", err)
	}
}
