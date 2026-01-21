package friend_chat

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

type friendChatURL struct{ name, path string }

func (u friendChatURL) SubPath() string { return u.path }
func (u friendChatURL) Name() string    { return u.name }

type onlinePeer struct {
	DID       string `json:"did"`
	UpdatedAt int64  `json:"updated_at"`
}

type friendChatSubServer struct {
	status      server.Status
	addrs       []string
	mu          sync.RWMutex
	onlinePeers map[string]onlinePeer
	db          *gorm.DB
}

func (s *friendChatSubServer) Init(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusStarting
	s.onlinePeers = make(map[string]onlinePeer)
	if db, err := store.GetRDS(ctx); err == nil {
		s.db = db
	}
	return nil
}

func (s *friendChatSubServer) Start(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusRunning
	go s.cleanupExpiredOfflineMessages(ctx)
	return nil
}

func (s *friendChatSubServer) Stop(ctx context.Context) error {
	s.status = server.StatusStopped
	return nil
}

func (s *friendChatSubServer) Name() string               { return "friend_chat" }
func (s *friendChatSubServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *friendChatSubServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}
func (s *friendChatSubServer) Status() server.Status { return s.status }

func (s *friendChatSubServer) Handlers() []server.Handler {
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	jwtWrapper := httpadapter.RequireJWT(provider)

	return []server.Handler{
		server.NewHandler(friendChatURL{name: "fc-online", path: "/friend-chat/online"}, http.HandlerFunc(s.handleOnline), server.WithMethod(server.POST), server.WithWrappers(jwtWrapper)),
		server.NewHandler(friendChatURL{name: "fc-offline", path: "/friend-chat/offline"}, http.HandlerFunc(s.handleOffline), server.WithMethod(server.POST), server.WithWrappers(jwtWrapper)),
		server.NewHandler(friendChatURL{name: "fc-relay", path: "/friend-chat/relay"}, http.HandlerFunc(s.handleRelay), server.WithMethod(server.POST), server.WithWrappers(jwtWrapper)),
		server.NewHandler(friendChatURL{name: "fc-pending", path: "/friend-chat/pending"}, http.HandlerFunc(s.handleGetPending), server.WithMethod(server.GET), server.WithWrappers(jwtWrapper)),
		server.NewHandler(friendChatURL{name: "fc-ack", path: "/friend-chat/ack"}, http.HandlerFunc(s.handleAck), server.WithMethod(server.POST), server.WithWrappers(jwtWrapper)),
		server.NewHandler(friendChatURL{name: "fc-sessions", path: "/friend-chat/sessions"}, http.HandlerFunc(s.handleGetSessions), server.WithMethod(server.GET), server.WithWrappers(jwtWrapper)),
		server.NewHandler(friendChatURL{name: "fc-messages", path: "/friend-chat/messages"}, http.HandlerFunc(s.handleGetMessages), server.WithMethod(server.GET), server.WithWrappers(jwtWrapper)),
		server.NewHandler(friendChatURL{name: "fc-stats", path: "/friend-chat/stats"}, http.HandlerFunc(s.handleStats), server.WithMethod(server.GET)),
	}
}

func NewFriendChatSubServer(opts ...option.Option) server.Subserver {
	return &friendChatSubServer{status: server.StatusStopped, addrs: []string{}}
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

type relayReq struct {
	MessageULID      string `json:"message_ulid"`
	SenderDID        string `json:"sender_did"`
	ReceiverDID      string `json:"receiver_did"`
	SessionULID      string `json:"session_ulid"`
	EncryptedPayload []byte `json:"encrypted_payload"`
	Timestamp        int64  `json:"timestamp"`
	Signature        string `json:"signature"`
}

type relayResp struct {
	Status      string `json:"status"`
	DeliveredAt *int64 `json:"delivered_at,omitempty"`
	ForwardedTo string `json:"forwarded_to,omitempty"`
}

func (s *friendChatSubServer) handleRelay(w http.ResponseWriter, r *http.Request) {
	var req relayReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	if req.SenderDID == "" || req.ReceiverDID == "" || len(req.EncryptedPayload) == 0 {
		http.Error(w, "missing required fields", http.StatusBadRequest)
		return
	}

	s.mu.RLock()
	peer, isOnline := s.onlinePeers[req.ReceiverDID]
	if isOnline && time.Now().Unix()-peer.UpdatedAt > 60 {
		isOnline = false
	}
	s.mu.RUnlock()

	resp := relayResp{}

	if isOnline {
		now := time.Now().Unix()
		resp.Status = "delivered"
		resp.DeliveredAt = &now
		resp.ForwardedTo = "p2p"
	} else {
		msgULID := req.MessageULID
		if msgULID == "" {
			msgULID = ulid.Make().String()
		}

		offlineMsg := db.OfflineMessage{
			ULID:             msgULID,
			ReceiverDID:      req.ReceiverDID,
			SenderDID:        req.SenderDID,
			SessionULID:      req.SessionULID,
			EncryptedPayload: req.EncryptedPayload,
			Status:           1,
			ExpireAt:         time.Now().Add(7 * 24 * time.Hour),
		}

		if s.db != nil {
			if err := s.db.Create(&offlineMsg).Error; err != nil {
				logger.DefaultHelper.Errorf("failed to store offline message: %v", err)
				http.Error(w, "failed to store message", http.StatusInternalServerError)
				return
			}
		}

		resp.Status = "queued"
		resp.ForwardedTo = "offline_queue"
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
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

	var messages []db.OfflineMessage
	if s.db != nil {
		s.db.Where("receiver_did = ? AND status = 1 AND expire_at > ?", receiverDID, time.Now()).
			Order("created_at ASC").
			Limit(100).
			Find(&messages)
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

type ackReq struct {
	ULIDs []string `json:"ulids"`
}

func (s *friendChatSubServer) handleAck(w http.ResponseWriter, r *http.Request) {
	var req ackReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.ULIDs) == 0 {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	if s.db != nil {
		now := time.Now()
		s.db.Model(&db.OfflineMessage{}).
			Where("ulid IN ?", req.ULIDs).
			Updates(map[string]interface{}{
				"status":       2,
				"delivered_at": now,
				"updated_at":   now,
			})
	}

	w.WriteHeader(http.StatusNoContent)
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

	var sessions []db.FriendChatSession
	if s.db != nil {
		s.db.Where("participant_a_did = ? OR participant_b_did = ?", did, did).
			Order("last_message_at DESC").
			Limit(50).
			Find(&sessions)
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

	var messages []db.FriendChatMessage
	if s.db != nil {
		query := s.db.Where("session_ulid = ?", sessionULID)
		if beforeULID != "" {
			query = query.Where("ulid < ?", beforeULID)
		}
		query.Order("ulid DESC").Limit(limit + 1).Find(&messages)
	}

	hasMore := len(messages) > limit
	if hasMore {
		messages = messages[:limit]
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

func (s *friendChatSubServer) handleStats(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	onlineCount := len(s.onlinePeers)
	s.mu.RUnlock()

	var pendingCount int64
	var sessionsCount int64
	var messagesCount int64

	if s.db != nil {
		s.db.Model(&db.OfflineMessage{}).Where("status = 1").Count(&pendingCount)
		s.db.Model(&db.FriendChatSession{}).Count(&sessionsCount)
		s.db.Model(&db.FriendChatMessage{}).Count(&messagesCount)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"online_peers":     onlineCount,
		"pending_messages": pendingCount,
		"sessions":         sessionsCount,
		"messages":         messagesCount,
		"status":           s.status,
	})
}

func (s *friendChatSubServer) cleanupExpiredOfflineMessages(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if s.db != nil {
				result := s.db.Model(&db.OfflineMessage{}).
					Where("expire_at < ? AND status = 1", time.Now()).
					Updates(map[string]interface{}{"status": 3})
				if result.RowsAffected > 0 {
					logger.DefaultHelper.Infof("cleaned up %d expired offline messages", result.RowsAffected)
				}
			}
		}
	}
}
