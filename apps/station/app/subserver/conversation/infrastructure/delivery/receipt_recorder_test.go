package delivery_test

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/delivery"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/interaction"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	domainservice "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/service"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	deliveryinfra "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/delivery"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/persistence"
	conversationhttp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/interface/http"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

type receiptPersistenceFixture struct {
	*deliveryFixture
	recorder *deliveryinfra.ReceiptRecorder
	item     delivery.Item
	claim    delivery.ClaimResult
	receipt  interaction.DeliveryReceipt
}

func newReceiptPersistenceFixture(t *testing.T) *receiptPersistenceFixture {
	t.Helper()

	fixture := newDeliveryFixture(t, standardLimits(), standardPolicy())
	if err := fixture.db.AutoMigrate(
		&persistence.ConversationModel{},
		&persistence.ConversationEventModel{},
		&persistence.ConversationMemberDeviceModel{},
		&persistence.ConversationReadCursorModel{},
		&deliveryinfra.AuthorityDeliveryCommitmentModel{},
		&deliveryinfra.AuthorityDeliveryReceiptModel{},
	); err != nil {
		t.Fatalf("migrate receipt dependencies: %v", err)
	}
	eventID := valueobject.EventID(digest("receipt:event"))
	endpointPayload := []byte("endpoint-private-ciphertext")
	originator := valueobject.Endpoint{
		Actor:  "ptid:alice",
		Device: "alice-device",
	}
	originatorPrepared, err := valueobject.NewPreparedDelivery(
		originator,
		"station:local",
		valueobject.DeliveryKindPublicEvent,
		[]byte("originator-public-marker"),
	)
	if err != nil {
		t.Fatalf("prepare receipt originator delivery: %v", err)
	}
	prepared, err := valueobject.NewPreparedDelivery(
		fixture.recipient,
		"station:local",
		valueobject.DeliveryKindDirectCiphertext,
		endpointPayload,
	)
	if err != nil {
		t.Fatalf("prepare receipt delivery: %v", err)
	}
	commitments, err := domainservice.BuildDeliveryCommitments(
		"conversation-1",
		eventID,
		[]valueobject.PreparedDelivery{originatorPrepared, prepared},
	)
	if err != nil {
		t.Fatalf("build receipt delivery commitment: %v", err)
	}
	commandBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chat.ChatCommand{
			CommandId:      "command-1",
			ConversationId: "conversation-1",
			Sender: &chat.CryptoEndpoint{
				Ptid:     "ptid:alice",
				DeviceId: "alice-device",
			},
			Payload: &chat.ChatCommand_SendMessage{
				SendMessage: &chat.SendMessageIntent{
					MessageId:   "message-1",
					ContentKind: chat.MessagingContentKind_MESSAGING_CONTENT_KIND_TEXT,
				},
			},
		},
	)
	if err != nil {
		t.Fatalf("encode receipt source command: %v", err)
	}
	commitmentByEndpoint := make(map[string]valueobject.Hash, len(commitments))
	eventCommitments := make([]valueobject.Hash, 0, len(commitments))
	for _, commitment := range commitments {
		commitmentByEndpoint[commitment.Recipient.Key()] = commitment.Hash
		eventCommitments = append(eventCommitments, commitment.Hash)
	}
	event, err := conversationhttp.ProtobufEventSealer{}.Seal(domainevent.RecordInput{
		ID:                  eventID,
		ConversationID:      "conversation-1",
		Sequence:            1,
		CommandID:           "command-1",
		Actor:               originator,
		CommittedAt:         fixture.clock.now.Add(-time.Hour),
		MembershipEpoch:     1,
		MLSEpoch:            1,
		AuthorityStation:    "station:local",
		DeliveryCommitments: eventCommitments,
		Fact: domainevent.NewCommandCommittedFact(
			domainevent.KindMessageCommitted,
			"message-1",
			commandBytes,
		),
	})
	if err != nil {
		t.Fatalf("seal receipt event: %v", err)
	}
	opaquePayload, err := conversationhttp.ProtobufDeviceEventEncoder{}.EncodeDeviceEvent(
		event,
		prepared,
		commitmentByEndpoint[prepared.Recipient.Key()],
		make([]byte, ed25519.PublicKeySize),
	)
	if err != nil {
		t.Fatalf("encode receipt delivery: %v", err)
	}
	item, err := fixture.repository.Enqueue(
		context.Background(),
		delivery.EnqueueRequest{
			ItemID:         digest("receipt:item"),
			Recipient:      fixture.recipient,
			EventID:        event.ID,
			EventSequence:  event.Sequence,
			ConversationID: event.ConversationID,
			IdempotencyKey: digest("receipt:idempotency"),
			PayloadType:    delivery.PayloadTypeConversationEvent,
			OpaquePayload:  opaquePayload,
			PayloadHash:    valueobject.HashBytes(opaquePayload),
			CreatedAt:      event.CommittedAt,
		},
	)
	if err != nil {
		t.Fatalf("enqueue receipt item: %v", err)
	}
	claim, err := fixture.service.Claim(
		context.Background(),
		fixture.recipient,
		"consumer-a",
		0,
		0,
		1,
	)
	if err != nil {
		t.Fatalf("claim receipt item: %v", err)
	}
	if err := persistReceiptEvent(t, fixture.db, event); err != nil {
		t.Fatal(err)
	}
	if err := persistReceiptConversation(
		fixture.db,
		event,
		valueobject.ConversationKindDirect,
	); err != nil {
		t.Fatal(err)
	}
	authorityLedger, err := deliveryinfra.NewAuthorityLedgerWriter(fixture.db)
	if err != nil {
		t.Fatalf("new authority delivery ledger: %v", err)
	}
	originatorPayload, err := conversationhttp.ProtobufDeviceEventEncoder{}.
		EncodeDeviceEvent(
			event,
			originatorPrepared,
			commitmentByEndpoint[originator.Key()],
			make([]byte, ed25519.PublicKeySize),
		)
	if err != nil {
		t.Fatalf("encode receipt originator delivery: %v", err)
	}
	originatorItemID := valueobject.HashBytes(valueobject.CanonicalTuple(
		[]byte("peers-touch/conversation-delivery"),
		[]byte(event.ID),
		[]byte(originator.Actor),
		[]byte(originator.Device),
	)).String()
	if err := authorityLedger.RecordCommitments(
		context.Background(),
		[]ports.AuthorityDeliveryCommitment{
			{
				ConversationID:      event.ConversationID,
				EventID:             event.ID,
				EventSequence:       event.Sequence,
				Originator:          event.Actor.Actor,
				Recipient:           originator,
				HomeStation:         "station:local",
				PayloadKind:         originatorPrepared.Kind,
				EndpointPayloadHash: originatorPrepared.PayloadHash,
				Commitment:          commitmentByEndpoint[originator.Key()],
				QueueItemID:         originatorItemID,
				QueuePayloadHash:    valueobject.HashBytes(originatorPayload),
				RequiredRecipient:   false,
				CreatedAt:           event.CommittedAt,
			},
			{
				ConversationID:      event.ConversationID,
				EventID:             event.ID,
				EventSequence:       event.Sequence,
				Originator:          event.Actor.Actor,
				Recipient:           item.Recipient,
				HomeStation:         "station:local",
				PayloadKind:         prepared.Kind,
				EndpointPayloadHash: prepared.PayloadHash,
				Commitment:          commitmentByEndpoint[prepared.Recipient.Key()],
				QueueItemID:         item.ItemID,
				QueuePayloadHash:    item.PayloadHash,
				RequiredRecipient:   true,
				CreatedAt:           event.CommittedAt,
			}},
	); err != nil {
		t.Fatalf("seed authority delivery ledger: %v", err)
	}
	if err := fixture.db.Create([]persistence.ConversationMemberDeviceModel{
		{
			ConversationID: string(item.ConversationID),
			PTID:           string(originator.Actor),
			DeviceID:       string(originator.Device),
			HomeStation:    "station:local",
			Active:         true,
			JoinedSequence: 1,
		},
		{
			ConversationID: string(item.ConversationID),
			PTID:           string(item.Recipient.Actor),
			DeviceID:       string(item.Recipient.Device),
			HomeStation:    "station:local",
			Active:         true,
			JoinedSequence: 1,
		},
	}).Error; err != nil {
		t.Fatalf("seed receipt member device: %v", err)
	}
	recorder, err := deliveryinfra.NewReceiptRecorder(fixture.db)
	if err != nil {
		t.Fatalf("new receipt recorder: %v", err)
	}

	return &receiptPersistenceFixture{
		deliveryFixture: fixture,
		recorder:        recorder,
		item:            item,
		claim:           claim,
		receipt: interaction.DeliveryReceipt{
			ReceiptID:      "device-consumed:" + item.ItemID,
			ConversationID: item.ConversationID,
			EventID:        item.EventID,
			Consumer:       item.Recipient,
			EventSequence:  item.EventSequence,
			LaneSequence:   item.LaneSequence,
			PayloadHash:    item.PayloadHash,
			ConsumedAt:     fixture.clock.now.Add(time.Second + 1234*time.Nanosecond),
		},
	}
}

func persistReceiptEvent(
	t *testing.T,
	db *gorm.DB,
	record domainevent.Record,
) error {
	t.Helper()

	snapshot := record.Clone()
	snapshot.EncodedBytes = nil
	domainSnapshot, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	messageID := string(record.Fact.MessageID)

	return db.Create(&persistence.ConversationEventModel{
		EventID:          string(record.ID),
		ConversationID:   string(record.ConversationID),
		Sequence:         uint64(record.Sequence),
		CommandID:        string(record.CommandID),
		MessageID:        &messageID,
		MessageAuthor:    string(record.Actor.Actor),
		ActorPTID:        string(record.Actor.Actor),
		ActorDeviceID:    string(record.Actor.Device),
		EventHash:        record.Hash.Bytes(),
		MembershipEpoch:  uint64(record.MembershipEpoch),
		MLSEpoch:         uint64(record.MLSEpoch),
		AuthorityStation: string(record.AuthorityStation),
		EventKind:        string(record.Fact.Kind),
		HashScheme:       string(record.HashScheme),
		EventBytes:       record.Bytes(),
		DomainSnapshot:   domainSnapshot,
		CommittedAt:      record.CommittedAt,
	}).Error
}

func persistReceiptConversation(
	db *gorm.DB,
	record domainevent.Record,
	kind valueobject.ConversationKind,
) error {
	return db.Create(&persistence.ConversationModel{
		ConversationID:         string(record.ConversationID),
		Kind:                   string(kind),
		Status:                 string(valueobject.ConversationStatusActive),
		FederationID:           "federation-1",
		AuthorityStationPeerID: string(record.AuthorityStation),
		AuthorityEpoch:         1,
		OwnerPTID:              string(record.Actor.Actor),
		CurrentSequence:        uint64(record.Sequence),
		CurrentEventHash:       record.Hash.Bytes(),
		MembershipEpoch:        uint64(record.MembershipEpoch),
		MLSEpoch:               uint64(record.MLSEpoch),
		CreatedAt:              record.CommittedAt,
		UpdatedAt:              record.CommittedAt,
	}).Error
}

type crossStationReceiptFixture struct {
	*deliveryFixture
	recorder     *deliveryinfra.ReceiptRecorder
	event        domainevent.Record
	originator   valueobject.Endpoint
	firstRemote  valueobject.Endpoint
	secondRemote valueobject.Endpoint
	localItem    delivery.Item
	receipts     map[valueobject.Endpoint]interaction.DeliveryReceipt
}

func newCrossStationReceiptFixture(t *testing.T) *crossStationReceiptFixture {
	t.Helper()

	fixture := newDeliveryFixture(t, standardLimits(), standardPolicy())
	if err := fixture.db.AutoMigrate(
		&persistence.ConversationModel{},
		&persistence.ConversationEventModel{},
		&persistence.ConversationMemberDeviceModel{},
		&persistence.ConversationReadCursorModel{},
		&deliveryinfra.AuthorityDeliveryCommitmentModel{},
		&deliveryinfra.AuthorityDeliveryReceiptModel{},
	); err != nil {
		t.Fatalf("migrate cross-Station receipt dependencies: %v", err)
	}
	originator := fixture.recipient
	originatorRemote := valueobject.Endpoint{
		Actor:  originator.Actor,
		Device: "bob-remote-1",
	}
	firstRemote := valueobject.Endpoint{
		Actor:  "ptid:alice",
		Device: "alice-remote-1",
	}
	secondRemote := valueobject.Endpoint{
		Actor:  "ptid:charlie",
		Device: "charlie-remote-1",
	}
	deliveries := []valueobject.PreparedDelivery{
		mustPreparedReceiptDelivery(
			t,
			originator,
			"station:local",
			valueobject.DeliveryKindPublicEvent,
			"originator-public-marker",
		),
		mustPreparedReceiptDelivery(
			t,
			originatorRemote,
			"station:remote-c",
			valueobject.DeliveryKindPublicEvent,
			"originator-remote-public-marker",
		),
		mustPreparedReceiptDelivery(
			t,
			firstRemote,
			"station:remote-a",
			valueobject.DeliveryKindDirectCiphertext,
			"alice-remote-ciphertext",
		),
		mustPreparedReceiptDelivery(
			t,
			secondRemote,
			"station:remote-b",
			valueobject.DeliveryKindDirectCiphertext,
			"charlie-remote-ciphertext",
		),
	}
	eventID := valueobject.EventID(digest("cross-station-receipt:event"))
	commitments, err := domainservice.BuildDeliveryCommitments(
		"conversation-cross-station",
		eventID,
		deliveries,
	)
	if err != nil {
		t.Fatalf("build cross-Station commitments: %v", err)
	}
	commitmentByEndpoint := make(
		map[string]valueobject.Hash,
		len(commitments),
	)
	eventCommitments := make([]valueobject.Hash, 0, len(commitments))
	for _, commitment := range commitments {
		commitmentByEndpoint[commitment.Recipient.Key()] = commitment.Hash
		eventCommitments = append(eventCommitments, commitment.Hash)
	}
	commandBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chat.ChatCommand{
			CommandId:      "cross-station-command",
			ConversationId: "conversation-cross-station",
			Sender: &chat.CryptoEndpoint{
				Ptid:     string(originator.Actor),
				DeviceId: string(originator.Device),
			},
			Payload: &chat.ChatCommand_SendMessage{
				SendMessage: &chat.SendMessageIntent{
					MessageId:   "cross-station-message",
					ContentKind: chat.MessagingContentKind_MESSAGING_CONTENT_KIND_TEXT,
				},
			},
		},
	)
	if err != nil {
		t.Fatalf("encode cross-Station command: %v", err)
	}
	event, err := conversationhttp.ProtobufEventSealer{}.Seal(domainevent.RecordInput{
		ID:                  eventID,
		ConversationID:      "conversation-cross-station",
		Sequence:            1,
		CommandID:           "cross-station-command",
		Actor:               originator,
		CommittedAt:         fixture.clock.now.Add(-time.Hour),
		MembershipEpoch:     1,
		MLSEpoch:            1,
		AuthorityStation:    "station:local",
		DeliveryCommitments: eventCommitments,
		Fact: domainevent.NewCommandCommittedFact(
			domainevent.KindMessageCommitted,
			"cross-station-message",
			commandBytes,
		),
	})
	if err != nil {
		t.Fatalf("seal cross-Station event: %v", err)
	}
	if err := persistReceiptEvent(t, fixture.db, event); err != nil {
		t.Fatal(err)
	}
	if err := persistReceiptConversation(
		fixture.db,
		event,
		valueobject.ConversationKindGroup,
	); err != nil {
		t.Fatal(err)
	}

	ledgerEntries := make(
		[]ports.AuthorityDeliveryCommitment,
		0,
		len(deliveries),
	)
	receipts := make(
		map[valueobject.Endpoint]interaction.DeliveryReceipt,
		len(deliveries),
	)
	var localItem delivery.Item
	for index, prepared := range deliveries {
		commitment := commitmentByEndpoint[prepared.Recipient.Key()]
		opaquePayload, err := conversationhttp.ProtobufDeviceEventEncoder{}.EncodeDeviceEvent(
			event,
			prepared,
			commitment,
			make([]byte, ed25519.PublicKeySize),
		)
		if err != nil {
			t.Fatalf("encode cross-Station delivery: %v", err)
		}
		itemID := valueobject.HashBytes(valueobject.CanonicalTuple(
			[]byte("peers-touch/conversation-delivery"),
			[]byte(event.ID),
			[]byte(prepared.Recipient.Actor),
			[]byte(prepared.Recipient.Device),
		)).String()
		queuePayloadHash := valueobject.HashBytes(opaquePayload)
		ledgerEntries = append(ledgerEntries, ports.AuthorityDeliveryCommitment{
			ConversationID:      event.ConversationID,
			EventID:             event.ID,
			EventSequence:       event.Sequence,
			Originator:          event.Actor.Actor,
			Recipient:           prepared.Recipient,
			HomeStation:         prepared.HomeStation,
			PayloadKind:         prepared.Kind,
			EndpointPayloadHash: prepared.PayloadHash,
			Commitment:          commitment,
			QueueItemID:         itemID,
			QueuePayloadHash:    queuePayloadHash,
			RequiredRecipient:   prepared.Recipient.Actor != event.Actor.Actor,
			CreatedAt:           event.CommittedAt,
		})
		laneSequence := int64(40 + index)
		if prepared.Recipient == originator {
			localItem, err = fixture.repository.Enqueue(
				context.Background(),
				delivery.EnqueueRequest{
					ItemID:         itemID,
					Recipient:      prepared.Recipient,
					EventID:        event.ID,
					EventSequence:  event.Sequence,
					ConversationID: event.ConversationID,
					IdempotencyKey: itemID,
					PayloadType:    delivery.PayloadTypeConversationEvent,
					OpaquePayload:  opaquePayload,
					PayloadHash:    queuePayloadHash,
					CreatedAt:      event.CommittedAt,
				},
			)
			if err != nil {
				t.Fatalf("enqueue originator marker: %v", err)
			}
			laneSequence = localItem.LaneSequence
		}
		receipts[prepared.Recipient] = interaction.DeliveryReceipt{
			ReceiptID:      "device-consumed:" + itemID,
			ConversationID: event.ConversationID,
			EventID:        event.ID,
			Consumer:       prepared.Recipient,
			SourceStation:  prepared.HomeStation,
			EventSequence:  event.Sequence,
			LaneSequence:   laneSequence,
			PayloadHash:    queuePayloadHash,
			ConsumedAt: fixture.clock.now.Add(
				time.Duration(index+1) * time.Second,
			),
		}
		if prepared.HomeStation == event.AuthorityStation {
			receipt := receipts[prepared.Recipient]
			receipt.SourceStation = ""
			receipts[prepared.Recipient] = receipt
		}
		if err := fixture.db.Create(&persistence.ConversationMemberDeviceModel{
			ConversationID: string(event.ConversationID),
			PTID:           string(prepared.Recipient.Actor),
			DeviceID:       string(prepared.Recipient.Device),
			HomeStation:    string(prepared.HomeStation),
			Active:         true,
			JoinedSequence: 1,
		}).Error; err != nil {
			t.Fatalf("seed cross-Station member endpoint: %v", err)
		}
	}
	authorityLedger, err := deliveryinfra.NewAuthorityLedgerWriter(fixture.db)
	if err != nil {
		t.Fatal(err)
	}
	if err := authorityLedger.RecordCommitments(
		context.Background(),
		ledgerEntries,
	); err != nil {
		t.Fatalf("persist cross-Station commitment ledger: %v", err)
	}
	claim, err := fixture.service.Claim(
		context.Background(),
		originator,
		"originator-consumer",
		0,
		0,
		1,
	)
	if err != nil || len(claim.Items) != 1 {
		t.Fatalf("claim originator marker: claim=%+v error=%v", claim, err)
	}
	recorder, err := deliveryinfra.NewReceiptRecorder(fixture.db)
	if err != nil {
		t.Fatal(err)
	}

	return &crossStationReceiptFixture{
		deliveryFixture: fixture,
		recorder:        recorder,
		event:           event,
		originator:      originator,
		firstRemote:     firstRemote,
		secondRemote:    secondRemote,
		localItem:       localItem,
		receipts:        receipts,
	}
}

func mustPreparedReceiptDelivery(
	t *testing.T,
	endpoint valueobject.Endpoint,
	homeStation valueobject.StationID,
	kind valueobject.DeliveryKind,
	payload string,
) valueobject.PreparedDelivery {
	t.Helper()

	prepared, err := valueobject.NewPreparedDelivery(
		endpoint,
		homeStation,
		kind,
		[]byte(payload),
	)
	if err != nil {
		t.Fatal(err)
	}

	return prepared
}

func TestReceiptRecorderAggregatesRemoteEndpointsAndExcludesOriginatorMarkers(
	t *testing.T,
) {
	fixture := newCrossStationReceiptFixture(t)

	originatorResult, err := fixture.recorder.Record(
		context.Background(),
		fixture.receipts[fixture.originator],
	)
	if err != nil {
		t.Fatal(err)
	}
	if originatorResult.Aggregate.RequiredDeviceCount != 2 ||
		originatorResult.Aggregate.ConsumedDeviceCount != 0 ||
		originatorResult.Aggregate.Delivered ||
		originatorResult.Aggregate.FullyDelivered {
		t.Fatalf("originator marker aggregate = %+v", originatorResult.Aggregate)
	}
	if len(originatorResult.OriginatorRoutes) != 2 ||
		originatorResult.OriginatorRoutes[0].Endpoint.Actor != fixture.originator.Actor ||
		originatorResult.OriginatorRoutes[1].HomeStation != "station:remote-c" {
		t.Fatalf("originator routes = %+v", originatorResult.OriginatorRoutes)
	}
	var localItem deliveryinfra.DeviceQueueItemModel
	if err := fixture.db.First(
		&localItem,
		"item_id = ?",
		fixture.localItem.ItemID,
	).Error; err != nil {
		t.Fatal(err)
	}
	if localItem.State != 4 ||
		localItem.ConsumptionReceiptID == nil {
		t.Fatalf("originator marker did not preserve local consumed state: %+v", localItem)
	}

	var remoteQueueCount int64
	remoteReceipt := fixture.receipts[fixture.firstRemote]
	if err := fixture.db.Model(&deliveryinfra.DeviceQueueItemModel{}).
		Where("item_id = ?", remoteReceipt.ReceiptID[len("device-consumed:"):]).
		Count(&remoteQueueCount).Error; err != nil {
		t.Fatal(err)
	}
	if remoteQueueCount != 0 {
		t.Fatalf("authority unexpectedly has %d remote queue rows", remoteQueueCount)
	}
	wrongSource := remoteReceipt
	wrongSource.SourceStation = "station:remote-b"
	if _, err := fixture.recorder.Record(
		context.Background(),
		wrongSource,
	); !interaction.IsCode(err, interaction.ErrorCodeIntegrityFailed) {
		t.Fatalf("wrong remote receipt source error = %v", err)
	}
	remoteResult, err := fixture.recorder.Record(
		context.Background(),
		remoteReceipt,
	)
	if err != nil {
		t.Fatalf("record remote authority receipt without local queue row: %v", err)
	}
	if remoteResult.Replay ||
		remoteResult.Aggregate.RequiredDeviceCount != 2 ||
		remoteResult.Aggregate.ConsumedDeviceCount != 1 ||
		remoteResult.Aggregate.RevokedDeviceCount != 0 ||
		!remoteResult.Aggregate.Delivered ||
		remoteResult.Aggregate.FullyDelivered {
		t.Fatalf("remote receipt aggregate = %+v", remoteResult)
	}

	replayed, err := fixture.recorder.Record(context.Background(), remoteReceipt)
	if err != nil || !replayed.Replay {
		t.Fatalf("exact remote receipt replay: result=%+v error=%v", replayed, err)
	}
	conflicting := remoteReceipt
	conflicting.LaneSequence++
	if _, err := fixture.recorder.Record(
		context.Background(),
		conflicting,
	); !interaction.IsCode(err, interaction.ErrorCodeIdempotencyConflict) {
		t.Fatalf("remote receipt conflict error = %v", err)
	}

	if err := fixture.db.Model(&persistence.ConversationMemberDeviceModel{}).
		Where(
			"conversation_id = ? AND ptid = ? AND device_id = ?",
			string(fixture.event.ConversationID),
			string(fixture.secondRemote.Actor),
			string(fixture.secondRemote.Device),
		).
		Update("active", false).Error; err != nil {
		t.Fatal(err)
	}
	replayed, err = fixture.recorder.Record(context.Background(), remoteReceipt)
	if err != nil {
		t.Fatalf("replay after endpoint revoke: %v", err)
	}
	if !replayed.Replay ||
		replayed.Aggregate.ConsumedDeviceCount != 1 ||
		replayed.Aggregate.RevokedDeviceCount != 1 ||
		!replayed.Aggregate.FullyDelivered {
		t.Fatalf("revoked endpoint aggregate = %+v", replayed)
	}
	var authorityReceiptCount int64
	if err := fixture.db.Model(&deliveryinfra.AuthorityDeliveryReceiptModel{}).
		Count(&authorityReceiptCount).Error; err != nil {
		t.Fatal(err)
	}
	if authorityReceiptCount != 2 {
		t.Fatalf("authority receipt rows = %d, want 2", authorityReceiptCount)
	}
}

func TestReceiptRecorderUsesDirectCommitmentsOutsideGroupDeviceProjection(
	t *testing.T,
) {
	fixture := newCrossStationReceiptFixture(t)
	if err := fixture.db.Model(&persistence.ConversationModel{}).
		Where("conversation_id = ?", string(fixture.event.ConversationID)).
		Update("kind", string(valueobject.ConversationKindDirect)).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.
		Where("conversation_id = ?", string(fixture.event.ConversationID)).
		Delete(&persistence.ConversationMemberDeviceModel{}).Error; err != nil {
		t.Fatal(err)
	}

	first := fixture.receipts[fixture.firstRemote]
	firstResult, err := fixture.recorder.Record(context.Background(), first)
	if err != nil {
		t.Fatalf("record first current Direct endpoint receipt: %v", err)
	}
	if firstResult.Aggregate.RequiredDeviceCount != 2 ||
		firstResult.Aggregate.ConsumedDeviceCount != 1 ||
		firstResult.Aggregate.RevokedDeviceCount != 0 ||
		!firstResult.Aggregate.Delivered ||
		firstResult.Aggregate.FullyDelivered ||
		len(firstResult.OriginatorRoutes) != 2 {
		t.Fatalf("first current Direct receipt result = %+v", firstResult)
	}

	second := fixture.receipts[fixture.secondRemote]
	secondResult, err := fixture.recorder.Record(context.Background(), second)
	if err != nil {
		t.Fatalf("record second current Direct endpoint receipt: %v", err)
	}
	if secondResult.Aggregate.RequiredDeviceCount != 2 ||
		secondResult.Aggregate.ConsumedDeviceCount != 2 ||
		secondResult.Aggregate.RevokedDeviceCount != 0 ||
		!secondResult.Aggregate.Delivered ||
		!secondResult.Aggregate.FullyDelivered ||
		len(secondResult.OriginatorRoutes) != 2 {
		t.Fatalf("second current Direct receipt result = %+v", secondResult)
	}
}

func TestReceiptRecorderKeepsReadAheadOfDeliveredMonotonic(t *testing.T) {
	fixture := newCrossStationReceiptFixture(t)
	if err := fixture.db.Create(&persistence.ConversationReadCursorModel{
		ConversationID: string(fixture.event.ConversationID),
		PTID:           string(fixture.firstRemote.Actor),
		Sequence:       uint64(fixture.event.Sequence),
		UpdatedAt:      fixture.clock.now,
	}).Error; err != nil {
		t.Fatal(err)
	}

	result, err := fixture.recorder.Record(
		context.Background(),
		fixture.receipts[fixture.originator],
	)
	if err != nil {
		t.Fatalf("record originator marker after recipient read: %v", err)
	}
	if result.Aggregate.RequiredDeviceCount != 2 ||
		result.Aggregate.ConsumedDeviceCount != 0 ||
		result.Aggregate.RevokedDeviceCount != 0 ||
		!result.Aggregate.Delivered ||
		result.Aggregate.FullyDelivered ||
		!result.Aggregate.Read {
		t.Fatalf("read-ahead delivery aggregate = %+v", result.Aggregate)
	}
}

func TestReceiptRecorderAdmitsExactFollowerConsumptionBeforeForwarding(
	t *testing.T,
) {
	fixture := newReceiptPersistenceFixture(t)

	replay, err := fixture.recorder.RecordFollowerConsumption(
		context.Background(),
		"station:local",
		fixture.receipt,
	)
	if err != nil || replay {
		t.Fatalf("record follower consumption: replay=%v error=%v", replay, err)
	}
	replay, err = fixture.recorder.RecordFollowerConsumption(
		context.Background(),
		"station:local",
		fixture.receipt,
	)
	if err != nil || !replay {
		t.Fatalf("replay follower consumption: replay=%v error=%v", replay, err)
	}
	if _, err := fixture.recorder.RecordFollowerConsumption(
		context.Background(),
		"station:wrong",
		fixture.receipt,
	); !interaction.IsCode(err, interaction.ErrorCodeIntegrityFailed) {
		t.Fatalf("wrong follower authority error = %v", err)
	}
	conflicting := fixture.receipt
	conflicting.LaneSequence++
	if _, err := fixture.recorder.RecordFollowerConsumption(
		context.Background(),
		"station:local",
		conflicting,
	); !interaction.IsCode(err, interaction.ErrorCodeIdempotencyConflict) {
		t.Fatalf("follower receipt conflict error = %v", err)
	}
}

func TestReceiptRecorderPersistsConsumedTransitionAndAllowsDelayedAck(t *testing.T) {
	fixture := newReceiptPersistenceFixture(t)

	recorded, err := fixture.recorder.Record(context.Background(), fixture.receipt)
	if err != nil {
		t.Fatal(err)
	}
	if recorded.Replay ||
		recorded.Originator != "ptid:alice" ||
		recorded.MessageID != "message-1" ||
		len(recorded.OriginatorRoutes) != 1 ||
		recorded.OriginatorRoutes[0].Endpoint.Actor != "ptid:alice" ||
		recorded.OriginatorRoutes[0].HomeStation != "station:local" ||
		recorded.Aggregate.ConsumedDeviceCount != 1 ||
		!recorded.Aggregate.Delivered ||
		!recorded.Aggregate.FullyDelivered {
		t.Fatalf("recorded receipt = %+v", recorded)
	}

	var persisted deliveryinfra.DeviceQueueItemModel
	if err := fixture.db.First(&persisted, "item_id = ?", fixture.item.ItemID).Error; err != nil {
		t.Fatal(err)
	}
	expectedConsumedAt := fixture.receipt.ConsumedAt.UTC().Truncate(time.Microsecond)
	if persisted.State != 4 ||
		persisted.ConsumptionReceiptID == nil ||
		*persisted.ConsumptionReceiptID != fixture.receipt.ReceiptID ||
		persisted.ConsumedAt == nil ||
		!persisted.ConsumedAt.Equal(expectedConsumedAt) {
		t.Fatalf("persisted consumed item = %+v", persisted)
	}
	if _, err := fixture.service.Reject(
		context.Background(),
		delivery.RejectRequest{
			Recipient:     fixture.item.Recipient,
			ItemID:        fixture.item.ItemID,
			LaneSequence:  fixture.item.LaneSequence,
			ConsumerEpoch: fixture.claim.ConsumerEpoch,
			Code:          delivery.RejectCodeRetryLater,
		},
	); !delivery.IsCode(err, delivery.ErrorCodeItemNotClaimed) {
		t.Fatalf("post-consumption reject error = %v", err)
	}

	fixture.clock.now = fixture.clock.now.Add(standardPolicy().LeaseDuration + time.Second)
	ackedThrough, err := fixture.service.Acknowledge(
		context.Background(),
		delivery.AcknowledgeRequest{
			Recipient:     fixture.item.Recipient,
			ItemID:        fixture.item.ItemID,
			LaneSequence:  fixture.item.LaneSequence,
			ConsumerEpoch: fixture.claim.ConsumerEpoch,
			PayloadHash:   fixture.item.PayloadHash,
		},
	)
	if err != nil {
		t.Fatalf("acknowledge durably consumed item after lease expiry: %v", err)
	}
	if ackedThrough != fixture.item.LaneSequence {
		t.Fatalf("acked through = %d, want %d", ackedThrough, fixture.item.LaneSequence)
	}
}

func TestReceiptRecorderLocksEventBeforeEndpointCommitment(t *testing.T) {
	fixture := newReceiptPersistenceFixture(t)
	const callbackName = "receipt-lock-order"
	var queriedTables []string
	if err := fixture.db.Callback().Query().
		Before("gorm:query").
		Register(callbackName, func(tx *gorm.DB) {
			switch tx.Statement.Table {
			case "conversation_events", "conversation_delivery_commitments":
				queriedTables = append(queriedTables, tx.Statement.Table)
			}
		}); err != nil {
		t.Fatalf("register query callback: %v", err)
	}
	defer fixture.db.Callback().Query().Remove(callbackName)

	if _, err := fixture.recorder.Record(context.Background(), fixture.receipt); err != nil {
		t.Fatalf("record receipt: %v", err)
	}
	if len(queriedTables) < 2 {
		t.Fatalf("receipt lock queries = %v", queriedTables)
	}
	if queriedTables[0] != "conversation_events" ||
		queriedTables[1] != "conversation_delivery_commitments" {
		t.Fatalf("receipt lock order = %v", queriedTables[:2])
	}
}

func TestReceiptRecorderExactReplayAndConflict(t *testing.T) {
	fixture := newReceiptPersistenceFixture(t)

	if _, err := fixture.recorder.Record(context.Background(), fixture.receipt); err != nil {
		t.Fatal(err)
	}
	replayed, err := fixture.recorder.Record(context.Background(), fixture.receipt)
	if err != nil {
		t.Fatalf("exact receipt replay: %v", err)
	}
	if !replayed.Replay || replayed.Aggregate.ConsumedDeviceCount != 1 {
		t.Fatalf("replayed receipt = %+v", replayed)
	}

	conflicting := fixture.receipt
	conflicting.LaneSequence++
	if _, err := fixture.recorder.Record(
		context.Background(),
		conflicting,
	); !interaction.IsCode(err, interaction.ErrorCodeIdempotencyConflict) {
		t.Fatalf("receipt tuple conflict error = %v", err)
	}
	conflicting = fixture.receipt
	conflicting.ConsumedAt = conflicting.ConsumedAt.Add(time.Microsecond)
	if _, err := fixture.recorder.Record(
		context.Background(),
		conflicting,
	); !interaction.IsCode(err, interaction.ErrorCodeIdempotencyConflict) {
		t.Fatalf("receipt timestamp conflict error = %v", err)
	}

	replayed, err = fixture.recorder.Record(context.Background(), fixture.receipt)
	if err != nil || !replayed.Replay {
		t.Fatalf("receipt changed after conflicts: result=%+v error=%v", replayed, err)
	}
}

func TestReceiptRecorderRollsBackWhenAggregateValidationFails(t *testing.T) {
	fixture := newReceiptPersistenceFixture(t)
	if err := fixture.db.Model(&persistence.ConversationModel{}).
		Where("conversation_id = ?", string(fixture.item.ConversationID)).
		Update("kind", string(valueobject.ConversationKindGroup)).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.
		Where(
			"conversation_id = ? AND ptid = ? AND device_id = ?",
			string(fixture.item.ConversationID),
			string(fixture.item.Recipient.Actor),
			string(fixture.item.Recipient.Device),
		).
		Delete(&persistence.ConversationMemberDeviceModel{}).Error; err != nil {
		t.Fatal(err)
	}

	if _, err := fixture.recorder.Record(
		context.Background(),
		fixture.receipt,
	); !interaction.IsCode(err, interaction.ErrorCodeIntegrityFailed) {
		t.Fatalf("aggregate validation error = %v", err)
	}

	var persisted deliveryinfra.DeviceQueueItemModel
	if err := fixture.db.First(&persisted, "item_id = ?", fixture.item.ItemID).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.State != 2 ||
		persisted.ConsumptionReceiptID != nil ||
		persisted.ConsumedAt != nil {
		t.Fatalf("failed receipt transaction persisted mutation: %+v", persisted)
	}
	var authorityReceiptCount int64
	if err := fixture.db.Model(&deliveryinfra.AuthorityDeliveryReceiptModel{}).
		Count(&authorityReceiptCount).Error; err != nil {
		t.Fatal(err)
	}
	if authorityReceiptCount != 0 {
		t.Fatalf(
			"failed receipt transaction persisted %d authority receipts",
			authorityReceiptCount,
		)
	}
}

func TestReceiptRecorderRejectsDeliveryOutsideCommittedSetBeforeMutation(t *testing.T) {
	fixture := newReceiptPersistenceFixture(t)
	var wire chat.DeviceEventDelivery
	if err := proto.Unmarshal(fixture.item.OpaquePayload, &wire); err != nil {
		t.Fatal(err)
	}
	wire.DeliveryCommitment = valueobject.HashBytes([]byte("different-commitment")).Bytes()
	opaquePayload, err := proto.MarshalOptions{Deterministic: true}.Marshal(&wire)
	if err != nil {
		t.Fatal(err)
	}
	payloadHash := valueobject.HashBytes(opaquePayload)
	if err := fixture.db.Model(&deliveryinfra.DeviceQueueItemModel{}).
		Where("item_id = ?", fixture.item.ItemID).
		Updates(map[string]any{
			"opaque_payload": opaquePayload,
			"payload_sha256": payloadHash.Bytes(),
		}).Error; err != nil {
		t.Fatal(err)
	}
	fixture.receipt.PayloadHash = payloadHash

	if _, err := fixture.recorder.Record(
		context.Background(),
		fixture.receipt,
	); !interaction.IsCode(err, interaction.ErrorCodeIntegrityFailed) {
		t.Fatalf("delivery commitment error = %v", err)
	}

	var persisted deliveryinfra.DeviceQueueItemModel
	if err := fixture.db.First(&persisted, "item_id = ?", fixture.item.ItemID).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.State != 2 ||
		persisted.ConsumptionReceiptID != nil ||
		persisted.ConsumedAt != nil {
		t.Fatalf("invalid delivery persisted receipt mutation: %+v", persisted)
	}
}

func TestReceiptRecorderPreservesAcknowledgedState(t *testing.T) {
	fixture := newReceiptPersistenceFixture(t)
	if _, err := fixture.service.Acknowledge(
		context.Background(),
		delivery.AcknowledgeRequest{
			Recipient:     fixture.item.Recipient,
			ItemID:        fixture.item.ItemID,
			LaneSequence:  fixture.item.LaneSequence,
			ConsumerEpoch: fixture.claim.ConsumerEpoch,
			PayloadHash:   fixture.item.PayloadHash,
		},
	); err != nil {
		t.Fatal(err)
	}

	if _, err := fixture.recorder.Record(context.Background(), fixture.receipt); err != nil {
		t.Fatal(err)
	}
	var persisted deliveryinfra.DeviceQueueItemModel
	if err := fixture.db.First(&persisted, "item_id = ?", fixture.item.ItemID).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.State != 5 ||
		persisted.ConsumptionReceiptID == nil ||
		*persisted.ConsumptionReceiptID != fixture.receipt.ReceiptID {
		t.Fatalf("acknowledged receipt state = %+v", persisted)
	}
}
