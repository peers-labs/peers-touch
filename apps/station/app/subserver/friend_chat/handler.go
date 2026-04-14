package friend_chat

import (
	"context"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *subServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()
	return []server.Handler{
		server.NewTypedHandler("fc-session-create", "/friend-chat/session/create", server.POST, s.handleCreateSession, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-sessions", "/friend-chat/sessions", server.GET, s.handleGetSessions, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-message-send", "/friend-chat/message/send", server.POST, s.handleSendMessage, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-message-sync", "/friend-chat/message/sync", server.POST, s.handleSyncMessages, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-messages", "/friend-chat/messages", server.GET, s.handleGetMessages, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-message-search", "/friend-chat/messages/search", server.GET, s.handleSearchMessages, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-message-ack", "/friend-chat/message/ack", server.POST, s.handleAckMessage, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-online", "/friend-chat/online", server.POST, s.handleOnline, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-offline", "/friend-chat/offline", server.POST, s.handleOffline, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-pending", "/friend-chat/pending", server.GET, s.handleGetPending, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-stats", "/friend-chat/stats", server.GET, s.handleStats, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-friend-request-send", "/friend-chat/friend-request/send", server.POST, s.handleSendFriendRequest, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-friend-request-accept", "/friend-chat/friend-request/accept", server.POST, s.handleAcceptFriendRequest, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-friend-request-reject", "/friend-chat/friend-request/reject", server.POST, s.handleRejectFriendRequest, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-friend-requests", "/friend-chat/friend-requests", server.GET, s.handleListFriendRequests, logIDWrapper, s.jwtWrapper),
	}
}

func (s *subServer) handleCreateSession(ctx context.Context, req *chat.CreateSessionRequest) (*chat.CreateSessionResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.ParticipantDid == "" {
		return nil, server.BadRequest("participant_did is required")
	}
	session, created, err := s.service.GetOrCreateSession(subject.ID, req.ParticipantDid)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get or create session", err)
	}
	return &chat.CreateSessionResponse{
		Session: &chat.FriendChatSession{
			Ulid:            session.ID,
			ParticipantADid: session.ParticipantADID,
			ParticipantBDid: session.ParticipantBDID,
			LastMessageUlid: session.LastMessageID,
			LastMessageAt:   timestamppb.New(session.LastMessageAt),
			UnreadCountA:    session.UnreadCountA,
			UnreadCountB:    session.UnreadCountB,
			CreatedAt:       timestamppb.New(session.CreatedAt),
			UpdatedAt:       timestamppb.New(session.UpdatedAt),
		},
		Created: created,
	}, nil
}

func (s *subServer) handleGetSessions(ctx context.Context, req *chat.GetSessionsRequest) (*chat.GetSessionsResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	limit := int(req.Limit)
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	offset := int(req.Offset)
	if offset < 0 {
		offset = 0
	}
	items, total, err := s.service.ListSessions(subject.ID, limit, offset)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to list sessions", err)
	}
	out := make([]*chat.FriendChatSession, 0, len(items))
	for _, item := range items {
		out = append(out, &chat.FriendChatSession{
			Ulid:            item.ID,
			ParticipantADid: item.ParticipantADID,
			ParticipantBDid: item.ParticipantBDID,
			LastMessageUlid: item.LastMessageID,
			LastMessageAt:   timestamppb.New(item.LastMessageAt),
			UnreadCountA:    item.UnreadCountA,
			UnreadCountB:    item.UnreadCountB,
			CreatedAt:       timestamppb.New(item.CreatedAt),
			UpdatedAt:       timestamppb.New(item.UpdatedAt),
		})
	}
	return &chat.GetSessionsResponse{Sessions: out, Total: int32(total)}, nil
}

func (s *subServer) handleSendMessage(ctx context.Context, req *chat.SendMessageRequest) (*chat.SendMessageResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.SessionUlid == "" || req.ReceiverDid == "" {
		return nil, server.BadRequest("session_ulid and receiver_did are required")
	}
	enc := req.GetEncryptedPayload()
	hasEnc := len(enc) > 0
	if req.Content == "" && len(req.Attachments) == 0 && !hasEnc {
		return nil, server.BadRequest("content or attachments are required")
	}
	content := req.Content
	if hasEnc && strings.TrimSpace(content) == "" {
		content = "[Encrypted Message]"
	}
	msgType := int32(req.Type)
	if msgType == 0 {
		msgType = 1
	}
	atts := friendAttachmentsFromProto(req.Attachments)
	message, err := s.service.SendMessageByActor(subject.ID, req.SessionUlid, req.ReceiverDid, msgType, content, req.ReplyToUlid, atts, enc)
	if err != nil {
		if err == application.ErrSessionNotFound {
			return nil, server.NotFound(err.Error())
		}
		if err == application.ErrNotParticipant || err == application.ErrInvalidReceiver {
			return nil, server.Forbidden(err.Error())
		}
		return nil, server.InternalErrorWithCause("failed to send message", err)
	}
	s.mu.Lock()
	_, isOnline := s.online[req.ReceiverDid]
	relayStatus := "delivered"
	if !isOnline {
		relayStatus = "queued"
		relayEnc := append([]byte(nil), message.EncryptedPayload...)
		if len(relayEnc) == 0 {
			relayEnc = []byte(message.Content)
		}
		s.pending[req.ReceiverDid] = append(s.pending[req.ReceiverDid], pendingMessage{
			ULID:             message.ID,
			SenderDID:        subject.ID,
			SessionULID:      req.SessionUlid,
			EncryptedPayload: relayEnc,
			CreatedAt:        message.CreatedAt.Unix(),
		})
	}
	s.mu.Unlock()
	return &chat.SendMessageResponse{
		Message:     friendChatMessageFromDomain(message),
		RelayStatus: relayStatus,
	}, nil
}

func (s *subServer) handleGetMessages(ctx context.Context, req *chat.GetMessagesRequest) (*chat.GetMessagesResponse, error) {
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
	items, err := s.service.ListMessagesByActor(subject.ID, req.SessionUlid, req.BeforeUlid, limit+1)
	if err != nil {
		if err == application.ErrSessionNotFound {
			return nil, server.NotFound(err.Error())
		}
		if err == application.ErrNotParticipant {
			return nil, server.Forbidden(err.Error())
		}
		return nil, server.InternalErrorWithCause("failed to list messages", err)
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	nextCursor := ""
	if hasMore && len(items) > 0 {
		nextCursor = items[len(items)-1].ID
	}
	out := make([]*chat.FriendChatMessage, 0, len(items))
	for _, item := range items {
		out = append(out, friendChatMessageFromDomain(item))
	}
	return &chat.GetMessagesResponse{Messages: out, HasMore: hasMore, NextCursor: nextCursor}, nil
}

func (s *subServer) handleSearchMessages(ctx context.Context, req *chat.SearchFriendMessagesRequest) (*chat.SearchFriendMessagesResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if strings.TrimSpace(req.GetQuery()) == "" {
		return nil, server.BadRequest("query is required")
	}
	limit := int(req.Limit)
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	offset := int(req.Offset)
	if offset < 0 {
		offset = 0
	}
	items, total, err := s.service.SearchMessagesByActor(subject.ID, req.GetQuery(), req.GetSessionUlid(), limit, offset)
	if err != nil {
		if err == application.ErrSessionNotFound {
			return nil, server.NotFound(err.Error())
		}
		if err == application.ErrNotParticipant {
			return nil, server.Forbidden(err.Error())
		}
		return nil, server.InternalErrorWithCause("failed to search messages", err)
	}
	out := make([]*chat.FriendChatMessage, 0, len(items))
	for _, item := range items {
		out = append(out, friendChatMessageFromDomain(item))
	}
	return &chat.SearchFriendMessagesResponse{Messages: out, Total: int32(total)}, nil
}

func (s *subServer) handleAckMessage(ctx context.Context, req *chat.MessageAckRequest) (*chat.MessageAckResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if len(req.Ulids) == 0 {
		return nil, server.BadRequest("ulids is required")
	}
	if err := s.service.AckMessages(subject.ID, req.Ulids, req.Status); err != nil {
		return nil, server.InternalErrorWithCause("failed to ack messages", err)
	}
	s.mu.Lock()
	delete(s.pending, subject.ID)
	s.mu.Unlock()
	return &chat.MessageAckResponse{}, nil
}

func (s *subServer) handleSyncMessages(ctx context.Context, req *chat.SyncMessagesRequest) (*chat.SyncMessagesResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if len(req.Messages) == 0 {
		return nil, server.BadRequest("messages list is required")
	}
	synced := int32(0)
	failed := make([]string, 0)
	for _, item := range req.Messages {
		msgType := int32(item.Type)
		if msgType == 0 {
			msgType = 1
		}
		if item.SessionUlid == "" || item.ReceiverDid == "" || item.Content == "" {
			failed = append(failed, item.Ulid)
			continue
		}
		in := domain.Message{
			ID:          item.Ulid,
			SessionID:   item.SessionUlid,
			ReceiverDID: item.ReceiverDid,
			Type:        msgType,
			Content:     item.Content,
		}
		resultSynced, resultFailed := s.service.SyncMessagesByActor(subject.ID, []domain.Message{in})
		synced += resultSynced
		failed = append(failed, resultFailed...)
	}
	return &chat.SyncMessagesResponse{Synced: synced, Failed: failed}, nil
}

func (s *subServer) handleOnline(ctx context.Context, req *chat.OnlineRequest) (*chat.OnlineResponse, error) {
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
	s.online[did] = timestamppb.Now().GetSeconds()
	s.mu.Unlock()
	return &chat.OnlineResponse{Status: "online"}, nil
}

func (s *subServer) handleOffline(ctx context.Context, req *chat.OnlineRequest) (*chat.OnlineResponse, error) {
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
	delete(s.online, did)
	s.mu.Unlock()
	return &chat.OnlineResponse{Status: "offline"}, nil
}

func (s *subServer) handleGetPending(ctx context.Context, req *chat.GetPendingRequest) (*chat.GetPendingResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	limit := int(req.Limit)
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	s.mu.RLock()
	items := s.pending[subject.ID]
	s.mu.RUnlock()
	if len(items) > limit {
		items = items[:limit]
	}
	out := make([]*chat.PendingMessageInfo, 0, len(items))
	for _, item := range items {
		out = append(out, &chat.PendingMessageInfo{
			Ulid:             item.ULID,
			SenderDid:        item.SenderDID,
			SessionUlid:      item.SessionULID,
			EncryptedPayload: item.EncryptedPayload,
			CreatedAt:        item.CreatedAt,
		})
	}
	return &chat.GetPendingResponse{Messages: out}, nil
}

func (s *subServer) handleStats(ctx context.Context, req *chat.GetStatsRequest) (*chat.GetStatsResponse, error) {
	_ = req
	s.mu.RLock()
	onlineCount := len(s.online)
	pendingCount := int64(0)
	for _, items := range s.pending {
		pendingCount += int64(len(items))
	}
	s.mu.RUnlock()
	return &chat.GetStatsResponse{
		OnlinePeers:     int32(onlineCount),
		PendingMessages: pendingCount,
		Status:          string(s.status),
	}, nil
}

// ============================================================================
// Friend Request Handlers
// ============================================================================

func (s *subServer) handleSendFriendRequest(ctx context.Context, req *chat.SendFriendRequestRequest) (*chat.SendFriendRequestResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.ReceiverDid == "" {
		return nil, server.BadRequest("receiver_did is required")
	}

	fr, err := s.service.SendFriendRequest(subject.ID, req.ReceiverDid, req.Message)
	if err != nil {
		if err == application.ErrAlreadyFriends {
			return nil, server.BadRequest(err.Error())
		}
		return nil, server.InternalErrorWithCause("failed to send friend request", err)
	}
	return &chat.SendFriendRequestResponse{
		Request: friendRequestToProto(fr),
	}, nil
}

func (s *subServer) handleAcceptFriendRequest(ctx context.Context, req *chat.AcceptFriendRequestRequest) (*chat.AcceptFriendRequestResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.RequestId == "" {
		return nil, server.BadRequest("request_id is required")
	}

	fr, session, err := s.service.AcceptFriendRequest(subject.ID, req.RequestId)
	if err != nil {
		if err == application.ErrRequestNotFound {
			return nil, server.NotFound(err.Error())
		}
		if err == application.ErrNotRequestTarget {
			return nil, server.Forbidden(err.Error())
		}
		return nil, server.InternalErrorWithCause("failed to accept friend request", err)
	}
	resp := &chat.AcceptFriendRequestResponse{
		Request: friendRequestToProto(*fr),
	}
	if session != nil {
		resp.Session = &chat.FriendChatSession{
			Ulid:            session.ID,
			ParticipantADid: session.ParticipantADID,
			ParticipantBDid: session.ParticipantBDID,
			CreatedAt:       timestamppb.New(session.CreatedAt),
			UpdatedAt:       timestamppb.New(session.UpdatedAt),
		}
	}
	return resp, nil
}

func (s *subServer) handleRejectFriendRequest(ctx context.Context, req *chat.RejectFriendRequestRequest) (*chat.RejectFriendRequestResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.RequestId == "" {
		return nil, server.BadRequest("request_id is required")
	}

	fr, err := s.service.RejectFriendRequest(subject.ID, req.RequestId)
	if err != nil {
		if err == application.ErrRequestNotFound {
			return nil, server.NotFound(err.Error())
		}
		if err == application.ErrNotRequestTarget {
			return nil, server.Forbidden(err.Error())
		}
		return nil, server.InternalErrorWithCause("failed to reject friend request", err)
	}
	return &chat.RejectFriendRequestResponse{
		Request: friendRequestToProto(*fr),
	}, nil
}

func (s *subServer) handleListFriendRequests(ctx context.Context, req *chat.ListFriendRequestsRequest) (*chat.ListFriendRequestsResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	limit := int(req.Limit)
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	offset := int(req.Offset)
	if offset < 0 {
		offset = 0
	}

	items, total, err := s.service.ListFriendRequests(subject.ID, int32(req.Status), limit, offset)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to list friend requests", err)
	}
	out := make([]*chat.FriendRequest, 0, len(items))
	for _, item := range items {
		out = append(out, friendRequestToProto(item))
	}
	return &chat.ListFriendRequestsResponse{Requests: out, Total: int32(total)}, nil
}

func friendChatMessageFromDomain(m domain.Message) *chat.FriendChatMessage {
	return &chat.FriendChatMessage{
		Ulid:             m.ID,
		SessionUlid:      m.SessionID,
		SenderDid:        m.SenderDID,
		ReceiverDid:      m.ReceiverDID,
		Type:             chat.FriendMessageType(m.Type),
		Content:          m.Content,
		EncryptedPayload: append([]byte(nil), m.EncryptedPayload...),
		Attachments:      friendAttachmentsToProto(m.Attachments),
		ReplyToUlid:      m.ReplyToID,
		Status:           chat.FriendMessageStatus(m.Status),
		SentAt:           timestamppb.New(m.SentAt),
		CreatedAt:        timestamppb.New(m.CreatedAt),
		UpdatedAt:        timestamppb.New(m.UpdatedAt),
	}
}

func friendAttachmentsFromProto(in []*chat.FriendMessageAttachment) []domain.Attachment {
	if len(in) == 0 {
		return nil
	}
	out := make([]domain.Attachment, 0, len(in))
	for _, a := range in {
		if a == nil {
			continue
		}
		out = append(out, domain.Attachment{
			CID:          a.GetCid(),
			Filename:     a.GetFilename(),
			MimeType:     a.GetMimeType(),
			Size:         a.GetSize(),
			ThumbnailCID: a.GetThumbnailCid(),
		})
	}
	return out
}

func friendAttachmentsToProto(in []domain.Attachment) []*chat.FriendMessageAttachment {
	if len(in) == 0 {
		return nil
	}
	out := make([]*chat.FriendMessageAttachment, 0, len(in))
	for _, a := range in {
		out = append(out, &chat.FriendMessageAttachment{
			Cid:          a.CID,
			Filename:     a.Filename,
			MimeType:     a.MimeType,
			Size:         a.Size,
			ThumbnailCid: a.ThumbnailCID,
		})
	}
	return out
}

func friendRequestToProto(fr domain.FriendRequest) *chat.FriendRequest {
	return &chat.FriendRequest{
		Id:          fr.ID,
		SenderId:    fr.SenderDID,
		ReceiverId:  fr.ReceiverDID,
		Status:      chat.FriendRequestStatus(fr.Status),
		Message:     fr.Message,
		CreatedAt:   timestamppb.New(fr.CreatedAt),
		RespondedAt: timestamppb.New(fr.UpdatedAt),
	}
}
