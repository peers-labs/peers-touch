package application

import (
	"context"
	"errors"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// NotificationProducer abstracts the notification subsystem so friend
// request events can push real-time notifications without importing the
// notification subserver directly.
type NotificationProducer interface {
	Produce(recipientPTID, actorPTID string, notifType, category int32, targetType, targetID, title, body, groupKey string, metadata map[string]string) error
}

// ConversationCreator abstracts the conversation subsystem so that
// accepting a friend request can auto-create the DM conversation.
type ConversationCreator interface {
	CreateDirect(ctx context.Context, actorAPTID, actorBPTID string) error
}

var (
	ErrFriendRequestSelf     = errors.New("cannot send friend request to yourself")
	ErrFriendRequestBlocked  = errors.New("blocked relationship")
	ErrFriendRequestNotFound = errors.New("friend request not found")
	ErrNotRequestReceiver    = errors.New("only the receiver can accept or reject")
	ErrAlreadyFriends        = errors.New("already friends")
)

type FriendRequestService struct {
	repo            infrastructure.FriendRequestRepository
	blocks          infrastructure.BlockGraphRepository
	relationshipSvc *RelationshipService
	notif           NotificationProducer
	conv            ConversationCreator
}

func NewFriendRequestService(
	repo infrastructure.FriendRequestRepository,
	blocks infrastructure.BlockGraphRepository,
	relationshipSvc *RelationshipService,
	notif NotificationProducer,
	conv ConversationCreator,
) *FriendRequestService {
	return &FriendRequestService{
		repo:            repo,
		blocks:          blocks,
		relationshipSvc: relationshipSvc,
		notif:           notif,
		conv:            conv,
	}
}

func (s *FriendRequestService) SendFriendRequest(ctx context.Context, senderPTID, receiverPTID, message string) (*chat.FriendRequest, error) {
	if senderPTID == receiverPTID {
		return nil, ErrFriendRequestSelf
	}
	blocked, err := s.blocks.IsBlockedBetween(ctx, senderPTID, receiverPTID)
	if err != nil {
		return nil, err
	}
	if blocked {
		return nil, ErrFriendRequestBlocked
	}

	fr, err := s.repo.CreateFriendRequest(ctx, senderPTID, receiverPTID, message)
	if err != nil {
		if err.Error() == "already friends" {
			return nil, ErrAlreadyFriends
		}
		return nil, err
	}

	if s.notif != nil {
		senderName := senderPTID
		profiles := resolveProfiles(ctx, []string{senderPTID})
		if p, ok := profiles[senderPTID]; ok && p.Name != "" {
			senderName = p.Name
		}
		if err := s.notif.Produce(
			receiverPTID, senderPTID,
			200, 1,
			"friend_request", fr.ID,
			senderName+" sent you a friend request", message,
			"friend_request:"+senderPTID,
			map[string]string{"sender_ptid": senderPTID, "request_id": fr.ID, "sender_name": senderName},
		); err != nil {
			logger.Error(ctx, "friend request notification failed", "error", err)
		}
	}

	return domainToProtoFriendRequest(fr), nil
}

func (s *FriendRequestService) AcceptFriendRequest(ctx context.Context, actorPTID, requestID string) (*chat.FriendRequest, error) {
	existing, err := s.repo.GetFriendRequest(ctx, requestID)
	if err != nil {
		return nil, ErrFriendRequestNotFound
	}
	if existing.ReceiverPtid != actorPTID {
		return nil, ErrNotRequestReceiver
	}

	blocked, err := s.blocks.IsBlockedBetween(ctx, actorPTID, existing.SenderPtid)
	if err != nil {
		return nil, err
	}
	if blocked {
		return nil, ErrFriendRequestBlocked
	}

	fr, err := s.repo.AcceptFriendRequest(ctx, requestID)
	if err != nil {
		return nil, err
	}

	// Establish mutual follow
	if _, err := s.relationshipSvc.Follow(ctx, existing.SenderPtid, actorPTID); err != nil {
		logger.Error(ctx, "friend accept: failed to create follow sender→receiver", "error", err)
	}
	if _, err := s.relationshipSvc.Follow(ctx, actorPTID, existing.SenderPtid); err != nil {
		logger.Error(ctx, "friend accept: failed to create follow receiver→sender", "error", err)
	}

	// Auto-create DM conversation so both parties can message immediately.
	if s.conv != nil {
		if err := s.conv.CreateDirect(ctx, existing.SenderPtid, actorPTID); err != nil {
			logger.Error(ctx, "friend accept: failed to create DM conversation", "error", err)
		}
	}

	return domainToProtoFriendRequest(*fr), nil
}

func (s *FriendRequestService) RejectFriendRequest(ctx context.Context, actorPTID, requestID string) (*chat.FriendRequest, error) {
	existing, err := s.repo.GetFriendRequest(ctx, requestID)
	if err != nil {
		return nil, ErrFriendRequestNotFound
	}
	if existing.ReceiverPtid != actorPTID {
		return nil, ErrNotRequestReceiver
	}

	fr, err := s.repo.RejectFriendRequest(ctx, requestID)
	if err != nil {
		return nil, err
	}
	return domainToProtoFriendRequest(*fr), nil
}

func (s *FriendRequestService) ListFriendRequests(ctx context.Context, actorPTID string, status int32, limit, offset int) ([]*chat.FriendRequest, int, error) {
	requests, total, err := s.repo.ListFriendRequests(ctx, actorPTID, status, limit, offset)
	if err != nil {
		return nil, 0, err
	}

	actorPTIDs := collectActorPTIDs(requests)
	profiles := resolveProfiles(ctx, actorPTIDs)

	out := make([]*chat.FriendRequest, 0, len(requests))
	for _, r := range requests {
		fr := domainToProtoFriendRequest(r)
		enrichFriendRequest(fr, profiles)
		out = append(out, fr)
	}
	return out, total, nil
}

func domainToProtoFriendRequest(fr domain.FriendRequest) *chat.FriendRequest {
	return &chat.FriendRequest{
		Id:           fr.ID,
		SenderPtid:   fr.SenderPtid,
		ReceiverPtid: fr.ReceiverPtid,
		Message:      fr.Message,
		Status:       chat.FriendRequestStatus(fr.Status),
		CreatedAt:    timestamppb.New(fr.CreatedAt),
	}
}

func collectActorPTIDs(requests []domain.FriendRequest) []string {
	seen := make(map[string]struct{})
	for _, r := range requests {
		if r.SenderPtid != "" {
			seen[r.SenderPtid] = struct{}{}
		}
		if r.ReceiverPtid != "" {
			seen[r.ReceiverPtid] = struct{}{}
		}
	}
	out := make([]string, 0, len(seen))
	for ptid := range seen {
		out = append(out, ptid)
	}
	return out
}

type actorProfile struct {
	Name   string
	Avatar string
	Ptid   string
}

func resolveProfiles(ctx context.Context, ptids []string) map[string]actorProfile {
	out := make(map[string]actorProfile, len(ptids))
	if len(ptids) == 0 {
		return out
	}
	actors, err := actor.GetActorsByPTIDs(ctx, ptids)
	if err != nil {
		return out
	}
	for ptid, a := range actors {
		name := a.Name
		if name == "" {
			name = a.PreferredUsername
		}
		out[ptid] = actorProfile{Name: name, Avatar: a.Icon, Ptid: a.PTID}
	}
	return out
}

func enrichFriendRequest(fr *chat.FriendRequest, profiles map[string]actorProfile) {
	if p, ok := profiles[fr.SenderPtid]; ok {
		fr.SenderPtid = p.Ptid
		fr.SenderDisplayName = p.Name
		fr.SenderAvatar = p.Avatar
	}
	if p, ok := profiles[fr.ReceiverPtid]; ok {
		fr.ReceiverPtid = p.Ptid
		fr.ReceiverDisplayName = p.Name
		fr.ReceiverAvatar = p.Avatar
	}
}
