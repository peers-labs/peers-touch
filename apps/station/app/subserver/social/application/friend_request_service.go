package application

import (
	"context"
	"errors"
	"strconv"

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
	Produce(recipientID, actorID string, notifType, category int32, targetType, targetID, title, body, groupKey string, metadata map[string]string) error
}

// ConversationCreator abstracts the conversation subsystem so that
// accepting a friend request can auto-create the DM conversation.
type ConversationCreator interface {
	CreateDirect(ctx context.Context, actorAID, actorBID uint64) error
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

func (s *FriendRequestService) SendFriendRequest(ctx context.Context, senderID, receiverID uint64, message string) (*chat.FriendRequest, error) {
	if senderID == receiverID {
		return nil, ErrFriendRequestSelf
	}
	blocked, err := s.blocks.IsBlockedBetween(ctx, senderID, receiverID)
	if err != nil {
		return nil, err
	}
	if blocked {
		return nil, ErrFriendRequestBlocked
	}

	fr, err := s.repo.CreateFriendRequest(ctx, senderID, receiverID, message)
	if err != nil {
		if err.Error() == "already friends" {
			return nil, ErrAlreadyFriends
		}
		return nil, err
	}

	if s.notif != nil {
		receiverDID := strconv.FormatUint(receiverID, 10)
		senderDID := strconv.FormatUint(senderID, 10)
		senderName := senderDID
		profiles := resolveProfiles(ctx, []uint64{senderID})
		if p, ok := profiles[senderID]; ok && p.Name != "" {
			senderName = p.Name
		}
		if err := s.notif.Produce(
			receiverDID, senderDID,
			200, 1,
			"friend_request", fr.ID,
			senderName+" sent you a friend request", message,
			"friend_request:"+senderDID,
			map[string]string{"sender_did": senderDID, "request_id": fr.ID, "sender_name": senderName},
		); err != nil {
			logger.Error(ctx, "friend request notification failed", "error", err)
		}
	}

	return domainToProtoFriendRequest(fr), nil
}

func (s *FriendRequestService) AcceptFriendRequest(ctx context.Context, actorID uint64, requestID string) (*chat.FriendRequest, error) {
	existing, err := s.repo.GetFriendRequest(ctx, requestID)
	if err != nil {
		return nil, ErrFriendRequestNotFound
	}
	actorDID := strconv.FormatUint(actorID, 10)
	if existing.ReceiverDID != actorDID {
		return nil, ErrNotRequestReceiver
	}

	senderID, err := strconv.ParseUint(existing.SenderDID, 10, 64)
	if err != nil {
		return nil, err
	}
	blocked, err := s.blocks.IsBlockedBetween(ctx, actorID, senderID)
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
	if _, err := s.relationshipSvc.Follow(ctx, senderID, actorDID); err != nil {
		logger.Error(ctx, "friend accept: failed to create follow sender→receiver", "error", err)
	}
	if _, err := s.relationshipSvc.Follow(ctx, actorID, existing.SenderDID); err != nil {
		logger.Error(ctx, "friend accept: failed to create follow receiver→sender", "error", err)
	}

	// Auto-create DM conversation so both parties can message immediately.
	if s.conv != nil {
		if err := s.conv.CreateDirect(ctx, senderID, actorID); err != nil {
			logger.Error(ctx, "friend accept: failed to create DM conversation", "error", err)
		}
	}

	return domainToProtoFriendRequest(*fr), nil
}

func (s *FriendRequestService) RejectFriendRequest(ctx context.Context, actorID uint64, requestID string) (*chat.FriendRequest, error) {
	existing, err := s.repo.GetFriendRequest(ctx, requestID)
	if err != nil {
		return nil, ErrFriendRequestNotFound
	}
	actorDID := strconv.FormatUint(actorID, 10)
	if existing.ReceiverDID != actorDID {
		return nil, ErrNotRequestReceiver
	}

	fr, err := s.repo.RejectFriendRequest(ctx, requestID)
	if err != nil {
		return nil, err
	}
	return domainToProtoFriendRequest(*fr), nil
}

func (s *FriendRequestService) ListFriendRequests(ctx context.Context, actorID uint64, status int32, limit, offset int) ([]*chat.FriendRequest, int, error) {
	requests, total, err := s.repo.ListFriendRequests(ctx, actorID, status, limit, offset)
	if err != nil {
		return nil, 0, err
	}

	actorIDs := collectActorIDs(requests)
	profiles := resolveProfiles(ctx, actorIDs)

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
		Id:         fr.ID,
		SenderId:   fr.SenderDID,
		ReceiverId: fr.ReceiverDID,
		Message:    fr.Message,
		Status:     chat.FriendRequestStatus(fr.Status),
		CreatedAt:  timestamppb.New(fr.CreatedAt),
	}
}

func collectActorIDs(requests []domain.FriendRequest) []uint64 {
	seen := make(map[uint64]struct{})
	for _, r := range requests {
		if id, err := strconv.ParseUint(r.SenderDID, 10, 64); err == nil {
			seen[id] = struct{}{}
		}
		if id, err := strconv.ParseUint(r.ReceiverDID, 10, 64); err == nil {
			seen[id] = struct{}{}
		}
	}
	out := make([]uint64, 0, len(seen))
	for id := range seen {
		out = append(out, id)
	}
	return out
}

type actorProfile struct {
	Name   string
	Avatar string
	Ptid   string
}

func resolveProfiles(ctx context.Context, ids []uint64) map[uint64]actorProfile {
	out := make(map[uint64]actorProfile, len(ids))
	if len(ids) == 0 {
		return out
	}
	actors, err := actor.GetActorsByIDs(ctx, ids)
	if err != nil {
		return out
	}
	for id, a := range actors {
		name := a.Name
		if name == "" {
			name = a.PreferredUsername
		}
		out[id] = actorProfile{Name: name, Avatar: a.Icon, Ptid: a.PTID}
	}
	return out
}

func enrichFriendRequest(fr *chat.FriendRequest, profiles map[uint64]actorProfile) {
	if senderID, err := strconv.ParseUint(fr.SenderId, 10, 64); err == nil {
		if p, ok := profiles[senderID]; ok {
			fr.SenderId = p.Ptid
			fr.SenderDisplayName = p.Name
			fr.SenderAvatar = p.Avatar
		}
	}
	if receiverID, err := strconv.ParseUint(fr.ReceiverId, 10, 64); err == nil {
		if p, ok := profiles[receiverID]; ok {
			fr.ReceiverId = p.Ptid
			fr.ReceiverDisplayName = p.Name
			fr.ReceiverAvatar = p.Avatar
		}
	}
}
