package interaction

import (
	"context"
	"strings"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

// Service owns Conversation typing, read-cursor, and delivery-receipt orchestration.
type Service struct {
	conversations ConversationReader
	devices       DeviceDirectory
	readCursors   ReadCursorAdvancer
	receipts      DeliveryReceiptRecorder
	typing        TypingPublisher
	delivery      DeliveryPublisher
	pulses        TypingPulseLedger
	clock         Clock
	policy        Policy
}

func NewService(
	conversations ConversationReader,
	devices DeviceDirectory,
	readCursors ReadCursorAdvancer,
	receipts DeliveryReceiptRecorder,
	typing TypingPublisher,
	delivery DeliveryPublisher,
	pulses TypingPulseLedger,
	clock Clock,
	policy Policy,
) (*Service, error) {
	if conversations == nil || devices == nil || readCursors == nil ||
		receipts == nil || typing == nil || delivery == nil ||
		pulses == nil || clock == nil {
		return nil, NewError(
			ErrorCodeInvalidArgument,
			"interaction.new_service",
			"dependencies",
			"Conversation reader, device directory, read cursor, receipt, typing, delivery, pulse ledger, and clock ports are required",
		)
	}
	if policy.MinimumPulseInterval <= 0 ||
		policy.MaximumTypingTTL <= 0 ||
		policy.MinimumPulseInterval >= policy.MaximumTypingTTL ||
		policy.MaximumFutureClockSkew <= 0 {
		return nil, NewError(
			ErrorCodeInvalidArgument,
			"interaction.new_service",
			"policy",
			"must define positive ordered typing bounds and non-negative clock skew",
		)
	}

	return &Service{
		conversations: conversations,
		devices:       devices,
		readCursors:   readCursors,
		receipts:      receipts,
		typing:        typing,
		delivery:      delivery,
		pulses:        pulses,
		clock:         clock,
		policy:        policy,
	}, nil
}

func (s *Service) SubmitTyping(
	ctx context.Context,
	pulse TypingPulse,
) (TypingResult, error) {
	if pulse.ConversationID == "" ||
		pulse.Sender.Validate() != nil ||
		pulse.Generation == 0 ||
		pulse.ExpiresAt.IsZero() {
		return TypingResult{}, NewError(
			ErrorCodeInvalidArgument,
			"interaction.submit_typing",
			"pulse",
			"must bind conversation, endpoint, generation, and expiry",
		)
	}
	now := s.clock.Now().UTC()
	expiresAt := pulse.ExpiresAt.UTC()
	if !expiresAt.After(now) ||
		expiresAt.After(now.Add(s.policy.MaximumTypingTTL)) {
		return TypingResult{}, NewError(
			ErrorCodeInvalidArgument,
			"interaction.submit_typing",
			"expires_at",
			"must be fresh and within the configured typing TTL",
		)
	}
	pulse.ExpiresAt = expiresAt
	conversation, err := s.authorizeMemberEndpoint(
		ctx,
		pulse.ConversationID,
		pulse.Sender,
		"interaction.submit_typing",
	)
	if err != nil {
		return TypingResult{}, err
	}
	admission, err := s.pulses.Admit(
		ctx,
		pulse,
		now,
		s.policy.MinimumPulseInterval,
	)
	if err != nil || !admission.Accepted {
		return admission, err
	}
	for _, recipient := range conversation.ActiveMemberActors() {
		if recipient == pulse.Sender.Actor {
			continue
		}
		if err := s.typing.PublishTyping(ctx, recipient, pulse); err != nil {
			return TypingResult{}, WrapError(
				ErrorCodePersistence,
				"interaction.submit_typing.publish",
				err,
			)
		}
	}

	return admission, nil
}

func (s *Service) SubmitReadCursor(
	ctx context.Context,
	request ReadCursorRequest,
) (ReadCursorResult, error) {
	if request.ConversationID == "" ||
		request.Reader.Validate() != nil ||
		request.Sequence == 0 {
		return ReadCursorResult{}, NewError(
			ErrorCodeInvalidArgument,
			"interaction.submit_read_cursor",
			"cursor",
			"must bind conversation, reader endpoint, and positive sequence",
		)
	}
	result, err := s.readCursors.AdvanceReadCursor(
		ctx,
		request.ConversationID,
		request.Reader,
		request.Sequence,
	)
	if err != nil {
		return ReadCursorResult{}, err
	}

	return ReadCursorResult{Result: result}, nil
}

func (s *Service) SubmitDeliveryReceipt(
	ctx context.Context,
	receipt DeliveryReceipt,
) (DeliveryRecordResult, error) {
	if !validReceiptID(receipt.ReceiptID) ||
		receipt.ConversationID == "" ||
		receipt.EventID == "" ||
		receipt.Consumer.Validate() != nil ||
		receipt.EventSequence == 0 ||
		receipt.LaneSequence <= 0 ||
		receipt.PayloadHash.IsZero() ||
		receipt.ConsumedAt.IsZero() {
		return DeliveryRecordResult{}, NewError(
			ErrorCodeInvalidArgument,
			"interaction.submit_delivery_receipt",
			"receipt",
			"is incomplete or malformed",
		)
	}
	now := s.clock.Now().UTC()
	receipt.ConsumedAt = receipt.ConsumedAt.UTC()
	if receipt.ConsumedAt.After(now.Add(s.policy.MaximumFutureClockSkew)) {
		return DeliveryRecordResult{}, NewError(
			ErrorCodeInvalidArgument,
			"interaction.submit_delivery_receipt",
			"consumed_at",
			"is beyond the accepted clock skew",
		)
	}
	conversation, err := s.authorizeMemberEndpoint(
		ctx,
		receipt.ConversationID,
		receipt.Consumer,
		"interaction.submit_delivery_receipt",
	)
	if err != nil {
		return DeliveryRecordResult{}, err
	}
	if receipt.EventSequence > conversation.AuthorityHead().Sequence {
		return DeliveryRecordResult{}, NewError(
			ErrorCodeIntegrityFailed,
			"interaction.submit_delivery_receipt",
			"event_sequence",
			"exceeds the current Conversation authority head",
		)
	}
	result, err := s.receipts.Record(ctx, receipt)
	if err != nil {
		return DeliveryRecordResult{}, err
	}
	if err := validateDeliveryAggregate(receipt, result.Aggregate); err != nil {
		return DeliveryRecordResult{}, err
	}
	if result.Originator == "" {
		return DeliveryRecordResult{}, NewError(
			ErrorCodeIntegrityFailed,
			"interaction.submit_delivery_receipt",
			"originator",
			"is missing from the committed event",
		)
	}
	routes, err := s.devices.ListActiveEndpoints(
		ctx,
		[]valueobject.PTID{result.Originator},
	)
	if err != nil {
		return DeliveryRecordResult{}, WrapError(
			ErrorCodePersistence,
			"interaction.submit_delivery_receipt.resolve_originator",
			err,
		)
	}
	seen := make(map[string]struct{}, len(routes))
	for _, route := range routes {
		if route.Endpoint.Validate() != nil ||
			route.Endpoint.Actor != result.Originator ||
			route.HomeStation == "" {
			return DeliveryRecordResult{}, NewError(
				ErrorCodeIntegrityFailed,
				"interaction.submit_delivery_receipt.resolve_originator",
				"route",
				"does not belong to the receipt originator",
			)
		}
		if _, duplicate := seen[route.Endpoint.Key()]; duplicate {
			return DeliveryRecordResult{}, NewError(
				ErrorCodeIntegrityFailed,
				"interaction.submit_delivery_receipt.resolve_originator",
				"route",
				"contains a duplicate endpoint",
			)
		}
		seen[route.Endpoint.Key()] = struct{}{}
		active, err := s.devices.IsActive(ctx, route.Endpoint)
		if err != nil {
			return DeliveryRecordResult{}, WrapError(
				ErrorCodePersistence,
				"interaction.submit_delivery_receipt.authorize_originator_device",
				err,
			)
		}
		if !active {
			return DeliveryRecordResult{}, NewError(
				ErrorCodeIntegrityFailed,
				"interaction.submit_delivery_receipt.resolve_originator",
				"route",
				"contains an inactive endpoint",
			)
		}
		if route.Endpoint == receipt.Consumer {
			continue
		}
		idempotencyKey := valueobject.HashBytes(valueobject.CanonicalTuple(
			[]byte("conversation-delivery-receipt"),
			[]byte(receipt.ReceiptID),
			[]byte(route.Endpoint.Actor),
			[]byte(route.Endpoint.Device),
		)).String()
		if err := s.delivery.PublishDeliveryAggregate(
			ctx,
			route.Endpoint,
			result.Aggregate,
			idempotencyKey,
		); err != nil {
			return DeliveryRecordResult{}, WrapError(
				ErrorCodePersistence,
				"interaction.submit_delivery_receipt.publish",
				err,
			)
		}
	}

	return result, nil
}

func (s *Service) authorizeMemberEndpoint(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	endpoint valueobject.Endpoint,
	operation string,
) (*aggregate.Conversation, error) {
	view, err := s.conversations.Get(ctx, conversationID, endpoint.Actor)
	if err != nil {
		if conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
			return nil, NewError(
				ErrorCodeUnauthorized,
				operation,
				"membership",
				"actor is not an active Conversation member",
			)
		}

		return nil, err
	}
	conversation, err := aggregate.Rehydrate(view.Conversation)
	if err != nil {
		return nil, err
	}
	if !conversation.Status().Writable() ||
		!containsEndpoint(conversation.ActiveEndpoints(), endpoint) {
		return nil, NewError(
			ErrorCodeUnauthorized,
			operation,
			"membership",
			"endpoint is not active in the Conversation",
		)
	}
	active, err := s.devices.IsActive(ctx, endpoint)
	if err != nil {
		return nil, WrapError(ErrorCodePersistence, operation+".authorize_device", err)
	}
	if !active {
		return nil, NewError(
			ErrorCodeUnauthorized,
			operation,
			"device",
			"is not active for the authenticated actor",
		)
	}

	return conversation, nil
}

func validateDeliveryAggregate(
	receipt DeliveryReceipt,
	aggregate DeliveryAggregate,
) error {
	if aggregate.ConversationID != receipt.ConversationID ||
		aggregate.EventID != receipt.EventID ||
		aggregate.EventSequence != receipt.EventSequence ||
		aggregate.ConsumedDeviceCount > aggregate.RequiredDeviceCount ||
		aggregate.RevokedDeviceCount > aggregate.RequiredDeviceCount ||
		aggregate.ConsumedDeviceCount+aggregate.RevokedDeviceCount >
			aggregate.RequiredDeviceCount ||
		aggregate.Delivered != (aggregate.ConsumedDeviceCount > 0) ||
		aggregate.FullyDelivered !=
			(aggregate.RequiredDeviceCount > 0 &&
				aggregate.ConsumedDeviceCount+aggregate.RevokedDeviceCount ==
					aggregate.RequiredDeviceCount) ||
		(aggregate.Read && !aggregate.Delivered) {
		return NewError(
			ErrorCodeIntegrityFailed,
			"interaction.validate_delivery_aggregate",
			"delivery",
			"does not match the committed consumption receipt",
		)
	}

	return nil
}

func validReceiptID(value string) bool {
	return strings.HasPrefix(value, "device-consumed:") &&
		len(value) > len("device-consumed:") &&
		len(value) <= 255 &&
		strings.TrimSpace(value) == value
}

func containsEndpoint(endpoints []valueobject.Endpoint, expected valueobject.Endpoint) bool {
	for _, endpoint := range endpoints {
		if endpoint == expected {
			return true
		}
	}

	return false
}
