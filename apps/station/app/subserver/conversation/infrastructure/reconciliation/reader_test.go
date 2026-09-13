package reconciliation_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	reconciliationapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/reconciliation"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	deliveryinfra "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/delivery"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/persistence"
	reconciliationinfra "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/reconciliation"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var (
	now    = time.Date(2026, time.September, 13, 12, 0, 0, 0, time.UTC)
	caller = valueobject.Endpoint{Actor: "ptid:alice", Device: "alice-device"}
)

type fixedClock struct{}

func (fixedClock) Now() time.Time {
	return now
}

func TestReaderResolvesAuthorityReceipt(t *testing.T) {
	db := testDatabase(t)
	command, reference := testCommand(t, "local-command")
	event := testEvent(t, command)
	snapshot := event.Clone()
	snapshot.EncodedBytes = nil
	domainSnapshot, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&persistence.ConversationEventModel{
		EventID:          string(event.ID),
		ConversationID:   string(event.ConversationID),
		Sequence:         uint64(event.Sequence),
		CommandID:        string(event.CommandID),
		MessageID:        stringPointer("message-1"),
		MessageAuthor:    string(caller.Actor),
		ActorPTID:        string(caller.Actor),
		ActorDeviceID:    string(caller.Device),
		EventHash:        event.Hash.Bytes(),
		MembershipEpoch:  uint64(event.MembershipEpoch),
		AuthorityStation: string(event.AuthorityStation),
		EventKind:        string(event.Fact.Kind),
		HashScheme:       string(event.HashScheme),
		EventBytes:       event.Bytes(),
		DomainSnapshot:   domainSnapshot,
		CommittedAt:      event.CommittedAt,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&persistence.ConversationCommandReceiptModel{
		ConversationID: string(reference.ConversationID),
		CommandID:      string(reference.CommandID),
		CommandHash:    reference.CommandHash.Bytes(),
		Outcome:        "accepted",
		EventID:        string(event.ID),
		EventBytes:     event.Bytes(),
		CreatedAt:      now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	reader := newReader(t, db)
	resolved, err := reader.Resolve(context.Background(), caller, reference)
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if resolved.State != reconciliationapp.StateAccepted ||
		resolved.AuthorityEvent == nil ||
		resolved.AuthorityEvent.ID != event.ID {
		t.Fatalf("Resolve() = %+v", resolved)
	}
	otherEndpoint := valueobject.Endpoint{Actor: caller.Actor, Device: "other-device"}
	_, err = reader.Resolve(context.Background(), otherEndpoint, reference)
	if !conversationdomain.IsCode(err, conversationdomain.ErrorCodeHashChainInvalid) {
		t.Fatalf("endpoint mismatch error = %v", err)
	}
}

func TestReaderResolvesOutboxAndAddressedInbox(t *testing.T) {
	t.Run("home pending survives durable outbox state", func(t *testing.T) {
		db := testDatabase(t)
		_, reference := insertAuthorityCommandOutbox(
			t,
			db,
			"pending-command",
			federationdelivery.OutboxStateRetryWait,
			now.Add(time.Hour),
		)
		resolved, err := newReader(t, db).Resolve(
			context.Background(),
			caller,
			reference,
		)
		if err != nil {
			t.Fatalf("Resolve() error = %v", err)
		}
		if resolved.State != reconciliationapp.StateHomePending {
			t.Fatalf("state = %s, want HOME_PENDING", resolved.State)
		}
	})

	t.Run("addressed accepted result wins over original outbox", func(t *testing.T) {
		db := testDatabase(t)
		command, reference := insertAuthorityCommandOutbox(
			t,
			db,
			"accepted-command",
			federationdelivery.OutboxStateDelivered,
			now.Add(time.Hour),
		)
		eventHash := valueobject.HashBytes([]byte("accepted-event"))
		result := &chatmodel.ConversationCommandProposalResult{
			CommandId: command.GetCommandId(),
			Accepted:  true,
			Event: &chatmodel.ConversationEvent{
				EventId:        "accepted-event",
				ConversationId: command.GetConversationId(),
				Sequence:       7,
				CommandId:      command.GetCommandId(),
				Actor: &chatmodel.CryptoEndpoint{
					Ptid:     string(caller.Actor),
					DeviceId: string(caller.Device),
				},
				EventHash: eventHash.Bytes(),
			},
			AuthoritySequence:  7,
			AuthorityEventHash: eventHash.Bytes(),
		}
		insertInboxResult(t, db, caller, command.GetConversationId(), result, true)
		resolved, err := newReader(t, db).Resolve(
			context.Background(),
			caller,
			reference,
		)
		if err != nil {
			t.Fatalf("Resolve() error = %v", err)
		}
		var canonicalResult chatmodel.ConversationCommandProposalResult
		if err := proto.Unmarshal(resolved.CanonicalResult, &canonicalResult); err != nil {
			t.Fatal(err)
		}
		if resolved.State != reconciliationapp.StateAccepted ||
			canonicalResult.GetEvent().GetEventId() != "accepted-event" {
			t.Fatalf("Resolve() = %+v", resolved)
		}
	})

	t.Run("expired outbox becomes typed terminal rejection", func(t *testing.T) {
		db := testDatabase(t)
		_, reference := insertAuthorityCommandOutbox(
			t,
			db,
			"expired-command",
			federationdelivery.OutboxStateExpired,
			now.Add(-time.Minute),
		)
		resolved, err := newReader(t, db).Resolve(
			context.Background(),
			caller,
			reference,
		)
		if err != nil {
			t.Fatalf("Resolve() error = %v", err)
		}
		if resolved.State != reconciliationapp.StateTerminalRejected ||
			resolved.TerminalErrorCode != conversationdomain.ErrorCodeProposalExpired {
			t.Fatalf("Resolve() = %+v", resolved)
		}
	})
}

func TestReaderFailsClosedOnHashAndEndpointConflicts(t *testing.T) {
	db := testDatabase(t)
	_, reference := insertAuthorityCommandOutbox(
		t,
		db,
		"conflicting-command",
		federationdelivery.OutboxStatePending,
		now.Add(time.Hour),
	)
	wrongHash := reference
	wrongHash.CommandHash = valueobject.HashBytes([]byte("different"))
	if _, err := newReader(t, db).Resolve(
		context.Background(),
		caller,
		wrongHash,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeCommandConflict) {
		t.Fatalf("hash mismatch error = %v", err)
	}
	if _, err := newReader(t, db).Resolve(
		context.Background(),
		valueobject.Endpoint{Actor: caller.Actor, Device: "other-device"},
		reference,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeCommandConflict) {
		t.Fatalf("endpoint mismatch error = %v", err)
	}
}

func TestReaderReturnsNotFoundWithoutMutation(t *testing.T) {
	db := testDatabase(t)
	reference := reconciliationapp.Reference{
		ConversationID: "conversation-1",
		CommandID:      "missing-command",
		CommandHash:    valueobject.HashBytes([]byte("missing")),
	}
	resolved, err := newReader(t, db).Resolve(context.Background(), caller, reference)
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if resolved.State != reconciliationapp.StateNotFound {
		t.Fatalf("state = %s, want NOT_FOUND", resolved.State)
	}
}

func testDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&persistence.ConversationCommandReceiptModel{},
		&persistence.ConversationEventModel{},
		&deliveryinfra.DeviceQueueItemModel{},
		&federationdelivery.OutboxRecord{},
	); err != nil {
		t.Fatal(err)
	}
	return db
}

func newReader(t *testing.T, db *gorm.DB) *reconciliationinfra.Reader {
	t.Helper()
	reader, err := reconciliationinfra.NewReader(
		db,
		domainevent.CanonicalSealer{},
		"station-home",
		fixedClock{},
	)
	if err != nil {
		t.Fatal(err)
	}
	return reader
}

func testCommand(
	t *testing.T,
	commandID string,
) (*chatmodel.ChatCommand, reconciliationapp.Reference) {
	t.Helper()
	command := &chatmodel.ChatCommand{
		CommandId:              commandID,
		ConversationId:         "conversation-1",
		AuthorityStationPeerId: "station-authority",
		Sender: &chatmodel.CryptoEndpoint{
			Ptid:     string(caller.Actor),
			DeviceId: string(caller.Device),
		},
		Payload: &chatmodel.ChatCommand_SendMessage{
			SendMessage: &chatmodel.SendMessageIntent{MessageId: "message-1"},
		},
	}
	commandBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(command)
	if err != nil {
		t.Fatal(err)
	}
	return command, reconciliationapp.Reference{
		ConversationID: valueobject.ConversationID(command.GetConversationId()),
		CommandID:      valueobject.CommandID(command.GetCommandId()),
		CommandHash:    valueobject.HashBytes(commandBytes),
	}
}

func testEvent(t *testing.T, command *chatmodel.ChatCommand) domainevent.Record {
	t.Helper()
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(command)
	if err != nil {
		t.Fatal(err)
	}
	event, err := domainevent.NewRecord(domainevent.RecordInput{
		ID:               "event-1",
		ConversationID:   valueobject.ConversationID(command.GetConversationId()),
		Sequence:         1,
		CommandID:        valueobject.CommandID(command.GetCommandId()),
		Actor:            caller,
		CommittedAt:      now,
		MembershipEpoch:  1,
		AuthorityStation: "station-authority",
		Fact: domainevent.NewCommandCommittedFact(
			domainevent.KindMessageCommitted,
			"message-1",
			payload,
		),
	})
	if err != nil {
		t.Fatal(err)
	}
	return event
}

func insertAuthorityCommandOutbox(
	t *testing.T,
	db *gorm.DB,
	commandID string,
	state federationdelivery.OutboxState,
	expiresAt time.Time,
) (*chatmodel.ChatCommand, reconciliationapp.Reference) {
	t.Helper()
	command, reference := testCommand(t, commandID)
	commandBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(command)
	if err != nil {
		t.Fatal(err)
	}
	proposal := &chatmodel.ConversationCommandProposal{
		AuthorityStationPeerId: "station-authority",
		HomeStationPeerId:      "station-home",
		ActorPtid:              string(caller.Actor),
		ActorDeviceId:          string(caller.Device),
		CommandSha256:          federationdelivery.PayloadSHA256(commandBytes),
		Command:                command,
	}
	proposalBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(proposal)
	if err != nil {
		t.Fatal(err)
	}
	frame := &federationdelivery.Frame{
		FormatVersion:       federationdelivery.CurrentFormatVersion,
		FrameId:             "frame-" + commandID,
		SourceStationPeerId: "station-home",
		TargetStationPeerId: "station-authority",
		IdempotencyKey:      "idempotency-" + commandID,
		PayloadKind:         federationdelivery.PayloadKindConversationAuthorityCommand,
		PayloadId:           commandID,
		OrderingKey:         "conversation-authority-command:conversation-1",
		OrderingSequence:    1,
		OpaquePayload:       proposalBytes,
		PayloadSha256:       federationdelivery.PayloadSHA256(proposalBytes),
		IssuedAt:            timestamppb.New(now),
		ExpiresAt:           timestamppb.New(expiresAt),
		SigningKeyId:        "station-key",
		StationSignature:    []byte("test-signature"),
	}
	frameBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(frame)
	if err != nil {
		t.Fatal(err)
	}
	canonicalHash, err := federationdelivery.CanonicalFrameSHA256(frame)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&federationdelivery.OutboxRecord{
		FrameID:             frame.GetFrameId(),
		SourceStationPeerID: frame.GetSourceStationPeerId(),
		TargetStationPeerID: frame.GetTargetStationPeerId(),
		IdempotencyKey:      frame.GetIdempotencyKey(),
		PayloadKind:         int32(frame.GetPayloadKind()),
		PayloadID:           frame.GetPayloadId(),
		OrderingKey:         frame.GetOrderingKey(),
		OrderingSequence:    frame.GetOrderingSequence(),
		FrameBytes:          frameBytes,
		PayloadSHA256:       frame.GetPayloadSha256(),
		CanonicalSHA256:     canonicalHash,
		State:               state,
		NextAttemptAt:       now,
		ExpiresAt:           expiresAt,
		CreatedAt:           now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	return command, reference
}

func insertInboxResult(
	t *testing.T,
	db *gorm.DB,
	recipient valueobject.Endpoint,
	conversationID string,
	result *chatmodel.ConversationCommandProposalResult,
	accepted bool,
) {
	t.Helper()
	state := chatmodel.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_TERMINAL_REJECTED
	if accepted {
		state = chatmodel.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_ACCEPTED
	}
	delivery := &chatmodel.ConversationCommandResultDelivery{
		ConversationId: conversationID,
		CommandId:      result.GetCommandId(),
		State:          state,
		Result:         result,
	}
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(delivery)
	if err != nil {
		t.Fatal(err)
	}
	payloadHash := federationdelivery.PayloadSHA256(payload)
	itemID, err := deliveryinfra.CommandResultItemID(
		recipient,
		valueobject.ConversationID(conversationID),
		valueobject.CommandID(result.GetCommandId()),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&deliveryinfra.DeviceQueueItemModel{
		ItemID:            itemID,
		RecipientPTID:     string(recipient.Actor),
		RecipientDeviceID: string(recipient.Device),
		LaneSequence:      1,
		IdempotencyKey:    itemID,
		EventID:           "result-event-" + result.GetCommandId(),
		EventSequence:     1,
		ConversationID:    conversationID,
		PayloadType:       int32(chatmodel.DeviceInboxPayloadType_DEVICE_INBOX_PAYLOAD_TYPE_COMMAND_RESULT),
		OpaquePayload:     payload,
		PayloadSHA256:     payloadHash,
		State:             int32(chatmodel.DeviceInboxItemState_DEVICE_INBOX_ITEM_STATE_PENDING),
		FirstQueuedAt:     now,
		NextAttemptAt:     now,
	}).Error; err != nil {
		t.Fatal(err)
	}
}

func stringPointer(value string) *string {
	return &value
}
