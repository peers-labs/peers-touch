package friend_chat

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/service"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

type friendChatURL struct{ name, path string }

func (u friendChatURL) SubPath() string { return u.path }
func (u friendChatURL) Name() string    { return u.name }

func (s *friendChatSubServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()
	jwtWrapper := s.jwtWrapper
	return []server.Handler{
		server.NewTypedHandler("fc-session-create", "/friend-chat/session/create", server.POST, s.handleSessionCreateTyped, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("fc-sessions", "/friend-chat/sessions", server.GET, s.handleGetSessionsTyped, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("fc-message-send", "/friend-chat/message/send", server.POST, s.handleSendMessageTyped, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("fc-message-sync", "/friend-chat/message/sync", server.POST, s.handleSyncMessagesTyped, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("fc-messages", "/friend-chat/messages", server.GET, s.handleGetMessagesTyped, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("fc-message-ack", "/friend-chat/message/ack", server.POST, s.handleMessageAckTyped, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("fc-online", "/friend-chat/online", server.POST, s.handleOnlineTyped, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("fc-offline", "/friend-chat/offline", server.POST, s.handleOfflineTyped, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("fc-pending", "/friend-chat/pending", server.GET, s.handleGetPendingTyped, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("fc-stats", "/friend-chat/stats", server.GET, s.handleStatsTyped),
	}
}

type sessionCreateReq struct {
	ParticipantDID string `json:"participant_did"`
}

type sessionCreateResp struct {
	Session sessionInfo `json:"session"`
	Created bool        `json:"created"`
}

type sessionsResp struct {
	Sessions []sessionInfo `json:"sessions"`
	Total    int           `json:"total"`
}

type sessionInfo struct {
	ULID            string `json:"ulid"`
	ParticipantADID string `json:"participant_a_did"`
	ParticipantBDID string `json:"participant_b_did"`
	LastMessageULID string `json:"last_message_ulid"`
	LastMessageAt   int64  `json:"last_message_at"`
	UnreadCount     int32  `json:"unread_count"`
}

type sendMessageReq struct {
	SessionULID string `json:"session_ulid"`
	ReceiverDID string `json:"receiver_did"`
	Type        int32  `json:"type"`
	Content     string `json:"content"`
	ReplyToULID string `json:"reply_to_ulid"`
}

type sendMessageResp struct {
	Message        messageInfo `json:"message"`
	DeliveryStatus string      `json:"delivery_status"`
}

func (s *friendChatSubServer) handleSendMessageTyped(ctx context.Context, req *chat.SendMessageRequest) (*chat.SendMessageResponse, error) {
	// Get authenticated user from context
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	// Validate request
	if req.ReceiverDid == "" {
		return nil, server.BadRequest("receiver_did is required")
	}
	if req.Content == "" {
		return nil, server.BadRequest("content is required")
	}

	// Default message type
	msgType := int32(req.Type)
	if msgType == 0 {
		msgType = 1
	}

	// Send message
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

	// Check online status
	s.mu.RLock()
	peer, isOnline := s.onlinePeers[req.ReceiverDid]
	if isOnline && time.Now().Unix()-peer.UpdatedAt > 60 {
		isOnline = false
	}
	s.mu.RUnlock()

	// Store offline message if receiver is offline
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

	// Return response
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

// handleSendMessage_legacy is the old implementation (kept for comparison)
func (s *friendChatSubServer) handleSendMessage_legacy(w http.ResponseWriter, r *http.Request) {
	contentType := r.Header.Get("Content-Type")

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	senderActorDID := subject.ID

	var sessionUlid, receiverDid, content, replyToUlid string
	var msgType int32

	// Parse request based on Content-Type
	if contentType == "application/protobuf" || contentType == "application/x-protobuf" {
		// Proto format
		body, err := io.ReadAll(r.Body)
		if err != nil {
			logger.Error(r.Context(), "Failed to read request body", "error", err)
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}

		var req chat.SendMessageRequest
		if err := proto.Unmarshal(body, &req); err != nil {
			logger.Error(r.Context(), "Failed to unmarshal proto request", "error", err)
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}

		sessionUlid = req.SessionUlid
		receiverDid = req.ReceiverDid
		content = req.Content
		replyToUlid = req.ReplyToUlid
		msgType = int32(req.Type)
	} else {
		// JSON format
		var req sendMessageReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}

		sessionUlid = req.SessionULID
		receiverDid = req.ReceiverDID
		content = req.Content
		replyToUlid = req.ReplyToULID
		msgType = req.Type
	}

	// Validate
	if receiverDid == "" || content == "" {
		http.Error(w, "missing required fields", http.StatusBadRequest)
		return
	}

	if msgType == 0 {
		msgType = 1
	}

	// Send message
	msg, err := s.messageService.SendMessage(r.Context(), &service.SendMessageRequest{
		SessionULID: sessionUlid,
		SenderDID:   senderActorDID,
		ReceiverDID: receiverDid,
		Type:        msgType,
		Content:     content,
		ReplyToULID: replyToUlid,
	})
	if err != nil {
		logger.Error(r.Context(), "Failed to send message", "error", err)
		http.Error(w, "failed to send message", http.StatusInternalServerError)
		return
	}

	// Check online status
	s.mu.RLock()
	peer, isOnline := s.onlinePeers[receiverDid]
	if isOnline && time.Now().Unix()-peer.UpdatedAt > 60 {
		isOnline = false
	}
	s.mu.RUnlock()

	relayStatus := "delivered"
	if !isOnline {
		relayStatus = "queued"
		s.relayService.StoreOfflineMessage(r.Context(), &service.StoreOfflineRequest{
			MessageULID:      msg.ULID,
			SenderDID:        senderActorDID,
			ReceiverDID:      receiverDid,
			SessionULID:      sessionUlid,
			EncryptedPayload: []byte(content),
			ExpireDuration:   0,
		})
	}

	// Response based on request Content-Type
	if contentType == "application/protobuf" || contentType == "application/x-protobuf" {
		resp := &chat.SendMessageResponse{
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
		}

		out, err := proto.Marshal(resp)
		if err != nil {
			logger.Error(r.Context(), "Failed to marshal proto response", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/protobuf")
		w.Write(out)
	} else {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(sendMessageResp{
			Message: messageInfo{
				ULID:        msg.ULID,
				SenderDID:   msg.SenderDID,
				ReceiverDID: msg.ReceiverDID,
				Type:        msg.Type,
				Content:     msg.Content,
				Status:      msg.Status,
				SentAt:      msg.SentAt.Unix(),
			},
			DeliveryStatus: relayStatus,
		})
	}
}

func (s *friendChatSubServer) handleSyncMessages(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	var req chat.SyncMessagesRequest
	if err := proto.Unmarshal(body, &req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if len(req.GetMessages()) == 0 {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	senderActorDID := subject.ID

	synced := int32(0)
	failed := make([]string, 0)

	for _, item := range req.GetMessages() {
		msgType := item.GetType()
		if msgType == chat.FriendMessageType_FRIEND_MESSAGE_TYPE_UNSPECIFIED {
			msgType = chat.FriendMessageType_FRIEND_MESSAGE_TYPE_TEXT
		}
		_, err := s.messageService.SendMessage(r.Context(), &service.SendMessageRequest{
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

	resp := &chat.SyncMessagesResponse{Synced: synced, Failed: failed}
	out, err := proto.Marshal(resp)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/protobuf")
	_, _ = w.Write(out)
}

type messagesResp struct {
	Messages []messageInfo `json:"messages"`
	HasMore  bool          `json:"has_more"`
}

type messageInfo struct {
	ULID        string `json:"ulid"`
	SenderDID   string `json:"sender_did"`
	ReceiverDID string `json:"receiver_did"`
	Type        int32  `json:"type"`
	Content     string `json:"content"`
	Status      int32  `json:"status"`
	SentAt      int64  `json:"sent_at"`
}

func (s *friendChatSubServer) handleGetMessages(w http.ResponseWriter, r *http.Request) {
	sessionULID := r.URL.Query().Get("session_ulid")
	if sessionULID == "" {
		http.Error(w, "missing session_ulid parameter", http.StatusBadRequest)
		return
	}

	beforeULID := r.URL.Query().Get("before_ulid")
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	messages, hasMore, err := s.messageService.GetMessagesBySession(r.Context(), sessionULID, beforeULID, limit)
	if err != nil {
		http.Error(w, "failed to get messages", http.StatusInternalServerError)
		return
	}

	resp := messagesResp{Messages: make([]messageInfo, 0, len(messages)), HasMore: hasMore}
	for _, m := range messages {
		resp.Messages = append(resp.Messages, messageInfo{
			ULID:        m.ULID,
			SenderDID:   m.SenderDID,
			ReceiverDID: m.ReceiverDID,
			Type:        m.Type,
			Content:     m.Content,
			Status:      m.Status,
			SentAt:      m.SentAt.Unix(),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

type OnlineRequestTyped struct {
	Did string `json:"did" protobuf:"bytes,1,opt,name=did"`
}

type OnlineResponseTyped struct {
	Status string `json:"status" protobuf:"bytes,1,opt,name=status"`
}

type GetPendingRequestTyped struct {
	Limit int32 `json:"limit" protobuf:"varint,1,opt,name=limit"`
}

type GetPendingResponseTyped struct {
	Messages []*PendingMessageInfo `json:"messages" protobuf:"bytes,1,rep,name=messages"`
}

type PendingMessageInfo struct {
	Ulid             string `json:"ulid" protobuf:"bytes,1,opt,name=ulid"`
	SenderDid        string `json:"sender_did" protobuf:"bytes,2,opt,name=sender_did"`
	SessionUlid      string `json:"session_ulid" protobuf:"bytes,3,opt,name=session_ulid"`
	EncryptedPayload []byte `json:"encrypted_payload" protobuf:"bytes,4,opt,name=encrypted_payload"`
	CreatedAt        int64  `json:"created_at" protobuf:"varint,5,opt,name=created_at"`
}

type StatsResponseTyped struct {
	OnlinePeers     int32  `json:"online_peers" protobuf:"varint,1,opt,name=online_peers"`
	PendingMessages int64  `json:"pending_messages" protobuf:"varint,2,opt,name=pending_messages"`
	Status          string `json:"status" protobuf:"bytes,3,opt,name=status"`
}

func (s *friendChatSubServer) handleOnlineTyped(
	ctx context.Context,
	req *OnlineRequestTyped,
) (*OnlineResponseTyped, error) {
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

	return &OnlineResponseTyped{Status: "online"}, nil
}

func (s *friendChatSubServer) handleOfflineTyped(
	ctx context.Context,
	req *OnlineRequestTyped,
) (*OnlineResponseTyped, error) {
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

	return &OnlineResponseTyped{Status: "offline"}, nil
}

func (s *friendChatSubServer) handleGetPendingTyped(
	ctx context.Context,
	req *GetPendingRequestTyped,
) (*GetPendingResponseTyped, error) {
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

	resp := &GetPendingResponseTyped{
		Messages: make([]*PendingMessageInfo, 0, len(messages)),
	}

	for _, m := range messages {
		resp.Messages = append(resp.Messages, &PendingMessageInfo{
			Ulid:             m.ULID,
			SenderDid:        m.SenderDID,
			SessionUlid:      m.SessionULID,
			EncryptedPayload: m.EncryptedPayload,
			CreatedAt:        m.CreatedAt.Unix(),
		})
	}

	return resp, nil
}

type EmptyRequestTyped struct{}

func (s *friendChatSubServer) handleStatsTyped(
	ctx context.Context,
	req *EmptyRequestTyped,
) (*StatsResponseTyped, error) {
	s.mu.RLock()
	onlineCount := len(s.onlinePeers)
	s.mu.RUnlock()

	pendingCount, _ := s.relayService.GetPendingCount(ctx, "")

	return &StatsResponseTyped{
		OnlinePeers:     int32(onlineCount),
		PendingMessages: pendingCount,
		Status:          string(s.status),
	}, nil
}

type GetMessagesRequestTyped struct {
	SessionUlid string `json:"session_ulid" protobuf:"bytes,1,opt,name=session_ulid"`
	BeforeUlid  string `json:"before_ulid" protobuf:"bytes,2,opt,name=before_ulid"`
	Limit       int32  `json:"limit" protobuf:"varint,3,opt,name=limit"`
}

type GetMessagesResponseTyped struct {
	Messages []*MessageInfoTyped `json:"messages" protobuf:"bytes,1,rep,name=messages"`
	HasMore  bool                `json:"has_more" protobuf:"varint,2,opt,name=has_more"`
}

type MessageInfoTyped struct {
	Ulid        string `json:"ulid" protobuf:"bytes,1,opt,name=ulid"`
	SenderDid   string `json:"sender_did" protobuf:"bytes,2,opt,name=sender_did"`
	ReceiverDid string `json:"receiver_did" protobuf:"bytes,3,opt,name=receiver_did"`
	Type        int32  `json:"type" protobuf:"varint,4,opt,name=type"`
	Content     string `json:"content" protobuf:"bytes,5,opt,name=content"`
	Status      int32  `json:"status" protobuf:"varint,6,opt,name=status"`
	SentAt      int64  `json:"sent_at" protobuf:"varint,7,opt,name=sent_at"`
}

type MessageAckRequestTyped struct {
	Ulids  []string `json:"ulids" protobuf:"bytes,1,rep,name=ulids"`
	Status int32    `json:"status" protobuf:"varint,2,opt,name=status"`
}

type MessageAckResponseTyped struct{}

func (s *friendChatSubServer) handleSyncMessagesTyped(
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

func (s *friendChatSubServer) handleGetMessagesTyped(
	ctx context.Context,
	req *GetMessagesRequestTyped,
) (*GetMessagesResponseTyped, error) {
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

	resp := &GetMessagesResponseTyped{
		Messages: make([]*MessageInfoTyped, 0, len(messages)),
		HasMore:  hasMore,
	}

	for _, m := range messages {
		resp.Messages = append(resp.Messages, &MessageInfoTyped{
			Ulid:        m.ULID,
			SenderDid:   m.SenderDID,
			ReceiverDid: m.ReceiverDID,
			Type:        m.Type,
			Content:     m.Content,
			Status:      m.Status,
			SentAt:      m.SentAt.Unix(),
		})
	}

	return resp, nil
}

func (s *friendChatSubServer) handleMessageAckTyped(
	ctx context.Context,
	req *MessageAckRequestTyped,
) (*MessageAckResponseTyped, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	if len(req.Ulids) == 0 {
		return nil, server.BadRequest("ulids list is required")
	}

	if req.Status == 2 {
		s.messageService.MarkAsDelivered(ctx, req.Ulids)
	} else if req.Status == 3 {
		s.messageService.MarkAsRead(ctx, req.Ulids)
	}

	s.relayService.AcknowledgeMessages(ctx, req.Ulids)

	return &MessageAckResponseTyped{}, nil
}

type messageAckReq struct {
	ULIDs  []string `json:"ulids"`
	Status int32    `json:"status"`
}

func (s *friendChatSubServer) handleMessageAck(w http.ResponseWriter, r *http.Request) {
	var req messageAckReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.ULIDs) == 0 {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	if req.Status == 2 {
		s.messageService.MarkAsDelivered(r.Context(), req.ULIDs)
	} else if req.Status == 3 {
		s.messageService.MarkAsRead(r.Context(), req.ULIDs)
	}

	s.relayService.AcknowledgeMessages(r.Context(), req.ULIDs)

	w.WriteHeader(http.StatusNoContent)
}

type onlineReq struct {
	DID string `json:"did"`
}

func (s *friendChatSubServer) handleOnline(w http.ResponseWriter, r *http.Request) {
	var req onlineReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.DID == "" {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	s.onlinePeers[req.DID] = onlinePeer{DID: req.DID, UpdatedAt: time.Now().Unix()}
	s.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "online"})
}

func (s *friendChatSubServer) handleOffline(w http.ResponseWriter, r *http.Request) {
	var req onlineReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.DID == "" {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	delete(s.onlinePeers, req.DID)
	s.mu.Unlock()

	w.WriteHeader(http.StatusNoContent)
}

type pendingResp struct {
	Messages []pendingMessage `json:"messages"`
}

type pendingMessage struct {
	ULID             string `json:"ulid"`
	SenderDID        string `json:"sender_did"`
	SessionULID      string `json:"session_ulid"`
	EncryptedPayload []byte `json:"encrypted_payload"`
	CreatedAt        int64  `json:"created_at"`
}

func (s *friendChatSubServer) handleGetPending(w http.ResponseWriter, r *http.Request) {
	receiverDID := r.URL.Query().Get("did")
	if receiverDID == "" {
		http.Error(w, "missing did parameter", http.StatusBadRequest)
		return
	}

	messages, err := s.relayService.GetPendingMessages(r.Context(), receiverDID, 100)
	if err != nil {
		http.Error(w, "failed to get pending messages", http.StatusInternalServerError)
		return
	}

	resp := pendingResp{Messages: make([]pendingMessage, 0, len(messages))}
	for _, m := range messages {
		resp.Messages = append(resp.Messages, pendingMessage{
			ULID:             m.ULID,
			SenderDID:        m.SenderDID,
			SessionULID:      m.SessionULID,
			EncryptedPayload: m.EncryptedPayload,
			CreatedAt:        m.CreatedAt.Unix(),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (s *friendChatSubServer) handleStats(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	onlineCount := len(s.onlinePeers)
	s.mu.RUnlock()

	pendingCount, _ := s.relayService.GetPendingCount(r.Context(), "")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"online_peers":     onlineCount,
		"pending_messages": pendingCount,
		"status":           s.status,
	})
}

type CreateSessionRequestTyped struct {
	ParticipantDid string `json:"participant_did" protobuf:"bytes,1,opt,name=participant_did"`
}

type CreateSessionResponseTyped struct {
	Session *FriendChatSessionInfo `json:"session" protobuf:"bytes,1,opt,name=session"`
	Created bool                   `json:"created" protobuf:"varint,2,opt,name=created"`
}

type FriendChatSessionInfo struct {
	Ulid            string `json:"ulid" protobuf:"bytes,1,opt,name=ulid"`
	ParticipantADid string `json:"participant_a_did" protobuf:"bytes,2,opt,name=participant_a_did"`
	ParticipantBDid string `json:"participant_b_did" protobuf:"bytes,3,opt,name=participant_b_did"`
	LastMessageUlid string `json:"last_message_ulid" protobuf:"bytes,4,opt,name=last_message_ulid"`
	LastMessageAt   int64  `json:"last_message_at" protobuf:"varint,5,opt,name=last_message_at"`
	UnreadCount     int32  `json:"unread_count" protobuf:"varint,6,opt,name=unread_count"`
}

type GetSessionsRequestTyped struct {
	Limit  int32 `json:"limit" protobuf:"varint,1,opt,name=limit"`
	Offset int32 `json:"offset" protobuf:"varint,2,opt,name=offset"`
}

type GetSessionsResponseTyped struct {
	Sessions []*FriendChatSessionInfo `json:"sessions" protobuf:"bytes,1,rep,name=sessions"`
	Total    int32                    `json:"total" protobuf:"varint,2,opt,name=total"`
}

func (s *friendChatSubServer) handleSessionCreateTyped(
	ctx context.Context,
	req *CreateSessionRequestTyped,
) (*CreateSessionResponseTyped, error) {
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

	unread := session.UnreadCountA
	if session.ParticipantBDID == currentActorDID {
		unread = session.UnreadCountB
	}

	return &CreateSessionResponseTyped{
		Session: &FriendChatSessionInfo{
			Ulid:            session.ULID,
			ParticipantADid: session.ParticipantADID,
			ParticipantBDid: session.ParticipantBDID,
			LastMessageUlid: session.LastMessageULID,
			LastMessageAt:   session.LastMessageAt.Unix(),
			UnreadCount:     unread,
		},
		Created: false,
	}, nil
}

func (s *friendChatSubServer) handleGetSessionsTyped(
	ctx context.Context,
	req *GetSessionsRequestTyped,
) (*GetSessionsResponseTyped, error) {
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

	resp := &GetSessionsResponseTyped{
		Sessions: make([]*FriendChatSessionInfo, 0, len(sessions)),
		Total:    int32(len(sessions)),
	}

	for _, sess := range sessions {
		unread := sess.UnreadCountA
		if sess.ParticipantBDID == did {
			unread = sess.UnreadCountB
		}
		resp.Sessions = append(resp.Sessions, &FriendChatSessionInfo{
			Ulid:            sess.ULID,
			ParticipantADid: sess.ParticipantADID,
			ParticipantBDid: sess.ParticipantBDID,
			LastMessageUlid: sess.LastMessageULID,
			LastMessageAt:   sess.LastMessageAt.Unix(),
			UnreadCount:     unread,
		})
	}

	return resp, nil
}

func (s *friendChatSubServer) handleSessionCreate_legacy(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logID := serverwrapper.GetLogID(ctx)

	var req sessionCreateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ParticipantDID == "" {
		logger.Errorf(ctx, "[%s] Invalid request: err=%v, participant_did=%s", logID, err, req.ParticipantDID)
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		logger.Errorf(ctx, "[%s] Unauthorized: no subject in context", logID)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	currentActorDID := subject.ID

	session, err := s.sessionService.GetOrCreateSession(ctx, currentActorDID, req.ParticipantDID)
	if err != nil {
		logger.Errorf(ctx, "[%s] Failed to create session: actor=%s, participant=%s, error=%v",
			logID, currentActorDID, req.ParticipantDID, err)
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}

	logger.Infof(ctx, "[%s] Session created/retrieved: session_ulid=%s, actor=%s, participant=%s",
		logID, session.ULID, currentActorDID, req.ParticipantDID)

	unread := session.UnreadCountA
	if session.ParticipantBDID == currentActorDID {
		unread = session.UnreadCountB
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sessionCreateResp{
		Session: sessionInfo{
			ULID:            session.ULID,
			ParticipantADID: session.ParticipantADID,
			ParticipantBDID: session.ParticipantBDID,
			LastMessageULID: session.LastMessageULID,
			LastMessageAt:   session.LastMessageAt.Unix(),
			UnreadCount:     unread,
		},
		Created: false,
	})
}

func (s *friendChatSubServer) handleGetSessions_legacy(w http.ResponseWriter, r *http.Request) {
	did := r.URL.Query().Get("did")
	if did == "" {
		http.Error(w, "missing did parameter", http.StatusBadRequest)
		return
	}

	sessions, err := s.sessionService.GetSessionsByDID(r.Context(), did, 50)
	if err != nil {
		http.Error(w, "failed to get sessions", http.StatusInternalServerError)
		return
	}

	resp := sessionsResp{Sessions: make([]sessionInfo, 0, len(sessions)), Total: len(sessions)}
	for _, sess := range sessions {
		unread := sess.UnreadCountA
		if sess.ParticipantBDID == did {
			unread = sess.UnreadCountB
		}
		resp.Sessions = append(resp.Sessions, sessionInfo{
			ULID:            sess.ULID,
			ParticipantADID: sess.ParticipantADID,
			ParticipantBDID: sess.ParticipantBDID,
			LastMessageULID: sess.LastMessageULID,
			LastMessageAt:   sess.LastMessageAt.Unix(),
			UnreadCount:     unread,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
