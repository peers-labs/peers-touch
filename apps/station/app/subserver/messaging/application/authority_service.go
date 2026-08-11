package application

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const deliveryCommitmentDomain = "peers-touch/device-delivery-commitment"
const deliveryPlanDomain = "peers-touch/messaging-send-delivery-plan"

type AuthorityService struct {
	unitOfWork       messaging.AuthorityUnitOfWork
	localStationID   string
	frameSigner      messaging.FederationFrameSigner
	manifestResolver messaging.EndpointManifestResolver
	clock            func() time.Time
}

func NewAuthorityService(
	unitOfWork messaging.AuthorityUnitOfWork,
	localStationID string,
	frameSigner messaging.FederationFrameSigner,
	manifestResolver messaging.EndpointManifestResolver,
	clock func() time.Time,
) (*AuthorityService, error) {
	if unitOfWork == nil ||
		localStationID == "" ||
		frameSigner == nil ||
		manifestResolver == nil ||
		clock == nil {
		return nil, fmt.Errorf("messaging: authority dependencies are required")
	}
	return &AuthorityService{
		unitOfWork:       unitOfWork,
		localStationID:   localStationID,
		frameSigner:      frameSigner,
		manifestResolver: manifestResolver,
		clock:            clock,
	}, nil
}

func (s *AuthorityService) PrepareSend(
	ctx context.Context,
	request *chat.PrepareMessagingSendRequest,
) (*chat.PrepareMessagingSendResponse, error) {
	if request == nil ||
		request.ConversationId == "" ||
		request.Sender == nil ||
		request.Sender.Ptid == "" ||
		request.Sender.DeviceId == "" ||
		request.AuthorityStationId != s.localStationID {
		return nil, fmt.Errorf("messaging: complete send preparation identity is required")
	}
	actors, err := s.activeConversationActors(ctx, request.ConversationId)
	if err != nil {
		return nil, err
	}
	if err := resolveEndpointManifests(ctx, s.manifestResolver, actors); err != nil {
		return nil, err
	}
	var plan *chat.PrepareMessagingSendResponse
	err = s.unitOfWork.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		conversation, err := repositories.Authority.LockConversation(
			ctx,
			request.ConversationId,
		)
		if err != nil {
			return err
		}
		if !conversation.Active {
			return messaging.ErrConversationState
		}
		active, err := repositories.Devices.IsActive(ctx, request.Sender)
		if err != nil {
			return err
		}
		if !active {
			return messaging.ErrSenderUnauthorized
		}
		plan, err = buildSendPlan(
			ctx,
			repositories,
			conversation,
			request.Sender,
			s.localStationID,
			s.clock().UTC(),
		)
		return err
	})
	if err != nil {
		return nil, err
	}
	return plan, nil
}

func (s *AuthorityService) activeConversationActors(
	ctx context.Context,
	conversationID string,
) ([]string, error) {
	var actors []string
	err := s.unitOfWork.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		devices, err := repositories.Authority.ListActiveMemberDevices(ctx, conversationID)
		if err != nil {
			return err
		}
		actorSet := make(map[string]struct{})
		for _, device := range devices {
			if device.Active && device.Endpoint != nil {
				actorSet[device.Endpoint.Ptid] = struct{}{}
			}
		}
		actors = make([]string, 0, len(actorSet))
		for actor := range actorSet {
			actors = append(actors, actor)
		}
		sort.Strings(actors)
		return nil
	})
	return actors, err
}

func resolveEndpointManifests(
	ctx context.Context,
	resolver messaging.EndpointManifestResolver,
	actorPTIDs []string,
) error {
	for _, actorPTID := range actorPTIDs {
		if _, err := resolver.ResolveEndpointManifest(ctx, actorPTID); err != nil {
			return err
		}
	}
	return nil
}

func (s *AuthorityService) Submit(
	ctx context.Context,
	command *chat.ChatCommand,
) (*chat.ConversationEvent, error) {
	if command == nil || command.CommandId == "" || command.ConversationId == "" ||
		command.Sender == nil ||
		command.Sender.Ptid == "" ||
		command.Sender.DeviceId == "" ||
		command.AuthorityStationId != s.localStationID {
		return nil, fmt.Errorf("messaging: complete command identity is required")
	}
	commandBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(command)
	if err != nil {
		return nil, fmt.Errorf("messaging: marshal command: %w", err)
	}
	commandHash := sha256.Sum256(commandBytes)
	var committed *chat.ConversationEvent

	err = s.unitOfWork.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		receipt, err := repositories.Authority.GetCommandReceipt(
			ctx,
			command.ConversationId,
			command.CommandId,
		)
		if err == nil {
			if !bytes.Equal(receipt.CommandSHA256, commandHash[:]) {
				return messaging.ErrCommandConflict
			}
			event := &chat.ConversationEvent{}
			if err := proto.Unmarshal(receipt.EventBytes, event); err != nil {
				return fmt.Errorf("messaging: decode command receipt: %w", err)
			}
			committed = event
			return nil
		}
		if err != messaging.ErrNotFound {
			return err
		}

		if transition := command.GetMembershipTransition(); transition != nil &&
			transition.AuthorityPlanId != "" {
			plan, err := repositories.Plans.Get(ctx, transition.AuthorityPlanId)
			if err != nil {
				return err
			}
			var event *chat.ConversationEvent
			switch plan.PlanKind {
			case messaging.AuthorityPlanKindGroupGenesis:
				event, err = commitGroupGenesisFromPlan(
					ctx,
					repositories,
					command,
					commandHash[:],
					transition,
					s.localStationID,
					s.frameSigner,
					s.clock().UTC(),
				)
			case messaging.AuthorityPlanKindMembershipTransition:
				event, err = commitMembershipTransitionFromPlan(
					ctx,
					repositories,
					command,
					commandHash[:],
					transition,
					plan,
					s.localStationID,
					s.frameSigner,
					s.clock().UTC(),
				)
			default:
				err = messaging.ErrAuthorityPlanStale
			}
			if err != nil {
				return err
			}
			committed = event
			return nil
		}

		conversation, err := repositories.Authority.LockConversation(ctx, command.ConversationId)
		if err != nil {
			return err
		}
		if !conversation.Active {
			return messaging.ErrConversationState
		}
		active, err := repositories.Devices.IsActive(ctx, command.Sender)
		if err != nil {
			return err
		}
		if !active {
			return messaging.ErrSenderUnauthorized
		}
		plan, err := buildSendPlan(
			ctx,
			repositories,
			conversation,
			command.Sender,
			s.localStationID,
			s.clock().UTC(),
		)
		if err != nil {
			return err
		}
		if len(command.DeliveryPlanSha256) != sha256.Size ||
			!bytes.Equal(command.DeliveryPlanSha256, plan.DeliveryPlanSha256) ||
			command.ObservedMembershipEpoch != conversation.MembershipEpoch ||
			command.ObservedMlsEpoch != conversation.MlsEpoch {
			return messaging.ErrStaleDeliveryPlan
		}

		eventID := uuid.NewSHA1(
			uuid.NameSpaceOID,
			[]byte(command.ConversationId+"\x00"+command.CommandId),
		).String()
		event, payloads, err := buildEventAndPayloads(
			ctx,
			repositories,
			conversation,
			command,
			eventID,
			s.clock().UTC(),
		)
		if err != nil {
			return err
		}
		event.AuthorityStationId = s.localStationID
		if conversation.CurrentSequence > 0 {
			head, err := repositories.Authority.GetLastEvent(ctx, command.ConversationId)
			if err != nil {
				return err
			}
			if head.Sequence != conversation.CurrentSequence || len(head.EventHash) != sha256.Size {
				return fmt.Errorf("messaging: invalid authority head")
			}
			event.PreviousHash = append([]byte(nil), head.EventHash...)
		}
		event.EventHash, err = hashAuthorityEvent(event)
		if err != nil {
			return err
		}
		if err := repositories.Authority.AppendEvent(ctx, event); err != nil {
			return err
		}
		if send := command.GetSendMessage(); send != nil && len(send.Attachments) > 0 {
			members, err := repositories.Authority.ListActiveMembers(
				ctx,
				command.ConversationId,
			)
			if err != nil {
				return err
			}
			recipientPTIDs := make([]string, 0, len(members))
			for _, member := range members {
				recipientPTIDs = append(recipientPTIDs, member.PTID)
			}
			if err := repositories.Attachments.GrantMessageObjects(
				ctx,
				command.ConversationId,
				send.MessageId,
				event.EventId,
				command.Sender.Ptid,
				send.Attachments,
				recipientPTIDs,
				s.clock().UTC(),
			); err != nil {
				return err
			}
		}
		if transition := command.GetMembershipTransition(); transition != nil {
			if err := repositories.Authority.AdvanceEpochs(
				ctx,
				command.ConversationId,
				transition.FromMembershipEpoch,
				transition.FromMlsEpoch,
				event.MembershipEpoch,
				event.MlsEpoch,
			); err != nil {
				return err
			}
		}
		senderActorIdentityKey, err := repositories.Devices.ActorIdentityPublicKey(
			ctx,
			command.Sender.Ptid,
		)
		if err != nil {
			return err
		}
		if err := enqueueEventPayloads(
			ctx,
			repositories,
			event,
			payloads,
			senderActorIdentityKey,
			s.localStationID,
			s.frameSigner,
			s.clock().UTC(),
		); err != nil {
			return err
		}
		eventBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(event)
		if err != nil {
			return err
		}
		if err := repositories.Authority.CreateCommandReceipt(ctx, &messaging.AuthorityCommandReceipt{
			ConversationID: command.ConversationId,
			CommandID:      command.CommandId,
			CommandSHA256:  commandHash[:],
			EventBytes:     eventBytes,
			CreatedAt:      s.clock().UTC(),
		}); err != nil {
			return err
		}
		committed = event
		return nil
	})
	if err != nil {
		return nil, err
	}
	return committed, nil
}

func commitMembershipTransitionFromPlan(
	ctx context.Context,
	repositories messaging.AuthorityRepositories,
	command *chat.ChatCommand,
	commandHash []byte,
	transition *chat.MembershipTransitionIntent,
	plan *messaging.AuthorityPlan,
	localStationID string,
	frameSigner messaging.FederationFrameSigner,
	now time.Time,
) (*chat.ConversationEvent, error) {
	if plan == nil ||
		plan.PlanKind != messaging.AuthorityPlanKindMembershipTransition ||
		plan.ConversationID != command.ConversationId ||
		plan.RequesterPTID != command.Sender.Ptid ||
		plan.RequesterDeviceID != command.Sender.DeviceId ||
		plan.State != messaging.AuthorityPlanStatePrepared ||
		len(transition.AuthorityPlanSha256) != sha256.Size ||
		!bytes.Equal(plan.AuthorityPlanSHA256, transition.AuthorityPlanSha256) ||
		!bytes.Equal(command.DeliveryPlanSha256, transition.AuthorityPlanSha256) {
		return nil, messaging.ErrAuthorityPlanStale
	}
	if !plan.ExpiresAt.After(now) {
		return nil, messaging.ErrAuthorityPlanExpired
	}
	var request chat.PrepareMessagingMembershipTransitionRequest
	var snapshot chat.PrepareMessagingMembershipTransitionResponse
	if err := proto.Unmarshal(plan.IntentBytes, &request); err != nil {
		return nil, fmt.Errorf("messaging: decode transition intent: %w", err)
	}
	if err := proto.Unmarshal(plan.SnapshotBytes, &snapshot); err != nil {
		return nil, fmt.Errorf("messaging: decode transition snapshot: %w", err)
	}
	if request.ConversationId != command.ConversationId ||
		request.Sender == nil ||
		endpointKey(request.Sender) != endpointKey(command.Sender) ||
		snapshot.AuthorityPlanId != plan.PlanID ||
		!bytes.Equal(snapshot.AuthorityPlanSha256, plan.AuthorityPlanSHA256) ||
		snapshot.ExpiresAt == nil ||
		!snapshot.ExpiresAt.AsTime().Equal(plan.ExpiresAt) {
		return nil, messaging.ErrAuthorityPlanStale
	}
	conversation, err := repositories.Authority.LockConversation(ctx, command.ConversationId)
	if err != nil {
		return nil, err
	}
	if conversation.Kind != messaging.AuthorityConversationKindGroup ||
		!conversation.Active ||
		conversation.CurrentSequence != snapshot.AuthoritySequence ||
		conversation.MembershipEpoch != snapshot.FromMembershipEpoch ||
		conversation.MlsEpoch != snapshot.FromMlsEpoch ||
		command.ObservedMembershipEpoch != snapshot.FromMembershipEpoch ||
		command.ObservedMlsEpoch != snapshot.FromMlsEpoch ||
		transition.FromMembershipEpoch != snapshot.FromMembershipEpoch ||
		transition.FromMlsEpoch != snapshot.FromMlsEpoch ||
		transition.ToMlsEpoch != snapshot.FromMlsEpoch+1 {
		return nil, messaging.ErrAuthorityPlanStale
	}
	head, err := repositories.Authority.GetLastEvent(ctx, command.ConversationId)
	if err != nil {
		return nil, err
	}
	if head.Sequence != snapshot.AuthoritySequence ||
		!bytes.Equal(head.EventHash, snapshot.AuthorityHash) {
		return nil, messaging.ErrAuthorityPlanStale
	}
	active, err := repositories.Devices.IsActive(ctx, command.Sender)
	if err != nil {
		return nil, err
	}
	if !active {
		return nil, messaging.ErrSenderUnauthorized
	}
	currentDevices, err := repositories.Authority.ListActiveMemberDevices(
		ctx,
		command.ConversationId,
	)
	if err != nil {
		return nil, err
	}
	currentEndpoints := make([]*chat.CryptoEndpoint, 0, len(currentDevices))
	for _, device := range currentDevices {
		currentEndpoints = append(currentEndpoints, device.Endpoint)
	}
	sort.Slice(currentEndpoints, func(i, j int) bool {
		return endpointKey(currentEndpoints[i]) < endpointKey(currentEndpoints[j])
	})
	if !endpointSlicesEqual(currentEndpoints, snapshot.PreEndpoints) {
		return nil, messaging.ErrAuthorityPlanStale
	}
	if err := validatePlannedTransitionCommand(
		&request,
		&snapshot,
		transition,
		command.Sender,
	); err != nil {
		return nil, err
	}
	if err := repositories.Plans.MarkConsumed(
		ctx,
		plan.PlanID,
		plan.AuthorityPlanSHA256,
		now,
	); err != nil {
		return nil, err
	}

	eventID := uuid.NewSHA1(
		uuid.NameSpaceOID,
		[]byte(command.ConversationId+"\x00"+command.CommandId),
	).String()
	toMembershipEpoch := snapshot.FromMembershipEpoch + 1
	toMlsEpoch := snapshot.FromMlsEpoch + 1
	payloads, err := buildPlannedTransitionPayloads(
		command,
		transition,
		&snapshot,
		eventID,
		toMembershipEpoch,
		toMlsEpoch,
	)
	if err != nil {
		return nil, err
	}
	committedChanges := make([]*chat.MessagingMembershipChangeCommitted, 0, len(transition.Changes))
	for _, change := range transition.Changes {
		committedChanges = append(committedChanges, &chat.MessagingMembershipChangeCommitted{
			Action:        change.Action,
			Ptid:          change.Ptid,
			DeviceId:      change.DeviceId,
			HomeStationId: change.HomeStationId,
			Role:          change.Role,
		})
	}
	if err := applyMembershipMutation(
		ctx,
		repositories,
		&request,
		&snapshot,
		conversation.CurrentSequence+1,
	); err != nil {
		return nil, err
	}
	postState, err := buildConversationAuthoritySnapshot(
		ctx,
		repositories,
		conversation,
		toMembershipEpoch,
		toMlsEpoch,
	)
	if err != nil {
		return nil, err
	}
	event := &chat.ConversationEvent{
		EventId:            eventID,
		ConversationId:     command.ConversationId,
		Sequence:           conversation.CurrentSequence + 1,
		CommandId:          command.CommandId,
		Actor:              command.Sender,
		CommittedAt:        timestamppb.New(now),
		MembershipEpoch:    toMembershipEpoch,
		MlsEpoch:           toMlsEpoch,
		PreviousHash:       append([]byte(nil), head.EventHash...),
		AuthorityStationId: localStationID,
		Payload: &chat.ConversationEvent_MembershipTransitionCommitted{
			MembershipTransitionCommitted: &chat.MembershipTransitionCommittedFact{
				TransitionId:        transition.TransitionId,
				FromMembershipEpoch: snapshot.FromMembershipEpoch,
				ToMembershipEpoch:   toMembershipEpoch,
				FromMlsEpoch:        snapshot.FromMlsEpoch,
				ToMlsEpoch:          toMlsEpoch,
				Changes:             committedChanges,
				MlsCommitSha256:     transition.MlsCommitSha256,
				LeaveIntentId:       transition.LeaveIntentId,
				PostState:           postState,
			},
		},
	}
	for _, payload := range payloads {
		event.DeliveryCommitments = append(
			event.DeliveryCommitments,
			deliveryCommitment(eventID, command.ConversationId, payload),
		)
	}
	sort.Slice(event.DeliveryCommitments, func(i, j int) bool {
		return bytes.Compare(event.DeliveryCommitments[i], event.DeliveryCommitments[j]) < 0
	})
	event.EventHash, err = hashAuthorityEvent(event)
	if err != nil {
		return nil, err
	}
	if err := repositories.Authority.AppendEvent(ctx, event); err != nil {
		return nil, err
	}
	if err := repositories.Authority.AdvanceEpochs(
		ctx,
		command.ConversationId,
		snapshot.FromMembershipEpoch,
		snapshot.FromMlsEpoch,
		toMembershipEpoch,
		toMlsEpoch,
	); err != nil {
		return nil, err
	}
	senderActorIdentityKey, err := repositories.Devices.ActorIdentityPublicKey(
		ctx,
		command.Sender.Ptid,
	)
	if err != nil {
		return nil, err
	}
	if err := enqueueEventPayloads(
		ctx,
		repositories,
		event,
		payloads,
		senderActorIdentityKey,
		localStationID,
		frameSigner,
		now,
	); err != nil {
		return nil, err
	}
	if err := repositories.KeyPackages.ConsumeReservations(ctx, plan.PlanID); err != nil {
		return nil, err
	}
	eventBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(event)
	if err != nil {
		return nil, err
	}
	if err := repositories.Authority.CreateCommandReceipt(
		ctx,
		&messaging.AuthorityCommandReceipt{
			ConversationID: command.ConversationId,
			CommandID:      command.CommandId,
			CommandSHA256:  commandHash,
			EventBytes:     eventBytes,
			CreatedAt:      now,
		},
	); err != nil {
		return nil, err
	}
	return event, nil
}

func validatePlannedTransitionCommand(
	request *chat.PrepareMessagingMembershipTransitionRequest,
	snapshot *chat.PrepareMessagingMembershipTransitionResponse,
	transition *chat.MembershipTransitionIntent,
	sender *chat.CryptoEndpoint,
) error {
	if transition.TransitionId == "" ||
		len(transition.MlsCommit) == 0 ||
		len(transition.MlsCommitSha256) != sha256.Size {
		return messaging.ErrDeliverySet
	}
	commitHash := sha256.Sum256(transition.MlsCommit)
	if !bytes.Equal(commitHash[:], transition.MlsCommitSha256) {
		return messaging.ErrDeliverySet
	}
	expectedChanges := make(map[string]struct{})
	switch request.Action {
	case chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_ACTOR,
		chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_DEVICE:
		for _, endpoint := range snapshot.AddedEndpoints {
			expectedChanges[endpointKey(endpoint)] = struct{}{}
		}
	case chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_ACTOR,
		chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_DEVICE:
		for _, endpoint := range snapshot.RemovedEndpoints {
			expectedChanges[endpointKey(endpoint)] = struct{}{}
		}
	default:
		return messaging.ErrUnsupportedCommand
	}
	for _, change := range transition.Changes {
		if change == nil || change.Action != request.Action {
			return messaging.ErrDeliverySet
		}
		key := endpointKey(&chat.CryptoEndpoint{
			Ptid:     change.Ptid,
			DeviceId: change.DeviceId,
		})
		if _, ok := expectedChanges[key]; !ok {
			return messaging.ErrDeliverySet
		}
		delete(expectedChanges, key)
	}
	if len(expectedChanges) != 0 {
		return messaging.ErrDeliverySet
	}
	expectedWelcomes := make(map[string]struct{}, len(snapshot.AddedEndpoints))
	for _, endpoint := range snapshot.AddedEndpoints {
		expectedWelcomes[endpointKey(endpoint)] = struct{}{}
	}
	for _, welcome := range transition.WelcomePayloads {
		if welcome == nil ||
			welcome.Recipient == nil ||
			welcome.Kind != chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_WELCOME ||
			len(welcome.OpaquePayload) == 0 ||
			len(welcome.PayloadSha256) != sha256.Size {
			return messaging.ErrDeliverySet
		}
		hash := sha256.Sum256(welcome.OpaquePayload)
		if !bytes.Equal(hash[:], welcome.PayloadSha256) {
			return messaging.ErrDeliverySet
		}
		key := endpointKey(welcome.Recipient)
		if _, ok := expectedWelcomes[key]; !ok {
			return messaging.ErrDeliverySet
		}
		delete(expectedWelcomes, key)
	}
	if len(expectedWelcomes) != 0 || !containsEndpoint(snapshot.PostEndpoints, sender) {
		return messaging.ErrDeliverySet
	}
	return nil
}

func buildPlannedTransitionPayloads(
	command *chat.ChatCommand,
	transition *chat.MembershipTransitionIntent,
	snapshot *chat.PrepareMessagingMembershipTransitionResponse,
	eventID string,
	toMembershipEpoch int64,
	toMlsEpoch int64,
) ([]*chat.PreparedEndpointPayload, error) {
	welcomes := make(map[string]*chat.PreparedEndpointPayload, len(transition.WelcomePayloads))
	for _, welcome := range transition.WelcomePayloads {
		welcomes[endpointKey(welcome.Recipient)] = welcome
	}
	added := make(map[string]struct{}, len(snapshot.AddedEndpoints))
	for _, endpoint := range snapshot.AddedEndpoints {
		added[endpointKey(endpoint)] = struct{}{}
	}
	payloads := make([]*chat.PreparedEndpointPayload, 0, len(snapshot.PostEndpoints)+len(snapshot.RemovedEndpoints))
	for _, endpoint := range snapshot.PostEndpoints {
		var kind chat.PreparedEndpointPayloadKind
		var opaque []byte
		var payloadHash []byte
		key := endpointKey(endpoint)
		switch {
		case key == endpointKey(command.Sender):
			marker, err := proto.MarshalOptions{Deterministic: true}.Marshal(
				&chat.PublicEventMarker{
					ConversationId:  command.ConversationId,
					EventId:         eventID,
					CommandId:       command.CommandId,
					SendingEndpoint: command.Sender,
				},
			)
			if err != nil {
				return nil, err
			}
			hash := sha256.Sum256(marker)
			kind, opaque, payloadHash = chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_PUBLIC_EVENT, marker, hash[:]
		case containsEndpoint(snapshot.AddedEndpoints, endpoint):
			welcome := welcomes[key]
			if welcome == nil {
				return nil, messaging.ErrDeliverySet
			}
			wrapped, err := wrapMlsTransitionPayload(
				chat.MlsQueuePayloadKind_MLS_QUEUE_PAYLOAD_KIND_WELCOME,
				command,
				transition,
				endpoint,
				eventID,
				snapshot.AuthoritySequence+1,
				toMembershipEpoch,
				toMlsEpoch,
				welcome.OpaquePayload,
				welcome.PayloadSha256,
			)
			if err != nil {
				return nil, err
			}
			hash := sha256.Sum256(wrapped)
			kind, opaque, payloadHash = chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_WELCOME, wrapped, hash[:]
		default:
			wrapped, err := wrapMlsTransitionPayload(
				chat.MlsQueuePayloadKind_MLS_QUEUE_PAYLOAD_KIND_COMMIT,
				command,
				transition,
				endpoint,
				eventID,
				snapshot.AuthoritySequence+1,
				toMembershipEpoch,
				toMlsEpoch,
				transition.MlsCommit,
				transition.MlsCommitSha256,
			)
			if err != nil {
				return nil, err
			}
			hash := sha256.Sum256(wrapped)
			kind, opaque, payloadHash = chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_COMMIT, wrapped, hash[:]
		}
		payloads = append(payloads, &chat.PreparedEndpointPayload{
			Recipient:     endpoint,
			Kind:          kind,
			OpaquePayload: opaque,
			PayloadSha256: payloadHash,
		})
		delete(added, key)
	}
	for _, endpoint := range snapshot.RemovedEndpoints {
		marker, err := proto.MarshalOptions{Deterministic: true}.Marshal(
			&chat.MlsRetirementMarker{
				ConversationId:  command.ConversationId,
				EventId:         eventID,
				TransitionId:    transition.TransitionId,
				RemovedEndpoint: endpoint,
			},
		)
		if err != nil {
			return nil, err
		}
		hash := sha256.Sum256(marker)
		payloads = append(payloads, &chat.PreparedEndpointPayload{
			Recipient:     endpoint,
			Kind:          chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_RETIREMENT,
			OpaquePayload: marker,
			PayloadSha256: hash[:],
		})
	}
	if len(added) != 0 {
		return nil, messaging.ErrDeliverySet
	}
	return payloads, nil
}

func wrapMlsTransitionPayload(
	kind chat.MlsQueuePayloadKind,
	command *chat.ChatCommand,
	transition *chat.MembershipTransitionIntent,
	recipient *chat.CryptoEndpoint,
	eventID string,
	authoritySequence int64,
	toMembershipEpoch int64,
	toMlsEpoch int64,
	opaque []byte,
	payloadHash []byte,
) ([]byte, error) {
	return proto.MarshalOptions{Deterministic: true}.Marshal(&chat.MlsQueuePayload{
		Kind:                kind,
		ConversationId:      command.ConversationId,
		TransitionId:        transition.TransitionId,
		EventId:             eventID,
		AuthoritySequence:   authoritySequence,
		FromMembershipEpoch: transition.FromMembershipEpoch,
		ToMembershipEpoch:   toMembershipEpoch,
		FromMlsEpoch:        transition.FromMlsEpoch,
		ToMlsEpoch:          toMlsEpoch,
		Recipient:           recipient,
		OpaqueMlsBytes:      opaque,
		PayloadSha256:       payloadHash,
	})
}

func applyMembershipMutation(
	ctx context.Context,
	repositories messaging.AuthorityRepositories,
	request *chat.PrepareMessagingMembershipTransitionRequest,
	snapshot *chat.PrepareMessagingMembershipTransitionResponse,
	sequence int64,
) error {
	switch request.Action {
	case chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_ACTOR:
		role := strings.TrimSpace(request.Role)
		if role == "" {
			role = "member"
		}
		if err := repositories.Authority.AddMember(
			ctx,
			request.ConversationId,
			request.TargetPtid,
			role,
			sequence,
		); err != nil {
			return err
		}
		for _, endpoint := range snapshot.AddedEndpoints {
			if err := repositories.Authority.AddMemberDevice(
				ctx,
				request.ConversationId,
				endpoint,
				sequence,
			); err != nil {
				return err
			}
		}
	case chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_DEVICE:
		return repositories.Authority.AddMemberDevice(
			ctx,
			request.ConversationId,
			snapshot.AddedEndpoints[0],
			sequence,
		)
	case chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_ACTOR:
		return repositories.Authority.RemoveMember(
			ctx,
			request.ConversationId,
			request.TargetPtid,
			sequence,
		)
	case chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_DEVICE:
		return repositories.Authority.RemoveMemberDevice(
			ctx,
			request.ConversationId,
			snapshot.RemovedEndpoints[0],
			sequence,
		)
	default:
		return messaging.ErrUnsupportedCommand
	}
	return nil
}

func commitGroupGenesisFromPlan(
	ctx context.Context,
	repositories messaging.AuthorityRepositories,
	command *chat.ChatCommand,
	commandHash []byte,
	transition *chat.MembershipTransitionIntent,
	localStationID string,
	frameSigner messaging.FederationFrameSigner,
	now time.Time,
) (*chat.ConversationEvent, error) {
	if transition.AuthorityPlanId == "" ||
		len(transition.AuthorityPlanSha256) != sha256.Size ||
		len(command.DeliveryPlanSha256) != sha256.Size ||
		!bytes.Equal(command.DeliveryPlanSha256, transition.AuthorityPlanSha256) ||
		command.ObservedMembershipEpoch != 0 ||
		command.ObservedMlsEpoch != 0 {
		return nil, messaging.ErrAuthorityPlanStale
	}
	plan, err := repositories.Plans.Get(ctx, transition.AuthorityPlanId)
	if err != nil {
		return nil, err
	}
	if plan.PlanKind != messaging.AuthorityPlanKindGroupGenesis ||
		plan.ConversationID != command.ConversationId ||
		plan.RequesterPTID != command.Sender.Ptid ||
		plan.RequesterDeviceID != command.Sender.DeviceId ||
		!bytes.Equal(plan.AuthorityPlanSHA256, transition.AuthorityPlanSha256) {
		return nil, messaging.ErrAuthorityPlanStale
	}
	if plan.State != messaging.AuthorityPlanStatePrepared {
		return nil, messaging.ErrAuthorityPlanStale
	}
	if !plan.ExpiresAt.After(now) {
		return nil, messaging.ErrAuthorityPlanExpired
	}
	var request chat.PrepareMessagingGroupGenesisRequest
	var snapshot chat.PrepareMessagingGroupGenesisResponse
	if err := proto.Unmarshal(plan.IntentBytes, &request); err != nil {
		return nil, fmt.Errorf("messaging: decode group genesis intent: %w", err)
	}
	if err := proto.Unmarshal(plan.SnapshotBytes, &snapshot); err != nil {
		return nil, fmt.Errorf("messaging: decode group genesis snapshot: %w", err)
	}
	if request.ConversationId != command.ConversationId ||
		request.Creator == nil ||
		endpointKey(request.Creator) != endpointKey(command.Sender) ||
		snapshot.AuthorityPlanId != transition.AuthorityPlanId ||
		!bytes.Equal(snapshot.AuthorityPlanSha256, transition.AuthorityPlanSha256) ||
		snapshot.ExpiresAt == nil ||
		!snapshot.ExpiresAt.AsTime().Equal(plan.ExpiresAt) {
		return nil, messaging.ErrAuthorityPlanStale
	}
	if _, err := repositories.Authority.LockConversation(
		ctx,
		command.ConversationId,
	); err == nil {
		return nil, messaging.ErrCommandConflict
	} else if !errors.Is(err, messaging.ErrNotFound) {
		return nil, err
	}
	active, err := repositories.Devices.IsActive(ctx, command.Sender)
	if err != nil {
		return nil, err
	}
	if !active {
		return nil, messaging.ErrSenderUnauthorized
	}
	currentEndpoints, actors, err := resolveGenesisEndpoints(ctx, repositories, &request)
	if err != nil {
		return nil, err
	}
	if !endpointSlicesEqual(currentEndpoints, snapshot.ProspectiveEndpoints) {
		return nil, messaging.ErrAuthorityPlanStale
	}
	if err := validateGenesisTransitionBinding(
		command.Sender,
		currentEndpoints,
		snapshot.ReservedKeyPackages,
		transition,
	); err != nil {
		return nil, err
	}
	if err := repositories.Plans.MarkConsumed(
		ctx,
		plan.PlanID,
		plan.AuthorityPlanSHA256,
		now,
	); err != nil {
		return nil, err
	}

	conversation := &messaging.AuthorityConversation{
		ConversationID:  command.ConversationId,
		Kind:            messaging.AuthorityConversationKindGroup,
		Name:            request.Name,
		OwnerPTID:       command.Sender.Ptid,
		CurrentSequence: 0,
		MembershipEpoch: 0,
		MlsEpoch:        0,
		Active:          true,
	}
	created, err := repositories.Authority.CreateConversation(ctx, conversation)
	if err != nil {
		return nil, err
	}
	if !created {
		return nil, messaging.ErrCommandConflict
	}
	for _, actor := range actors {
		role := "member"
		if actor == conversation.OwnerPTID {
			role = "owner"
		}
		if err := repositories.Authority.AddMember(
			ctx,
			command.ConversationId,
			actor,
			role,
			2,
		); err != nil {
			return nil, err
		}
	}
	for _, endpoint := range currentEndpoints {
		if err := repositories.Authority.AddMemberDevice(
			ctx,
			command.ConversationId,
			endpoint,
			2,
		); err != nil {
			return nil, err
		}
	}
	createdEvent, createdPayloads, err := buildConversationCreatedEvent(
		conversation,
		command.Sender,
		actors,
		currentEndpoints,
		localStationID,
		now,
	)
	if err != nil {
		return nil, err
	}
	if err := repositories.Authority.AppendEvent(ctx, createdEvent); err != nil {
		return nil, err
	}
	senderActorIdentityKey, err := repositories.Devices.ActorIdentityPublicKey(
		ctx,
		command.Sender.Ptid,
	)
	if err != nil {
		return nil, err
	}
	if err := enqueueEventPayloads(
		ctx,
		repositories,
		createdEvent,
		createdPayloads,
		senderActorIdentityKey,
		localStationID,
		frameSigner,
		now,
	); err != nil {
		return nil, err
	}
	conversation.CurrentSequence = 1

	eventID := uuid.NewSHA1(
		uuid.NameSpaceOID,
		[]byte(command.ConversationId+"\x00"+command.CommandId),
	).String()
	event, payloads, err := buildMembershipTransitionEventAndPayloads(
		ctx,
		repositories,
		conversation,
		command,
		transition,
		eventID,
		now,
	)
	if err != nil {
		return nil, err
	}
	event.PreviousHash = append([]byte(nil), createdEvent.EventHash...)
	event.EventHash, err = hashAuthorityEvent(event)
	if err != nil {
		return nil, err
	}
	if err := repositories.Authority.AppendEvent(ctx, event); err != nil {
		return nil, err
	}
	if err := repositories.Authority.AdvanceEpochs(
		ctx,
		command.ConversationId,
		0,
		0,
		event.MembershipEpoch,
		event.MlsEpoch,
	); err != nil {
		return nil, err
	}
	if err := enqueueEventPayloads(
		ctx,
		repositories,
		event,
		payloads,
		senderActorIdentityKey,
		localStationID,
		frameSigner,
		now,
	); err != nil {
		return nil, err
	}
	if err := repositories.KeyPackages.ConsumeReservations(ctx, plan.PlanID); err != nil {
		return nil, err
	}
	eventBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(event)
	if err != nil {
		return nil, err
	}
	if err := repositories.Authority.CreateCommandReceipt(
		ctx,
		&messaging.AuthorityCommandReceipt{
			ConversationID: command.ConversationId,
			CommandID:      command.CommandId,
			CommandSHA256:  commandHash,
			EventBytes:     eventBytes,
			CreatedAt:      now,
		},
	); err != nil {
		return nil, err
	}
	return event, nil
}

func resolveGenesisEndpoints(
	ctx context.Context,
	repositories messaging.AuthorityRepositories,
	request *chat.PrepareMessagingGroupGenesisRequest,
) ([]*chat.CryptoEndpoint, []string, error) {
	actorSet := map[string]struct{}{request.Creator.Ptid: {}}
	for _, actor := range request.MemberPtids {
		actorSet[actor] = struct{}{}
	}
	actors := make([]string, 0, len(actorSet))
	for actor := range actorSet {
		actors = append(actors, actor)
	}
	sort.Strings(actors)
	endpoints := make([]*chat.CryptoEndpoint, 0)
	for _, actor := range actors {
		devices, err := repositories.Devices.ListActiveEndpoints(ctx, actor)
		if err != nil {
			return nil, nil, err
		}
		if len(devices) == 0 {
			return nil, nil, messaging.ErrAuthorityPlanStale
		}
		endpoints = append(endpoints, devices...)
	}
	sort.Slice(endpoints, func(i, j int) bool {
		return endpointKey(endpoints[i]) < endpointKey(endpoints[j])
	})
	return endpoints, actors, nil
}

func endpointSlicesEqual(left, right []*chat.CryptoEndpoint) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if endpointKey(left[index]) != endpointKey(right[index]) {
			return false
		}
	}
	return true
}

func validateGenesisTransitionBinding(
	sender *chat.CryptoEndpoint,
	endpoints []*chat.CryptoEndpoint,
	reserved []*chat.ReservedMessagingMlsKeyPackage,
	transition *chat.MembershipTransitionIntent,
) error {
	if transition.FromMembershipEpoch != 0 ||
		transition.FromMlsEpoch != 0 ||
		transition.ToMlsEpoch != 1 {
		return messaging.ErrConversationState
	}
	expectedChanges := make(map[string]struct{}, len(endpoints))
	expectedWelcomes := make(map[string]struct{}, len(endpoints)-1)
	for _, endpoint := range endpoints {
		key := endpointKey(endpoint)
		expectedChanges[key] = struct{}{}
		if key != endpointKey(sender) {
			expectedWelcomes[key] = struct{}{}
		}
	}
	for _, change := range transition.Changes {
		if change == nil ||
			(change.Action != chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_ACTOR &&
				change.Action != chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_DEVICE) {
			return messaging.ErrDeliverySet
		}
		key := endpointKey(&chat.CryptoEndpoint{
			Ptid:     change.Ptid,
			DeviceId: change.DeviceId,
		})
		if _, ok := expectedChanges[key]; !ok {
			return messaging.ErrDeliverySet
		}
		delete(expectedChanges, key)
	}
	if len(expectedChanges) != 0 {
		return messaging.ErrDeliverySet
	}
	reservedEndpoints := make(map[string]struct{}, len(reserved))
	for _, keyPackage := range reserved {
		if keyPackage == nil ||
			keyPackage.Target == nil ||
			keyPackage.PackageId == "" ||
			len(keyPackage.KeyPackage) == 0 ||
			len(keyPackage.KeyPackageSha256) != sha256.Size {
			return messaging.ErrDeliverySet
		}
		hash := sha256.Sum256(keyPackage.KeyPackage)
		if !bytes.Equal(hash[:], keyPackage.KeyPackageSha256) {
			return messaging.ErrDeliverySet
		}
		reservedEndpoints[endpointKey(keyPackage.Target)] = struct{}{}
	}
	if len(reservedEndpoints) != len(expectedWelcomes) {
		return messaging.ErrDeliverySet
	}
	for endpoint := range expectedWelcomes {
		if _, ok := reservedEndpoints[endpoint]; !ok {
			return messaging.ErrDeliverySet
		}
	}
	for _, welcome := range transition.WelcomePayloads {
		if welcome == nil || welcome.Recipient == nil {
			return messaging.ErrDeliverySet
		}
		key := endpointKey(welcome.Recipient)
		if _, ok := expectedWelcomes[key]; !ok {
			return messaging.ErrDeliverySet
		}
		delete(expectedWelcomes, key)
	}
	if len(expectedWelcomes) != 0 {
		return messaging.ErrDeliverySet
	}
	return nil
}

func buildConversationCreatedEvent(
	conversation *messaging.AuthorityConversation,
	creator *chat.CryptoEndpoint,
	memberPTIDs []string,
	endpoints []*chat.CryptoEndpoint,
	authorityStationID string,
	now time.Time,
) (*chat.ConversationEvent, []*chat.PreparedEndpointPayload, error) {
	eventID := "created:" + conversation.ConversationID
	markerBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chat.ConversationStateMarker{
			ConversationId: conversation.ConversationID,
			EventId:        eventID,
		},
	)
	if err != nil {
		return nil, nil, err
	}
	markerHash := sha256.Sum256(markerBytes)
	payloads := make([]*chat.PreparedEndpointPayload, 0, len(endpoints))
	for _, endpoint := range endpoints {
		payloads = append(payloads, &chat.PreparedEndpointPayload{
			Recipient:     endpoint,
			Kind:          chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_CONVERSATION_STATE,
			OpaquePayload: markerBytes,
			PayloadSha256: markerHash[:],
		})
	}
	event := &chat.ConversationEvent{
		EventId:            eventID,
		ConversationId:     conversation.ConversationID,
		Sequence:           1,
		CommandId:          "create:" + conversation.ConversationID,
		Actor:              creator,
		CommittedAt:        timestamppb.New(now),
		MembershipEpoch:    0,
		MlsEpoch:           0,
		AuthorityStationId: authorityStationID,
		Payload: &chat.ConversationEvent_ConversationCreated{
			ConversationCreated: &chat.ConversationCreatedFact{
				Kind:        chat.ConversationKind_CONVERSATION_KIND_GROUP,
				Name:        conversation.Name,
				OwnerPtid:   conversation.OwnerPTID,
				MemberPtids: memberPTIDs,
			},
		},
	}
	for _, payload := range payloads {
		event.DeliveryCommitments = append(
			event.DeliveryCommitments,
			deliveryCommitment(eventID, conversation.ConversationID, payload),
		)
	}
	sort.Slice(event.DeliveryCommitments, func(i, j int) bool {
		return bytes.Compare(event.DeliveryCommitments[i], event.DeliveryCommitments[j]) < 0
	})
	event.EventHash, err = hashAuthorityEvent(event)
	return event, payloads, err
}

func enqueueEventPayloads(
	ctx context.Context,
	repositories messaging.AuthorityRepositories,
	event *chat.ConversationEvent,
	payloads []*chat.PreparedEndpointPayload,
	senderActorIdentityKey []byte,
	localStationID string,
	frameSigner messaging.FederationFrameSigner,
	now time.Time,
) error {
	if event == nil || localStationID == "" || frameSigner == nil {
		return messaging.ErrFederationFrameInvalid
	}
	remoteWrites := make(map[string][]*chat.FederatedDeviceQueueWrite)
	for _, payload := range payloads {
		delivery := &chat.DeviceEventDelivery{
			Event:                 event,
			Recipient:             payload.Recipient,
			PayloadKind:           payload.Kind,
			EndpointPayload:       payload.OpaquePayload,
			EndpointPayloadSha256: payload.PayloadSha256,
			DeliveryCommitment: deliveryCommitment(
				event.EventId,
				event.ConversationId,
				payload,
			),
			SenderActorIdentityPublicKey: senderActorIdentityKey,
		}
		deliveryBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(delivery)
		if err != nil {
			return err
		}
		deliveryHash := sha256.Sum256(deliveryBytes)
		write := &chat.FederatedDeviceQueueWrite{
			Recipient:      payload.Recipient,
			EventId:        event.EventId,
			ConversationId: event.ConversationId,
			IdempotencyKey: "event:" + event.EventId,
			PayloadType:    chat.DeviceQueuePayloadType_DEVICE_QUEUE_PAYLOAD_TYPE_CONVERSATION_EVENT,
			OpaquePayload:  deliveryBytes,
			PayloadSha256:  deliveryHash[:],
		}
		homeStationID, err := repositories.EndpointManifests.HomeStationForEndpoint(
			ctx,
			payload.Recipient,
			now,
		)
		if err != nil {
			return err
		}
		if homeStationID != localStationID {
			remoteWrites[homeStationID] = append(remoteWrites[homeStationID], write)
			continue
		}
		if _, err := repositories.Queue.Enqueue(ctx, &chat.DeviceQueueItem{
			Recipient:      write.Recipient,
			EventId:        write.EventId,
			ConversationId: write.ConversationId,
			IdempotencyKey: write.IdempotencyKey,
			PayloadType:    write.PayloadType,
			OpaquePayload:  write.OpaquePayload,
			PayloadSha256:  write.PayloadSha256,
		}); err != nil {
			return err
		}
	}
	targets := make([]string, 0, len(remoteWrites))
	for target := range remoteWrites {
		targets = append(targets, target)
	}
	sort.Strings(targets)
	for _, target := range targets {
		actorSet := make(map[string]struct{})
		for _, write := range remoteWrites[target] {
			actorSet[write.Recipient.Ptid] = struct{}{}
		}
		actors := make([]string, 0, len(actorSet))
		for actor := range actorSet {
			actors = append(actors, actor)
		}
		sort.Strings(actors)
		manifests, err := repositories.EndpointManifests.ListVerifiedManifests(
			ctx,
			actors,
			now,
		)
		if err != nil {
			return err
		}
		for _, manifest := range manifests {
			if manifest.HomeStationId != target {
				return messaging.ErrEndpointManifestConflict
			}
		}
		batchBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
			&chat.FederatedDeviceQueueBatch{
				Writes:            remoteWrites[target],
				EndpointManifests: manifests,
			},
		)
		if err != nil {
			return err
		}
		batchHash := sha256.Sum256(batchBytes)
		idempotencyKey := "event:" + event.EventId + ":station:" + target
		frame := &chat.MessagingFederationFrame{
			FrameId:           uuid.NewSHA1(uuid.NameSpaceOID, []byte(localStationID+"\x00"+idempotencyKey)).String(),
			SourceStationId:   localStationID,
			TargetStationId:   target,
			IdempotencyKey:    idempotencyKey,
			PayloadType:       chat.MessagingFederationPayloadType_MESSAGING_FEDERATION_PAYLOAD_TYPE_DEVICE_QUEUE_BATCH,
			ConversationId:    event.ConversationId,
			EventId:           event.EventId,
			AuthoritySequence: event.Sequence,
			OpaquePayload:     batchBytes,
			PayloadSha256:     batchHash[:],
			IssuedAt:          timestamppb.New(now),
			ExpiresAt:         timestamppb.New(now.Add(5 * time.Minute)),
		}
		if err := frameSigner.SignFederationFrame(ctx, frame); err != nil {
			return err
		}
		if err := repositories.Federation.EnqueueFederationFrame(ctx, frame, now); err != nil {
			return err
		}
	}
	return nil
}

func buildSendPlan(
	ctx context.Context,
	repositories messaging.AuthorityRepositories,
	conversation *messaging.AuthorityConversation,
	sender *chat.CryptoEndpoint,
	authorityStationID string,
	now time.Time,
) (*chat.PrepareMessagingSendResponse, error) {
	endpoints, err := listRequiredEndpoints(ctx, repositories, conversation.ConversationID)
	if err != nil {
		return nil, err
	}
	senderPresent := false
	for _, endpoint := range endpoints {
		if endpointKey(endpoint) == endpointKey(sender) {
			senderPresent = true
			break
		}
	}
	if !senderPresent {
		return nil, messaging.ErrSenderUnauthorized
	}
	var kind chat.ConversationKind
	switch conversation.Kind {
	case messaging.AuthorityConversationKindDirect:
		kind = chat.ConversationKind_CONVERSATION_KIND_DIRECT
	case messaging.AuthorityConversationKindGroup:
		kind = chat.ConversationKind_CONVERSATION_KIND_GROUP
	default:
		return nil, messaging.ErrConversationState
	}
	var authorityHash []byte
	if conversation.CurrentSequence > 0 {
		head, err := repositories.Authority.GetLastEvent(ctx, conversation.ConversationID)
		if err != nil {
			return nil, err
		}
		if head.Sequence != conversation.CurrentSequence || len(head.EventHash) != sha256.Size {
			return nil, fmt.Errorf("messaging: invalid authority head")
		}
		authorityHash = append([]byte(nil), head.EventHash...)
	}
	plan := &chat.PrepareMessagingSendResponse{
		ConversationId:     conversation.ConversationID,
		ConversationKind:   kind,
		AuthoritySequence:  conversation.CurrentSequence,
		AuthorityHash:      authorityHash,
		MembershipEpoch:    conversation.MembershipEpoch,
		MlsEpoch:           conversation.MlsEpoch,
		RequiredEndpoints:  endpoints,
		AuthorityStationId: authorityStationID,
	}
	actorPTIDs := make([]string, 0)
	for _, endpoint := range endpoints {
		if len(actorPTIDs) == 0 || actorPTIDs[len(actorPTIDs)-1] != endpoint.Ptid {
			actorPTIDs = append(actorPTIDs, endpoint.Ptid)
		}
	}
	plan.EndpointManifests, err = repositories.EndpointManifests.ListVerifiedManifests(
		ctx,
		actorPTIDs,
		now.UTC(),
	)
	if err != nil {
		return nil, err
	}
	planBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(plan)
	if err != nil {
		return nil, err
	}
	var hashInput bytes.Buffer
	hashInput.WriteString(deliveryPlanDomain)
	hashInput.WriteByte(0)
	if err := binary.Write(&hashInput, binary.BigEndian, uint32(1)); err != nil {
		return nil, err
	}
	writeString(&hashInput, sender.Ptid)
	writeString(&hashInput, sender.DeviceId)
	hashInput.Write(planBytes)
	hash := sha256.Sum256(hashInput.Bytes())
	plan.DeliveryPlanSha256 = hash[:]
	return plan, nil
}

func listRequiredEndpoints(
	ctx context.Context,
	repositories messaging.AuthorityRepositories,
	conversationID string,
) ([]*chat.CryptoEndpoint, error) {
	required, err := repositories.Authority.ListActiveMemberDevices(ctx, conversationID)
	if err != nil {
		return nil, err
	}
	endpoints := make([]*chat.CryptoEndpoint, 0, len(required))
	for _, device := range required {
		if !device.Active || device.Endpoint == nil {
			continue
		}
		active, err := repositories.Devices.IsActive(ctx, device.Endpoint)
		if err != nil {
			return nil, err
		}
		if active {
			endpoints = append(endpoints, device.Endpoint)
		}
	}
	sort.Slice(endpoints, func(i, j int) bool {
		return endpointKey(endpoints[i]) < endpointKey(endpoints[j])
	})
	return endpoints, nil
}

func buildConversationAuthoritySnapshot(
	ctx context.Context,
	repositories messaging.AuthorityRepositories,
	conversation *messaging.AuthorityConversation,
	membershipEpoch int64,
	mlsEpoch int64,
) (*chat.ConversationAuthoritySnapshot, error) {
	if conversation == nil || membershipEpoch <= 0 || mlsEpoch <= 0 {
		return nil, messaging.ErrConversationState
	}
	members, err := repositories.Authority.ListActiveMembers(ctx, conversation.ConversationID)
	if err != nil {
		return nil, err
	}
	devices, err := repositories.Authority.ListActiveMemberDevices(ctx, conversation.ConversationID)
	if err != nil {
		return nil, err
	}
	activeMembers := make([]*chat.ConversationAuthorityMember, 0, len(members))
	for _, member := range members {
		if !member.Active || strings.TrimSpace(member.PTID) == "" || strings.TrimSpace(member.Role) == "" {
			return nil, messaging.ErrConversationState
		}
		activeMembers = append(activeMembers, &chat.ConversationAuthorityMember{
			Ptid: member.PTID,
			Role: member.Role,
		})
	}
	activeEndpoints := make([]*chat.CryptoEndpoint, 0, len(devices))
	for _, device := range devices {
		if !device.Active || device.Endpoint == nil {
			return nil, messaging.ErrConversationState
		}
		activeEndpoints = append(activeEndpoints, device.Endpoint)
	}
	sort.Slice(activeEndpoints, func(i, j int) bool {
		return endpointKey(activeEndpoints[i]) < endpointKey(activeEndpoints[j])
	})
	var kind chat.ConversationKind
	switch conversation.Kind {
	case messaging.AuthorityConversationKindGroup:
		kind = chat.ConversationKind_CONVERSATION_KIND_GROUP
	case messaging.AuthorityConversationKindDirect:
		kind = chat.ConversationKind_CONVERSATION_KIND_DIRECT
	default:
		return nil, messaging.ErrConversationState
	}
	return &chat.ConversationAuthoritySnapshot{
		Kind:            kind,
		Name:            conversation.Name,
		OwnerPtid:       conversation.OwnerPTID,
		ActiveMembers:   activeMembers,
		ActiveEndpoints: activeEndpoints,
		MembershipEpoch: membershipEpoch,
		MlsEpoch:        mlsEpoch,
	}, nil
}

func buildEventAndPayloads(
	ctx context.Context,
	repositories messaging.AuthorityRepositories,
	conversation *messaging.AuthorityConversation,
	command *chat.ChatCommand,
	eventID string,
	now time.Time,
) (*chat.ConversationEvent, []*chat.PreparedEndpointPayload, error) {
	if transition := command.GetMembershipTransition(); transition != nil {
		return buildMembershipTransitionEventAndPayloads(
			ctx,
			repositories,
			conversation,
			command,
			transition,
			eventID,
			now,
		)
	}

	// Edit carries encrypted payloads (same structure as SendMessage).
	if edit := command.GetEditMessage(); edit != nil {
		return buildEditMessageEventAndPayloads(
			ctx,
			repositories,
			conversation,
			command,
			edit,
			eventID,
			now,
		)
	}

	// Retract is metadata-only: all endpoints receive a PublicEventMarker.
	if retract := command.GetRetractMessage(); retract != nil {
		return buildRetractMessageEventAndPayloads(
			ctx,
			repositories,
			conversation,
			command,
			retract,
			eventID,
			now,
		)
	}

	// Reaction is metadata-only: all endpoints receive a PublicEventMarker.
	if reaction := command.GetReaction(); reaction != nil {
		return buildReactionEventAndPayloads(
			ctx,
			repositories,
			conversation,
			command,
			reaction,
			eventID,
			now,
		)
	}

	// Pin is metadata-only: all endpoints receive a PublicEventMarker.
	if pin := command.GetPinMessage(); pin != nil {
		return buildPinMessageEventAndPayloads(
			ctx,
			repositories,
			conversation,
			command,
			pin,
			eventID,
			now,
		)
	}

	send := command.GetSendMessage()
	if send == nil || send.MessageId == "" {
		return nil, nil, messaging.ErrUnsupportedCommand
	}
	endpoints, err := listRequiredEndpoints(ctx, repositories, command.ConversationId)
	if err != nil {
		return nil, nil, err
	}
	markerBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chat.PublicEventMarker{
			ConversationId:  command.ConversationId,
			EventId:         eventID,
			CommandId:       command.CommandId,
			SendingEndpoint: command.Sender,
		},
	)
	if err != nil {
		return nil, nil, err
	}
	markerHash := sha256.Sum256(markerBytes)
	marker := &chat.PreparedEndpointPayload{
		Recipient:     command.Sender,
		Kind:          chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_PUBLIC_EVENT,
		OpaquePayload: markerBytes,
		PayloadSha256: markerHash[:],
	}

	var payloads []*chat.PreparedEndpointPayload
	switch conversation.Kind {
	case messaging.AuthorityConversationKindDirect:
		payloads = append(payloads, send.DirectPayloads...)
		payloads = append(payloads, marker)
	case messaging.AuthorityConversationKindGroup:
		if len(send.MlsApplicationPayload) == 0 ||
			len(send.MlsApplicationPayloadSha256) != sha256.Size {
			return nil, nil, messaging.ErrDeliverySet
		}
		hash := sha256.Sum256(send.MlsApplicationPayload)
		if !bytes.Equal(hash[:], send.MlsApplicationPayloadSha256) {
			return nil, nil, messaging.ErrDeliverySet
		}
		for _, endpoint := range endpoints {
			if endpointKey(endpoint) == endpointKey(command.Sender) {
				payloads = append(payloads, marker)
				continue
			}
			payloads = append(payloads, &chat.PreparedEndpointPayload{
				Recipient:     endpoint,
				Kind:          chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_APPLICATION,
				OpaquePayload: send.MlsApplicationPayload,
				PayloadSha256: send.MlsApplicationPayloadSha256,
			})
		}
	default:
		return nil, nil, messaging.ErrConversationState
	}
	if err := validateDeliverySet(endpoints, payloads); err != nil {
		return nil, nil, err
	}

	event := &chat.ConversationEvent{
		EventId:         eventID,
		ConversationId:  command.ConversationId,
		Sequence:        conversation.CurrentSequence + 1,
		CommandId:       command.CommandId,
		Actor:           command.Sender,
		CommittedAt:     timestamppb.New(now),
		MembershipEpoch: conversation.MembershipEpoch,
		MlsEpoch:        conversation.MlsEpoch,
		Payload: &chat.ConversationEvent_MessageCommitted{
			MessageCommitted: &chat.MessageCommittedFact{
				MessageId:           send.MessageId,
				Sender:              command.Sender,
				ContentKind:         send.ContentKind,
				ReplyToMessageId:    send.ReplyToMessageId,
				ThreadRootMessageId: send.ThreadRootMessageId,
				Attachments:         send.Attachments,
				ClientTimestamp:     command.ClientTimestamp,
			},
		},
	}
	for _, payload := range payloads {
		event.DeliveryCommitments = append(
			event.DeliveryCommitments,
			deliveryCommitment(eventID, command.ConversationId, payload),
		)
	}
	sort.Slice(event.DeliveryCommitments, func(i, j int) bool {
		return bytes.Compare(event.DeliveryCommitments[i], event.DeliveryCommitments[j]) < 0
	})
	return event, payloads, nil
}

func buildMembershipTransitionEventAndPayloads(
	ctx context.Context,
	repositories messaging.AuthorityRepositories,
	conversation *messaging.AuthorityConversation,
	command *chat.ChatCommand,
	transition *chat.MembershipTransitionIntent,
	eventID string,
	now time.Time,
) (*chat.ConversationEvent, []*chat.PreparedEndpointPayload, error) {
	if conversation.Kind != messaging.AuthorityConversationKindGroup ||
		conversation.MembershipEpoch != 0 ||
		conversation.MlsEpoch != 0 ||
		transition.TransitionId == "" ||
		transition.FromMembershipEpoch != 0 ||
		transition.FromMlsEpoch != 0 ||
		transition.ToMlsEpoch != 1 ||
		len(transition.MlsCommit) == 0 ||
		len(transition.MlsCommitSha256) != sha256.Size {
		return nil, nil, messaging.ErrConversationState
	}
	commitHash := sha256.Sum256(transition.MlsCommit)
	if !bytes.Equal(commitHash[:], transition.MlsCommitSha256) {
		return nil, nil, messaging.ErrDeliverySet
	}
	endpoints, err := listRequiredEndpoints(ctx, repositories, command.ConversationId)
	if err != nil {
		return nil, nil, err
	}
	expectedChanges := make(map[string]struct{}, len(endpoints))
	for _, endpoint := range endpoints {
		expectedChanges[endpointKey(endpoint)] = struct{}{}
	}
	committedChanges := make([]*chat.MessagingMembershipChangeCommitted, 0, len(transition.Changes))
	for _, change := range transition.Changes {
		if change == nil ||
			change.Ptid == "" ||
			change.DeviceId == "" ||
			(change.Action != chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_ACTOR &&
				change.Action != chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_DEVICE) {
			return nil, nil, messaging.ErrDeliverySet
		}
		key := endpointKey(&chat.CryptoEndpoint{Ptid: change.Ptid, DeviceId: change.DeviceId})
		if _, ok := expectedChanges[key]; !ok {
			return nil, nil, messaging.ErrDeliverySet
		}
		delete(expectedChanges, key)
		committedChanges = append(committedChanges, &chat.MessagingMembershipChangeCommitted{
			Action:        change.Action,
			Ptid:          change.Ptid,
			DeviceId:      change.DeviceId,
			HomeStationId: change.HomeStationId,
			Role:          change.Role,
		})
	}
	if len(expectedChanges) != 0 {
		return nil, nil, messaging.ErrDeliverySet
	}
	postState, err := buildConversationAuthoritySnapshot(ctx, repositories, conversation, 1, 1)
	if err != nil {
		return nil, nil, err
	}
	markerBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chat.PublicEventMarker{
			ConversationId:  command.ConversationId,
			EventId:         eventID,
			CommandId:       command.CommandId,
			SendingEndpoint: command.Sender,
		},
	)
	if err != nil {
		return nil, nil, err
	}
	markerHash := sha256.Sum256(markerBytes)
	payloads := []*chat.PreparedEndpointPayload{{
		Recipient:     command.Sender,
		Kind:          chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_PUBLIC_EVENT,
		OpaquePayload: markerBytes,
		PayloadSha256: markerHash[:],
	}}
	for _, welcome := range transition.WelcomePayloads {
		if welcome == nil ||
			welcome.Recipient == nil ||
			endpointKey(welcome.Recipient) == endpointKey(command.Sender) ||
			welcome.Kind != chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_WELCOME ||
			len(welcome.OpaquePayload) == 0 ||
			len(welcome.PayloadSha256) != sha256.Size {
			return nil, nil, messaging.ErrDeliverySet
		}
		welcomeHash := sha256.Sum256(welcome.OpaquePayload)
		if !bytes.Equal(welcomeHash[:], welcome.PayloadSha256) {
			return nil, nil, messaging.ErrDeliverySet
		}
		wrapped, err := proto.MarshalOptions{Deterministic: true}.Marshal(&chat.MlsQueuePayload{
			Kind:                chat.MlsQueuePayloadKind_MLS_QUEUE_PAYLOAD_KIND_WELCOME,
			ConversationId:      command.ConversationId,
			TransitionId:        transition.TransitionId,
			EventId:             eventID,
			AuthoritySequence:   conversation.CurrentSequence + 1,
			FromMembershipEpoch: transition.FromMembershipEpoch,
			ToMembershipEpoch:   1,
			FromMlsEpoch:        transition.FromMlsEpoch,
			ToMlsEpoch:          transition.ToMlsEpoch,
			Recipient:           welcome.Recipient,
			OpaqueMlsBytes:      welcome.OpaquePayload,
			PayloadSha256:       welcome.PayloadSha256,
		})
		if err != nil {
			return nil, nil, err
		}
		wrappedHash := sha256.Sum256(wrapped)
		payloads = append(payloads, &chat.PreparedEndpointPayload{
			Recipient:     welcome.Recipient,
			Kind:          welcome.Kind,
			OpaquePayload: wrapped,
			PayloadSha256: wrappedHash[:],
		})
	}
	if err := validateDeliverySet(endpoints, payloads); err != nil {
		return nil, nil, err
	}
	event := &chat.ConversationEvent{
		EventId:            eventID,
		ConversationId:     command.ConversationId,
		Sequence:           conversation.CurrentSequence + 1,
		CommandId:          command.CommandId,
		Actor:              command.Sender,
		CommittedAt:        timestamppb.New(now),
		MembershipEpoch:    1,
		MlsEpoch:           1,
		AuthorityStationId: command.AuthorityStationId,
		Payload: &chat.ConversationEvent_MembershipTransitionCommitted{
			MembershipTransitionCommitted: &chat.MembershipTransitionCommittedFact{
				TransitionId:        transition.TransitionId,
				FromMembershipEpoch: transition.FromMembershipEpoch,
				ToMembershipEpoch:   1,
				FromMlsEpoch:        transition.FromMlsEpoch,
				ToMlsEpoch:          transition.ToMlsEpoch,
				Changes:             committedChanges,
				MlsCommitSha256:     transition.MlsCommitSha256,
				LeaveIntentId:       transition.LeaveIntentId,
				PostState:           postState,
			},
		},
	}
	for _, payload := range payloads {
		event.DeliveryCommitments = append(
			event.DeliveryCommitments,
			deliveryCommitment(eventID, command.ConversationId, payload),
		)
	}
	sort.Slice(event.DeliveryCommitments, func(i, j int) bool {
		return bytes.Compare(event.DeliveryCommitments[i], event.DeliveryCommitments[j]) < 0
	})
	return event, payloads, nil
}

// buildEditMessageEventAndPayloads handles the EditMessage command.
// Edit carries encrypted payloads identical in structure to SendMessage
// (Direct payloads for direct conversations, MLS application payload for groups).
func buildEditMessageEventAndPayloads(
	ctx context.Context,
	repositories messaging.AuthorityRepositories,
	conversation *messaging.AuthorityConversation,
	command *chat.ChatCommand,
	edit *chat.EditMessageIntent,
	eventID string,
	now time.Time,
) (*chat.ConversationEvent, []*chat.PreparedEndpointPayload, error) {
	if edit.MessageId == "" {
		return nil, nil, messaging.ErrUnsupportedCommand
	}
	if len(edit.DirectPayloads) == 0 && len(edit.MlsApplicationPayload) == 0 {
		return nil, nil, messaging.ErrDeliverySet
	}

	endpoints, err := listRequiredEndpoints(ctx, repositories, command.ConversationId)
	if err != nil {
		return nil, nil, err
	}

	markerBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chat.PublicEventMarker{
			ConversationId:  command.ConversationId,
			EventId:         eventID,
			CommandId:       command.CommandId,
			SendingEndpoint: command.Sender,
		},
	)
	if err != nil {
		return nil, nil, err
	}
	markerHash := sha256.Sum256(markerBytes)
	marker := &chat.PreparedEndpointPayload{
		Recipient:     command.Sender,
		Kind:          chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_PUBLIC_EVENT,
		OpaquePayload: markerBytes,
		PayloadSha256: markerHash[:],
	}

	var payloads []*chat.PreparedEndpointPayload
	switch conversation.Kind {
	case messaging.AuthorityConversationKindDirect:
		payloads = append(payloads, edit.DirectPayloads...)
		payloads = append(payloads, marker)
	case messaging.AuthorityConversationKindGroup:
		if len(edit.MlsApplicationPayload) == 0 ||
			len(edit.MlsApplicationPayloadSha256) != sha256.Size {
			return nil, nil, messaging.ErrDeliverySet
		}
		hash := sha256.Sum256(edit.MlsApplicationPayload)
		if !bytes.Equal(hash[:], edit.MlsApplicationPayloadSha256) {
			return nil, nil, messaging.ErrDeliverySet
		}
		for _, endpoint := range endpoints {
			if endpointKey(endpoint) == endpointKey(command.Sender) {
				payloads = append(payloads, marker)
				continue
			}
			payloads = append(payloads, &chat.PreparedEndpointPayload{
				Recipient:     endpoint,
				Kind:          chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_APPLICATION,
				OpaquePayload: edit.MlsApplicationPayload,
				PayloadSha256: edit.MlsApplicationPayloadSha256,
			})
		}
	default:
		return nil, nil, messaging.ErrConversationState
	}
	if err := validateDeliverySet(endpoints, payloads); err != nil {
		return nil, nil, err
	}

	event := &chat.ConversationEvent{
		EventId:         eventID,
		ConversationId:  command.ConversationId,
		Sequence:        conversation.CurrentSequence + 1,
		CommandId:       command.CommandId,
		Actor:           command.Sender,
		CommittedAt:     timestamppb.New(now),
		MembershipEpoch: conversation.MembershipEpoch,
		MlsEpoch:        conversation.MlsEpoch,
		Payload: &chat.ConversationEvent_MessageEdited{
			MessageEdited: &chat.MessageEditedFact{
				MessageId: edit.MessageId,
				Editor:    command.Sender,
				EditedAt:  timestamppb.New(now),
			},
		},
	}
	for _, payload := range payloads {
		event.DeliveryCommitments = append(
			event.DeliveryCommitments,
			deliveryCommitment(eventID, command.ConversationId, payload),
		)
	}
	sort.Slice(event.DeliveryCommitments, func(i, j int) bool {
		return bytes.Compare(event.DeliveryCommitments[i], event.DeliveryCommitments[j]) < 0
	})
	return event, payloads, nil
}

// buildRetractMessageEventAndPayloads handles the RetractMessage command.
// Retraction is metadata-only: all endpoints receive a PublicEventMarker.
func buildRetractMessageEventAndPayloads(
	ctx context.Context,
	repositories messaging.AuthorityRepositories,
	conversation *messaging.AuthorityConversation,
	command *chat.ChatCommand,
	retract *chat.RetractMessageIntent,
	eventID string,
	now time.Time,
) (*chat.ConversationEvent, []*chat.PreparedEndpointPayload, error) {
	if retract.MessageId == "" {
		return nil, nil, messaging.ErrUnsupportedCommand
	}

	endpoints, err := listRequiredEndpoints(ctx, repositories, command.ConversationId)
	if err != nil {
		return nil, nil, err
	}

	payloads, err := buildMetadataOnlyPayloads(command, eventID, endpoints)
	if err != nil {
		return nil, nil, err
	}
	if err := validateDeliverySet(endpoints, payloads); err != nil {
		return nil, nil, err
	}

	event := &chat.ConversationEvent{
		EventId:         eventID,
		ConversationId:  command.ConversationId,
		Sequence:        conversation.CurrentSequence + 1,
		CommandId:       command.CommandId,
		Actor:           command.Sender,
		CommittedAt:     timestamppb.New(now),
		MembershipEpoch: conversation.MembershipEpoch,
		MlsEpoch:        conversation.MlsEpoch,
		Payload: &chat.ConversationEvent_MessageRetracted{
			MessageRetracted: &chat.MessageRetractedFact{
				MessageId:   retract.MessageId,
				Retractor:   command.Sender,
				RetractedAt: timestamppb.New(now),
			},
		},
	}
	for _, payload := range payloads {
		event.DeliveryCommitments = append(
			event.DeliveryCommitments,
			deliveryCommitment(eventID, command.ConversationId, payload),
		)
	}
	sort.Slice(event.DeliveryCommitments, func(i, j int) bool {
		return bytes.Compare(event.DeliveryCommitments[i], event.DeliveryCommitments[j]) < 0
	})
	return event, payloads, nil
}

// buildReactionEventAndPayloads handles the Reaction command.
// Reaction is metadata-only: all endpoints receive a PublicEventMarker.
func buildReactionEventAndPayloads(
	ctx context.Context,
	repositories messaging.AuthorityRepositories,
	conversation *messaging.AuthorityConversation,
	command *chat.ChatCommand,
	reaction *chat.ReactionIntent,
	eventID string,
	now time.Time,
) (*chat.ConversationEvent, []*chat.PreparedEndpointPayload, error) {
	if reaction.MessageId == "" || reaction.Reaction == "" {
		return nil, nil, messaging.ErrUnsupportedCommand
	}

	endpoints, err := listRequiredEndpoints(ctx, repositories, command.ConversationId)
	if err != nil {
		return nil, nil, err
	}

	payloads, err := buildMetadataOnlyPayloads(command, eventID, endpoints)
	if err != nil {
		return nil, nil, err
	}
	if err := validateDeliverySet(endpoints, payloads); err != nil {
		return nil, nil, err
	}

	event := &chat.ConversationEvent{
		EventId:         eventID,
		ConversationId:  command.ConversationId,
		Sequence:        conversation.CurrentSequence + 1,
		CommandId:       command.CommandId,
		Actor:           command.Sender,
		CommittedAt:     timestamppb.New(now),
		MembershipEpoch: conversation.MembershipEpoch,
		MlsEpoch:        conversation.MlsEpoch,
		Payload: &chat.ConversationEvent_ReactionCommitted{
			ReactionCommitted: &chat.ReactionCommittedFact{
				MessageId: reaction.MessageId,
				Actor:     command.Sender,
				Reaction:  reaction.Reaction,
				Removed:   reaction.Remove,
			},
		},
	}
	for _, payload := range payloads {
		event.DeliveryCommitments = append(
			event.DeliveryCommitments,
			deliveryCommitment(eventID, command.ConversationId, payload),
		)
	}
	sort.Slice(event.DeliveryCommitments, func(i, j int) bool {
		return bytes.Compare(event.DeliveryCommitments[i], event.DeliveryCommitments[j]) < 0
	})
	return event, payloads, nil
}

// buildPinMessageEventAndPayloads handles the PinMessage command.
// Pin is metadata-only: all endpoints receive a PublicEventMarker.
func buildPinMessageEventAndPayloads(
	ctx context.Context,
	repositories messaging.AuthorityRepositories,
	conversation *messaging.AuthorityConversation,
	command *chat.ChatCommand,
	pin *chat.PinMessageIntent,
	eventID string,
	now time.Time,
) (*chat.ConversationEvent, []*chat.PreparedEndpointPayload, error) {
	if pin.MessageId == "" {
		return nil, nil, messaging.ErrUnsupportedCommand
	}

	endpoints, err := listRequiredEndpoints(ctx, repositories, command.ConversationId)
	if err != nil {
		return nil, nil, err
	}

	payloads, err := buildMetadataOnlyPayloads(command, eventID, endpoints)
	if err != nil {
		return nil, nil, err
	}
	if err := validateDeliverySet(endpoints, payloads); err != nil {
		return nil, nil, err
	}

	event := &chat.ConversationEvent{
		EventId:         eventID,
		ConversationId:  command.ConversationId,
		Sequence:        conversation.CurrentSequence + 1,
		CommandId:       command.CommandId,
		Actor:           command.Sender,
		CommittedAt:     timestamppb.New(now),
		MembershipEpoch: conversation.MembershipEpoch,
		MlsEpoch:        conversation.MlsEpoch,
		Payload: &chat.ConversationEvent_MessagePinCommitted{
			MessagePinCommitted: &chat.MessagePinCommittedFact{
				MessageId: pin.MessageId,
				Actor:     command.Sender,
				Removed:   pin.Remove,
			},
		},
	}
	for _, payload := range payloads {
		event.DeliveryCommitments = append(
			event.DeliveryCommitments,
			deliveryCommitment(eventID, command.ConversationId, payload),
		)
	}
	sort.Slice(event.DeliveryCommitments, func(i, j int) bool {
		return bytes.Compare(event.DeliveryCommitments[i], event.DeliveryCommitments[j]) < 0
	})
	return event, payloads, nil
}

// buildMetadataOnlyPayloads constructs a PublicEventMarker payload for every
// endpoint in the conversation. Used by metadata-only commands (retract, react, pin)
// where no encrypted content needs to be delivered.
func buildMetadataOnlyPayloads(
	command *chat.ChatCommand,
	eventID string,
	endpoints []*chat.CryptoEndpoint,
) ([]*chat.PreparedEndpointPayload, error) {
	markerBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chat.PublicEventMarker{
			ConversationId:  command.ConversationId,
			EventId:         eventID,
			CommandId:       command.CommandId,
			SendingEndpoint: command.Sender,
		},
	)
	if err != nil {
		return nil, err
	}
	markerHash := sha256.Sum256(markerBytes)

	payloads := make([]*chat.PreparedEndpointPayload, 0, len(endpoints))
	for _, endpoint := range endpoints {
		payloads = append(payloads, &chat.PreparedEndpointPayload{
			Recipient:     endpoint,
			Kind:          chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_PUBLIC_EVENT,
			OpaquePayload: markerBytes,
			PayloadSha256: markerHash[:],
		})
	}
	return payloads, nil
}

func validateDeliverySet(
	required []*chat.CryptoEndpoint,
	payloads []*chat.PreparedEndpointPayload,
) error {
	if len(required) != len(payloads) {
		return messaging.ErrDeliverySet
	}
	expected := make(map[string]struct{}, len(required))
	for _, endpoint := range required {
		expected[endpointKey(endpoint)] = struct{}{}
	}
	for _, payload := range payloads {
		if payload == nil || payload.Recipient == nil ||
			len(payload.OpaquePayload) == 0 || len(payload.PayloadSha256) != sha256.Size {
			return messaging.ErrDeliverySet
		}
		hash := sha256.Sum256(payload.OpaquePayload)
		if !bytes.Equal(hash[:], payload.PayloadSha256) {
			return messaging.ErrDeliverySet
		}
		key := endpointKey(payload.Recipient)
		if _, ok := expected[key]; !ok {
			return messaging.ErrDeliverySet
		}
		delete(expected, key)
	}
	if len(expected) != 0 {
		return messaging.ErrDeliverySet
	}
	return nil
}

func deliveryCommitment(
	eventID string,
	conversationID string,
	payload *chat.PreparedEndpointPayload,
) []byte {
	var input bytes.Buffer
	input.WriteString(deliveryCommitmentDomain)
	input.WriteByte(0)
	writeUint32(&input, 1)
	writeString(&input, conversationID)
	writeString(&input, eventID)
	writeString(&input, payload.Recipient.Ptid)
	writeString(&input, payload.Recipient.DeviceId)
	writeUint32(&input, uint32(payload.Kind))
	input.Write(payload.PayloadSha256)
	hash := sha256.Sum256(input.Bytes())
	return hash[:]
}

func hashAuthorityEvent(event *chat.ConversationEvent) ([]byte, error) {
	cloned := proto.Clone(event).(*chat.ConversationEvent)
	cloned.EventHash = nil
	eventBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(cloned)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(eventBytes)
	return hash[:], nil
}

func writeString(buffer *bytes.Buffer, value string) {
	writeUint32(buffer, uint32(len(value)))
	buffer.WriteString(value)
}

func writeUint32(buffer *bytes.Buffer, value uint32) {
	var encoded [4]byte
	binary.BigEndian.PutUint32(encoded[:], value)
	buffer.Write(encoded[:])
}

func endpointKey(endpoint *chat.CryptoEndpoint) string {
	if endpoint == nil {
		return ""
	}
	return endpoint.Ptid + "\x00" + endpoint.DeviceId
}
