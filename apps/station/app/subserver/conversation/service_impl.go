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
		Ptid:                   actorA,
		Role:                   chat.MemberRole_MEMBER_ROLE_MEMBER,
		MemberStatus:           chat.MemberStatus_MEMBER_STATUS_ACTIVE,
		ActorHomeStationPeerId: actorAStation,
		JoinedAt:               timestamppb.New(now),
	}
	memberB := &chat.ConversationMember{
		ConversationId:         convID,
		Ptid:                   actorB,
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

func (s *DefaultService) CreateGroup(ctx context.Context, name string, ownerPtid string, ownerStation string, members []MemberEntry) (*chat.Conversation, error) {
	convID := uuid.NewString()
	now := s.clock()

	conv := &chat.Conversation{
		ConversationId:         convID,
		Kind:                   chat.ConversationKind_CONVERSATION_KIND_GROUP,
		AuthorityStationPeerId: s.localStationID,
		MembershipEpoch:        1,
		Status:                 chat.ConversationStatus_CONVERSATION_STATUS_ACTIVE,
		Name:                   name,
		OwnerPtid:              ownerPtid,
		CreatedAt:              timestamppb.New(now),
		UpdatedAt:              timestamppb.New(now),
	}

	if err := s.repo.UpsertConversation(ctx, conv); err != nil {
		return nil, fmt.Errorf("conversation: create group failed: %w", err)
	}

	protoMembers := make([]*chat.ConversationMember, 0, len(members))
	for _, entry := range members {
		role := entry.Role
		if entry.Ptid == ownerPtid {
			role = chat.MemberRole_MEMBER_ROLE_OWNER
		}
		member := &chat.ConversationMember{
			ConversationId:         convID,
			Ptid:                   entry.Ptid,
			Role:                   role,
			MemberStatus:           chat.MemberStatus_MEMBER_STATUS_ACTIVE,
			ActorHomeStationPeerId: entry.StationID,
			JoinedAt:               timestamppb.New(now),
		}
		if err := s.repo.UpsertMember(ctx, member); err != nil {
			return nil, fmt.Errorf("conversation: add initial member %s failed: %w", entry.Ptid, err)
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

	member, err := s.repo.GetMember(ctx, cmd.ConversationId, cmd.SenderPtid)
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

func (s *DefaultService) ListConversations(ctx context.Context, ptid string) ([]*chat.Conversation, error) {
	return s.repo.ListByActor(ctx, ptid)
}

func (s *DefaultService) GetMembers(ctx context.Context, conversationID string) ([]*chat.ConversationMember, error) {
	return s.repo.GetMembers(ctx, conversationID)
}

func (s *DefaultService) GetMember(ctx context.Context, conversationID, ptid string) (*chat.ConversationMember, error) {
	return s.repo.GetMember(ctx, conversationID, ptid)
}

func (s *DefaultService) UpsertMember(ctx context.Context, member *chat.ConversationMember) error {
	return s.repo.UpsertMember(ctx, member)
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
		if member.Ptid == receipt.Ptid {
			continue
		}
		if member.MemberStatus != chat.MemberStatus_MEMBER_STATUS_ACTIVE {
			continue
		}
		if s.envelope != nil {
			_ = s.envelope.SubmitReceipt(ctx, receipt, member.Ptid, member.ActorHomeStationPeerId)
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
				SenderPtid:          cmd.SenderPtid,
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
				EditorPtid:      cmd.SenderPtid,
				EncryptedPayload: p.EditMessage.EncryptedPayload,
				EditedAt:         timestamppb.New(now),
			},
		}
	case *chat.ConversationCommand_RetractMessage:
		event.Payload = &chat.CommittedConversationEvent_MessageRetracted{
			MessageRetracted: &chat.MessageRetractedEvent{
				MessageId:         p.RetractMessage.TargetMessageId,
				RetractorPtid:    cmd.SenderPtid,
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
				Ptid:                   entry.Ptid,
				Role:                   entry.Role,
				MemberStatus:           chat.MemberStatus_MEMBER_STATUS_ACTIVE,
				ActorHomeStationPeerId: entry.ActorHomeStationPeerId,
				JoinedAt:               timestamppb.New(now),
				InvitedByPtid:          cmd.SenderPtid,
			}
			if err := s.repo.UpsertMember(ctx, member); err != nil {
				return nil, fmt.Errorf("conversation: add member %s failed: %w", entry.Ptid, err)
			}
			changes = append(changes, &chat.MemberChange{
				Ptid:                   entry.Ptid,
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
		if err := s.requireAdminOrOwner(ctx, conv.ConversationId, cmd.SenderPtid); err != nil {
			return nil, err
		}
		newEpoch := conv.MembershipEpoch + 1
		changes := make([]*chat.MemberChange, 0, len(p.RemoveMembers.Ptids))
		for _, ptid := range p.RemoveMembers.Ptids {
			removedMember := &chat.ConversationMember{
				ConversationId: conv.ConversationId,
				Ptid:           ptid,
				MemberStatus:   chat.MemberStatus_MEMBER_STATUS_REMOVED,
			}
			if err := s.repo.UpsertMember(ctx, removedMember); err != nil {
				return nil, fmt.Errorf("conversation: remove member %s failed: %w", ptid, err)
			}
			changes = append(changes, &chat.MemberChange{
				Ptid:   ptid,
				Action: chat.MemberChangeAction_MEMBER_CHANGE_ACTION_REMOVED,
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
			Ptid:           cmd.SenderPtid,
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
					Ptid:   cmd.SenderPtid,
					Action: chat.MemberChangeAction_MEMBER_CHANGE_ACTION_LEFT,
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
				DissolvedByPtid: cmd.SenderPtid,
			},
		}

	case *chat.ConversationCommand_UpdateSettings:
		if conv.Kind == chat.ConversationKind_CONVERSATION_KIND_GROUP {
			if err := s.requireAdminOrOwner(ctx, conv.ConversationId, cmd.SenderPtid); err != nil {
				return nil, err
			}
		}
		changed := false
		if p.UpdateSettings.Name != nil {
			conv.Name = *p.UpdateSettings.Name
			changed = true
		}
		if p.UpdateSettings.Description != nil {
			conv.Description = *p.UpdateSettings.Description
			changed = true
		}
		if p.UpdateSettings.AvatarCid != nil {
			conv.AvatarCid = *p.UpdateSettings.AvatarCid
			changed = true
		}
		if p.UpdateSettings.DisappearTimerSeconds != nil {
			conv.DisappearTimerSeconds = *p.UpdateSettings.DisappearTimerSeconds
			changed = true
		}
		if changed {
			conv.UpdatedAt = timestamppb.New(now)
			if err := s.repo.UpsertConversation(ctx, conv); err != nil {
				return nil, fmt.Errorf("conversation: update settings failed: %w", err)
			}
		}
		event.Payload = &chat.CommittedConversationEvent_SettingsChanged{
			SettingsChanged: &chat.SettingsChangedEvent{
				ChangedByPtid: cmd.SenderPtid,
				Name:          p.UpdateSettings.Name,
				Description:   p.UpdateSettings.Description,
				AvatarCid:     p.UpdateSettings.AvatarCid,
				Muted:         p.UpdateSettings.Muted,
			},
		}

	case *chat.ConversationCommand_React:
		if p.React.MessageId == "" || p.React.Emoji == "" {
			return nil, fmt.Errorf("conversation: react requires message_id and emoji")
		}
		event.Payload = &chat.CommittedConversationEvent_Reaction{
			Reaction: &chat.ReactionEvent{
				MessageId: p.React.MessageId,
				ActorPtid: cmd.SenderPtid,
				Emoji:     p.React.Emoji,
				Removed:   p.React.Remove,
				Ts:        event.CommittedAt,
			},
		}

	case *chat.ConversationCommand_UpdateMember:
		if conv.Kind != chat.ConversationKind_CONVERSATION_KIND_GROUP {
			return nil, fmt.Errorf("conversation: update_member only valid for group conversations")
		}
		if err := s.requireAdminOrOwner(ctx, conv.ConversationId, cmd.SenderPtid); err != nil {
			return nil, err
		}
		if p.UpdateMember.TargetPtid == "" {
			return nil, fmt.Errorf("conversation: update_member requires target_ptid")
		}
		targetMember, err := s.repo.GetMember(ctx, conv.ConversationId, p.UpdateMember.TargetPtid)
		if err != nil || targetMember == nil {
			return nil, fmt.Errorf("conversation: target member not found")
		}
		targetMember.Role = p.UpdateMember.NewRole
		targetMember.Muted = p.UpdateMember.Muted
		if err := s.repo.UpsertMember(ctx, targetMember); err != nil {
			return nil, fmt.Errorf("conversation: update member failed: %w", err)
		}
		event.Payload = &chat.CommittedConversationEvent_MembershipChanged{
			MembershipChanged: &chat.MembershipChangedEvent{
				Changes: []*chat.MemberChange{{
					Ptid:   p.UpdateMember.TargetPtid,
					Action: chat.MemberChangeAction_MEMBER_CHANGE_ACTION_ROLE_CHANGED,
					Role:   p.UpdateMember.NewRole,
				}},
				NewMembershipEpoch: conv.MembershipEpoch,
			},
		}

	case *chat.ConversationCommand_PinMessage:
		if p.PinMessage.MessageId == "" {
			return nil, fmt.Errorf("conversation: pin requires message_id")
		}
		if conv.Kind == chat.ConversationKind_CONVERSATION_KIND_GROUP {
			if err := s.requireAdminOrOwner(ctx, conv.ConversationId, cmd.SenderPtid); err != nil {
				return nil, err
			}
		}
		event.Payload = &chat.CommittedConversationEvent_Pin{
			Pin: &chat.PinEvent{
				MessageId: p.PinMessage.MessageId,
				ActorPtid: cmd.SenderPtid,
				Unpinned:  p.PinMessage.Unpin,
				Ts:        event.CommittedAt,
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

func (s *DefaultService) requireAdminOrOwner(ctx context.Context, conversationID, senderPtid string) error {
	member, err := s.repo.GetMember(ctx, conversationID, senderPtid)
	if err != nil || member == nil {
		return fmt.Errorf("conversation: sender not a member")
	}
	if member.Role != chat.MemberRole_MEMBER_ROLE_OWNER && member.Role != chat.MemberRole_MEMBER_ROLE_ADMIN {
		return fmt.Errorf("conversation: admin or owner role required")
	}
	return nil
}

// --- New Service methods (W1/W2: unified conversation API) ---

func (s *DefaultService) ListMessages(ctx context.Context, conversationID string, afterSeq int64, limit int) ([]*chat.CommittedConversationEvent, error) {
	events, err := s.repo.ListEvents(ctx, conversationID, afterSeq, limit)
	if err != nil {
		return nil, err
	}
	messages := make([]*chat.CommittedConversationEvent, 0, len(events))
	for _, ev := range events {
		if ev.GetMessageCommitted() != nil {
			messages = append(messages, ev)
		}
	}
	return messages, nil
}

func (s *DefaultService) ListThreadMessages(ctx context.Context, conversationID, threadRootID string, afterSeq int64, limit int) ([]*chat.CommittedConversationEvent, error) {
	return s.repo.ListThreadEvents(ctx, conversationID, threadRootID, afterSeq, limit)
}

func (s *DefaultService) GetThreadCounts(ctx context.Context, conversationID string, rootIDs []string) (map[string]ThreadSummary, error) {
	return s.repo.CountThreadReplies(ctx, conversationID, rootIDs)
}

func (s *DefaultService) SetReadCursor(ctx context.Context, conversationID, ptid string, seq int64) error {
	return s.repo.SetReadCursor(ctx, conversationID, ptid, seq)
}

func (s *DefaultService) GetUnreadCount(ctx context.Context, conversationID, ptid string) (int64, error) {
	return s.repo.CountUnread(ctx, conversationID, ptid)
}
