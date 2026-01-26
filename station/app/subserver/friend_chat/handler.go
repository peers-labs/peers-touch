package friend_chat

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/service"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type friendChatURL struct{ name, path string }

func (u friendChatURL) SubPath() string { return u.path }
func (u friendChatURL) Name() string    { return u.name }

func (s *friendChatSubServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()
	jwtWrapper := s.jwtWrapper
	return []server.Handler{
		server.NewHTTPHandler("fc-session-create", "/friend-chat/session/create", server.POST, server.HTTPHandlerFunc(s.handleSessionCreate), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("fc-sessions", "/friend-chat/sessions", server.GET, server.HTTPHandlerFunc(s.handleGetSessions), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("fc-message-send", "/friend-chat/message/send", server.POST, server.HTTPHandlerFunc(s.handleSendMessage), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("fc-message-sync", "/friend-chat/message/sync", server.POST, server.HTTPHandlerFunc(s.handleSyncMessages), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("fc-messages", "/friend-chat/messages", server.GET, server.HTTPHandlerFunc(s.handleGetMessages), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("fc-message-ack", "/friend-chat/message/ack", server.POST, server.HTTPHandlerFunc(s.handleMessageAck), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("fc-online", "/friend-chat/online", server.POST, server.HTTPHandlerFunc(s.handleOnline), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("fc-offline", "/friend-chat/offline", server.POST, server.HTTPHandlerFunc(s.handleOffline), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("fc-pending", "/friend-chat/pending", server.GET, server.HTTPHandlerFunc(s.handleGetPending), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("fc-stats", "/friend-chat/stats", server.GET, server.HTTPHandlerFunc(s.handleStats)),
	}
}

type sessionCreateReq struct {
	ParticipantDID string `json:"participant_did"`
}

type sessionCreateResp struct {
	Session sessionInfo `json:"session"`
	Created bool        `json:"created"`
}

func (s *friendChatSubServer) handleSessionCreate(w http.ResponseWriter, r *http.Request) {
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

func (s *friendChatSubServer) handleGetSessions(w http.ResponseWriter, r *http.Request) {
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

func (s *friendChatSubServer) handleSendMessage(w http.ResponseWriter, r *http.Request) {
	var req sendMessageReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	senderActorDID := subject.ID

	if req.ReceiverDID == "" || req.Content == "" {
		http.Error(w, "missing required fields", http.StatusBadRequest)
		return
	}

	if req.Type == 0 {
		req.Type = 1
	}

	msg, err := s.messageService.SendMessage(r.Context(), &service.SendMessageRequest{
		SessionULID: req.SessionULID,
		SenderDID:   senderActorDID,
		ReceiverDID: req.ReceiverDID,
		Type:        req.Type,
		Content:     req.Content,
		ReplyToULID: req.ReplyToULID,
	})
	if err != nil {
		http.Error(w, "failed to send message", http.StatusInternalServerError)
		return
	}

	s.mu.RLock()
	peer, isOnline := s.onlinePeers[req.ReceiverDID]
	if isOnline && time.Now().Unix()-peer.UpdatedAt > 60 {
		isOnline = false
	}
	s.mu.RUnlock()

	deliveryStatus := "delivered"
	if !isOnline {
		deliveryStatus = "queued"
		s.relayService.StoreOfflineMessage(r.Context(), &service.StoreOfflineRequest{
			MessageULID:      msg.ULID,
			SenderDID:        senderActorDID,
			ReceiverDID:      req.ReceiverDID,
			SessionULID:      req.SessionULID,
			EncryptedPayload: []byte(req.Content),
			ExpireDuration:   0,
		})
	}

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
		DeliveryStatus: deliveryStatus,
	})
}

type syncMessagesReq struct {
	Messages []syncMessageItem `json:"messages"`
}

type syncMessageItem struct {
	ULID        string `json:"ulid"`
	SessionULID string `json:"session_ulid"`
	ReceiverDID string `json:"receiver_did"`
	Type        int32  `json:"type"`
	Content     string `json:"content"`
	SentAt      int64  `json:"sent_at"`
}

type syncMessagesResp struct {
	Synced int      `json:"synced"`
	Failed []string `json:"failed"`
}

func (s *friendChatSubServer) handleSyncMessages(w http.ResponseWriter, r *http.Request) {
	var req syncMessagesReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Messages) == 0 {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	senderActorDID := subject.ID

	synced := 0
	failed := make([]string, 0)

	for _, item := range req.Messages {
		if item.Type == 0 {
			item.Type = 1
		}
		_, err := s.messageService.SendMessage(r.Context(), &service.SendMessageRequest{
			SessionULID: item.SessionULID,
			SenderDID:   senderActorDID,
			ReceiverDID: item.ReceiverDID,
			Type:        item.Type,
			Content:     item.Content,
			ReplyToULID: "",
		})
		if err != nil {
			failed = append(failed, item.ULID)
		} else {
			synced++
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(syncMessagesResp{
		Synced: synced,
		Failed: failed,
	})
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
