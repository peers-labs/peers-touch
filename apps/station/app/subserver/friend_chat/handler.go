package friend_chat

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/service"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type friendChatURL struct{ name, path string }

func (u friendChatURL) SubPath() string { return u.path }
func (u friendChatURL) Name() string    { return u.name }

func (s *friendChatSubServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()
	jwtWrapper := s.jwtWrapper
	return []server.Handler{
		server.NewTypedHandler("fc-session-create", "/friend-chat/session/create", server.POST, s.handleSessionCreate, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("fc-sessions", "/friend-chat/sessions", server.GET, s.handleGetSessions, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("fc-message-send", "/friend-chat/message/send", server.POST, s.handleSendMessage, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("fc-message-sync", "/friend-chat/message/sync", server.POST, s.handleSyncMessages, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("fc-messages", "/friend-chat/messages", server.GET, s.handleGetMessages, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("fc-message-ack", "/friend-chat/message/ack", server.POST, s.handleMessageAck, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("fc-online", "/friend-chat/online", server.POST, s.handleOnline, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("fc-offline", "/friend-chat/offline", server.POST, s.handleOffline, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("fc-pending", "/friend-chat/pending", server.GET, s.handleGetPending, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("fc-stats", "/friend-chat/stats", server.GET, s.handleStats),
	}
}

func (s *friendChatSubServer) handleSendMessage(ctx context.Context, req *chat.SendMessageRequest) (*chat.SendMessageResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	if req.ReceiverDid == "" {
		return nil, server.BadRequest("receiver_did is required")
	}
	if req.Content == "" {
		return nil, server.BadRequest("content is required")
	}

	msgType := int32(req.Type)
	if msgType == 0 {
		msgType = 1
	}

	msg, err := s.messageService.SendMessage(ctx, &service.SendMessageRequest{
		SessionULID: req.SessionUlid,
		SenderDID:   subject.ID,
		ReceiverDID: req.ReceiverDid,
		Type:        msgType,
		Content:     req.Content,
		ReplyToULID: req.ReplyToUlid,
	})
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to send message", err)
	}

	s.mu.RLock()
	peer, isOnline := s.onlinePeers[req.ReceiverDid]
	if isOnline && time.Now().Unix()-peer.UpdatedAt > 60 {
		isOnline = false
	}
	s.mu.RUnlock()

	relayStatus := "delivered"
	if !isOnline {
		relayStatus = "queued"
		s.relayService.StoreOfflineMessage(ctx, &service.StoreOfflineRequest{
			MessageULID:      msg.ULID,
			SenderDID:        subject.ID,
			ReceiverDID:      req.ReceiverDid,
			SessionULID:      req.SessionUlid,
			EncryptedPayload: []byte(req.Content),
			ExpireDuration:   0,
		})
	}

	return &chat.SendMessageResponse{
		Message: &chat.FriendChatMessage{
			Ulid:        msg.ULID,
			SessionUlid: msg.SessionULID,
			SenderDid:   msg.SenderDID,
			ReceiverDid: msg.ReceiverDID,
			Type:        chat.FriendMessageType(msg.Type),
			Content:     msg.Content,
			Status:      chat.FriendMessageStatus(msg.Status),
		},
		RelayStatus: relayStatus,
	}, nil
}

func (s *friendChatSubServer) handleSyncMessages(
	ctx context.Context,
	req *chat.SyncMessagesRequest,
) (*chat.SyncMessagesResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	if len(req.GetMessages()) == 0 {
		return nil, server.BadRequest("messages list is required")
	}

	senderActorDID := subject.ID
	synced := int32(0)
	failed := make([]string, 0)

	for _, item := range req.GetMessages() {
		msgType := item.GetType()
		if msgType == chat.FriendMessageType_FRIEND_MESSAGE_TYPE_UNSPECIFIED {
			msgType = chat.FriendMessageType_FRIEND_MESSAGE_TYPE_TEXT
		}
		_, err := s.messageService.SendMessage(ctx, &service.SendMessageRequest{
			SessionULID: item.GetSessionUlid(),
			SenderDID:   senderActorDID,
			ReceiverDID: item.GetReceiverDid(),
			Type:        int32(msgType),
			Content:     item.GetContent(),
			ReplyToULID: "",
		})
		if err != nil {
			failed = append(failed, item.GetUlid())
		} else {
			synced++
		}
	}

	return &chat.SyncMessagesResponse{Synced: synced, Failed: failed}, nil
}

func (s *friendChatSubServer) handleGetMessages(
	ctx context.Context,
	req *chat.GetMessagesRequest,
) (*chat.GetMessagesResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	if req.SessionUlid == "" {
		return nil, server.BadRequest("session_ulid is required")
	}

	limit := int(req.Limit)
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	messages, hasMore, err := s.messageService.GetMessagesBySession(ctx, req.SessionUlid, req.BeforeUlid, limit)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get messages", err)
	}

	resp := &chat.GetMessagesResponse{
		Messages: make([]*chat.FriendChatMessage, 0, len(messages)),
		HasMore:  hasMore,
	}

	for _, m := range messages {
		resp.Messages = append(resp.Messages, &chat.FriendChatMessage{
			Ulid:        m.ULID,
			SenderDid:   m.SenderDID,
			ReceiverDid: m.ReceiverDID,
			Type:        chat.FriendMessageType(m.Type),
			Content:     m.Content,
			Status:      chat.FriendMessageStatus(m.Status),
			SentAt:      timestamppb.New(m.SentAt),
		})
	}

	return resp, nil
}

func (s *friendChatSubServer) handleOnline(
	ctx context.Context,
	req *chat.OnlineRequest,
) (*chat.OnlineResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	did := subject.ID
	if req.Did != "" {
		did = req.Did
	}

	if did == "" {
		return nil, server.BadRequest("did is required")
	}

	s.mu.Lock()
	s.onlinePeers[did] = onlinePeer{DID: did, UpdatedAt: time.Now().Unix()}
	s.mu.Unlock()

	return &chat.OnlineResponse{Status: "online"}, nil
}

func (s *friendChatSubServer) handleOffline(
	ctx context.Context,
	req *chat.OnlineRequest,
) (*chat.OnlineResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	did := subject.ID
	if req.Did != "" {
		did = req.Did
	}

	if did == "" {
		return nil, server.BadRequest("did is required")
	}

	s.mu.Lock()
	delete(s.onlinePeers, did)
	s.mu.Unlock()

	return &chat.OnlineResponse{Status: "offline"}, nil
}

func (s *friendChatSubServer) handleGetPending(
	ctx context.Context,
	req *chat.GetPendingRequest,
) (*chat.GetPendingResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	receiverDID := subject.ID

	limit := req.Limit
	if limit <= 0 || limit > 100 {
		limit = 100
	}

	messages, err := s.relayService.GetPendingMessages(ctx, receiverDID, int(limit))
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get pending messages", err)
	}

	resp := &chat.GetPendingResponse{
		Messages: make([]*chat.PendingMessageInfo, 0, len(messages)),
	}

	for _, m := range messages {
		resp.Messages = append(resp.Messages, &chat.PendingMessageInfo{
			Ulid:             m.ULID,
			SenderDid:        m.SenderDID,
			SessionUlid:      m.SessionULID,
			EncryptedPayload: m.EncryptedPayload,
			CreatedAt:        m.CreatedAt.Unix(),
		})
	}

	return resp, nil
}

func (s *friendChatSubServer) handleStats(
	ctx context.Context,
	req *chat.GetStatsRequest,
) (*chat.GetStatsResponse, error) {
	s.mu.RLock()
	onlineCount := len(s.onlinePeers)
	s.mu.RUnlock()

	pendingCount, _ := s.relayService.GetPendingCount(ctx, "")

	return &chat.GetStatsResponse{
		OnlinePeers:     int32(onlineCount),
		PendingMessages: pendingCount,
		Status:          string(s.status),
	}, nil
}

func (s *friendChatSubServer) handleMessageAck(
	ctx context.Context,
	req *chat.MessageAckRequest,
) (*chat.MessageAckResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	if len(req.Ulids) == 0 {
		return nil, server.BadRequest("ulids list is required")
	}

	if req.Status == int32(chat.FriendMessageStatus_FRIEND_MESSAGE_STATUS_DELIVERED) {
		s.messageService.MarkAsDelivered(ctx, req.Ulids)
	} else if req.Status == int32(chat.FriendMessageStatus_FRIEND_MESSAGE_STATUS_READ) {
		s.messageService.MarkAsRead(ctx, req.Ulids)
	}

	s.relayService.AcknowledgeMessages(ctx, req.Ulids)

	return &chat.MessageAckResponse{}, nil
}

func (s *friendChatSubServer) handleSessionCreate(
	ctx context.Context,
	req *chat.CreateSessionRequest,
) (*chat.CreateSessionResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	if req.ParticipantDid == "" {
		return nil, server.BadRequest("participant_did is required")
	}

	currentActorDID := subject.ID

	session, err := s.sessionService.GetOrCreateSession(ctx, currentActorDID, req.ParticipantDid)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to create session", err)
	}

	unreadCountA := session.UnreadCountA
	unreadCountB := session.UnreadCountB

	return &chat.CreateSessionResponse{
		Session: &chat.FriendChatSession{
			Ulid:            session.ULID,
			ParticipantADid: session.ParticipantADID,
			ParticipantBDid: session.ParticipantBDID,
			LastMessageUlid: session.LastMessageULID,
			LastMessageAt:   timestamppb.New(session.LastMessageAt),
			UnreadCountA:    unreadCountA,
			UnreadCountB:    unreadCountB,
		},
		Created: false,
	}, nil
}

func (s *friendChatSubServer) handleGetSessions(
	ctx context.Context,
	req *chat.GetSessionsRequest,
) (*chat.GetSessionsResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	did := subject.ID

	limit := req.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	sessions, err := s.sessionService.GetSessionsByDID(ctx, did, int(limit))
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get sessions", err)
	}

	resp := &chat.GetSessionsResponse{
		Sessions: make([]*chat.FriendChatSession, 0, len(sessions)),
		Total:    int32(len(sessions)),
	}

	for _, sess := range sessions {
		resp.Sessions = append(resp.Sessions, &chat.FriendChatSession{
			Ulid:            sess.ULID,
			ParticipantADid: sess.ParticipantADID,
			ParticipantBDid: sess.ParticipantBDID,
			LastMessageUlid: sess.LastMessageULID,
			LastMessageAt:   timestamppb.New(sess.LastMessageAt),
			UnreadCountA:    sess.UnreadCountA,
			UnreadCountB:    sess.UnreadCountB,
		})
	}

	return resp, nil
}
