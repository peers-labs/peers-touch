package delivery

import (
	"bytes"
	"context"
	"errors"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	domainservice "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/service"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// AuthorityLedgerWriter records the endpoint identities hidden by public
// delivery commitments. It must be bound to the authority command transaction.
type AuthorityLedgerWriter struct {
	db *gorm.DB
}

// NewAuthorityLedgerWriter creates a transaction-scoped commitment writer.
func NewAuthorityLedgerWriter(db *gorm.DB) (*AuthorityLedgerWriter, error) {
	if db == nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"delivery_authority_ledger.new",
			"database",
			"is required",
		)
	}

	return &AuthorityLedgerWriter{db: db}, nil
}

// RecordCommitments stores one complete immutable event delivery set.
func (w *AuthorityLedgerWriter) RecordCommitments(
	ctx context.Context,
	commitments []ports.AuthorityDeliveryCommitment,
) error {
	if len(commitments) == 0 {
		return deliverySetError("commitments", "must not be empty")
	}

	first := commitments[0]
	seenEndpoints := make(map[string]struct{}, len(commitments))
	seenCommitments := make(map[valueobject.Hash]struct{}, len(commitments))
	for _, commitment := range commitments {
		if err := validateAuthorityDeliveryCommitment(first, commitment); err != nil {
			return err
		}
		endpointKey := commitment.Recipient.Key()
		if _, duplicate := seenEndpoints[endpointKey]; duplicate {
			return deliverySetError("recipient", "is duplicated in the authority delivery set")
		}
		seenEndpoints[endpointKey] = struct{}{}
		if _, duplicate := seenCommitments[commitment.Commitment]; duplicate {
			return deliverySetError("delivery_commitment", "is duplicated in the authority delivery set")
		}
		seenCommitments[commitment.Commitment] = struct{}{}

		expected, err := domainservice.BuildDeliveryCommitments(
			commitment.ConversationID,
			commitment.EventID,
			[]valueobject.PreparedDelivery{{
				Recipient:   commitment.Recipient,
				HomeStation: commitment.HomeStation,
				Kind:        commitment.PayloadKind,
				PayloadHash: commitment.EndpointPayloadHash,
			}},
		)
		if err != nil ||
			len(expected) != 1 ||
			expected[0].Hash != commitment.Commitment {
			return deliverySetError(
				"delivery_commitment",
				"does not match its exact endpoint payload provenance",
			)
		}
		if err := w.recordCommitment(ctx, commitment); err != nil {
			return err
		}
	}

	var persistedCount int64
	if err := w.db.WithContext(ctx).
		Model(&AuthorityDeliveryCommitmentModel{}).
		Where("event_id = ?", string(first.EventID)).
		Count(&persistedCount).Error; err != nil {
		return err
	}
	if persistedCount != int64(len(commitments)) {
		return deliverySetError(
			"commitments",
			"conflict with the persisted authority delivery-set cardinality",
		)
	}

	return nil
}

func validateAuthorityDeliveryCommitment(
	first ports.AuthorityDeliveryCommitment,
	commitment ports.AuthorityDeliveryCommitment,
) error {
	if commitment.ConversationID == "" ||
		commitment.EventID == "" ||
		commitment.EventSequence == 0 ||
		commitment.Originator == "" ||
		commitment.Recipient.Validate() != nil ||
		commitment.HomeStation == "" ||
		commitment.PayloadKind == "" ||
		commitment.EndpointPayloadHash.IsZero() ||
		commitment.Commitment.IsZero() ||
		strings.TrimSpace(commitment.QueueItemID) == "" ||
		commitment.QueuePayloadHash.IsZero() ||
		commitment.CreatedAt.IsZero() {
		return deliverySetError(
			"commitment",
			"is incomplete",
		)
	}
	if commitment.ConversationID != first.ConversationID ||
		commitment.EventID != first.EventID ||
		commitment.EventSequence != first.EventSequence ||
		commitment.Originator != first.Originator ||
		!commitment.CreatedAt.Equal(first.CreatedAt) {
		return deliverySetError(
			"commitment",
			"does not belong to the same authority event",
		)
	}
	if commitment.RequiredRecipient !=
		(commitment.Recipient.Actor != commitment.Originator) {
		return deliverySetError(
			"required_recipient",
			"must exclude every originating-actor synchronization delivery",
		)
	}

	return nil
}

func (w *AuthorityLedgerWriter) recordCommitment(
	ctx context.Context,
	commitment ports.AuthorityDeliveryCommitment,
) error {
	var existing AuthorityDeliveryCommitmentModel
	err := w.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		First(
			&existing,
			"event_id = ? AND recipient_ptid = ? AND recipient_device_id = ?",
			string(commitment.EventID),
			string(commitment.Recipient.Actor),
			string(commitment.Recipient.Device),
		).
		Error
	switch {
	case err == nil:
		if !authorityCommitmentMatches(existing, commitment) {
			return deliverySetError(
				"commitment",
				"conflicts with an existing authority delivery",
			)
		}

		return nil
	case !errors.Is(err, gorm.ErrRecordNotFound):
		return err
	}

	return w.db.WithContext(ctx).Create(&AuthorityDeliveryCommitmentModel{
		EventID:               string(commitment.EventID),
		RecipientPTID:         string(commitment.Recipient.Actor),
		RecipientDeviceID:     string(commitment.Recipient.Device),
		ConversationID:        string(commitment.ConversationID),
		EventSequence:         uint64(commitment.EventSequence),
		OriginatorPTID:        string(commitment.Originator),
		HomeStation:           string(commitment.HomeStation),
		PayloadKind:           string(commitment.PayloadKind),
		EndpointPayloadSHA256: commitment.EndpointPayloadHash.Bytes(),
		CommitmentSHA256:      commitment.Commitment.Bytes(),
		QueueItemID:           commitment.QueueItemID,
		QueuePayloadSHA256:    commitment.QueuePayloadHash.Bytes(),
		RequiredRecipient:     commitment.RequiredRecipient,
		CreatedAt:             commitment.CreatedAt.UTC(),
	}).Error
}

func authorityCommitmentMatches(
	model AuthorityDeliveryCommitmentModel,
	commitment ports.AuthorityDeliveryCommitment,
) bool {
	return model.EventID == string(commitment.EventID) &&
		model.RecipientPTID == string(commitment.Recipient.Actor) &&
		model.RecipientDeviceID == string(commitment.Recipient.Device) &&
		model.ConversationID == string(commitment.ConversationID) &&
		model.EventSequence == uint64(commitment.EventSequence) &&
		model.OriginatorPTID == string(commitment.Originator) &&
		model.HomeStation == string(commitment.HomeStation) &&
		model.PayloadKind == string(commitment.PayloadKind) &&
		bytes.Equal(
			model.EndpointPayloadSHA256,
			commitment.EndpointPayloadHash.Bytes(),
		) &&
		bytes.Equal(model.CommitmentSHA256, commitment.Commitment.Bytes()) &&
		model.QueueItemID == commitment.QueueItemID &&
		bytes.Equal(
			model.QueuePayloadSHA256,
			commitment.QueuePayloadHash.Bytes(),
		) &&
		model.RequiredRecipient == commitment.RequiredRecipient &&
		model.CreatedAt.Equal(commitment.CreatedAt.UTC())
}

func deliverySetError(field string, message string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeDeliverySetMismatch,
		"delivery_authority_ledger.record",
		field,
		message,
	)
}

var _ ports.AuthorityDeliveryCommitmentWriter = (*AuthorityLedgerWriter)(nil)
