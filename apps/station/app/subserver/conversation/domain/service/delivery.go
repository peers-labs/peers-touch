package service

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"sort"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

const deliveryCommitmentSchemaVersion uint32 = 1

func ValidateExactDeliverySet(
	required []valueobject.Endpoint,
	deliveries []valueobject.PreparedDelivery,
) error {
	requiredKeys := make(map[string]struct{}, len(required))
	for _, endpoint := range required {
		if err := endpoint.Validate(); err != nil {
			return err
		}
		key := endpoint.Key()
		if _, exists := requiredKeys[key]; exists {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeDeliverySetMismatch,
				"domain.validate_delivery_set",
				"required_endpoints",
				"contains a duplicate endpoint",
			)
		}
		requiredKeys[key] = struct{}{}
	}
	seen := make(map[string]struct{}, len(deliveries))
	for index, delivery := range deliveries {
		if err := delivery.Recipient.Validate(); err != nil {
			return err
		}
		if len(delivery.Opaque) == 0 ||
			delivery.Kind == "" ||
			delivery.HomeStation == "" ||
			delivery.PayloadHash.IsZero() {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeDeliverySetMismatch,
				"domain.validate_delivery_set",
				fmt.Sprintf("deliveries[%d]", index),
				"is incomplete",
			)
		}
		actualHash := valueobject.HashBytes(delivery.Opaque)
		if !bytes.Equal(actualHash[:], delivery.PayloadHash[:]) {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeDeliverySetMismatch,
				"domain.validate_delivery_set",
				fmt.Sprintf("deliveries[%d].payload_hash", index),
				"does not match the payload",
			)
		}
		key := delivery.Recipient.Key()
		if _, required := requiredKeys[key]; !required {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeDeliverySetMismatch,
				"domain.validate_delivery_set",
				fmt.Sprintf("deliveries[%d].recipient", index),
				"is not a required endpoint",
			)
		}
		if _, duplicate := seen[key]; duplicate {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeDeliverySetMismatch,
				"domain.validate_delivery_set",
				fmt.Sprintf("deliveries[%d].recipient", index),
				"is duplicated",
			)
		}
		seen[key] = struct{}{}
	}
	if len(seen) != len(requiredKeys) {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeDeliverySetMismatch,
			"domain.validate_delivery_set",
			"deliveries",
			"does not cover the exact required endpoint set",
		)
	}
	return nil
}

func BuildDeliveryCommitments(
	conversationID valueobject.ConversationID,
	eventID valueobject.EventID,
	deliveries []valueobject.PreparedDelivery,
) ([]valueobject.DeliveryCommitment, error) {
	if conversationID == "" || eventID == "" {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"domain.build_delivery_commitments",
			"event",
			"conversation and event identities are required",
		)
	}
	commitments := make([]valueobject.DeliveryCommitment, 0, len(deliveries))
	for _, delivery := range deliveries {
		if err := delivery.Recipient.Validate(); err != nil {
			return nil, err
		}
		kindCode, err := delivery.Kind.CommitmentCode()
		if err != nil {
			return nil, err
		}
		var input bytes.Buffer
		input.WriteString("peers-touch/device-delivery-commitment")
		input.WriteByte(0)
		writeUint32(&input, deliveryCommitmentSchemaVersion)
		writeString(&input, string(conversationID))
		writeString(&input, string(eventID))
		writeString(&input, string(delivery.Recipient.Actor))
		writeString(&input, string(delivery.Recipient.Device))
		writeUint32(&input, kindCode)
		input.Write(delivery.PayloadHash[:])
		hash := valueobject.HashBytes(input.Bytes())
		commitments = append(commitments, valueobject.DeliveryCommitment{
			Recipient: delivery.Recipient,
			Hash:      hash,
		})
	}
	sort.Slice(commitments, func(i int, j int) bool {
		return bytes.Compare(commitments[i].Hash[:], commitments[j].Hash[:]) < 0
	})
	return commitments, nil
}

func writeString(target *bytes.Buffer, value string) {
	writeUint32(target, uint32(len(value)))
	target.WriteString(value)
}

func writeUint32(target *bytes.Buffer, value uint32) {
	var encoded [4]byte
	binary.BigEndian.PutUint32(encoded[:], value)
	target.Write(encoded[:])
}
