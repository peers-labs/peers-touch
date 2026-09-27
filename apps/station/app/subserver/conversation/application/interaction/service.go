package interaction

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/command"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/query"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

const maximumTypingRecipients = 256

// Service owns Conversation typing, read-cursor, and delivery-receipt orchestration.
type Service struct {
	conversations ConversationReader
	devices       DeviceDirectory
	readCursors   ReadCursorAdvancer
	cursorForward ReadCursorForwarder
	receipts      DeliveryReceiptCommitter
	forwarder     DeliveryReceiptForwarder
	typing        TypingPublisher
	pulses        TypingPulseLedger
	typingRoutes  TypingRouteDirectory
	typingFrames  TypingFederationDispatcher
	clock         Clock
	policy        Policy
	localStation  valueobject.StationID
}

func NewService(
	conversations ConversationReader,
	devices DeviceDirectory,
	readCursors ReadCursorAdvancer,
	cursorForward ReadCursorForwarder,
	receipts DeliveryReceiptCommitter,
	forwarder DeliveryReceiptForwarder,
	typing TypingPublisher,
	pulses TypingPulseLedger,
	clock Clock,
	policy Policy,
	localStation valueobject.StationID,
) (*Service, error) {
	if conversations == nil || devices == nil || readCursors == nil || cursorForward == nil ||
		receipts == nil || forwarder == nil || typing == nil ||
		pulses == nil || clock == nil ||
		localStation == "" {
		return nil, NewError(
			ErrorCodeInvalidArgument,
			"interaction.new_service",
			"dependencies",
			"Conversation reader, device directory, read cursor advancer and forwarder, receipt committer and forwarder, typing, pulse ledger, clock, and local Station are required",
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
		cursorForward: cursorForward,
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

// BindReadCursorAuthorityPorts replaces only the authority persistence views
// used while applying an authenticated Federation read cursor.
func (s *Service) BindReadCursorAuthorityPorts(
	conversations ConversationReader,
	devices DeviceDirectory,
	readCursors ReadCursorAdvancer,
) (*Service, error) {
	if s == nil || conversations == nil || devices == nil || readCursors == nil {
		return nil, NewError(
			ErrorCodeInvalidArgument,
			"interaction.bind_read_cursor_authority_ports",
			"dependencies",
			"service, Conversation reader, device directory, and read cursor advancer are required",
		)
	}
	bound := *s
	bound.conversations = conversations
	bound.devices = devices
	bound.readCursors = readCursors

	return &bound, nil
}

// BindFederatedTyping installs the verified route and signed ephemeral dispatch ports.
func (s *Service) BindFederatedTyping(
	routes TypingRouteDirectory,
	frames TypingFederationDispatcher,
) (*Service, error) {
	if s == nil || routes == nil || frames == nil {
		return nil, NewError(
			ErrorCodeInvalidArgument,
			"interaction.bind_federated_typing",
			"dependencies",
			"service, verified route directory, and Federation dispatcher are required",
		)
	}
	bound := *s
	bound.typingRoutes = routes
	bound.typingFrames = frames

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
	if !s.typingExpiryWithinBounds(expiresAt, now) {
		return TypingResult{}, NewError(
			ErrorCodeInvalidArgument,
			"interaction.submit_typing",
			"expires_at",
			"must be fresh and within the configured typing TTL and clock skew",
		)
	}
	pulse.ExpiresAt = expiresAt
	view, _, err := s.authorizeMemberEndpoint(
		ctx,
		pulse.ConversationID,
		pulse.Sender,
		"",
		"interaction.submit_typing",
	)
	if err != nil {
		return TypingResult{}, err
	}
	if s.typingFrames == nil {
		return TypingResult{}, NewError(
			ErrorCodeInvalidArgument,
			"interaction.submit_typing",
			"federation",
			"ephemeral Federation dispatcher is not configured",
		)
	}
	pulse.Scope = "sender-home"
	admission, err := s.pulses.Admit(
		ctx,
		pulse,
		now,
		s.policy.MinimumPulseInterval,
	)
	if err != nil || !admission.Accepted {
		return admission, err
	}
	_, err = s.typingFrames.DispatchTyping(
		ctx,
		view.Conversation.AuthorityStation,
		FederatedTypingSignal{
			Phase:             FederatedTypingPhaseAuthorityAdmission,
			FederationID:      view.Conversation.FederationID,
			ConversationID:    pulse.ConversationID,
			AuthorityStation:  view.Conversation.AuthorityStation,
			AuthorityEpoch:    view.Conversation.AuthorityEpoch,
			Sender:            pulse.Sender,
			SenderHomeStation: s.localStation,
			Generation:        pulse.Generation,
			ExpiresAt:         pulse.ExpiresAt,
			IsTyping:          pulse.IsTyping,
		},
	)
	if err != nil {
		return TypingResult{}, WrapError(
			ErrorCodePersistence,
			"interaction.submit_typing.dispatch",
			err,
		)
	}

	return admission, nil
}

// ReceiveFederatedTyping applies one verified authority-admission or Home-fan-out hop.
func (s *Service) ReceiveFederatedTyping(
	ctx context.Context,
	source valueobject.StationID,
	signal FederatedTypingSignal,
) (FederatedTypingResult, error) {
	if err := s.validateFederatedTypingSignal(source, signal); err != nil {
		return FederatedTypingResult{}, err
	}
	switch signal.Phase {
	case FederatedTypingPhaseAuthorityAdmission:
		return s.receiveTypingAuthorityAdmission(ctx, source, signal)
	case FederatedTypingPhaseHomeFanout:
		return s.receiveTypingHomeFanout(ctx, source, signal)
	default:
		return FederatedTypingResult{}, NewError(
			ErrorCodeInvalidArgument,
			"interaction.receive_federated_typing",
			"phase",
			"is unsupported",
		)
	}
}

func (s *Service) receiveTypingAuthorityAdmission(
	ctx context.Context,
	source valueobject.StationID,
	signal FederatedTypingSignal,
) (FederatedTypingResult, error) {
	if signal.AuthorityStation != s.localStation ||
		source != signal.SenderHomeStation ||
		len(signal.Recipients) != 0 {
		return FederatedTypingResult{}, NewError(
			ErrorCodeUnauthorized,
			"interaction.receive_typing_authority_admission",
			"route",
			"must originate at the verified sender Home and target the Authority",
		)
	}
	view, err := s.conversations.Get(ctx, signal.ConversationID, signal.Sender.Actor)
	if err != nil {
		return FederatedTypingResult{}, err
	}
	conversation, err := aggregate.Rehydrate(view.Conversation)
	if err != nil {
		return FederatedTypingResult{}, err
	}
	if view.Source != query.SourceAuthority ||
		view.Conversation.FederationID != signal.FederationID ||
		view.Conversation.AuthorityStation != s.localStation ||
		view.Conversation.AuthorityEpoch != signal.AuthorityEpoch ||
		!conversation.Status().Writable() ||
		!conversation.IsActiveMember(signal.Sender.Actor) ||
		!memberBelongsToStation(conversation, signal.Sender.Actor, source) {
		return FederatedTypingResult{}, NewError(
			ErrorCodeUnauthorized,
			"interaction.receive_typing_authority_admission",
			"conversation",
			"does not match active Authority membership",
		)
	}
	routes, err := s.activeTypingRoutes(ctx, conversation)
	if err != nil {
		return FederatedTypingResult{}, err
	}
	senderActive := false
	recipientsByHome := make(map[valueobject.StationID]map[valueobject.PTID]struct{})
	for _, route := range routes {
		if route.Endpoint == signal.Sender &&
			route.HomeStation == signal.SenderHomeStation {
			senderActive = true
		}
		if route.Endpoint.Actor == signal.Sender.Actor {
			continue
		}
		recipients := recipientsByHome[route.HomeStation]
		if recipients == nil {
			recipients = make(map[valueobject.PTID]struct{})
			recipientsByHome[route.HomeStation] = recipients
		}
		recipients[route.Endpoint.Actor] = struct{}{}
	}
	if !senderActive {
		return FederatedTypingResult{}, NewError(
			ErrorCodeUnauthorized,
			"interaction.receive_typing_authority_admission",
			"sender",
			"is not an active endpoint at the verified Home Station",
		)
	}
	admission, err := s.admitFederatedPulse(ctx, signal, "authority")
	if err != nil {
		return FederatedTypingResult{}, err
	}
	if !admission.Accepted {
		return FederatedTypingResult{Duplicate: true}, nil
	}

	result := FederatedTypingResult{Accepted: true}
	stations := sortedTypingStations(recipientsByHome)
	for _, station := range stations {
		recipients := sortedTypingRecipients(recipientsByHome[station])
		result.Attempted++
		delivered, dispatchErr := s.typingFrames.DispatchTyping(
			ctx,
			station,
			FederatedTypingSignal{
				Phase:             FederatedTypingPhaseHomeFanout,
				FederationID:      signal.FederationID,
				ConversationID:    signal.ConversationID,
				AuthorityStation:  signal.AuthorityStation,
				AuthorityEpoch:    signal.AuthorityEpoch,
				Sender:            signal.Sender,
				SenderHomeStation: signal.SenderHomeStation,
				Generation:        signal.Generation,
				ExpiresAt:         signal.ExpiresAt,
				IsTyping:          signal.IsTyping,
				Recipients:        recipients,
			},
		)
		if dispatchErr != nil {
			result.Dropped++
			continue
		}
		result.Delivered += delivered.Delivered
		result.Dropped += delivered.Dropped
	}

	return result, nil
}

func (s *Service) receiveTypingHomeFanout(
	ctx context.Context,
	source valueobject.StationID,
	signal FederatedTypingSignal,
) (FederatedTypingResult, error) {
	if source != signal.AuthorityStation ||
		len(signal.Recipients) == 0 {
		return FederatedTypingResult{}, NewError(
			ErrorCodeUnauthorized,
			"interaction.receive_typing_home_fanout",
			"route",
			"must originate at the Authority with explicit recipients",
		)
	}
	view, err := s.conversations.Get(
		ctx,
		signal.ConversationID,
		signal.Recipients[0],
	)
	if err != nil {
		return FederatedTypingResult{}, err
	}
	conversation, err := aggregate.Rehydrate(view.Conversation)
	if err != nil {
		return FederatedTypingResult{}, err
	}
	if view.Conversation.FederationID != signal.FederationID ||
		view.Conversation.AuthorityStation != source ||
		view.Conversation.AuthorityEpoch != signal.AuthorityEpoch ||
		!conversation.Status().Writable() ||
		!conversation.IsActiveMember(signal.Sender.Actor) ||
		!memberBelongsToStation(
			conversation,
			signal.Sender.Actor,
			signal.SenderHomeStation,
		) {
		return FederatedTypingResult{}, NewError(
			ErrorCodeUnauthorized,
			"interaction.receive_typing_home_fanout",
			"conversation",
			"does not match the verified Authority projection",
		)
	}
	for _, recipient := range signal.Recipients {
		if recipient == signal.Sender.Actor ||
			!conversation.IsActiveMember(recipient) ||
			!memberBelongsToStation(conversation, recipient, s.localStation) {
			return FederatedTypingResult{}, NewError(
				ErrorCodeUnauthorized,
				"interaction.receive_typing_home_fanout",
				"recipient",
				"is not an active actor at this Home Station",
			)
		}
	}
	routes, err := s.typingRoutes.ListActiveEndpoints(ctx, signal.Recipients)
	if err != nil {
		return FederatedTypingResult{}, WrapError(
			ErrorCodePersistence,
			"interaction.receive_typing_home_fanout.routes",
			err,
		)
	}
	activeRecipients := make(map[valueobject.PTID]struct{}, len(signal.Recipients))
	for _, route := range routes {
		if route.Endpoint.Validate() != nil ||
			route.HomeStation != s.localStation {
			return FederatedTypingResult{}, NewError(
				ErrorCodeIntegrityFailed,
				"interaction.receive_typing_home_fanout",
				"route",
				"is invalid or belongs to another Home Station",
			)
		}
		activeRecipients[route.Endpoint.Actor] = struct{}{}
	}
	if len(activeRecipients) != len(signal.Recipients) {
		return FederatedTypingResult{}, NewError(
			ErrorCodeUnauthorized,
			"interaction.receive_typing_home_fanout",
			"recipient",
			"has no active endpoint at this Home Station",
		)
	}
	admission, err := s.admitFederatedPulse(
		ctx,
		signal,
		"recipient-home:"+string(s.localStation),
	)
	if err != nil {
		return FederatedTypingResult{}, err
	}
	if !admission.Accepted {
		return FederatedTypingResult{Duplicate: true}, nil
	}

	result := FederatedTypingResult{
		Accepted:  true,
		Attempted: len(signal.Recipients),
	}
	pulse := typingPulseFromSignal(signal, "recipient-publish")
	for _, recipient := range signal.Recipients {
		if err := s.typing.PublishTyping(ctx, recipient, pulse); err != nil {
			result.Dropped++
			continue
		}
		result.Delivered++
	}

	return result, nil
}

func (s *Service) validateFederatedTypingSignal(
	source valueobject.StationID,
	signal FederatedTypingSignal,
) error {
	now := s.clock.Now().UTC()
	if source == "" ||
		signal.FederationID == "" ||
		signal.ConversationID == "" ||
		signal.AuthorityStation == "" ||
		signal.AuthorityEpoch <= 0 ||
		signal.Sender.Validate() != nil ||
		signal.SenderHomeStation == "" ||
		signal.Generation == 0 ||
		signal.ExpiresAt.IsZero() ||
		!s.typingExpiryWithinBounds(signal.ExpiresAt, now) ||
		len(signal.Recipients) > maximumTypingRecipients {
		return NewError(
			ErrorCodeInvalidArgument,
			"interaction.receive_federated_typing",
			"signal",
			"is incomplete, expired, or outside bounded typing policy",
		)
	}
	seen := make(map[valueobject.PTID]struct{}, len(signal.Recipients))
	for _, recipient := range signal.Recipients {
		if strings.TrimSpace(string(recipient)) == "" ||
			string(recipient) != strings.TrimSpace(string(recipient)) {
			return NewError(
				ErrorCodeInvalidArgument,
				"interaction.receive_federated_typing",
				"recipient",
				"is invalid",
			)
		}
		if _, duplicate := seen[recipient]; duplicate {
			return NewError(
				ErrorCodeInvalidArgument,
				"interaction.receive_federated_typing",
				"recipient",
				"is duplicated",
			)
		}
		seen[recipient] = struct{}{}
	}

	return nil
}

func (s *Service) activeTypingRoutes(
	ctx context.Context,
	conversation *aggregate.Conversation,
) ([]EndpointRoute, error) {
	if s.typingRoutes == nil || s.typingFrames == nil {
		return nil, NewError(
			ErrorCodeInvalidArgument,
			"interaction.active_typing_routes",
			"federation",
			"typing route and dispatch ports are not configured",
		)
	}
	routes, err := s.typingRoutes.ListActiveEndpoints(
		ctx,
		conversation.ActiveMemberActors(),
	)
	if err != nil {
		return nil, WrapError(
			ErrorCodePersistence,
			"interaction.active_typing_routes",
			err,
		)
	}
	seenEndpoints := make(map[string]struct{}, len(routes))
	for _, route := range routes {
		if route.Endpoint.Validate() != nil ||
			route.HomeStation == "" ||
			!conversation.IsActiveMember(route.Endpoint.Actor) ||
			!memberBelongsToStation(
				conversation,
				route.Endpoint.Actor,
				route.HomeStation,
			) {
			return nil, NewError(
				ErrorCodeIntegrityFailed,
				"interaction.active_typing_routes",
				"route",
				"does not match active Conversation membership",
			)
		}
		if _, duplicate := seenEndpoints[route.Endpoint.Key()]; duplicate {
			return nil, NewError(
				ErrorCodeIntegrityFailed,
				"interaction.active_typing_routes",
				"route",
				"contains a duplicate endpoint",
			)
		}
		seenEndpoints[route.Endpoint.Key()] = struct{}{}
	}

	return routes, nil
}

func (s *Service) admitFederatedPulse(
	ctx context.Context,
	signal FederatedTypingSignal,
	scope string,
) (TypingResult, error) {
	return s.pulses.Admit(
		ctx,
		typingPulseFromSignal(signal, scope),
		s.clock.Now().UTC(),
		s.policy.MinimumPulseInterval,
	)
}

func (s *Service) typingExpiryWithinBounds(
	expiresAt time.Time,
	now time.Time,
) bool {
	latest := now.
		Add(s.policy.MaximumTypingTTL).
		Add(s.policy.MaximumFutureClockSkew)

	return expiresAt.After(now) && !expiresAt.After(latest)
}

func typingPulseFromSignal(
	signal FederatedTypingSignal,
	scope string,
) TypingPulse {
	return TypingPulse{
		ConversationID: signal.ConversationID,
		Sender:         signal.Sender,
		Generation:     signal.Generation,
		ExpiresAt:      signal.ExpiresAt.UTC(),
		IsTyping:       signal.IsTyping,
		Scope:          scope,
	}
}

func sortedTypingStations(
	recipients map[valueobject.StationID]map[valueobject.PTID]struct{},
) []valueobject.StationID {
	stations := make([]valueobject.StationID, 0, len(recipients))
	for station := range recipients {
		stations = append(stations, station)
	}
	sort.Slice(stations, func(left int, right int) bool {
		return stations[left] < stations[right]
	})

	return stations
}

func sortedTypingRecipients(
	recipients map[valueobject.PTID]struct{},
) []valueobject.PTID {
	actors := make([]valueobject.PTID, 0, len(recipients))
	for actor := range recipients {
		actors = append(actors, actor)
	}
	sort.Slice(actors, func(left int, right int) bool {
		return actors[left] < actors[right]
	})

	return actors
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
	view, _, err := s.authorizeMemberEndpoint(
		ctx,
		request.ConversationID,
		request.Reader,
		request.SourceStation,
		"interaction.submit_read_cursor",
	)
	if err != nil {
		return ReadCursorResult{}, err
	}
	if request.Sequence > view.Conversation.Head.Sequence {
		return ReadCursorResult{}, NewError(
			ErrorCodeIntegrityFailed,
			"interaction.submit_read_cursor",
			"sequence",
			"cannot exceed the authority head",
		)
	}
	switch view.Source {
	case query.SourceFollower:
		if request.SourceStation != "" ||
			view.FollowerStatus != repository.FollowerStatusActive ||
			view.Conversation.AuthorityStation == s.localStation {
			return ReadCursorResult{}, NewError(
				ErrorCodeIntegrityFailed,
				"interaction.submit_read_cursor",
				"authority",
				"follower read cursor route is inconsistent",
			)
		}
		replay, err := s.cursorForward.ForwardReadCursor(
			ctx,
			view.Conversation.AuthorityStation,
			view.Conversation.FederationID,
			view.Conversation.AuthorityEpoch,
			request,
		)
		if err != nil {
			if CodeOf(err) != "" {
				return ReadCursorResult{}, err
			}
			return ReadCursorResult{}, WrapError(
				ErrorCodePersistence,
				"interaction.submit_read_cursor.forward",
				err,
			)
		}
		return ReadCursorResult{
			Result: command.ReadCursorResult{
				Cursor: repository.ReadCursor{
					ConversationID: request.ConversationID,
					Actor:          request.Reader.Actor,
					Sequence:       request.Sequence,
					UpdatedAt:      s.clock.Now().UTC(),
				},
			},
			Replay:    replay,
			Forwarded: true,
		}, nil
	case query.SourceAuthority:
		if view.Conversation.AuthorityStation != s.localStation {
			return ReadCursorResult{}, NewError(
				ErrorCodeIntegrityFailed,
				"interaction.submit_read_cursor",
				"authority",
				"does not identify the local Station",
			)
		}
	default:
		return ReadCursorResult{}, NewError(
			ErrorCodeIntegrityFailed,
			"interaction.submit_read_cursor",
			"source",
			"is not a canonical Conversation projection",
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
