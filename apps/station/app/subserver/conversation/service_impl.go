package conversation

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"time"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// DefaultService implements the conversation Service.
type DefaultService struct {
	repo           Repository
	envelope       EnvelopeSubmitter
	localStationID string
	clock          Clock
}

func NewConversationService(repo Repository, envelope EnvelopeSubmitter, localStationID string) *DefaultService {
	return &DefaultService{
		repo:           repo,
		envelope:       envelope,
		localStationID: localStationID,
		clock:          time.Now,
	}
}

func (s *DefaultService) CreateDirect(ctx context.Context, actorA, actorB string, actorAStation, actorBStation string) (*chat.Conversation, error) {
	convID := DeterministicDirectID(actorA, actorB)

	existing, err := s.repo.GetConversation(ctx, convID)
	if err == nil && existing != nil {
		return existing, nil
	}

	now := s.clock()
	conv := &chat.Conversation{
		ConversationId:         convID,
		Kind:                   chat.ConversationKind_CONVERSATION_KIND_DIRECT,
		AuthorityStationPeerId: s.localStationID,
		MembershipEpoch:        1,
		Status:                 chat.ConversationStatus_CONVERSATION_STATUS_ACTIVE,
		CreatedAt:              timestamppb.New(now),
		UpdatedAt:              timestamppb.New(now),
	}

	if err := s.repo.UpsertConversation(ctx, conv); err != nil {
		return nil, fmt.Errorf("conversation: create failed: %w", err)
	}

	memberA := &chat.ConversationMember{
		ConversationId:         convID,
		ActorDid:               actorA,
		Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
		MemberStatus:           chat.MemberStatus_MEMBER_STATUS_ACTIVE,
		ActorHomeStationPeerId: actorAStation,
		JoinedAt:               timestamppb.New(now),
	}
	memberB := &chat.ConversationMember{
		ConversationId:         convID,
		ActorDid:               actorB,
		Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
		MemberStatus:           chat.MemberStatus_MEMBER_STATUS_ACTIVE,
		ActorHomeStationPeerId: actorBStation,
		JoinedAt:               timestamppb.New(now),
	}

	if err := s.repo.UpsertMember(ctx, memberA); err != nil {
		return nil, fmt.Errorf("conversation: member A create failed: %w", err)
	}
	if err := s.repo.UpsertMember(ctx, memberB); err != nil {
		return nil, fmt.Errorf("conversation: member B create failed: %w", err)
	}

	createdEvent := &chat.CommittedConversationEvent{
		EventId:                   uuid.NewString(),
		ConversationId:            convID,
		GroupSeq:                  1,
		MembershipEpoch:           1,
		CommittedByStationPeerId:  s.localStationID,
		CommittedAt:               timestamppb.New(now),
		Payload: &chat.CommittedConversationEvent_ConversationCreated{
			ConversationCreated: &chat.ConversationCreatedEvent{
				Conversation:   conv,
				InitialMembers: []*chat.ConversationMember{memberA, memberB},
			},
		},
	}

	if err := s.repo.AppendEvent(ctx, createdEvent); err != nil {
		return nil, fmt.Errorf("conversation: append created event failed: %w", err)
	}

	members := []*chat.ConversationMember{memberA, memberB}
	if s.envelope != nil {
		_ = s.envelope.SubmitEvent(ctx, conv, members, createdEvent)
	}

	return conv, nil
}

func (s *DefaultService) CreateGroup(ctx context.Context, name string, ownerDID string, ownerStation string, members []MemberEntry) (*chat.Conversation, error) {
	convID := uuid.NewString()
	now := s.clock()

	conv := &chat.Conversation{
		ConversationId:         convID,
		Kind:                   chat.ConversationKind_CONVERSATION_KIND_GROUP,
		AuthorityStationPeerId: s.localStationID,
		MembershipEpoch:        1,
		Status:                 chat.ConversationStatus_CONVERSATION_STATUS_ACTIVE,
		Name:                   name,
		OwnerActorDid:          ownerDID,
		CreatedAt:              timestamppb.New(now),
		UpdatedAt:              timestamppb.New(now),
	}

	if err := s.repo.UpsertConversation(ctx, conv); err != nil {
		return nil, fmt.Errorf("conversation: create group failed: %w", err)
	}

	protoMembers := make([]*chat.ConversationMember, 0, len(members))
	for _, entry := range members {
		role := entry.Role
		if entry.ActorDID == ownerDID {
			role = chat.MemberRole_MEMBER_ROLE_OWNER
		}
		member := &chat.ConversationMember{
			ConversationId:         convID,
			ActorDid:               entry.ActorDID,
			Role:                   role,
			MemberStatus:           chat.MemberStatus_MEMBER_STATUS_ACTIVE,
			ActorHomeStationPeerId: entry.StationID,
			JoinedAt:               timestamppb.New(now),
		}
		if err := s.repo.UpsertMember(ctx, member); err != nil {
			return nil, fmt.Errorf("conversation: add initial member %s failed: %w", entry.ActorDID, err)
		}
		protoMembers = append(protoMembers, member)
	}

	createdEvent := &chat.CommittedConversationEvent{
		EventId:                  uuid.NewString(),
		ConversationId:           convID,
		GroupSeq:                 1,
		MembershipEpoch:          1,
		CommittedByStationPeerId: s.localStationID,
		CommittedAt:              timestamppb.New(now),
		Payload: &chat.CommittedConversationEvent_ConversationCreated{
			ConversationCreated: &chat.ConversationCreatedEvent{
				Conversation:   conv,
				InitialMembers: protoMembers,
			},
		},
	}

	if err := s.repo.AppendEvent(ctx, createdEvent); err != nil {
		return nil, fmt.Errorf("conversation: append created event failed: %w", err)
	}

	if s.envelope != nil {
		_ = s.envelope.SubmitEvent(ctx, conv, protoMembers, createdEvent)
	}

	return conv, nil
}

func (s *DefaultService) SubmitCommand(ctx context.Context, cmd *chat.ConversationCommand) (*chat.CommittedConversationEvent, error) {
	if cmd.ConversationId == "" {
		return nil, fmt.Errorf("conversation: conversation_id is required")
	}

	conv, err := s.repo.GetConversation(ctx, cmd.ConversationId)
	if err != nil {
		return nil, fmt.Errorf("conversation: not found: %w", err)
	}
	if conv.Status != chat.ConversationStatus_CONVERSATION_STATUS_ACTIVE {
		return nil, fmt.Errorf("conversation: not active (status=%v)", conv.Status)
	}

	member, err := s.repo.GetMember(ctx, cmd.ConversationId, cmd.SenderActorDid)
	if err != nil || member == nil {
		return nil, fmt.Errorf("conversation: sender not a member")
	}
	if member.MemberStatus != chat.MemberStatus_MEMBER_STATUS_ACTIVE {
		return nil, fmt.Errorf("conversation: sender membership not active")
	}

	event, err := s.processCommand(ctx, conv, cmd)
	if err != nil {
		return nil, err
	}

	if err := s.repo.AppendEvent(ctx, event); err != nil {
		return nil, fmt.Errorf("conversation: append event failed: %w", err)
	}

	members, _ := s.repo.GetMembers(ctx, cmd.ConversationId)
	if s.envelope != nil {
		_ = s.envelope.SubmitEvent(ctx, conv, members, event)
	}

	return event, nil
}

func (s *DefaultService) GetConversation(ctx context.Context, conversationID string) (*chat.Conversation, error) {
	return s.repo.GetConversation(ctx, conversationID)
}

func (s *DefaultService) ListConversations(ctx context.Context, actorDID string) ([]*chat.Conversation, error) {
	return s.repo.ListByActor(ctx, actorDID)
}

func (s *DefaultService) GetMembers(ctx context.Context, conversationID string) ([]*chat.ConversationMember, error) {
	return s.repo.GetMembers(ctx, conversationID)
}

func (s *DefaultService) ListEvents(ctx context.Context, conversationID string, afterSeq int64, limit int) ([]*chat.CommittedConversationEvent, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	return s.repo.ListEvents(ctx, conversationID, afterSeq, limit)
}

func (s *DefaultService) SubmitReceipt(ctx context.Context, receipt *chat.MessageReceipt) error {
	if receipt.ConversationId == "" || receipt.MessageId == "" {
		return fmt.Errorf("conversation: receipt requires conversation_id and message_id")
	}

	members, err := s.repo.GetMembers(ctx, receipt.ConversationId)
	if err != nil {
		return fmt.Errorf("conversation: get members for receipt failed: %w", err)
	}

	for _, member := range members {
		if member.ActorDid == receipt.ActorDid {
			continue
		}
		if member.MemberStatus != chat.MemberStatus_MEMBER_STATUS_ACTIVE {
			continue
		}
		if s.envelope != nil {
			_ = s.envelope.SubmitReceipt(ctx, receipt, member.ActorDid, member.ActorHomeStationPeerId)
		}
	}
	return nil
}

func (s *DefaultService) processCommand(ctx context.Context, conv *chat.Conversation, cmd *chat.ConversationCommand) (*chat.CommittedConversationEvent, error) {
	seq, err := s.repo.NextSeq(ctx, conv.ConversationId)
	if err != nil {
		return nil, fmt.Errorf("conversation: next seq failed: %w", err)
	}

	now := s.clock()
	event := &chat.CommittedConversationEvent{
		EventId:                  uuid.NewString(),
		ConversationId:           conv.ConversationId,
		GroupSeq:                 seq,
		MembershipEpoch:          conv.MembershipEpoch,
		CommittedByStationPeerId: s.localStationID,
		CommittedAt:              timestamppb.New(now),
	}

	switch p := cmd.Payload.(type) {
	case *chat.ConversationCommand_SendMessage:
		event.Payload = &chat.CommittedConversationEvent_MessageCommitted{
			MessageCommitted: &chat.MessageCommittedEvent{
				MessageId:            uuid.NewString(),
				SenderActorDid:       cmd.SenderActorDid,
				SenderDeviceId:       cmd.SenderDeviceId,
				EncryptedPayload:     p.SendMessage.EncryptedPayload,
				ContentType:          p.SendMessage.ContentType,
				ReplyToMessageId:     p.SendMessage.ReplyToMessageId,
				ThreadRootMessageId:  p.SendMessage.ThreadRootMessageId,
				Attachments:          p.SendMessage.Attachments,
				ClientTs:             cmd.ClientTs,
			},
		}
	case *chat.ConversationCommand_EditMessage:
		event.Payload = &chat.CommittedConversationEvent_MessageEdited{
			MessageEdited: &chat.MessageEditedEvent{
				MessageId:        p.EditMessage.TargetMessageId,
				EditorActorDid:   cmd.SenderActorDid,
				EncryptedPayload: p.EditMessage.EncryptedPayload,
				EditedAt:         timestamppb.New(now),
			},
		}
	case *chat.ConversationCommand_RetractMessage:
		event.Payload = &chat.CommittedConversationEvent_MessageRetracted{
			MessageRetracted: &chat.MessageRetractedEvent{
				MessageId:          p.RetractMessage.TargetMessageId,
				RetractorActorDid:  cmd.SenderActorDid,
				RetractedAt:        timestamppb.New(now),
			},
		}
	case *chat.ConversationCommand_AddMembers:
		if conv.Kind != chat.ConversationKind_CONVERSATION_KIND_GROUP {
			return nil, fmt.Errorf("conversation: add_members only valid for group conversations")
		}
		newEpoch := conv.MembershipEpoch + 1
		changes := make([]*chat.MemberChange, 0, len(p.AddMembers.Members))
		for _, entry := range p.AddMembers.Members {
			member := &chat.ConversationMember{
				ConversationId:         conv.ConversationId,
				ActorDid:               entry.ActorDid,
				Role:                   entry.Role,
				MemberStatus:           chat.MemberStatus_MEMBER_STATUS_ACTIVE,
				ActorHomeStationPeerId: entry.ActorHomeStationPeerId,
				JoinedAt:               timestamppb.New(now),
				InvitedByActorDid:      cmd.SenderActorDid,
			}
			if err := s.repo.UpsertMember(ctx, member); err != nil {
				return nil, fmt.Errorf("conversation: add member %s failed: %w", entry.ActorDid, err)
			}
			changes = append(changes, &chat.MemberChange{
				ActorDid:               entry.ActorDid,
				Action:                 chat.MemberChangeAction_MEMBER_CHANGE_ACTION_ADDED,
				Role:                   entry.Role,
				ActorHomeStationPeerId: entry.ActorHomeStationPeerId,
			})
		}
		if err := s.repo.BumpMembershipEpoch(ctx, conv.ConversationId, newEpoch); err != nil {
			return nil, fmt.Errorf("conversation: bump epoch failed: %w", err)
		}
		event.MembershipEpoch = newEpoch
		event.Payload = &chat.CommittedConversationEvent_MembershipChanged{
			MembershipChanged: &chat.MembershipChangedEvent{
				Changes:            changes,
				NewMembershipEpoch: newEpoch,
			},
		}
	case *chat.ConversationCommand_RemoveMembers:
		if conv.Kind != chat.ConversationKind_CONVERSATION_KIND_GROUP {
			return nil, fmt.Errorf("conversation: remove_members only valid for group conversations")
		}
		newEpoch := conv.MembershipEpoch + 1
		changes := make([]*chat.MemberChange, 0, len(p.RemoveMembers.ActorDids))
		for _, actorDID := range p.RemoveMembers.ActorDids {
			removedMember := &chat.ConversationMember{
				ConversationId: conv.ConversationId,
				ActorDid:       actorDID,
				MemberStatus:   chat.MemberStatus_MEMBER_STATUS_REMOVED,
			}
			if err := s.repo.UpsertMember(ctx, removedMember); err != nil {
				return nil, fmt.Errorf("conversation: remove member %s failed: %w", actorDID, err)
			}
			changes = append(changes, &chat.MemberChange{
				ActorDid: actorDID,
				Action:   chat.MemberChangeAction_MEMBER_CHANGE_ACTION_REMOVED,
			})
		}
		if err := s.repo.BumpMembershipEpoch(ctx, conv.ConversationId, newEpoch); err != nil {
			return nil, fmt.Errorf("conversation: bump epoch failed: %w", err)
		}
		event.MembershipEpoch = newEpoch
		event.Payload = &chat.CommittedConversationEvent_MembershipChanged{
			MembershipChanged: &chat.MembershipChangedEvent{
				Changes:            changes,
				NewMembershipEpoch: newEpoch,
			},
		}
	case *chat.ConversationCommand_Leave:
		newEpoch := conv.MembershipEpoch + 1
		leftMember := &chat.ConversationMember{
			ConversationId: conv.ConversationId,
			ActorDid:       cmd.SenderActorDid,
			MemberStatus:   chat.MemberStatus_MEMBER_STATUS_LEFT,
		}
		if err := s.repo.UpsertMember(ctx, leftMember); err != nil {
			return nil, fmt.Errorf("conversation: leave failed: %w", err)
		}
		if err := s.repo.BumpMembershipEpoch(ctx, conv.ConversationId, newEpoch); err != nil {
			return nil, fmt.Errorf("conversation: bump epoch failed: %w", err)
		}
		event.MembershipEpoch = newEpoch
		event.Payload = &chat.CommittedConversationEvent_MembershipChanged{
			MembershipChanged: &chat.MembershipChangedEvent{
				Changes: []*chat.MemberChange{{
					ActorDid: cmd.SenderActorDid,
					Action:   chat.MemberChangeAction_MEMBER_CHANGE_ACTION_LEFT,
				}},
				NewMembershipEpoch: newEpoch,
			},
		}
	case *chat.ConversationCommand_Dissolve:
		if conv.Kind != chat.ConversationKind_CONVERSATION_KIND_GROUP {
			return nil, fmt.Errorf("conversation: dissolve only valid for group conversations")
		}
		conv.Status = chat.ConversationStatus_CONVERSATION_STATUS_DISSOLVED
		if err := s.repo.UpsertConversation(ctx, conv); err != nil {
			return nil, fmt.Errorf("conversation: dissolve update failed: %w", err)
		}
		event.Payload = &chat.CommittedConversationEvent_ConversationDissolved{
			ConversationDissolved: &chat.ConversationDissolvedEvent{
				DissolvedByActorDid: cmd.SenderActorDid,
			},
		}
	default:
		return nil, fmt.Errorf("conversation: unsupported command type")
	}

	return event, nil
}

// DeterministicDirectID generates a stable conversation ID from a sorted DID pair (DP-4).
func DeterministicDirectID(actorA, actorB string) string {
	pair := []string{actorA, actorB}
	sort.Strings(pair)
	hash := sha256.Sum256([]byte("direct:" + pair[0] + ":" + pair[1]))
	return "d-" + hex.EncodeToString(hash[:16])
}
