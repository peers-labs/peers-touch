package interaction

import (
	"context"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/query"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

// Service owns Conversation typing, read-cursor, and delivery-receipt orchestration.
type Service struct {
	conversations ConversationReader
	devices       DeviceDirectory
	readCursors   ReadCursorAdvancer
	receipts      DeliveryReceiptCommitter
	forwarder     DeliveryReceiptForwarder
	typing        TypingPublisher
	pulses        TypingPulseLedger
	clock         Clock
	policy        Policy
	localStation  valueobject.StationID
}

func NewService(
	conversations ConversationReader,
	devices DeviceDirectory,
	readCursors ReadCursorAdvancer,
	receipts DeliveryReceiptCommitter,
	forwarder DeliveryReceiptForwarder,
	typing TypingPublisher,
	pulses TypingPulseLedger,
	clock Clock,
	policy Policy,
	localStation valueobject.StationID,
) (*Service, error) {
	if conversations == nil || devices == nil || readCursors == nil ||
		receipts == nil || forwarder == nil || typing == nil ||
		pulses == nil || clock == nil ||
		localStation == "" {
		return nil, NewError(
			ErrorCodeInvalidArgument,
			"interaction.new_service",
			"dependencies",
			"Conversation reader, device directory, read cursor, receipt committer, receipt forwarder, typing, pulse ledger, clock, and local Station are required",
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
		forwarder:     forwarder,
		typing:        typing,
		pulses:        pulses,
		clock:         clock,
		policy:        policy,
		localStation:  localStation,
	}, nil
}

// BindAuthorityPorts replaces only the authority persistence views used while
// applying an authenticated Federation receipt inside the shared inbox
// transaction.
func (s *Service) BindAuthorityPorts(
	conversations ConversationReader,
	devices DeviceDirectory,
	receipts DeliveryReceiptCommitter,
) (*Service, error) {
	if s == nil || conversations == nil || devices == nil || receipts == nil {
		return nil, NewError(
			ErrorCodeInvalidArgument,
			"interaction.bind_authority_ports",
			"dependencies",
			"service, Conversation reader, device directory, and receipt recorder are required",
		)
	}
	bound := *s
	bound.conversations = conversations
	bound.devices = devices
	bound.receipts = receipts

	return &bound, nil
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
	_, conversation, err := s.authorizeMemberEndpoint(
		ctx,
		pulse.ConversationID,
		pulse.Sender,
		"",
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
	view, conversation, err := s.authorizeMemberEndpoint(
		ctx,
		receipt.ConversationID,
		receipt.Consumer,
		receipt.SourceStation,
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
	switch view.Source {
	case query.SourceFollower:
		if receipt.SourceStation != "" ||
			view.FollowerStatus != repository.FollowerStatusActive ||
			view.Conversation.AuthorityStation == s.localStation {
			return DeliveryRecordResult{}, NewError(
				ErrorCodeIntegrityFailed,
				"interaction.submit_delivery_receipt",
				"authority",
				"follower receipt route is inconsistent",
			)
		}
		replay, err := s.forwarder.ForwardDeliveryReceipt(
			ctx,
			view.Conversation.AuthorityStation,
			receipt,
		)
		if err != nil {
			if CodeOf(err) != "" {
				return DeliveryRecordResult{}, err
			}
			return DeliveryRecordResult{}, WrapError(
				ErrorCodePersistence,
				"interaction.submit_delivery_receipt.forward",
				err,
			)
		}

		return DeliveryRecordResult{Replay: replay, Forwarded: true}, nil
	case query.SourceAuthority:
		if view.Conversation.AuthorityStation != s.localStation {
			return DeliveryRecordResult{}, NewError(
				ErrorCodeIntegrityFailed,
				"interaction.submit_delivery_receipt",
				"authority",
				"does not identify the local Station",
			)
		}
	default:
		return DeliveryRecordResult{}, NewError(
			ErrorCodeIntegrityFailed,
			"interaction.submit_delivery_receipt",
			"source",
			"is not a canonical Conversation projection",
		)
	}
	result, err := s.receipts.CommitDeliveryReceipt(ctx, receipt)
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
	return result, nil
}

func (s *Service) authorizeMemberEndpoint(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	endpoint valueobject.Endpoint,
	sourceStation valueobject.StationID,
	operation string,
) (query.ConversationView, *aggregate.Conversation, error) {
	view, err := s.conversations.Get(ctx, conversationID, endpoint.Actor)
	if err != nil {
		if conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
			return query.ConversationView{}, nil, NewError(
				ErrorCodeUnauthorized,
				operation,
				"membership",
				"actor is not an active Conversation member",
			)
		}

		return query.ConversationView{}, nil, err
	}
	conversation, err := aggregate.Rehydrate(view.Conversation)
	if err != nil {
		return query.ConversationView{}, nil, err
	}
	if !conversation.Status().Writable() ||
		!conversation.IsActiveMemberEndpoint(endpoint) {
		return query.ConversationView{}, nil, NewError(
			ErrorCodeUnauthorized,
			operation,
			"membership",
			"endpoint is not active in the Conversation",
		)
	}
	if sourceStation != "" {
		if view.Source != query.SourceAuthority ||
			!memberBelongsToStation(conversation, endpoint.Actor, sourceStation) {
			return query.ConversationView{}, nil, NewError(
				ErrorCodeUnauthorized,
				operation,
				"source_station",
				"does not own the authenticated remote endpoint",
			)
		}

		return view, conversation, nil
	}
	active, err := s.devices.IsActive(ctx, endpoint)
	if err != nil {
		return query.ConversationView{}, nil,
			WrapError(ErrorCodePersistence, operation+".authorize_device", err)
	}
	if !active {
		return query.ConversationView{}, nil, NewError(
			ErrorCodeUnauthorized,
			operation,
			"device",
			"is not active for the authenticated actor",
		)
	}

	return view, conversation, nil
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
		aggregate.Delivered !=
			(aggregate.ConsumedDeviceCount > 0 || aggregate.Read) ||
		aggregate.FullyDelivered !=
			(aggregate.RequiredDeviceCount > 0 &&
				aggregate.ConsumedDeviceCount+aggregate.RevokedDeviceCount ==
					aggregate.RequiredDeviceCount) {
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

func memberBelongsToStation(
	conversation *aggregate.Conversation,
	actor valueobject.PTID,
	station valueobject.StationID,
) bool {
	for _, member := range conversation.Members() {
		if member.Actor == actor && member.Active() && member.HomeStation == station {
			return true
		}
	}

	return false
}
