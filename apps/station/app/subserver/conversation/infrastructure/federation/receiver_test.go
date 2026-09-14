package federation_test

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	actoridentitypersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	deliveryapplication "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/delivery"
	conversationports "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	conversationdelivery "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/delivery"
	conversationfederation "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/federation"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	gormlogger "gorm.io/gorm/logger"
)

const (
	testStationA = "station-a"
	testStationB = "station-b"
	testActor    = "ptid:p:alice"
	testDevice   = "alice-device"
)

func TestAuthorityCommandReceiverUsesVerifiedProjectionAndPreservesReceiptReplay(
	t *testing.T,
) {
	fixture := newReceiverFixture(t, testStationB)
	proposal := fixture.signedProposal(t, "command-replay")
	frame := fixture.authorityCommandFrame(t, proposal, 1)

	first, err := fixture.coreReceiver.Receive(context.Background(), frame)
	if err != nil {
		t.Fatalf("receive authority command: %v", err)
	}
	if first != federationdelivery.AcceptedResult() {
		t.Fatalf("first result = %+v", first)
	}

	fixture.actorKeys.setRevokedAt(fixture.clock.Now().Add(-30 * time.Second))
	replay := proto.Clone(frame).(*federationdelivery.Frame)
	replay.FrameId = "replay-" + replay.FrameId
	replay.IdempotencyKey = "replay-" + replay.IdempotencyKey
	if err := federationdelivery.SignFrame(
		context.Background(),
		replay,
		federationdelivery.DefaultFramePolicy(testStationB),
		fixture.stationKeys[testStationA].signer(),
	); err != nil {
		t.Fatalf("sign replay frame: %v", err)
	}
	replayed, err := fixture.coreReceiver.Receive(context.Background(), replay)
	if err != nil {
		t.Fatalf("receive exact command replay: %v", err)
	}
	if replayed != federationdelivery.DuplicateResult() {
		t.Fatalf("replay result = %+v", replayed)
	}

	fixture.actorKeys.setRevokedAt(time.Time{})
	conflictProposal := proto.Clone(proposal).(*chatmodel.ConversationCommandProposal)
	conflictProposal.GetCommand().GetSendMessage().ContentKind =
		chatmodel.MessagingContentKind_MESSAGING_CONTENT_KIND_IMAGE
	fixture.signProposal(t, conflictProposal)
	conflictFrame := fixture.authorityCommandFrame(t, conflictProposal, 1)
	conflictFrame.FrameId = "conflict-" + conflictFrame.FrameId
	conflictFrame.IdempotencyKey = "conflict-" + conflictFrame.IdempotencyKey
	if err := federationdelivery.SignFrame(
		context.Background(),
		conflictFrame,
		federationdelivery.DefaultFramePolicy(testStationB),
		fixture.stationKeys[testStationA].signer(),
	); err != nil {
		t.Fatalf("sign conflicting command frame: %v", err)
	}
	conflict, err := fixture.coreReceiver.Receive(context.Background(), conflictFrame)
	if err != nil {
		t.Fatalf("receive command-ID/hash conflict: %v", err)
	}
	if conflict != federationdelivery.AcceptedResult() {
		t.Fatalf("command-ID/hash conflict = %+v", conflict)
	}
	conflictReplay, err := fixture.coreReceiver.Receive(
		context.Background(),
		proto.Clone(conflictFrame).(*federationdelivery.Frame),
	)
	if err != nil {
		t.Fatalf("replay command-ID/hash conflict: %v", err)
	}
	if conflictReplay != federationdelivery.DuplicateResult() {
		t.Fatalf("command-ID/hash conflict replay = %+v", conflictReplay)
	}

	if fixture.actorKeys.callCount() != 3 {
		t.Fatalf("verified identity resolutions = %d, want 3", fixture.actorKeys.callCount())
	}
	if fixture.authority.callCount() != 3 {
		t.Fatalf("authority applications = %d, want 3", fixture.authority.callCount())
	}
	for _, source := range fixture.authority.sourceHomeStations() {
		if source != testStationA {
			t.Fatalf("verified authority source = %q, want %q", source, testStationA)
		}
	}
	if fixture.db.Migrator().HasTable("actor_devices") {
		t.Fatal("Conversation adapter created or depended on a local actor_devices table")
	}
	assertTableCount(t, fixture.db, &authorityReceiptTestModel{}, 1)
	assertTableCount(t, fixture.db, &federationdelivery.InboxRecord{}, 3)
	assertTableCount(t, fixture.db, &federationdelivery.OutboxRecord{}, 2)

	var resultRecords []federationdelivery.OutboxRecord
	if err := fixture.db.Find(&resultRecords).Error; err != nil {
		t.Fatal(err)
	}
	var acceptedResults int
	var conflictResults int
	for _, resultRecord := range resultRecords {
		var resultFrame federationdelivery.Frame
		if err := proto.Unmarshal(resultRecord.FrameBytes, &resultFrame); err != nil {
			t.Fatalf("decode result frame: %v", err)
		}
		var resultDelivery chatmodel.ConversationCommandResultDelivery
		if err := proto.Unmarshal(resultFrame.GetOpaquePayload(), &resultDelivery); err != nil {
			t.Fatalf("decode authority result delivery: %v", err)
		}
		if resultFrame.GetSourceStationPeerId() != testStationB ||
			resultFrame.GetTargetStationPeerId() != testStationA ||
			resultFrame.GetOrderingSequence() != 0 {
			t.Fatalf("authority result frame = %+v", &resultFrame)
		}
		switch resultDelivery.GetState() {
		case chatmodel.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_ACCEPTED:
			acceptedResults++
			if resultDelivery.GetResult().GetEvent().GetSequence() != 1 {
				t.Fatalf("accepted authority result = %+v", &resultDelivery)
			}
		case chatmodel.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_TERMINAL_REJECTED:
			conflictResults++
			if resultDelivery.GetResult().GetRejectCode() !=
				chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_COMMAND_CONFLICT {
				t.Fatalf("terminal authority result = %+v", &resultDelivery)
			}
		default:
			t.Fatalf("unexpected authority result = %+v", &resultDelivery)
		}
	}
	if acceptedResults != 1 || conflictResults != 1 {
		t.Fatalf(
			"authority results accepted=%d conflict=%d, want one each",
			acceptedResults,
			conflictResults,
		)
	}
}

func TestAuthorityCommandReceiverRejectsRemoteLocalOnlyKeyBeforeAuthorityMutation(
	t *testing.T,
) {
	fixture := newReceiverFixture(t, testStationB)
	fixture.actorKeys.setVerificationSource(
		actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION,
	)
	proposal := fixture.signedProposal(t, "command-local-only-key")
	frame := fixture.authorityCommandFrame(t, proposal, 1)

	result, err := fixture.coreReceiver.Receive(context.Background(), frame)
	if err != nil {
		t.Fatalf("receive command with local-only key: %v", err)
	}
	if result != federationdelivery.AcceptedResult() {
		t.Fatalf("transport result = %+v", result)
	}
	if fixture.authority.callCount() != 0 {
		t.Fatal("untrusted remote identity reached Conversation authority")
	}
	assertTableCount(t, fixture.db, &authorityReceiptTestModel{}, 0)

	var resultRecord federationdelivery.OutboxRecord
	if err := fixture.db.First(&resultRecord).Error; err != nil {
		t.Fatal(err)
	}
	var resultFrame federationdelivery.Frame
	if err := proto.Unmarshal(resultRecord.FrameBytes, &resultFrame); err != nil {
		t.Fatal(err)
	}
	var resultDelivery chatmodel.ConversationCommandResultDelivery
	if err := proto.Unmarshal(resultFrame.GetOpaquePayload(), &resultDelivery); err != nil {
		t.Fatal(err)
	}
	if resultDelivery.GetResult().GetRejectCode() !=
		chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_FIELD_BINDING_MISMATCH {
		t.Fatalf("reject result = %+v", &resultDelivery)
	}
}

func TestRetryableAuthorityOutcomeKeepsOriginalCommandFrameDeliverable(t *testing.T) {
	authority := newReceiverFixture(t, testStationB)
	authority.authority.setRetryableAttempts(1)
	homeDB := openSQLite(t)
	homeOutbox, err := federationdelivery.NewGORMRepository(homeDB, authority.clock)
	if err != nil {
		t.Fatal(err)
	}
	if err := homeOutbox.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	homeSender, err := conversationfederation.NewSender(
		testStationA,
		authority.stationKeys[testStationA].signer(),
		authority.clock,
		24*time.Hour,
	)
	if err != nil {
		t.Fatal(err)
	}
	proposal := authority.signedProposal(t, "command-retryable")
	if _, err := homeSender.EnqueueAuthorityCommand(
		context.Background(),
		homeOutbox,
		proposal,
		1,
	); err != nil {
		t.Fatal(err)
	}
	dispatcher, err := federationdelivery.NewDispatcher(
		homeOutbox,
		federationdelivery.TransportFunc(authority.coreReceiver.Receive),
		federationdelivery.DispatcherConfig{
			WorkerID:      "home-command-worker",
			BatchSize:     1,
			LeaseDuration: time.Minute,
			IdleDelay:     time.Millisecond,
			RetryBackoff: federationdelivery.RetryBackoff{
				Initial: time.Second,
				Maximum: time.Second,
			},
		},
		authority.clock,
	)
	if err != nil {
		t.Fatal(err)
	}

	first, err := dispatcher.DispatchOnce(context.Background())
	if err != nil {
		t.Fatalf("first command dispatch: %v", err)
	}
	if first.Retried != 1 || first.Delivered != 0 {
		t.Fatalf("first dispatch report = %+v", first)
	}
	var commandFrame federationdelivery.OutboxRecord
	if err := homeDB.First(&commandFrame).Error; err != nil {
		t.Fatal(err)
	}
	if commandFrame.State != federationdelivery.OutboxStateRetryWait ||
		commandFrame.AttemptCount != 1 {
		t.Fatalf("retryable command outbox = %+v", commandFrame)
	}
	assertTableCount(t, authority.db, &federationdelivery.InboxRecord{}, 0)
	assertTableCount(t, authority.db, &federationdelivery.OutboxRecord{}, 0)
	assertTableCount(t, authority.db, &authorityReceiptTestModel{}, 0)

	authority.clock.Advance(time.Second)
	second, err := dispatcher.DispatchOnce(context.Background())
	if err != nil {
		t.Fatalf("second command dispatch: %v", err)
	}
	if second.Delivered != 1 || second.Retried != 0 {
		t.Fatalf("second dispatch report = %+v", second)
	}
	if err := homeDB.First(&commandFrame).Error; err != nil {
		t.Fatal(err)
	}
	if commandFrame.State != federationdelivery.OutboxStateDelivered ||
		commandFrame.AttemptCount != 2 {
		t.Fatalf("retried command outbox = %+v", commandFrame)
	}
	assertTableCount(t, authority.db, &federationdelivery.InboxRecord{}, 1)
	assertTableCount(t, authority.db, &federationdelivery.OutboxRecord{}, 1)
	assertTableCount(t, authority.db, &authorityReceiptTestModel{}, 1)
	if authority.authority.callCount() != 2 {
		t.Fatalf("authority applications = %d, want 2", authority.authority.callCount())
	}
}

func TestAuthorityCommandReceiverTerminatesUnroutableMalformedProposal(t *testing.T) {
	fixture := newReceiverFixture(t, testStationB)
	proposal := fixture.signedProposal(t, "command-unroutable")
	proposal.HomeStationPeerId = ""
	fixture.signProposal(t, proposal)
	payload := mustMarshal(t, proposal)
	frame := &federationdelivery.Frame{
		FormatVersion:       federationdelivery.CurrentFormatVersion,
		FrameId:             "malformed-proposal-frame",
		SourceStationPeerId: testStationA,
		TargetStationPeerId: testStationB,
		IdempotencyKey:      "malformed-proposal-idempotency",
		PayloadKind:         federationdelivery.PayloadKindConversationAuthorityCommand,
		PayloadId:           proposal.GetCommand().GetCommandId(),
		OrderingKey:         "conversation-authority-command:conversation-1",
		OrderingSequence:    1,
		OpaquePayload:       payload,
		IssuedAt:            timestamppb.New(fixture.clock.Now()),
		ExpiresAt:           timestamppb.New(fixture.clock.Now().Add(time.Hour)),
	}
	if err := federationdelivery.SignFrame(
		context.Background(),
		frame,
		federationdelivery.DefaultFramePolicy(testStationB),
		fixture.stationKeys[testStationA].signer(),
	); err != nil {
		t.Fatal(err)
	}

	result, err := fixture.coreReceiver.Receive(context.Background(), frame)
	if err != nil {
		t.Fatalf("malformed proposal returned retryable transport error: %v", err)
	}
	if result != federationdelivery.TerminalResult(federationdelivery.FrameErrorInvalidFrame) {
		t.Fatalf("malformed proposal result = %+v", result)
	}
	if fixture.authority.callCount() != 0 || fixture.actorKeys.callCount() != 0 {
		t.Fatal("malformed proposal reached identity or authority mutation")
	}
	assertTableCount(t, fixture.db, &federationdelivery.OutboxRecord{}, 0)
}

func TestAuthorityCommandSenderRejectsMismatchedCommandAuthority(t *testing.T) {
	clock := &testClock{
		now: time.Date(2026, time.September, 7, 12, 0, 0, 0, time.UTC),
	}
	sender, err := conversationfederation.NewSender(
		testStationA,
		newTestKey(0x11).signer(),
		clock,
		time.Hour,
	)
	if err != nil {
		t.Fatal(err)
	}
	proposal := &chatmodel.ConversationCommandProposal{
		HomeStationPeerId:      testStationA,
		AuthorityStationPeerId: testStationB,
		Command: &chatmodel.ChatCommand{
			AuthorityStationPeerId: "station-c",
		},
	}

	if _, err := sender.EnqueueAuthorityCommand(
		context.Background(),
		&capturingOutbox{},
		proposal,
		1,
	); err == nil {
		t.Fatal("mismatched command authority was accepted")
	} else if code, ok := federationdelivery.FailureCodeOf(err); !ok ||
		code != federationdelivery.FailureInvalidFrame {
		t.Fatalf("mismatched command authority error = %v", err)
	}
}

func TestDeviceDeliverySenderRejectsMissingActorWithoutPanic(t *testing.T) {
	clock := &testClock{
		now: time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC),
	}
	sender, err := conversationfederation.NewSender(
		testStationA,
		newTestKey(0x11).signer(),
		clock,
		time.Hour,
	)
	if err != nil {
		t.Fatal(err)
	}
	intent := conversationports.FederationOutboxIntent{
		Recipient: valueobject.Endpoint{Device: testDevice},
	}

	defer func() {
		if recovered := recover(); recovered != nil {
			t.Fatalf("malformed recipient panicked: %v", recovered)
		}
	}()
	if _, err := sender.EnqueueDeviceDelivery(
		context.Background(),
		&capturingOutbox{},
		intent,
	); err == nil {
		t.Fatal("missing recipient actor was accepted")
	} else if code, ok := federationdelivery.FailureCodeOf(err); !ok ||
		code != federationdelivery.FailureInvalidArgument {
		t.Fatalf("missing recipient actor error = %v", err)
	}
}

func TestDeviceDeliverySenderDoesNotPreallocateTargetLaneSequence(t *testing.T) {
	clock := &testClock{
		now: time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC),
	}
	sender, err := conversationfederation.NewSender(
		testStationB,
		newTestKey(0x22).signer(),
		clock,
		time.Hour,
	)
	if err != nil {
		t.Fatal(err)
	}
	intent := newDeviceDeliveryIntent(t, clock.Now())
	outbox := &capturingOutbox{}
	if _, err := sender.EnqueueDeviceDelivery(
		context.Background(),
		outbox,
		intent,
	); err != nil {
		t.Fatalf("enqueue target-local delivery intent: %v", err)
	}
	frame := outbox.single(t)
	if frame.GetOrderingSequence() != 4 {
		t.Fatalf(
			"transport ordering sequence = %d, want authority event sequence 4",
			frame.GetOrderingSequence(),
		)
	}
	var wireItem chatmodel.DurableDeviceInboxItem
	if err := proto.Unmarshal(frame.GetOpaquePayload(), &wireItem); err != nil {
		t.Fatal(err)
	}
	if wireItem.GetLaneSequence() != 0 ||
		wireItem.GetState() !=
			chatmodel.DeviceInboxItemState_DEVICE_INBOX_ITEM_STATE_UNSPECIFIED {
		t.Fatalf("remote delivery carried target-local queue state: %+v", &wireItem)
	}

	receiptOutbox := &capturingOutbox{}
	if _, err := sender.EnqueueDeviceDelivery(
		context.Background(),
		receiptOutbox,
		newDeviceReceiptIntent(t, clock.Now()),
	); err != nil {
		t.Fatalf("enqueue target-local read receipt intent: %v", err)
	}
	if receiptFrame := receiptOutbox.single(t); receiptFrame.GetOrderingSequence() != 0 {
		t.Fatalf(
			"read receipt transport ordering sequence = %d, want unordered 0",
			receiptFrame.GetOrderingSequence(),
		)
	}
}

func TestDeviceDeliveryReceiverRollsBackFollowerAndInboxAsOneTransaction(
	t *testing.T,
) {
	fixture := newReceiverFixture(t, testStationA)
	fixture.enableCanonicalDeviceInbox(t)
	fixture.device.failAfterWrites = true
	intent := newDeviceDeliveryIntent(t, fixture.clock.Now())
	frame := fixture.deviceDeliveryFrame(t, intent)

	if _, err := fixture.coreReceiver.Receive(context.Background(), frame); err == nil {
		t.Fatal("device delivery failure was swallowed")
	}
	assertTableCount(t, fixture.db, &deviceApplyTestModel{}, 0)
	assertTableCount(t, fixture.db, &conversationdelivery.DeviceQueueItemModel{}, 0)
	assertTableCount(t, fixture.db, &federationdelivery.InboxRecord{}, 0)

	fixture.device.failAfterWrites = false
	result, err := fixture.coreReceiver.Receive(context.Background(), frame)
	if err != nil {
		t.Fatalf("receive device delivery: %v", err)
	}
	if result != federationdelivery.AcceptedResult() {
		t.Fatalf("device delivery result = %+v", result)
	}
	assertTableCount(t, fixture.db, &deviceApplyTestModel{}, 1)
	assertTableCount(t, fixture.db, &conversationdelivery.DeviceQueueItemModel{}, 1)
	assertTableCount(t, fixture.db, &federationdelivery.InboxRecord{}, 1)
	var queued conversationdelivery.DeviceQueueItemModel
	if err := fixture.db.First(&queued).Error; err != nil {
		t.Fatal(err)
	}
	var wireItem chatmodel.DurableDeviceInboxItem
	if err := proto.Unmarshal(frame.GetOpaquePayload(), &wireItem); err != nil {
		t.Fatal(err)
	}
	if wireItem.GetLaneSequence() != 0 || queued.LaneSequence != 1 {
		t.Fatalf(
			"source lane=%d target lane=%d, want source unset and target allocated 1",
			wireItem.GetLaneSequence(),
			queued.LaneSequence,
		)
	}

	const readers = 8
	results := make(chan federationdelivery.Result, readers)
	errs := make(chan error, readers)
	var wait sync.WaitGroup
	for index := 0; index < readers; index++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			replayed, receiveErr := fixture.coreReceiver.Receive(
				context.Background(),
				proto.Clone(frame).(*federationdelivery.Frame),
			)
			results <- replayed
			errs <- receiveErr
		}()
	}
	wait.Wait()
	close(results)
	close(errs)
	for receiveErr := range errs {
		if receiveErr != nil {
			t.Fatalf("concurrent replay: %v", receiveErr)
		}
	}
	for replayed := range results {
		if replayed != federationdelivery.DuplicateResult() {
			t.Fatalf("concurrent replay result = %+v", replayed)
		}
	}
	if fixture.device.callCount() != 2 {
		t.Fatalf("device apply calls = %d, want failed attempt plus one commit", fixture.device.callCount())
	}
	assertTableCount(t, fixture.db, &deviceApplyTestModel{}, 1)
	assertTableCount(t, fixture.db, &conversationdelivery.DeviceQueueItemModel{}, 1)
}

func TestDeviceDeliveryReceiverAcceptsRemoteMessageReceipt(t *testing.T) {
	fixture := newReceiverFixture(t, testStationA)
	fixture.enableCanonicalDeviceInbox(t)
	intent := newMessageReceiptIntent(t, fixture.clock.Now())
	frame := fixture.deviceDeliveryFrame(t, intent)

	result, err := fixture.coreReceiver.Receive(context.Background(), frame)
	if err != nil {
		t.Fatalf("receive remote message receipt: %v", err)
	}
	if result != federationdelivery.AcceptedResult() {
		t.Fatalf("remote message receipt result = %+v", result)
	}
	var item conversationdelivery.DeviceQueueItemModel
	if err := fixture.db.First(
		&item,
		"item_id = ?",
		string(intent.IntentID),
	).Error; err != nil {
		t.Fatal(err)
	}
	if item.EventID != string(intent.EventID) ||
		item.EventSequence != uint64(intent.EventSequence) ||
		item.RecipientPTID != string(intent.Recipient.Actor) ||
		item.RecipientDeviceID != string(intent.Recipient.Device) {
		t.Fatalf("remote message receipt item = %+v", item)
	}
}

func TestDeliveryReceiptReceiverBindsSourceAndPreservesReplayConflict(
	t *testing.T,
) {
	fixture := newReceiverFixture(t, testStationB)
	receipt := &chatmodel.DeviceConsumptionReceipt{
		ReceiptId:      "device-consumed:item-1",
		ConversationId: "conversation-1",
		EventId:        "event-1",
		Consumer: &chatmodel.CryptoEndpoint{
			Ptid:     testActor,
			DeviceId: testDevice,
		},
		EventSequence: 1,
		LaneSequence:  7,
		PayloadSha256: bytes.Repeat([]byte{0x44}, sha256.Size),
		ConsumedAt:    timestamppb.New(fixture.clock.Now()),
	}
	frame := fixture.deliveryReceiptFrame(t, receipt)

	first, err := fixture.coreReceiver.Receive(context.Background(), frame)
	if err != nil {
		t.Fatalf("receive delivery receipt: %v", err)
	}
	if first != federationdelivery.AcceptedResult() {
		t.Fatalf("delivery receipt result = %+v", first)
	}
	var stored deliveryReceiptApplyTestModel
	if err := fixture.db.First(&stored, "receipt_id = ?", receipt.GetReceiptId()).
		Error; err != nil {
		t.Fatal(err)
	}
	if stored.Source != testStationA {
		t.Fatalf("delivery receipt source = %q, want %q", stored.Source, testStationA)
	}

	replayed, err := fixture.coreReceiver.Receive(
		context.Background(),
		proto.Clone(frame).(*federationdelivery.Frame),
	)
	if err != nil {
		t.Fatalf("receive exact delivery receipt replay: %v", err)
	}
	if replayed != federationdelivery.DuplicateResult() {
		t.Fatalf("delivery receipt replay = %+v", replayed)
	}

	conflicting := proto.Clone(receipt).(*chatmodel.DeviceConsumptionReceipt)
	conflicting.LaneSequence++
	conflict, err := fixture.coreReceiver.Receive(
		context.Background(),
		fixture.deliveryReceiptFrame(t, conflicting),
	)
	if err != nil {
		t.Fatalf("receive delivery receipt conflict: %v", err)
	}
	if conflict != federationdelivery.PayloadHashConflictResult() {
		t.Fatalf("delivery receipt conflict = %+v", conflict)
	}

	fixture.receipt.expectedSource = testStationB
	rejected := proto.Clone(receipt).(*chatmodel.DeviceConsumptionReceipt)
	rejected.ReceiptId = "device-consumed:item-2"
	rejection, err := fixture.coreReceiver.Receive(
		context.Background(),
		fixture.deliveryReceiptFrame(t, rejected),
	)
	if err != nil {
		t.Fatalf("receive wrong-source delivery receipt: %v", err)
	}
	if rejection != federationdelivery.TerminalResult(
		federationdelivery.FrameErrorDomainRejected,
	) {
		t.Fatalf("wrong-source delivery receipt = %+v", rejection)
	}
}

func TestAuthorityResultReceiverUsesTransactionBoundPort(t *testing.T) {
	fixture := newReceiverFixture(t, testStationA)
	proposal := fixture.signedProposal(t, "command-result")
	proposal.AuthorityStationPeerId = testStationB
	proposal.HomeStationPeerId = testStationA
	fixture.persistOutgoingProposal(t, proposal)
	eventHash := sha256.Sum256([]byte("event-result"))
	result := &chatmodel.ConversationCommandProposalResult{
		CommandId: proposal.GetCommand().GetCommandId(),
		Accepted:  true,
		Event: &chatmodel.ConversationEvent{
			EventId:                "event-result",
			ConversationId:         proposal.GetCommand().GetConversationId(),
			Sequence:               7,
			CommandId:              proposal.GetCommand().GetCommandId(),
			MembershipEpoch:        3,
			AuthorityStationPeerId: testStationB,
			CommittedAt:            timestamppb.New(fixture.clock.Now()),
			EventHash:              eventHash[:],
		},
		AuthoritySequence:  7,
		AuthorityEventHash: eventHash[:],
	}
	sender, err := conversationfederation.NewSender(
		testStationB,
		fixture.stationKeys[testStationB].signer(),
		fixture.clock,
		24*time.Hour,
	)
	if err != nil {
		t.Fatal(err)
	}
	outbox := &capturingOutbox{}
	if _, err := sender.EnqueueAuthorityResult(
		context.Background(),
		outbox,
		proposal,
		result,
	); err != nil {
		t.Fatal(err)
	}
	frame := outbox.single(t)

	received, err := fixture.coreReceiver.Receive(context.Background(), frame)
	if err != nil {
		t.Fatalf("receive authority result: %v", err)
	}
	if received != federationdelivery.AcceptedResult() {
		t.Fatalf("authority result receive = %+v", received)
	}
	replayed, err := fixture.coreReceiver.Receive(
		context.Background(),
		proto.Clone(frame).(*federationdelivery.Frame),
	)
	if err != nil {
		t.Fatalf("replay authority result: %v", err)
	}
	if replayed != federationdelivery.DuplicateResult() {
		t.Fatalf("authority result replay = %+v", replayed)
	}
	assertTableCount(t, fixture.db, &authorityResultTestModel{}, 1)
}

func TestAuthorityResultReceiverRejectsUnboundLegacyFrameIdentity(t *testing.T) {
	fixture := newReceiverFixture(t, testStationA)
	proposal := fixture.signedProposal(t, "command-result-unbound")
	fixture.persistOutgoingProposal(t, proposal)
	frame := fixture.authorityResultFrame(
		t,
		proposal,
		acceptedCommandResult(
			proposal,
			testStationB,
			fixture.clock.Now(),
		),
	)
	frame.FrameId = "unbound-authority-result-frame"
	frame.IdempotencyKey = "unbound-authority-result-idempotency"
	frame.PayloadId = proposal.GetCommand().GetCommandId()
	if err := federationdelivery.SignFrame(
		context.Background(),
		frame,
		federationdelivery.DefaultFramePolicy(testStationA),
		fixture.stationKeys[testStationB].signer(),
	); err != nil {
		t.Fatal(err)
	}

	received, err := fixture.coreReceiver.Receive(context.Background(), frame)
	if err != nil {
		t.Fatalf("receive unbound authority result: %v", err)
	}
	if received != federationdelivery.TerminalResult(federationdelivery.FrameErrorInvalidFrame) {
		t.Fatalf("unbound authority result disposition = %+v", received)
	}
	fixture.assertOutgoingProposalUnresolved(t, proposal)
	assertTableCount(t, fixture.db, &federationdelivery.InboxRecord{}, 1)
}

func TestAuthorityResultReceiverRejectsConflictBeforeBoundAcceptedResult(
	t *testing.T,
) {
	fixture := newReceiverFixture(t, testStationA)
	acceptedProposal := fixture.signedProposal(t, "command-result-reverse")
	conflictingProposal := proto.Clone(acceptedProposal).(*chatmodel.ConversationCommandProposal)
	conflictingProposal.GetCommand().GetSendMessage().ContentKind =
		chatmodel.MessagingContentKind_MESSAGING_CONTENT_KIND_IMAGE
	fixture.signProposal(t, conflictingProposal)
	fixture.persistOutgoingProposal(t, acceptedProposal)

	conflictFrame := fixture.authorityResultFrame(
		t,
		conflictingProposal,
		commandConflictResult(conflictingProposal.GetCommand().GetCommandId()),
	)
	mismatched, err := fixture.coreReceiver.Receive(
		context.Background(),
		conflictFrame,
	)
	if err != nil {
		t.Fatalf("receive mismatched conflict result: %v", err)
	}
	if mismatched != federationdelivery.PayloadHashConflictResult() {
		t.Fatalf("mismatched conflict result disposition = %+v", mismatched)
	}
	fixture.assertOutgoingProposalUnresolved(t, acceptedProposal)
	assertTableCount(t, fixture.db, &federationdelivery.InboxRecord{}, 1)

	acceptedResult := acceptedCommandResult(
		acceptedProposal,
		testStationB,
		fixture.clock.Now(),
	)
	acceptedFrame := fixture.authorityResultFrame(
		t,
		acceptedProposal,
		acceptedResult,
	)
	received, err := fixture.coreReceiver.Receive(
		context.Background(),
		acceptedFrame,
	)
	if err != nil {
		t.Fatalf("receive hash-bound accepted result: %v", err)
	}
	if received != federationdelivery.AcceptedResult() {
		t.Fatalf("hash-bound accepted result disposition = %+v", received)
	}
	fixture.assertOutgoingProposalResolved(t, acceptedProposal, acceptedResult)
	assertTableCount(t, fixture.db, &federationdelivery.InboxRecord{}, 2)
}

func TestAuthorityResultReceiverRejectsAcceptedBeforeBoundConflictResult(
	t *testing.T,
) {
	fixture := newReceiverFixture(t, testStationA)
	acceptedProposal := fixture.signedProposal(t, "command-result-hash-mismatch")
	conflictingProposal := proto.Clone(acceptedProposal).(*chatmodel.ConversationCommandProposal)
	conflictingProposal.GetCommand().GetSendMessage().ContentKind =
		chatmodel.MessagingContentKind_MESSAGING_CONTENT_KIND_IMAGE
	fixture.signProposal(t, conflictingProposal)
	fixture.persistOutgoingProposal(t, conflictingProposal)

	acceptedFrame := fixture.authorityResultFrame(
		t,
		acceptedProposal,
		acceptedCommandResult(
			acceptedProposal,
			testStationB,
			fixture.clock.Now(),
		),
	)
	mismatched, err := fixture.coreReceiver.Receive(
		context.Background(),
		acceptedFrame,
	)
	if err != nil {
		t.Fatalf("receive mismatched accepted result: %v", err)
	}
	if mismatched != federationdelivery.PayloadHashConflictResult() {
		t.Fatalf("mismatched accepted result disposition = %+v", mismatched)
	}
	fixture.assertOutgoingProposalUnresolved(t, conflictingProposal)
	assertTableCount(t, fixture.db, &federationdelivery.InboxRecord{}, 1)

	conflictResult := commandConflictResult(
		conflictingProposal.GetCommand().GetCommandId(),
	)
	conflictFrame := fixture.authorityResultFrame(
		t,
		conflictingProposal,
		conflictResult,
	)
	received, err := fixture.coreReceiver.Receive(
		context.Background(),
		conflictFrame,
	)
	if err != nil {
		t.Fatalf("receive hash-bound command conflict: %v", err)
	}
	if received != federationdelivery.AcceptedResult() {
		t.Fatalf("hash-bound command conflict disposition = %+v", received)
	}
	fixture.assertOutgoingProposalResolved(t, conflictingProposal, conflictResult)
	assertTableCount(t, fixture.db, &federationdelivery.InboxRecord{}, 2)
}

type receiverFixture struct {
	db           *gorm.DB
	clock        *testClock
	localStation string
	stationKeys  map[string]testKey
	actorKeys    *recordingActorKeyProjection
	authority    *transactionalAuthorityPort
	result       *transactionalResultPort
	device       *transactionalDevicePort
	receipt      *transactionalDeliveryReceiptPort
	coreReceiver *federationdelivery.DeliveryReceiver
}

func newReceiverFixture(t *testing.T, localStation string) *receiverFixture {
	t.Helper()
	db := openSQLite(t)
	clock := &testClock{
		now: time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC),
	}
	stationKeys := map[string]testKey{
		testStationA: newTestKey(0x11),
		testStationB: newTestKey(0x22),
	}
	actorKey := newTestKey(0x33)
	actorKeys := &recordingActorKeyProjection{
		key: &actormodel.VerifiedActorDeviceSigningKey{
			ActorPtid:          testActor,
			ActorDeviceId:      testDevice,
			HomeStationPeerId:  testStationA,
			SigningKeyId:       actorKey.id,
			Ed25519PublicKey:   append([]byte(nil), actorKey.public...),
			ProfileVersion:     1,
			VerificationSource: actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE,
			ValidFromUnixMs:    clock.Now().Add(-time.Hour).UnixMilli(),
		},
	}
	authority := &transactionalAuthorityPort{
		localStation: localStation,
		clock:        clock,
	}
	resultPort := &transactionalResultPort{}
	devicePort := &transactionalDevicePort{}
	receiptPort := &transactionalDeliveryReceiptPort{}
	if err := db.AutoMigrate(
		&authorityReceiptTestModel{},
		&authorityResultTestModel{},
		&deviceApplyTestModel{},
		&deliveryReceiptApplyTestModel{},
	); err != nil {
		t.Fatal(err)
	}
	deliveryRepository, err := federationdelivery.NewGORMRepository(db, clock)
	if err != nil {
		t.Fatal(err)
	}
	if err := deliveryRepository.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	sender, err := conversationfederation.NewSender(
		localStation,
		stationKeys[localStation].signer(),
		clock,
		24*time.Hour,
	)
	if err != nil {
		t.Fatal(err)
	}
	adapter, err := conversationfederation.NewReceiver(
		conversationfederation.ReceiverConfig{
			LocalStationPeerID: localStation,
			ActorKeys:          actorKeys,
			Federation:         activeFederationProjection{},
			AuthorityCommands:  authority,
			AuthorityResults:   resultPort,
			DeviceDeliveries:   devicePort,
			DeliveryReceipts:   receiptPort,
			Sender:             sender,
			Clock:              clock,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	registry := federationdelivery.NewRegistry()
	if err := conversationfederation.RegisterReceivers(registry, adapter); err != nil {
		t.Fatal(err)
	}
	coreReceiver, err := federationdelivery.NewReceiver(
		federationdelivery.ReceiverConfig{
			Policy:     federationdelivery.DefaultFramePolicy(localStation),
			Verifier:   stationKeyring(stationKeys),
			Registry:   registry,
			UnitOfWork: deliveryRepository,
			Clock:      clock,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	return &receiverFixture{
		db:           db,
		clock:        clock,
		localStation: localStation,
		stationKeys:  stationKeys,
		actorKeys:    actorKeys,
		authority:    authority,
		result:       resultPort,
		device:       devicePort,
		receipt:      receiptPort,
		coreReceiver: coreReceiver,
	}
}

func (f *receiverFixture) enableCanonicalDeviceInbox(t *testing.T) {
	t.Helper()
	repository, err := conversationdelivery.NewRepository(
		f.db,
		deliveryapplication.QueueLimits{
			MaxUnackedItems: 100,
			MaxUnackedBytes: 1024 * 1024,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	if err := f.db.AutoMigrate(&actoridentitypersistence.ActorDeviceModel{}); err != nil {
		t.Fatal(err)
	}
	if err := f.db.Create(&actoridentitypersistence.ActorDeviceModel{
		PTID:               testActor,
		ActorAccount:       "alice@example.test",
		ActorKind:          1,
		DeviceID:           testDevice,
		Label:              "Alice Device",
		HomeStationPeerID:  f.localStation,
		SigningKeyID:       "alice-signing-key",
		PublicKey:          make([]byte, ed25519.PublicKeySize),
		ProfileVersion:     1,
		VerificationSource: 1,
		CreatedAt:          f.clock.Now(),
	}).Error; err != nil {
		t.Fatal(err)
	}
	f.device.canonical = true
}

func (f *receiverFixture) signedProposal(
	t *testing.T,
	commandID string,
) *chatmodel.ConversationCommandProposal {
	t.Helper()
	createdAt := f.clock.Now().Add(-time.Minute)
	command := &chatmodel.ChatCommand{
		CommandId:               commandID,
		ConversationId:          "conversation-1",
		Sender:                  &chatmodel.CryptoEndpoint{Ptid: testActor, DeviceId: testDevice},
		ObservedMembershipEpoch: 1,
		ClientTimestamp:         timestamppb.New(createdAt),
		AuthorityStationPeerId:  testStationB,
		Payload: &chatmodel.ChatCommand_SendMessage{
			SendMessage: &chatmodel.SendMessageIntent{
				ContentKind: chatmodel.MessagingContentKind_MESSAGING_CONTENT_KIND_TEXT,
			},
		},
	}
	proposal := &chatmodel.ConversationCommandProposal{
		Version:                1,
		FederationId:           "federation-1",
		AuthorityStationPeerId: testStationB,
		AuthorityEpoch:         1,
		HomeStationPeerId:      testStationA,
		ActorPtid:              testActor,
		ActorDeviceId:          testDevice,
		ActorSigningKeyId:      f.actorKeys.keyCopy().GetSigningKeyId(),
		Command:                command,
		CreatedAtUnixMs:        createdAt.UnixMilli(),
		ExpiresAtUnixMs:        createdAt.Add(5 * time.Minute).UnixMilli(),
	}
	f.signProposal(t, proposal)
	return proposal
}

func (f *receiverFixture) signProposal(
	t *testing.T,
	proposal *chatmodel.ConversationCommandProposal,
) {
	t.Helper()
	commandBytes := mustMarshal(t, proposal.GetCommand())
	proposal.CommandSha256 = federationdelivery.PayloadSHA256(commandBytes)
	signingInput := &chatmodel.ConversationCommandProposalSigningInput{
		Version:                proposal.GetVersion(),
		FederationId:           proposal.GetFederationId(),
		AuthorityStationPeerId: proposal.GetAuthorityStationPeerId(),
		AuthorityEpoch:         proposal.GetAuthorityEpoch(),
		HomeStationPeerId:      proposal.GetHomeStationPeerId(),
		ConversationId:         proposal.GetCommand().GetConversationId(),
		CommandId:              proposal.GetCommand().GetCommandId(),
		CommandKind:            chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_SEND_MESSAGE,
		ActorPtid:              proposal.GetActorPtid(),
		ActorDeviceId:          proposal.GetActorDeviceId(),
		ActorSigningKeyId:      proposal.GetActorSigningKeyId(),
		CommandSha256:          append([]byte(nil), proposal.GetCommandSha256()...),
		CreatedAtUnixMs:        proposal.GetCreatedAtUnixMs(),
		ExpiresAtUnixMs:        proposal.GetExpiresAtUnixMs(),
	}
	proposal.ActorSignature = ed25519.Sign(
		newTestKey(0x33).private,
		mustMarshal(t, signingInput),
	)
}

func (f *receiverFixture) authorityCommandFrame(
	t *testing.T,
	proposal *chatmodel.ConversationCommandProposal,
	orderingSequence int64,
) *federationdelivery.Frame {
	t.Helper()
	sender, err := conversationfederation.NewSender(
		testStationA,
		f.stationKeys[testStationA].signer(),
		f.clock,
		24*time.Hour,
	)
	if err != nil {
		t.Fatal(err)
	}
	outbox := &capturingOutbox{}
	if _, err := sender.EnqueueAuthorityCommand(
		context.Background(),
		outbox,
		proposal,
		orderingSequence,
	); err != nil {
		t.Fatal(err)
	}
	return outbox.single(t)
}

func (f *receiverFixture) authorityResultFrame(
	t *testing.T,
	proposal *chatmodel.ConversationCommandProposal,
	result *chatmodel.ConversationCommandProposalResult,
) *federationdelivery.Frame {
	t.Helper()
	sender, err := conversationfederation.NewSender(
		testStationB,
		f.stationKeys[testStationB].signer(),
		f.clock,
		24*time.Hour,
	)
	if err != nil {
		t.Fatal(err)
	}
	outbox := &capturingOutbox{}
	if _, err := sender.EnqueueAuthorityResult(
		context.Background(),
		outbox,
		proposal,
		result,
	); err != nil {
		t.Fatal(err)
	}
	return outbox.single(t)
}

func (f *receiverFixture) persistOutgoingProposal(
	t *testing.T,
	proposal *chatmodel.ConversationCommandProposal,
) {
	t.Helper()
	if err := f.db.Create(&authorityResultTestModel{
		ConversationID:   proposal.GetCommand().GetConversationId(),
		CommandID:        proposal.GetCommand().GetCommandId(),
		CommandSHA256:    append([]byte(nil), proposal.GetCommandSha256()...),
		AuthorityStation: proposal.GetAuthorityStationPeerId(),
	}).Error; err != nil {
		t.Fatal(err)
	}
}

func (f *receiverFixture) assertOutgoingProposalUnresolved(
	t *testing.T,
	proposal *chatmodel.ConversationCommandProposal,
) {
	t.Helper()
	stored := f.loadOutgoingProposal(t, proposal)
	if len(stored.ResultBytes) != 0 {
		t.Fatalf("mismatched result resolved outgoing proposal: %+v", stored)
	}
}

func (f *receiverFixture) assertOutgoingProposalResolved(
	t *testing.T,
	proposal *chatmodel.ConversationCommandProposal,
	expected *chatmodel.ConversationCommandProposalResult,
) {
	t.Helper()
	stored := f.loadOutgoingProposal(t, proposal)
	delivery := &chatmodel.ConversationCommandResultDelivery{}
	if err := proto.Unmarshal(stored.ResultBytes, delivery); err != nil {
		t.Fatalf("decode stored authority result: %v", err)
	}
	if !proto.Equal(delivery.GetResult(), expected) {
		t.Fatalf(
			"stored authority result = %+v, want %+v",
			delivery.GetResult(),
			expected,
		)
	}
}

func (f *receiverFixture) loadOutgoingProposal(
	t *testing.T,
	proposal *chatmodel.ConversationCommandProposal,
) authorityResultTestModel {
	t.Helper()
	var stored authorityResultTestModel
	if err := f.db.Where(
		"conversation_id = ? AND command_id = ?",
		proposal.GetCommand().GetConversationId(),
		proposal.GetCommand().GetCommandId(),
	).First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	return stored
}

func (f *receiverFixture) deviceDeliveryFrame(
	t *testing.T,
	intent conversationports.FederationOutboxIntent,
) *federationdelivery.Frame {
	t.Helper()
	sender, err := conversationfederation.NewSender(
		testStationB,
		f.stationKeys[testStationB].signer(),
		f.clock,
		24*time.Hour,
	)
	if err != nil {
		t.Fatal(err)
	}
	outbox := &capturingOutbox{}
	if _, err := sender.EnqueueDeviceDelivery(
		context.Background(),
		outbox,
		intent,
	); err != nil {
		t.Fatal(err)
	}
	return outbox.single(t)
}

func (f *receiverFixture) deliveryReceiptFrame(
	t *testing.T,
	receipt *chatmodel.DeviceConsumptionReceipt,
) *federationdelivery.Frame {
	t.Helper()
	sender, err := conversationfederation.NewSender(
		testStationA,
		f.stationKeys[testStationA].signer(),
		f.clock,
		24*time.Hour,
	)
	if err != nil {
		t.Fatal(err)
	}
	outbox := &capturingOutbox{}
	if _, err := sender.EnqueueDeliveryReceipt(
		context.Background(),
		outbox,
		testStationB,
		receipt,
	); err != nil {
		t.Fatal(err)
	}

	return outbox.single(t)
}

type testClock struct {
	mu  sync.RWMutex
	now time.Time
}

func (c *testClock) Now() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.now
}

func (c *testClock) Advance(duration time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(duration)
}

type testKey struct {
	id      string
	public  ed25519.PublicKey
	private ed25519.PrivateKey
}

func newTestKey(seed byte) testKey {
	privateKey := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{seed}, ed25519.SeedSize))
	publicKey := privateKey.Public().(ed25519.PublicKey)
	digest := sha256.Sum256(publicKey)
	return testKey{
		id:      hex.EncodeToString(digest[:]),
		public:  publicKey,
		private: privateKey,
	}
}

func (k testKey) signer() stationSigner {
	return stationSigner{id: k.id, private: k.private}
}

type stationSigner struct {
	id      string
	private ed25519.PrivateKey
}

func (s stationSigner) KeyID() string {
	return s.id
}

func (s stationSigner) Sign(
	_ context.Context,
	canonical []byte,
) ([]byte, error) {
	return ed25519.Sign(s.private, canonical), nil
}

type stationKeyring map[string]testKey

func (k stationKeyring) Verify(
	_ context.Context,
	sourceStationPeerID string,
	signingKeyID string,
	canonical []byte,
	signature []byte,
) error {
	key, ok := k[sourceStationPeerID]
	if !ok ||
		key.id != signingKeyID ||
		!ed25519.Verify(key.public, canonical, signature) {
		return errors.New("Station signing identity is invalid")
	}
	return nil
}

type recordingActorKeyProjection struct {
	mu    sync.RWMutex
	key   *actormodel.VerifiedActorDeviceSigningKey
	calls int
}

func (p *recordingActorKeyProjection) ResolveVerifiedActorDeviceSigningKey(
	_ context.Context,
	transaction federationdelivery.Transaction,
	actorPTID string,
	expectedHomeStationPeerID string,
	deviceID string,
	signingKeyID string,
) (*actormodel.VerifiedActorDeviceSigningKey, error) {
	if transaction == nil || transaction.DB() == nil {
		return nil, errors.New("transaction is required")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.calls++
	if p.key.GetActorPtid() != actorPTID ||
		p.key.GetHomeStationPeerId() != expectedHomeStationPeerID ||
		p.key.GetActorDeviceId() != deviceID ||
		p.key.GetSigningKeyId() != signingKeyID {
		return nil, nil
	}
	return proto.Clone(p.key).(*actormodel.VerifiedActorDeviceSigningKey), nil
}

func (p *recordingActorKeyProjection) setRevokedAt(at time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.key.RevokedAtUnixMs = at.UnixMilli()
}

func (p *recordingActorKeyProjection) setVerificationSource(
	source actormodel.ActorSigningKeyVerificationSource,
) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.key.VerificationSource = source
}

func (p *recordingActorKeyProjection) callCount() int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.calls
}

func (p *recordingActorKeyProjection) keyCopy() *actormodel.VerifiedActorDeviceSigningKey {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return proto.Clone(p.key).(*actormodel.VerifiedActorDeviceSigningKey)
}

type activeFederationProjection struct{}

func (activeFederationProjection) IsActiveStation(
	_ context.Context,
	transaction federationdelivery.Transaction,
	_ string,
	_ string,
) (bool, error) {
	return transaction != nil && transaction.DB() != nil, nil
}

type authorityReceiptTestModel struct {
	CommandID   string `gorm:"column:command_id;primaryKey"`
	CommandHash []byte `gorm:"column:command_hash;type:blob;not null"`
	ResultBytes []byte `gorm:"column:result_bytes;type:blob;not null"`
}

func (*authorityReceiptTestModel) TableName() string {
	return "test_conversation_authority_receipts"
}

type transactionalAuthorityPort struct {
	mu                sync.Mutex
	localStation      string
	clock             *testClock
	calls             int
	retryableAttempts int
	sources           []string
}

func (p *transactionalAuthorityPort) ApplyAuthorityCommand(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	command conversationfederation.VerifiedAuthorityCommand,
) (conversationfederation.AuthorityCommandOutcome, error) {
	p.mu.Lock()
	p.calls++
	p.sources = append(p.sources, command.SourceHomeStation)
	if p.retryableAttempts > 0 {
		p.retryableAttempts--
		p.mu.Unlock()
		return conversationfederation.AuthorityCommandOutcome{
			Result: &chatmodel.ConversationCommandProposalResult{
				CommandId:  command.Proposal.GetCommand().GetCommandId(),
				RejectCode: chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_ACTOR_KEY_UNAVAILABLE,
				Retryable:  true,
			},
		}, nil
	}
	p.mu.Unlock()

	var existing authorityReceiptTestModel
	err := transaction.DB().WithContext(ctx).
		Where("command_id = ?", command.Proposal.GetCommand().GetCommandId()).
		First(&existing).Error
	if err == nil {
		if !bytes.Equal(existing.CommandHash, command.Proposal.GetCommandSha256()) {
			return conversationfederation.AuthorityCommandOutcome{
				Result: &chatmodel.ConversationCommandProposalResult{
					CommandId:  command.Proposal.GetCommand().GetCommandId(),
					RejectCode: chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_COMMAND_CONFLICT,
				},
			}, nil
		}
		result := &chatmodel.ConversationCommandProposalResult{}
		if err := proto.Unmarshal(existing.ResultBytes, result); err != nil {
			return conversationfederation.AuthorityCommandOutcome{}, err
		}
		return conversationfederation.AuthorityCommandOutcome{
			Result: result,
			Replay: true,
		}, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return conversationfederation.AuthorityCommandOutcome{}, err
	}
	if command.KeyCurrentlyRevoked {
		return conversationfederation.AuthorityCommandOutcome{
			Result: &chatmodel.ConversationCommandProposalResult{
				CommandId:  command.Proposal.GetCommand().GetCommandId(),
				RejectCode: chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_ACTOR_KEY_REVOKED,
			},
		}, nil
	}
	eventHash := sha256.Sum256(command.CanonicalCommandBytes)
	result := &chatmodel.ConversationCommandProposalResult{
		CommandId: command.Proposal.GetCommand().GetCommandId(),
		Accepted:  true,
		Event: &chatmodel.ConversationEvent{
			EventId:                "event-" + command.Proposal.GetCommand().GetCommandId(),
			ConversationId:         command.Proposal.GetCommand().GetConversationId(),
			Sequence:               1,
			CommandId:              command.Proposal.GetCommand().GetCommandId(),
			MembershipEpoch:        command.Proposal.GetCommand().GetObservedMembershipEpoch(),
			AuthorityStationPeerId: p.localStation,
			CommittedAt:            timestamppb.New(p.clock.Now()),
			EventHash:              eventHash[:],
		},
		AuthoritySequence:  1,
		AuthorityEventHash: eventHash[:],
	}
	resultBytes := mustMarshalWithoutTest(result)
	if err := transaction.DB().WithContext(ctx).Create(&authorityReceiptTestModel{
		CommandID:   command.Proposal.GetCommand().GetCommandId(),
		CommandHash: append([]byte(nil), command.Proposal.GetCommandSha256()...),
		ResultBytes: resultBytes,
	}).Error; err != nil {
		return conversationfederation.AuthorityCommandOutcome{}, err
	}
	return conversationfederation.AuthorityCommandOutcome{Result: result}, nil
}

func (p *transactionalAuthorityPort) callCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.calls
}

func (p *transactionalAuthorityPort) sourceHomeStations() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.sources...)
}

func (p *transactionalAuthorityPort) setRetryableAttempts(attempts int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.retryableAttempts = attempts
}

type authorityResultTestModel struct {
	ConversationID   string `gorm:"column:conversation_id;primaryKey"`
	CommandID        string `gorm:"column:command_id;primaryKey"`
	CommandSHA256    []byte `gorm:"column:command_sha256;type:blob;not null"`
	AuthorityStation string `gorm:"column:authority_station_peer_id;not null"`
	ResultBytes      []byte `gorm:"column:result_bytes;type:blob"`
}

func (*authorityResultTestModel) TableName() string {
	return "test_conversation_authority_results"
}

type transactionalResultPort struct{}

func (*transactionalResultPort) ApplyAuthorityResult(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	result *chatmodel.ConversationCommandResultDelivery,
	originatingCommandSHA256 []byte,
	sourceAuthorityStationPeerID string,
) (bool, error) {
	if len(originatingCommandSHA256) != sha256.Size {
		return false, errors.New("originating command hash is invalid")
	}
	resultBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(result)
	if err != nil {
		return false, err
	}
	var proposal authorityResultTestModel
	if err := transaction.DB().WithContext(ctx).
		Where(
			"conversation_id = ? AND command_id = ?",
			result.GetConversationId(),
			result.GetCommandId(),
		).
		First(&proposal).Error; err != nil {
		return false, err
	}
	if proposal.AuthorityStation != sourceAuthorityStationPeerID {
		return false, errors.New("authority result source does not match persisted outgoing proposal")
	}
	if !bytes.Equal(proposal.CommandSHA256, originatingCommandSHA256) {
		return false, conversationfederation.ErrAuthorityResultCommandHashMismatch
	}
	if len(proposal.ResultBytes) > 0 {
		if bytes.Equal(proposal.ResultBytes, resultBytes) {
			return true, nil
		}
		return false, errors.New("authority result conflict")
	}
	update := transaction.DB().WithContext(ctx).
		Model(&authorityResultTestModel{}).
		Where(
			"conversation_id = ? AND command_id = ? AND result_bytes IS NULL",
			result.GetConversationId(),
			result.GetCommandId(),
		).
		Update("result_bytes", resultBytes)
	if update.Error != nil {
		return false, update.Error
	}
	if update.RowsAffected == 1 {
		return false, nil
	}
	var existing authorityResultTestModel
	if err := transaction.DB().WithContext(ctx).
		Where(
			"conversation_id = ? AND command_id = ?",
			result.GetConversationId(),
			result.GetCommandId(),
		).
		First(&existing).Error; err != nil {
		return false, err
	}
	if !bytes.Equal(existing.CommandSHA256, originatingCommandSHA256) {
		return false, conversationfederation.ErrAuthorityResultCommandHashMismatch
	}
	if !bytes.Equal(existing.ResultBytes, resultBytes) {
		return false, errors.New("authority result conflict")
	}
	return true, nil
}

type deviceApplyTestModel struct {
	Kind string `gorm:"column:kind;primaryKey"`
	ID   string `gorm:"column:id;primaryKey"`
}

func (*deviceApplyTestModel) TableName() string {
	return "test_conversation_device_apply"
}

type deliveryReceiptApplyTestModel struct {
	ReceiptID   string `gorm:"column:receipt_id;primaryKey"`
	Source      string `gorm:"column:source_station;not null"`
	PayloadHash []byte `gorm:"column:payload_hash;type:blob;not null"`
}

func (*deliveryReceiptApplyTestModel) TableName() string {
	return "test_conversation_delivery_receipt_apply"
}

type transactionalDeliveryReceiptPort struct {
	expectedSource string
}

func (p *transactionalDeliveryReceiptPort) ApplyDeliveryReceipt(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	receipt *chatmodel.DeviceConsumptionReceipt,
	sourceHomeStationPeerID string,
) (bool, error) {
	expectedSource := p.expectedSource
	if expectedSource == "" {
		expectedSource = testStationA
	}
	if sourceHomeStationPeerID != expectedSource {
		return false, conversationfederation.ErrDeliveryReceiptRejected
	}
	payload := mustMarshalWithoutTest(receipt)
	payloadHash := federationdelivery.PayloadSHA256(payload)
	var existing deliveryReceiptApplyTestModel
	err := transaction.DB().WithContext(ctx).
		Where("receipt_id = ?", receipt.GetReceiptId()).
		First(&existing).Error
	if err == nil {
		if existing.Source != sourceHomeStationPeerID ||
			!bytes.Equal(existing.PayloadHash, payloadHash) {
			return false, conversationfederation.ErrDeliveryReceiptConflict
		}

		return true, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return false, err
	}
	if err := transaction.DB().WithContext(ctx).
		Create(&deliveryReceiptApplyTestModel{
			ReceiptID:   receipt.GetReceiptId(),
			Source:      sourceHomeStationPeerID,
			PayloadHash: payloadHash,
		}).Error; err != nil {
		return false, err
	}

	return false, nil
}

type transactionalDevicePort struct {
	mu              sync.Mutex
	calls           int
	failAfterWrites bool
	canonical       bool
}

func (p *transactionalDevicePort) ApplyDeviceDelivery(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	intent conversationports.DeviceInboxIntent,
	_ string,
) (bool, error) {
	p.mu.Lock()
	p.calls++
	fail := p.failAfterWrites
	canonical := p.canonical
	p.mu.Unlock()

	if err := transaction.DB().WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&deviceApplyTestModel{
			Kind: "follower",
			ID:   string(intent.EventID),
		}).Error; err != nil {
		return false, err
	}
	if !canonical {
		return false, errors.New("canonical Device Inbox writer is not configured")
	}
	repository, err := conversationdelivery.NewRepository(
		transaction.DB(),
		deliveryapplication.QueueLimits{
			MaxUnackedItems: 100,
			MaxUnackedBytes: 1024 * 1024,
		},
	)
	if err != nil {
		return false, err
	}
	writer, err := conversationdelivery.NewWriter(repository)
	if err != nil {
		return false, err
	}
	if err := writer.Enqueue(ctx, intent); err != nil {
		return false, err
	}
	if fail {
		return false, errors.New("injected follower apply failure")
	}
	return false, nil
}

func (p *transactionalDevicePort) callCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.calls
}

type capturingOutbox struct {
	mu     sync.Mutex
	frames []*federationdelivery.Frame
}

func (o *capturingOutbox) Enqueue(
	_ context.Context,
	frame *federationdelivery.Frame,
	_ time.Time,
) (federationdelivery.EnqueueResult, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.frames = append(
		o.frames,
		proto.Clone(frame).(*federationdelivery.Frame),
	)
	return federationdelivery.EnqueueResult{}, nil
}

func (o *capturingOutbox) single(t *testing.T) *federationdelivery.Frame {
	t.Helper()
	o.mu.Lock()
	defer o.mu.Unlock()
	if len(o.frames) != 1 {
		t.Fatalf("captured frames = %d, want 1", len(o.frames))
	}
	return proto.Clone(o.frames[0]).(*federationdelivery.Frame)
}

func acceptedCommandResult(
	proposal *chatmodel.ConversationCommandProposal,
	authorityStationPeerID string,
	committedAt time.Time,
) *chatmodel.ConversationCommandProposalResult {
	eventHash := sha256.Sum256(
		append(
			[]byte("accepted-authority-result:"),
			proposal.GetCommandSha256()...,
		),
	)
	return &chatmodel.ConversationCommandProposalResult{
		CommandId: proposal.GetCommand().GetCommandId(),
		Accepted:  true,
		Event: &chatmodel.ConversationEvent{
			EventId:                "event-" + hex.EncodeToString(eventHash[:8]),
			ConversationId:         proposal.GetCommand().GetConversationId(),
			Sequence:               7,
			CommandId:              proposal.GetCommand().GetCommandId(),
			MembershipEpoch:        3,
			AuthorityStationPeerId: authorityStationPeerID,
			CommittedAt:            timestamppb.New(committedAt),
			EventHash:              eventHash[:],
		},
		AuthoritySequence:  7,
		AuthorityEventHash: eventHash[:],
	}
}

func commandConflictResult(
	commandID string,
) *chatmodel.ConversationCommandProposalResult {
	return &chatmodel.ConversationCommandProposalResult{
		CommandId:  commandID,
		RejectCode: chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_COMMAND_CONFLICT,
	}
}

func newDeviceDeliveryIntent(
	t *testing.T,
	now time.Time,
) conversationports.FederationOutboxIntent {
	t.Helper()
	eventHash := sha256.Sum256([]byte("device-event"))
	endpointPayload := []byte("opaque-ciphertext")
	endpointPayloadHash := sha256.Sum256(endpointPayload)
	eventDelivery := &chatmodel.DeviceEventDelivery{
		Event: &chatmodel.ConversationEvent{
			EventId:                "event-device",
			ConversationId:         "conversation-device",
			Sequence:               4,
			EventHash:              eventHash[:],
			CommittedAt:            timestamppb.New(now),
			AuthorityStationPeerId: testStationB,
		},
		Recipient: &chatmodel.CryptoEndpoint{
			Ptid:     testActor,
			DeviceId: testDevice,
		},
		PayloadKind:           chatmodel.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_DIRECT_CIPHERTEXT,
		EndpointPayload:       endpointPayload,
		EndpointPayloadSha256: endpointPayloadHash[:],
		DeliveryCommitment:    eventHash[:],
		SenderActorIdentityPublicKey: bytes.Repeat(
			[]byte{0x44},
			ed25519.PublicKeySize,
		),
	}
	opaque := mustMarshal(t, eventDelivery)
	return conversationports.FederationOutboxIntent{
		IntentID:       "item-device",
		ConversationID: valueobject.ConversationID(eventDelivery.GetEvent().GetConversationId()),
		EventID:        valueobject.EventID(eventDelivery.GetEvent().GetEventId()),
		EventSequence:  valueobject.Sequence(eventDelivery.GetEvent().GetSequence()),
		Recipient: valueobject.Endpoint{
			Actor:  testActor,
			Device: testDevice,
		},
		TargetStation: testStationA,
		IdempotencyKey: valueobject.HashBytes(
			[]byte("device-idempotency"),
		).String(),
		PayloadKind:   conversationports.DeviceInboxPayloadConversationEvent,
		OpaquePayload: opaque,
		PayloadHash:   valueobject.HashBytes(opaque),
		CreatedAt:     now,
	}
}

func newDeviceReceiptIntent(
	t *testing.T,
	now time.Time,
) conversationports.FederationOutboxIntent {
	t.Helper()
	cursor := &chatmodel.ActorReadCursor{
		ConversationId:   "conversation-device",
		ReaderPtid:       testActor,
		LastReadSequence: 4,
		UpdatedAt:        timestamppb.New(now),
	}
	opaque := mustMarshal(t, cursor)
	eventID := valueobject.HashBytes(opaque).String()
	return conversationports.FederationOutboxIntent{
		IntentID:       valueobject.HashBytes([]byte("receipt-item")).String(),
		ConversationID: "conversation-device",
		EventID:        valueobject.EventID(eventID),
		EventSequence:  4,
		Recipient: valueobject.Endpoint{
			Actor:  "ptid:p:bob",
			Device: "bob-device",
		},
		TargetStation:  testStationA,
		IdempotencyKey: valueobject.HashBytes([]byte("receipt-idempotency")).String(),
		PayloadKind:    conversationports.DeviceInboxPayloadDeviceReceipt,
		OpaquePayload:  opaque,
		PayloadHash:    valueobject.HashBytes(opaque),
		CreatedAt:      now,
	}
}

func newMessageReceiptIntent(
	t *testing.T,
	now time.Time,
) conversationports.FederationOutboxIntent {
	t.Helper()
	receipt := &chatmodel.MessageReceipt{
		ConversationId: "conversation-1",
		MessageId:      "message-4",
		Ptid:           "ptid:p:bob",
		DeviceId:       "bob-device",
		ReceiptType:    chatmodel.ReceiptType_RECEIPT_TYPE_DELIVERED,
		Ts:             timestamppb.New(now),
	}
	payload := mustMarshal(t, receipt)
	return conversationports.FederationOutboxIntent{
		IntentID:       valueobject.HashBytes([]byte("message-receipt-item")).String(),
		ConversationID: "conversation-1",
		EventID:        "message-4",
		EventSequence:  4,
		Recipient: valueobject.Endpoint{
			Actor:  testActor,
			Device: testDevice,
		},
		TargetStation: testStationA,
		IdempotencyKey: valueobject.HashBytes(
			[]byte("message-receipt-idempotency"),
		).String(),
		PayloadKind:   conversationports.DeviceInboxPayloadDeviceReceipt,
		OpaquePayload: payload,
		PayloadHash:   valueobject.HashBytes(payload),
		CreatedAt:     now,
	}
}

func openSQLite(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open(
			"file:conversation-federation-"+uuid.NewString()+
				"?mode=memory&cache=shared&_busy_timeout=5000",
		),
		&gorm.Config{Logger: gormlogger.Default.LogMode(gormlogger.Silent)},
	)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() {
		if err := sqlDB.Close(); err != nil {
			t.Errorf("close SQLite: %v", err)
		}
	})
	return db
}

func mustMarshal(t *testing.T, message proto.Message) []byte {
	t.Helper()
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func mustMarshalWithoutTest(message proto.Message) []byte {
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		panic(fmt.Sprintf("marshal test result: %v", err))
	}
	return encoded
}

func assertTableCount(t *testing.T, db *gorm.DB, model any, expected int64) {
	t.Helper()
	var count int64
	if err := db.Model(model).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != expected {
		t.Fatalf("%T count = %d, want %d", model, count, expected)
	}
}

var (
	_ federationdelivery.Signer                             = stationSigner{}
	_ federationdelivery.Verifier                           = stationKeyring{}
	_ conversationfederation.VerifiedActorDeviceKeyResolver = (*recordingActorKeyProjection)(nil)
	_ conversationfederation.FederationMembershipProjection = activeFederationProjection{}
	_ conversationfederation.AuthorityCommandPort           = (*transactionalAuthorityPort)(nil)
	_ conversationfederation.AuthorityResultPort            = (*transactionalResultPort)(nil)
	_ conversationfederation.DeviceDeliveryPort             = (*transactionalDevicePort)(nil)
	_ conversationfederation.DeliveryReceiptPort            = (*transactionalDeliveryReceiptPort)(nil)
)
