package delivery

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/interaction"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	domainservice "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/service"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/persistence"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ReceiptRecorder records exact device consumption against canonical
// Conversation events and Device Inbox items.
type ReceiptRecorder struct {
	db              *gorm.DB
	sqliteMutex     sync.Mutex
	serializeSQLite bool
}

// NewReceiptRecorder constructs a canonical delivery-receipt persistence adapter.
func NewReceiptRecorder(db *gorm.DB) (*ReceiptRecorder, error) {
	if db == nil {
		return nil, interaction.NewError(
			interaction.ErrorCodeInvalidArgument,
			"delivery_receipt_recorder.new",
			"database",
			"is required",
		)
	}

	return &ReceiptRecorder{
		db:              db,
		serializeSQLite: db.Dialector.Name() == "sqlite",
	}, nil
}

// Record validates and persists one exact receipt, then derives the delivery
// aggregate and originator from canonical CA-W2 state.
func (r *ReceiptRecorder) Record(
	ctx context.Context,
	receipt interaction.DeliveryReceipt,
) (interaction.DeliveryRecordResult, error) {
	itemID, err := validateReceipt(receipt)
	if err != nil {
		return interaction.DeliveryRecordResult{}, err
	}
	receipt.ConsumedAt = receipt.ConsumedAt.UTC().Truncate(persistenceTimestampPrecision)

	var recorded interaction.DeliveryRecordResult
	err = r.transaction(ctx, func(tx *gorm.DB) error {
		expected, err := lockAuthorityDeliveryCommitment(tx, receipt)
		if err != nil {
			return err
		}
		event, err := loadReceiptEvent(tx, receipt.EventID)
		if err != nil {
			return err
		}
		if err := validateReceiptEvent(event, receipt); err != nil {
			return err
		}
		if err := validateReceiptExpectation(expected, event, receipt, itemID); err != nil {
			return err
		}

		item, localItemExists, err := lockReceiptItemIfPresent(tx, itemID)
		if err != nil {
			return err
		}
		if localItemExists {
			if err := validateReceiptItem(item, receipt); err != nil {
				return err
			}
			if err := validateReceiptDelivery(item, event, expected); err != nil {
				return err
			}
		} else if expected.HomeStation == string(event.AuthorityStation) {
			return receiptIntegrityError(
				"item_id",
				"does not identify the expected authority-local Device Inbox item",
			)
		}

		replay, err := persistAuthorityReceipt(tx, expected, receipt)
		if err != nil {
			return err
		}
		if localItemExists {
			localReplay, err := persistExactReceipt(tx, item, receipt)
			if err != nil {
				return err
			}
			if localReplay != replay {
				return receiptIntegrityError(
					"receipt",
					"authority and local consumption ledgers disagree",
				)
			}
		}
		aggregate, err := loadDeliveryAggregate(tx, event)
		if err != nil {
			return err
		}
		originatorRoutes, err := loadOriginatorRoutes(tx, event)
		if err != nil {
			return err
		}
		recorded = interaction.DeliveryRecordResult{
			Aggregate:        aggregate,
			MessageID:        event.Fact.MessageID,
			Originator:       event.Actor.Actor,
			OriginatorRoutes: originatorRoutes,
			Replay:           replay,
		}

		return nil
	})
	if err != nil {
		return interaction.DeliveryRecordResult{}, err
	}

	return recorded, nil
}

// RecordFollowerConsumption validates and persists the exact target-local
// Device Inbox tuple before its Home Station forwards the receipt.
func (r *ReceiptRecorder) RecordFollowerConsumption(
	ctx context.Context,
	authorityStation valueobject.StationID,
	receipt interaction.DeliveryReceipt,
) (bool, error) {
	if authorityStation == "" || receipt.SourceStation != "" {
		return false, interaction.NewError(
			interaction.ErrorCodeInvalidArgument,
			"delivery_receipt_recorder.record_follower",
			"authority_station",
			"authority Station is required and source Station must be server-derived",
		)
	}
	itemID, err := validateReceipt(receipt)
	if err != nil {
		return false, err
	}
	receipt.ConsumedAt = receipt.ConsumedAt.UTC().Truncate(persistenceTimestampPrecision)

	var replay bool
	err = r.transaction(ctx, func(tx *gorm.DB) error {
		item, found, err := lockReceiptItemIfPresent(tx, itemID)
		if err != nil {
			return err
		}
		if !found {
			return receiptIntegrityError(
				"item_id",
				"does not identify a target-local Device Inbox item",
			)
		}
		if err := validateReceiptItem(item, receipt); err != nil {
			return err
		}
		if err := validateFollowerReceiptDelivery(
			item,
			authorityStation,
		); err != nil {
			return err
		}
		replay, err = persistExactReceipt(tx, item, receipt)

		return err
	})
	if err != nil {
		return false, err
	}

	return replay, nil
}

const persistenceTimestampPrecision = 1000

func (r *ReceiptRecorder) transaction(
	ctx context.Context,
	fn func(*gorm.DB) error,
) error {
	if r.serializeSQLite {
		r.sqliteMutex.Lock()
		defer r.sqliteMutex.Unlock()
	}
	err := r.db.WithContext(ctx).Transaction(fn)
	if err == nil || interaction.CodeOf(err) != "" {
		return err
	}

	return interaction.WrapError(
		interaction.ErrorCodePersistence,
		"delivery_receipt_recorder.record",
		err,
	)
}

func validateReceipt(receipt interaction.DeliveryReceipt) (string, error) {
	const prefix = "device-consumed:"
	itemID := strings.TrimPrefix(receipt.ReceiptID, prefix)
	if itemID == receipt.ReceiptID ||
		strings.TrimSpace(itemID) == "" ||
		receipt.ReceiptID != prefix+itemID ||
		receipt.ConversationID == "" ||
		receipt.EventID == "" ||
		receipt.Consumer.Validate() != nil ||
		(receipt.SourceStation != "" &&
			string(receipt.SourceStation) !=
				strings.TrimSpace(string(receipt.SourceStation))) ||
		receipt.EventSequence == 0 ||
		receipt.LaneSequence <= 0 ||
		receipt.PayloadHash.IsZero() ||
		receipt.ConsumedAt.IsZero() {
		return "", interaction.NewError(
			interaction.ErrorCodeInvalidArgument,
			"delivery_receipt_recorder.record",
			"receipt",
			"is incomplete or malformed",
		)
	}

	return itemID, nil
}

func lockAuthorityDeliveryCommitment(
	tx *gorm.DB,
	receipt interaction.DeliveryReceipt,
) (*AuthorityDeliveryCommitmentModel, error) {
	var commitment AuthorityDeliveryCommitmentModel
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		First(
			&commitment,
			"event_id = ? AND recipient_ptid = ? AND recipient_device_id = ?",
			string(receipt.EventID),
			string(receipt.Consumer.Actor),
			string(receipt.Consumer.Device),
		).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, receiptIntegrityError(
			"consumer",
			"does not identify an expected authority delivery endpoint",
		)
	}
	if err != nil {
		return nil, err
	}

	return &commitment, nil
}

func lockReceiptItemIfPresent(
	tx *gorm.DB,
	itemID string,
) (*DeviceQueueItemModel, bool, error) {
	var item DeviceQueueItemModel
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		First(&item, "item_id = ?", itemID).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}

	return &item, true, nil
}

func validateReceiptExpectation(
	expected *AuthorityDeliveryCommitmentModel,
	event domainevent.Record,
	receipt interaction.DeliveryReceipt,
	itemID string,
) error {
	if expected.EventID != string(receipt.EventID) ||
		expected.ConversationID != string(receipt.ConversationID) ||
		expected.EventSequence != uint64(receipt.EventSequence) ||
		expected.RecipientPTID != string(receipt.Consumer.Actor) ||
		expected.RecipientDeviceID != string(receipt.Consumer.Device) ||
		expected.QueueItemID != itemID ||
		!bytes.Equal(expected.QueuePayloadSHA256, receipt.PayloadHash.Bytes()) {
		return receiptIntegrityError(
			"receipt",
			"does not match the exact authority delivery expectation",
		)
	}
	switch {
	case receipt.SourceStation == "" &&
		expected.HomeStation != string(event.AuthorityStation):
		return receiptIntegrityError(
			"source_station",
			"is required for a remote Home Station receipt",
		)
	case receipt.SourceStation != "" &&
		expected.HomeStation != string(receipt.SourceStation):
		return receiptIntegrityError(
			"source_station",
			"does not own the expected delivery endpoint",
		)
	}
	if err := validateAuthorityCommitmentModel(expected, event); err != nil {
		return err
	}

	return nil
}

func validateAuthorityCommitmentModel(
	expected *AuthorityDeliveryCommitmentModel,
	event domainevent.Record,
) error {
	endpoint := valueobject.Endpoint{
		Actor:  valueobject.PTID(expected.RecipientPTID),
		Device: valueobject.DeviceID(expected.RecipientDeviceID),
	}
	endpointPayloadHash, err := valueobject.NewHash(expected.EndpointPayloadSHA256)
	if err != nil {
		return receiptIntegrityError(
			"endpoint_payload_sha256",
			"is not a canonical SHA-256 hash",
		)
	}
	commitmentHash, err := valueobject.NewHash(expected.CommitmentSHA256)
	if err != nil {
		return receiptIntegrityError(
			"delivery_commitment",
			"is not a canonical SHA-256 hash",
		)
	}
	queuePayloadHash, err := valueobject.NewHash(expected.QueuePayloadSHA256)
	if err != nil {
		return receiptIntegrityError(
			"queue_payload_sha256",
			"is not a canonical SHA-256 hash",
		)
	}
	kind := valueobject.DeliveryKind(expected.PayloadKind)
	commitments, err := domainservice.BuildDeliveryCommitments(
		event.ConversationID,
		event.ID,
		[]valueobject.PreparedDelivery{{
			Recipient:   endpoint,
			HomeStation: valueobject.StationID(expected.HomeStation),
			Kind:        kind,
			PayloadHash: endpointPayloadHash,
		}},
	)
	if expected.EventID != string(event.ID) ||
		expected.ConversationID != string(event.ConversationID) ||
		expected.EventSequence != uint64(event.Sequence) ||
		expected.OriginatorPTID != string(event.Actor.Actor) ||
		endpoint.Validate() != nil ||
		expected.HomeStation == "" ||
		queuePayloadHash.IsZero() ||
		expected.RequiredRecipient !=
			(endpoint.Actor != event.Actor.Actor) ||
		!expected.CreatedAt.Equal(event.CommittedAt) ||
		err != nil ||
		len(commitments) != 1 ||
		commitments[0].Hash != commitmentHash ||
		!containsReceiptCommitment(event.DeliveryCommitments, commitmentHash) {
		return receiptIntegrityError(
			"delivery_commitment",
			"does not preserve exact event, endpoint, payload, and commitment provenance",
		)
	}

	return nil
}

func validateReceiptItem(
	item *DeviceQueueItemModel,
	receipt interaction.DeliveryReceipt,
) error {
	if item.ItemID == "" ||
		item.PayloadType != storagePayloadTypeConversationEvent ||
		!payloadMatches(item) {
		return receiptIntegrityError(
			"item",
			"is not a valid canonical Conversation delivery",
		)
	}
	exactMatch := item.ConversationID == string(receipt.ConversationID) &&
		item.EventID == string(receipt.EventID) &&
		item.EventSequence == uint64(receipt.EventSequence) &&
		item.RecipientPTID == string(receipt.Consumer.Actor) &&
		item.RecipientDeviceID == string(receipt.Consumer.Device) &&
		item.LaneSequence == receipt.LaneSequence &&
		bytes.Equal(item.PayloadSHA256, receipt.PayloadHash.Bytes())
	if item.ConsumptionReceiptID != nil {
		if *item.ConsumptionReceiptID != receipt.ReceiptID ||
			item.ConsumedAt == nil ||
			!item.ConsumedAt.Equal(receipt.ConsumedAt) ||
			!exactMatch {
			return interaction.NewError(
				interaction.ErrorCodeIdempotencyConflict,
				"delivery_receipt_recorder.record",
				"receipt_id",
				"already identifies a different persisted receipt",
			)
		}
		if item.State != storageStateConsumed &&
			item.State != storageStateAcked {
			return receiptIntegrityError(
				"state",
				"is inconsistent with its persisted consumption receipt",
			)
		}

		return nil
	}
	if !exactMatch {
		return receiptIntegrityError(
			"receipt",
			"does not match the canonical item, conversation, event, sequence, payload, and consumer tuple",
		)
	}
	switch item.State {
	case storageStateClaimed, storageStateConsumed, storageStateAcked:
		return nil
	default:
		return receiptIntegrityError(
			"state",
			"does not prove a durably consumed Device Inbox item",
		)
	}
}

const storagePayloadTypeConversationEvent = int32(1)

func loadReceiptEvent(
	tx *gorm.DB,
	eventID valueobject.EventID,
) (domainevent.Record, error) {
	var model persistence.ConversationEventModel
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		First(&model, "event_id = ?", string(eventID)).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domainevent.Record{}, receiptIntegrityError(
			"event_id",
			"does not identify a canonical Conversation event",
		)
	}
	if err != nil {
		return domainevent.Record{}, err
	}

	var record domainevent.Record
	if err := json.Unmarshal(model.DomainSnapshot, &record); err != nil {
		return domainevent.Record{}, fmt.Errorf(
			"decode canonical Conversation event: %w",
			err,
		)
	}
	record.HashScheme = domainevent.HashScheme(model.HashScheme)
	record.EncodedBytes = append([]byte(nil), model.EventBytes...)
	rehydrated, err := domainevent.Rehydrate(record)
	if err != nil {
		return domainevent.Record{}, receiptIntegrityError(
			"event",
			"canonical Conversation event failed integrity validation",
		)
	}
	if rehydrated.ID != valueobject.EventID(model.EventID) ||
		rehydrated.ConversationID != valueobject.ConversationID(model.ConversationID) ||
		rehydrated.Sequence != valueobject.Sequence(model.Sequence) ||
		rehydrated.CommandID != valueobject.CommandID(model.CommandID) ||
		rehydrated.Actor.Actor != valueobject.PTID(model.ActorPTID) ||
		rehydrated.Actor.Device != valueobject.DeviceID(model.ActorDeviceID) ||
		!bytes.Equal(optionalReceiptHash(rehydrated.PreviousHash), model.PreviousHash) ||
		!bytes.Equal(rehydrated.Hash.Bytes(), model.EventHash) ||
		rehydrated.MembershipEpoch != valueobject.Epoch(model.MembershipEpoch) ||
		rehydrated.MLSEpoch != valueobject.Epoch(model.MLSEpoch) ||
		rehydrated.AuthorityStation != valueobject.StationID(model.AuthorityStation) ||
		rehydrated.Fact.Kind != domainevent.Kind(model.EventKind) ||
		!receiptEventMessageBindingMatches(rehydrated, model) ||
		!rehydrated.CommittedAt.Equal(model.CommittedAt) {
		return domainevent.Record{}, receiptIntegrityError(
			"event",
			"indexed Conversation event state disagrees with its canonical record",
		)
	}

	return rehydrated, nil
}

func optionalReceiptHash(hash valueobject.Hash) []byte {
	if hash.IsZero() {
		return nil
	}

	return hash.Bytes()
}

func receiptEventMessageBindingMatches(
	event domainevent.Record,
	model persistence.ConversationEventModel,
) bool {
	if event.Fact.Kind == domainevent.KindMessageCommitted {
		return model.MessageID != nil &&
			*model.MessageID == string(event.Fact.MessageID) &&
			model.MessageAuthor == string(event.Actor.Actor)
	}

	return model.MessageID == nil && model.MessageAuthor == ""
}

func validateReceiptEvent(
	event domainevent.Record,
	receipt interaction.DeliveryReceipt,
) error {
	if event.ID != receipt.EventID ||
		event.ConversationID != receipt.ConversationID ||
		event.Sequence != receipt.EventSequence ||
		event.Actor.Actor == "" ||
		len(event.DeliveryCommitments) == 0 {
		return receiptIntegrityError(
			"event",
			"does not match the receipt or contain a committed delivery set",
		)
	}

	return nil
}

func validateReceiptDelivery(
	item *DeviceQueueItemModel,
	event domainevent.Record,
	expected *AuthorityDeliveryCommitmentModel,
) error {
	var delivery chat.DeviceEventDelivery
	if err := proto.Unmarshal(item.OpaquePayload, &delivery); err != nil {
		return receiptIntegrityError(
			"opaque_payload",
			"is not a canonical DeviceEventDelivery",
		)
	}
	if delivery.GetEvent() == nil || delivery.GetRecipient() == nil {
		return receiptIntegrityError(
			"opaque_payload",
			"is missing its Conversation event or recipient",
		)
	}
	eventBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		delivery.GetEvent(),
	)
	if err != nil || !bytes.Equal(eventBytes, event.Bytes()) {
		return receiptIntegrityError(
			"opaque_payload",
			"does not contain the exact canonical Conversation event",
		)
	}
	if delivery.GetRecipient().GetPtid() != item.RecipientPTID ||
		delivery.GetRecipient().GetDeviceId() != item.RecipientDeviceID ||
		item.ItemID != expected.QueueItemID ||
		!bytes.Equal(item.PayloadSHA256, expected.QueuePayloadSHA256) {
		return receiptIntegrityError(
			"opaque_payload",
			"does not match the exact authority delivery and Device Inbox item",
		)
	}
	endpointPayloadHash := valueobject.HashBytes(delivery.GetEndpointPayload())
	if !bytes.Equal(
		endpointPayloadHash.Bytes(),
		delivery.GetEndpointPayloadSha256(),
	) || !bytes.Equal(
		delivery.GetEndpointPayloadSha256(),
		expected.EndpointPayloadSHA256,
	) {
		return receiptIntegrityError(
			"endpoint_payload_sha256",
			"does not match the endpoint payload and authority expectation",
		)
	}
	kind, err := deliveryKindFromProto(delivery.GetPayloadKind())
	if err != nil {
		return err
	}
	if string(kind) != expected.PayloadKind {
		return receiptIntegrityError(
			"payload_kind",
			"does not match the authority expectation",
		)
	}
	commitments, err := domainservice.BuildDeliveryCommitments(
		event.ConversationID,
		event.ID,
		[]valueobject.PreparedDelivery{{
			Recipient: valueobject.Endpoint{
				Actor:  valueobject.PTID(item.RecipientPTID),
				Device: valueobject.DeviceID(item.RecipientDeviceID),
			},
			HomeStation: event.AuthorityStation,
			Kind:        kind,
			Opaque:      append([]byte(nil), delivery.GetEndpointPayload()...),
			PayloadHash: endpointPayloadHash,
		}},
	)
	if err != nil ||
		len(commitments) != 1 ||
		!bytes.Equal(
			commitments[0].Hash.Bytes(),
			delivery.GetDeliveryCommitment(),
		) ||
		!bytes.Equal(
			delivery.GetDeliveryCommitment(),
			expected.CommitmentSHA256,
		) ||
		!containsReceiptCommitment(
			event.DeliveryCommitments,
			commitments[0].Hash,
		) {
		return receiptIntegrityError(
			"delivery_commitment",
			"does not belong to the canonical Conversation event delivery set",
		)
	}

	return nil
}

func validateFollowerReceiptDelivery(
	item *DeviceQueueItemModel,
	authorityStation valueobject.StationID,
) error {
	var delivery chat.DeviceEventDelivery
	if err := proto.Unmarshal(item.OpaquePayload, &delivery); err != nil {
		return receiptIntegrityError(
			"item",
			"does not contain a canonical Conversation event delivery",
		)
	}
	event := delivery.GetEvent()
	recipient := delivery.GetRecipient()
	if event == nil ||
		recipient == nil ||
		event.GetAuthorityStationPeerId() != string(authorityStation) ||
		event.GetConversationId() != item.ConversationID ||
		event.GetEventId() != item.EventID ||
		event.GetSequence() != int64(item.EventSequence) ||
		recipient.GetPtid() != item.RecipientPTID ||
		recipient.GetDeviceId() != item.RecipientDeviceID ||
		len(delivery.GetDeliveryCommitment()) != 32 {
		return receiptIntegrityError(
			"item",
			"is not bound to the expected follower authority delivery",
		)
	}

	return nil
}

func deliveryKindFromProto(
	kind chat.PreparedEndpointPayloadKind,
) (valueobject.DeliveryKind, error) {
	switch kind {
	case chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_DIRECT_CIPHERTEXT:
		return valueobject.DeliveryKindDirectCiphertext, nil
	case chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_APPLICATION:
		return valueobject.DeliveryKindMLSApplication, nil
	case chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_COMMIT:
		return valueobject.DeliveryKindMLSCommit, nil
	case chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_WELCOME:
		return valueobject.DeliveryKindMLSWelcome, nil
	case chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_PUBLIC_EVENT:
		return valueobject.DeliveryKindPublicEvent, nil
	case chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_CONVERSATION_STATE:
		return valueobject.DeliveryKindConversation, nil
	case chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_RETIREMENT:
		return valueobject.DeliveryKindMLSRetirement, nil
	default:
		return "", receiptIntegrityError(
			"payload_kind",
			"is not supported by the canonical delivery contract",
		)
	}
}

func containsReceiptCommitment(
	commitments []valueobject.Hash,
	expected valueobject.Hash,
) bool {
	for _, commitment := range commitments {
		if commitment == expected {
			return true
		}
	}

	return false
}

func persistAuthorityReceipt(
	tx *gorm.DB,
	expected *AuthorityDeliveryCommitmentModel,
	receipt interaction.DeliveryReceipt,
) (bool, error) {
	candidate := AuthorityDeliveryReceiptModel{
		ReceiptID:          receipt.ReceiptID,
		EventID:            string(receipt.EventID),
		RecipientPTID:      string(receipt.Consumer.Actor),
		RecipientDeviceID:  string(receipt.Consumer.Device),
		SourceHomeStation:  expected.HomeStation,
		ConversationID:     string(receipt.ConversationID),
		EventSequence:      uint64(receipt.EventSequence),
		LaneSequence:       receipt.LaneSequence,
		QueuePayloadSHA256: receipt.PayloadHash.Bytes(),
		CommitmentSHA256:   append([]byte(nil), expected.CommitmentSHA256...),
		ConsumedAt:         receipt.ConsumedAt,
	}
	existing, found, err := findAuthorityReceipt(tx, receipt)
	if err != nil {
		return false, err
	}
	if found {
		if !authorityReceiptMatches(existing, candidate) {
			return false, receiptConflictError()
		}

		return true, nil
	}

	result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&candidate)
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected == 1 {
		return false, nil
	}
	existing, found, err = findAuthorityReceipt(tx, receipt)
	if err != nil {
		return false, err
	}
	if !found || !authorityReceiptMatches(existing, candidate) {
		return false, receiptConflictError()
	}

	return true, nil
}

func findAuthorityReceipt(
	tx *gorm.DB,
	receipt interaction.DeliveryReceipt,
) (AuthorityDeliveryReceiptModel, bool, error) {
	var models []AuthorityDeliveryReceiptModel
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"receipt_id = ? OR (event_id = ? AND recipient_ptid = ? AND recipient_device_id = ?)",
			receipt.ReceiptID,
			string(receipt.EventID),
			string(receipt.Consumer.Actor),
			string(receipt.Consumer.Device),
		).
		Limit(2).
		Find(&models).Error; err != nil {
		return AuthorityDeliveryReceiptModel{}, false, err
	}
	if len(models) == 0 {
		return AuthorityDeliveryReceiptModel{}, false, nil
	}
	if len(models) != 1 {
		return AuthorityDeliveryReceiptModel{}, false, receiptConflictError()
	}

	return models[0], true, nil
}

func authorityReceiptMatches(
	existing AuthorityDeliveryReceiptModel,
	candidate AuthorityDeliveryReceiptModel,
) bool {
	return existing.ReceiptID == candidate.ReceiptID &&
		existing.EventID == candidate.EventID &&
		existing.RecipientPTID == candidate.RecipientPTID &&
		existing.RecipientDeviceID == candidate.RecipientDeviceID &&
		existing.SourceHomeStation == candidate.SourceHomeStation &&
		existing.ConversationID == candidate.ConversationID &&
		existing.EventSequence == candidate.EventSequence &&
		existing.LaneSequence == candidate.LaneSequence &&
		bytes.Equal(
			existing.QueuePayloadSHA256,
			candidate.QueuePayloadSHA256,
		) &&
		bytes.Equal(
			existing.CommitmentSHA256,
			candidate.CommitmentSHA256,
		) &&
		existing.ConsumedAt.Equal(candidate.ConsumedAt)
}

func receiptConflictError() error {
	return interaction.NewError(
		interaction.ErrorCodeIdempotencyConflict,
		"delivery_receipt_recorder.record",
		"receipt_id",
		"already identifies a different persisted receipt",
	)
}

func persistExactReceipt(
	tx *gorm.DB,
	item *DeviceQueueItemModel,
	receipt interaction.DeliveryReceipt,
) (bool, error) {
	if item.ConsumptionReceiptID != nil {
		if *item.ConsumptionReceiptID != receipt.ReceiptID ||
			item.ConsumedAt == nil ||
			!item.ConsumedAt.Equal(receipt.ConsumedAt) {
			return false, receiptConflictError()
		}

		return true, nil
	}

	result := tx.Model(&DeviceQueueItemModel{}).
		Where(
			"item_id = ? AND consumption_receipt_id IS NULL AND state = ?",
			item.ItemID,
			item.State,
		).
		Updates(receiptUpdates(item.State, receipt))
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected != 1 {
		return false, interaction.NewError(
			interaction.ErrorCodeIdempotencyConflict,
			"delivery_receipt_recorder.record",
			"receipt_id",
			"was concurrently recorded with different receipt data",
		)
	}
	item.ConsumptionReceiptID = &receipt.ReceiptID
	consumedAt := receipt.ConsumedAt
	item.ConsumedAt = &consumedAt
	if item.State == storageStateClaimed {
		item.State = storageStateConsumed
	}

	return false, nil
}

func receiptUpdates(
	currentState int32,
	receipt interaction.DeliveryReceipt,
) map[string]any {
	updates := map[string]any{
		"consumption_receipt_id": receipt.ReceiptID,
		"consumed_at":            receipt.ConsumedAt,
	}
	if currentState == storageStateClaimed {
		updates["state"] = storageStateConsumed
	}

	return updates
}

func loadDeliveryAggregate(
	tx *gorm.DB,
	event domainevent.Record,
) (interaction.DeliveryAggregate, error) {
	var commitments []AuthorityDeliveryCommitmentModel
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("event_id = ?", string(event.ID)).
		Order("recipient_ptid ASC, recipient_device_id ASC").
		Find(&commitments).Error; err != nil {
		return interaction.DeliveryAggregate{}, err
	}
	if len(commitments) == 0 ||
		len(commitments) != len(event.DeliveryCommitments) {
		return interaction.DeliveryAggregate{}, receiptIntegrityError(
			"delivery_commitments",
			"does not exactly map the committed authority delivery set",
		)
	}

	eventCommitments := make(
		map[valueobject.Hash]struct{},
		len(event.DeliveryCommitments),
	)
	for _, commitment := range event.DeliveryCommitments {
		if commitment.IsZero() {
			return interaction.DeliveryAggregate{}, receiptIntegrityError(
				"delivery_commitments",
				"contains an empty commitment",
			)
		}
		eventCommitments[commitment] = struct{}{}
	}
	if len(eventCommitments) != len(event.DeliveryCommitments) {
		return interaction.DeliveryAggregate{}, receiptIntegrityError(
			"delivery_commitments",
			"contains duplicate commitments",
		)
	}

	commitmentsByEndpoint := make(
		map[string]AuthorityDeliveryCommitmentModel,
		len(commitments),
	)
	persistedCommitments := make(
		map[valueobject.Hash]struct{},
		len(commitments),
	)
	requiredCommitments := make(
		[]AuthorityDeliveryCommitmentModel,
		0,
		len(commitments),
	)
	for index := range commitments {
		commitment := &commitments[index]
		if err := validateAuthorityCommitmentModel(commitment, event); err != nil {
			return interaction.DeliveryAggregate{}, err
		}
		commitmentHash, err := valueobject.NewHash(commitment.CommitmentSHA256)
		if err != nil {
			return interaction.DeliveryAggregate{}, receiptIntegrityError(
				"delivery_commitment",
				"is not a canonical SHA-256 hash",
			)
		}
		if _, exists := eventCommitments[commitmentHash]; !exists {
			return interaction.DeliveryAggregate{}, receiptIntegrityError(
				"delivery_commitment",
				"is not present in the canonical event",
			)
		}
		if _, duplicate := persistedCommitments[commitmentHash]; duplicate {
			return interaction.DeliveryAggregate{}, receiptIntegrityError(
				"delivery_commitments",
				"maps one authority commitment to multiple endpoints",
			)
		}
		persistedCommitments[commitmentHash] = struct{}{}
		endpoint := valueobject.Endpoint{
			Actor:  valueobject.PTID(commitment.RecipientPTID),
			Device: valueobject.DeviceID(commitment.RecipientDeviceID),
		}
		key := endpoint.Key()
		if _, duplicate := commitmentsByEndpoint[key]; duplicate {
			return interaction.DeliveryAggregate{}, receiptIntegrityError(
				"delivery_commitments",
				"contains duplicate endpoint deliveries",
			)
		}
		commitmentsByEndpoint[key] = *commitment
		if commitment.RequiredRecipient {
			requiredCommitments = append(requiredCommitments, *commitment)
		}
	}
	if len(requiredCommitments) > math.MaxUint32 {
		return interaction.DeliveryAggregate{}, receiptIntegrityError(
			"delivery_commitments",
			"contains too many required recipient endpoints",
		)
	}

	var receipts []AuthorityDeliveryReceiptModel
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("event_id = ?", string(event.ID)).
		Order("recipient_ptid ASC, recipient_device_id ASC").
		Find(&receipts).Error; err != nil {
		return interaction.DeliveryAggregate{}, err
	}
	receiptsByEndpoint := make(
		map[string]AuthorityDeliveryReceiptModel,
		len(receipts),
	)
	for index := range receipts {
		receipt := receipts[index]
		endpoint := valueobject.Endpoint{
			Actor:  valueobject.PTID(receipt.RecipientPTID),
			Device: valueobject.DeviceID(receipt.RecipientDeviceID),
		}
		expected, exists := commitmentsByEndpoint[endpoint.Key()]
		if !exists ||
			receipt.ReceiptID != "device-consumed:"+expected.QueueItemID ||
			receipt.ConversationID != expected.ConversationID ||
			receipt.EventID != expected.EventID ||
			receipt.SourceHomeStation != expected.HomeStation ||
			receipt.EventSequence != expected.EventSequence ||
			receipt.LaneSequence <= 0 ||
			receipt.ConsumedAt.IsZero() ||
			!bytes.Equal(
				receipt.QueuePayloadSHA256,
				expected.QueuePayloadSHA256,
			) ||
			!bytes.Equal(
				receipt.CommitmentSHA256,
				expected.CommitmentSHA256,
			) {
			return interaction.DeliveryAggregate{}, receiptIntegrityError(
				"delivery_receipts",
				"contains a receipt outside its exact authority commitment",
			)
		}
		if _, duplicate := receiptsByEndpoint[endpoint.Key()]; duplicate {
			return interaction.DeliveryAggregate{}, receiptIntegrityError(
				"delivery_receipts",
				"contains duplicate endpoint receipts",
			)
		}
		receiptsByEndpoint[endpoint.Key()] = receipt
	}

	var devices []persistence.ConversationMemberDeviceModel
	if err := tx.Where(
		"conversation_id = ?",
		string(event.ConversationID),
	).Find(&devices).Error; err != nil {
		return interaction.DeliveryAggregate{}, err
	}
	devicesByEndpoint := make(map[string]persistence.ConversationMemberDeviceModel, len(devices))
	for _, device := range devices {
		endpoint := valueobject.Endpoint{
			Actor:  valueobject.PTID(device.PTID),
			Device: valueobject.DeviceID(device.DeviceID),
		}
		devicesByEndpoint[endpoint.Key()] = device
	}

	var consumedCount uint32
	var revokedCount uint32
	for index := range requiredCommitments {
		commitment := requiredCommitments[index]
		endpoint := valueobject.Endpoint{
			Actor:  valueobject.PTID(commitment.RecipientPTID),
			Device: valueobject.DeviceID(commitment.RecipientDeviceID),
		}
		key := endpoint.Key()
		device, exists := devicesByEndpoint[key]
		if !exists {
			return interaction.DeliveryAggregate{}, receiptIntegrityError(
				"conversation_member_devices",
				"is missing a required delivery endpoint",
			)
		}
		if _, consumed := receiptsByEndpoint[key]; consumed {
			consumedCount++
		} else if !device.Active {
			revokedCount++
		}
	}

	var readCount int64
	if err := tx.Model(&persistence.ConversationReadCursorModel{}).
		Where(
			"conversation_id = ? AND ptid != ? AND last_read_sequence >= ?",
			string(event.ConversationID),
			string(event.Actor.Actor),
			uint64(event.Sequence),
		).
		Count(&readCount).Error; err != nil {
		return interaction.DeliveryAggregate{}, err
	}
	required := uint32(len(requiredCommitments))

	return interaction.DeliveryAggregate{
		ConversationID:      event.ConversationID,
		EventID:             event.ID,
		EventSequence:       event.Sequence,
		RequiredDeviceCount: required,
		ConsumedDeviceCount: consumedCount,
		RevokedDeviceCount:  revokedCount,
		Delivered:           consumedCount > 0,
		FullyDelivered: required > 0 &&
			consumedCount+revokedCount == required,
		Read: readCount > 0,
	}, nil
}

func loadOriginatorRoutes(
	tx *gorm.DB,
	event domainevent.Record,
) ([]interaction.EndpointRoute, error) {
	var commitments []AuthorityDeliveryCommitmentModel
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"event_id = ? AND recipient_ptid = ? AND required_recipient = ?",
			string(event.ID),
			string(event.Actor.Actor),
			false,
		).
		Order("recipient_device_id ASC").
		Find(&commitments).Error; err != nil {
		return nil, err
	}
	if len(commitments) == 0 {
		return nil, receiptIntegrityError(
			"originator_deliveries",
			"does not contain an originator synchronization route",
		)
	}
	var devices []persistence.ConversationMemberDeviceModel
	if err := tx.Where(
		"conversation_id = ? AND ptid = ? AND active = ?",
		string(event.ConversationID),
		string(event.Actor.Actor),
		true,
	).Find(&devices).Error; err != nil {
		return nil, err
	}
	activeRoutes := make(map[string]valueobject.StationID, len(devices))
	for _, device := range devices {
		endpoint := valueobject.Endpoint{
			Actor:  valueobject.PTID(device.PTID),
			Device: valueobject.DeviceID(device.DeviceID),
		}
		if endpoint.Validate() != nil || device.HomeStation == "" {
			return nil, receiptIntegrityError(
				"originator_devices",
				"contains an invalid active endpoint route",
			)
		}
		activeRoutes[endpoint.Key()] = valueobject.StationID(device.HomeStation)
	}
	routes := make([]interaction.EndpointRoute, 0, len(commitments))
	seen := make(map[string]struct{}, len(commitments))
	for index := range commitments {
		commitment := &commitments[index]
		if err := validateAuthorityCommitmentModel(commitment, event); err != nil {
			return nil, err
		}
		route := interaction.EndpointRoute{
			Endpoint: valueobject.Endpoint{
				Actor:  valueobject.PTID(commitment.RecipientPTID),
				Device: valueobject.DeviceID(commitment.RecipientDeviceID),
			},
			HomeStation: valueobject.StationID(commitment.HomeStation),
		}
		if route.Endpoint.Validate() != nil ||
			route.Endpoint.Actor != event.Actor.Actor ||
			route.HomeStation == "" {
			return nil, receiptIntegrityError(
				"originator_deliveries",
				"contains an invalid originator route",
			)
		}
		activeHomeStation, active := activeRoutes[route.Endpoint.Key()]
		if !active {
			continue
		}
		if activeHomeStation != route.HomeStation {
			return nil, receiptIntegrityError(
				"originator_devices",
				"does not match the committed Home Station route",
			)
		}
		if _, duplicate := seen[route.Endpoint.Key()]; duplicate {
			return nil, receiptIntegrityError(
				"originator_deliveries",
				"contains a duplicate endpoint route",
			)
		}
		seen[route.Endpoint.Key()] = struct{}{}
		routes = append(routes, route)
	}

	return routes, nil
}

func receiptIntegrityError(field string, message string) error {
	return interaction.NewError(
		interaction.ErrorCodeIntegrityFailed,
		"delivery_receipt_recorder.record",
		field,
		message,
	)
}

var _ interaction.DeliveryReceiptRecorder = (*ReceiptRecorder)(nil)
