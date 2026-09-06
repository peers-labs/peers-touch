package application

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type ConversationService struct {
	uow              messaging.AuthorityUnitOfWork
	localStationID   string
	frameSigner      messaging.FederationFrameSigner
	manifestResolver messaging.EndpointManifestResolver
	clock            func() time.Time
}

func NewConversationService(
	uow messaging.AuthorityUnitOfWork,
	localStationID string,
	frameSigner messaging.FederationFrameSigner,
	manifestResolver messaging.EndpointManifestResolver,
	clock func() time.Time,
) (*ConversationService, error) {
	if uow == nil ||
		localStationID == "" ||
		frameSigner == nil ||
		manifestResolver == nil ||
		clock == nil {
		return nil, fmt.Errorf("messaging: conversation service dependencies are invalid")
	}
	return &ConversationService{
		uow:              uow,
		localStationID:   localStationID,
		frameSigner:      frameSigner,
		manifestResolver: manifestResolver,
		clock:            clock,
	}, nil
}

func (s *ConversationService) CreateDirect(
	ctx context.Context,
	creator *chat.CryptoEndpoint,
	peerPTID string,
) (*chat.MessagingConversationView, error) {
	if creator == nil ||
		strings.TrimSpace(creator.Ptid) == "" ||
		strings.TrimSpace(creator.DeviceId) == "" ||
		strings.TrimSpace(peerPTID) == "" ||
		creator.Ptid == peerPTID {
		return nil, fmt.Errorf("messaging: direct conversation identity is invalid")
	}
	conversationID := deterministicDirectConversationID(creator.Ptid, peerPTID)
	actors := []string{creator.Ptid, peerPTID}
	sort.Strings(actors)
	if err := resolveEndpointManifests(ctx, s.manifestResolver, actors); err != nil {
		return nil, err
	}
	var view *chat.MessagingConversationView
	err := s.uow.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		active, err := repositories.Devices.IsActive(ctx, creator)
		if err != nil {
			return err
		}
		if !active {
			return messaging.ErrSenderUnauthorized
		}
		endpoints := make([]*chat.CryptoEndpoint, 0)
		for _, ptid := range actors {
			actorEndpoints, err := repositories.Devices.ListActiveEndpoints(ctx, ptid)
			if err != nil {
				return err
			}
			if len(actorEndpoints) == 0 {
				return fmt.Errorf("messaging: actor %s has no active device", ptid)
			}
			endpoints = append(endpoints, actorEndpoints...)
		}
		sort.Slice(endpoints, func(i, j int) bool {
			return endpointKey(endpoints[i]) < endpointKey(endpoints[j])
		})
		conversation := &messaging.AuthorityConversation{
			ConversationID:  conversationID,
			Kind:            messaging.AuthorityConversationKindDirect,
			OwnerPTID:       actors[0],
			CurrentSequence: 0,
			MembershipEpoch: 1,
			MlsEpoch:        0,
			Active:          true,
		}
		created, err := repositories.Authority.CreateConversation(ctx, conversation)
		if err != nil {
			return err
		}
		for _, actor := range actors {
			role := "member"
			if actor == conversation.OwnerPTID {
				role = "owner"
			}
			if err := repositories.Authority.AddMember(
				ctx,
				conversationID,
				actor,
				role,
				1,
			); err != nil {
				return err
			}
		}
		for _, endpoint := range endpoints {
			if err := repositories.Authority.AddMemberDevice(
				ctx,
				conversationID,
				endpoint,
				1,
			); err != nil {
				return err
			}
		}
		if created {
			if err := s.appendCreatedEvent(
				ctx,
				repositories,
				conversation,
				creator,
				actors,
				endpoints,
			); err != nil {
				return err
			}
			conversation.CurrentSequence = 1
		} else {
			existing, err := repositories.Authority.LockConversation(ctx, conversationID)
			if err != nil {
				return err
			}
			if existing.Kind != messaging.AuthorityConversationKindDirect ||
				!existing.Active ||
				existing.MembershipEpoch != 1 {
				return messaging.ErrConversationState
			}
			conversation = existing
		}
		view = conversationView(conversation, actors, s.localStationID)
		return nil
	})
	return view, err
}

func (s *ConversationService) List(
	ctx context.Context,
	requester *chat.CryptoEndpoint,
) ([]*chat.MessagingConversationView, error) {
	if requester == nil {
		return nil, messaging.ErrSenderUnauthorized
	}
	var views []*chat.MessagingConversationView
	err := s.uow.Execute(ctx, func(repositories messaging.AuthorityRepositories) error {
		active, err := repositories.Devices.IsActive(ctx, requester)
		if err != nil {
			return err
		}
		if !active {
			return messaging.ErrSenderUnauthorized
		}
		rows, err := repositories.Authority.ListConversationsForActor(ctx, requester.Ptid)
		if err != nil {
			return err
		}
		views = make([]*chat.MessagingConversationView, 0, len(rows))
		for _, row := range rows {
			views = append(
				views,
				conversationView(row.Conversation, row.MemberPTIDs, s.localStationID),
			)
		}
		return nil
	})
	return views, err
}

func (s *ConversationService) appendCreatedEvent(
	ctx context.Context,
	repositories messaging.AuthorityRepositories,
	conversation *messaging.AuthorityConversation,
	creator *chat.CryptoEndpoint,
	memberPTIDs []string,
	endpoints []*chat.CryptoEndpoint,
) error {
	eventID := "created:" + conversation.ConversationID
	commandID := "create:" + conversation.ConversationID
	markerBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chat.ConversationStateMarker{
			ConversationId: conversation.ConversationID,
			EventId:        eventID,
		},
	)
	if err != nil {
		return err
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
		CommandId:          commandID,
		Actor:              creator,
		CommittedAt:        timestamppb.New(s.clock().UTC()),
		MembershipEpoch:    conversation.MembershipEpoch,
		MlsEpoch:           conversation.MlsEpoch,
		AuthorityStationId: s.localStationID,
		Payload: &chat.ConversationEvent_ConversationCreated{
			ConversationCreated: &chat.ConversationCreatedFact{
				Kind:        conversationKind(conversation.Kind),
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
	if err != nil {
		return err
	}
	if err := repositories.Authority.AppendEvent(ctx, event); err != nil {
		return err
	}
	senderActorIdentityKey, err := repositories.Devices.ActorIdentityPublicKey(
		ctx,
		creator.Ptid,
	)
	if err != nil {
		return err
	}
	return enqueueEventPayloads(
		ctx,
		repositories,
		event,
		payloads,
		senderActorIdentityKey,
		s.localStationID,
		s.frameSigner,
		s.clock().UTC(),
	)
}

func deterministicDirectConversationID(actorA string, actorB string) string {
	pair := []string{actorA, actorB}
	sort.Strings(pair)
	hash := sha256.Sum256([]byte("direct:" + pair[0] + ":" + pair[1]))
	return "d-" + hex.EncodeToString(hash[:16])
}

func conversationView(
	conversation *messaging.AuthorityConversation,
	memberPTIDs []string,
	authorityStationID string,
) *chat.MessagingConversationView {
	return &chat.MessagingConversationView{
		ConversationId:     conversation.ConversationID,
		Kind:               conversationKind(conversation.Kind),
		Name:               conversation.Name,
		OwnerPtid:          conversation.OwnerPTID,
		MemberPtids:        append([]string(nil), memberPTIDs...),
		MembershipEpoch:    conversation.MembershipEpoch,
		MlsEpoch:           conversation.MlsEpoch,
		Active:             conversation.Active,
		AuthorityStationId: authorityStationID,
	}
}

func conversationKind(kind messaging.AuthorityConversationKind) chat.ConversationKind {
	switch kind {
	case messaging.AuthorityConversationKindDirect:
		return chat.ConversationKind_CONVERSATION_KIND_DIRECT
	case messaging.AuthorityConversationKindGroup:
		return chat.ConversationKind_CONVERSATION_KIND_GROUP
	default:
		return chat.ConversationKind_CONVERSATION_KIND_UNSPECIFIED
	}
}
