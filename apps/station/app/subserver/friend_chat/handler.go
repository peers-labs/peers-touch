package friend_chat

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	"github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/friend_chat/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	hertzadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/hertz"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type listFriendThreadMessagesRequest struct {
	SessionUlid string `json:"session_ulid"`
	RootUlid    string `json:"root_ulid"`
	AfterUlid   string `json:"after_ulid"`
	Limit       int32  `json:"limit"`
}

type friendThreadCountsRequest struct {
	SessionUlid string   `json:"session_ulid"`
	RootUlids   []string `json:"root_ulids"`
}

type friendThreadReadRequest struct {
	SessionUlid  string `json:"session_ulid"`
	RootUlid     string `json:"root_ulid"`
	LastReadUlid string `json:"last_read_ulid,omitempty"`
}

type threadCountJSON struct {
	RootUlid        string `json:"rootUlid"`
	ReplyCount      int64  `json:"replyCount"`
	LatestReplyUlid string `json:"latestReplyUlid"`
	LatestReplyAt   int64  `json:"latestReplyAt"`
	UnreadCount     int64  `json:"unreadCount"`
}

type friendThreadCountsResponse struct {
	Counts []threadCountJSON `json:"counts"`
}

type friendThreadReadResponse struct {
	Success bool `json:"success"`
}

type threadAttachmentJSON struct {
	CID          string `json:"cid"`
	Filename     string `json:"filename"`
	MimeType     string `json:"mimeType"`
	Size         int64  `json:"size"`
	ThumbnailCID string `json:"thumbnailCid"`
	Visibility   string `json:"visibility"`
}

type friendThreadMessageJSON struct {
	Ulid             string                 `json:"ulid"`
	SessionUlid      string                 `json:"sessionUlid"`
	SessionULID      string                 `json:"session_ulid"`
	SenderDid        string                 `json:"senderDid"`
	SenderDID        string                 `json:"sender_did"`
	ReceiverDid      string                 `json:"receiverDid"`
	ReceiverDID      string                 `json:"receiver_did"`
	Type             int32                  `json:"type"`
	Content          string                 `json:"content"`
	Attachments      []threadAttachmentJSON `json:"attachments"`
	ReplyToUlid      string                 `json:"replyToUlid"`
	ReplyToULID      string                 `json:"reply_to_ulid"`
	ThreadRootUlid   string                 `json:"threadRootUlid"`
	ThreadRootULID   string                 `json:"thread_root_ulid"`
	Status           int32                  `json:"status"`
	SentAt           int64                  `json:"sentAt"`
	SentAtUnixMs     int64                  `json:"sent_at"`
	CreatedAt        int64                  `json:"createdAt"`
	UpdatedAt        int64                  `json:"updatedAt"`
	EncryptedPayload string                 `json:"encryptedPayload"`
	Recalled         bool                   `json:"recalled"`
	EditedAt         int64                  `json:"editedAt"`
}

type listFriendThreadMessagesResponse struct {
	Root       *friendThreadMessageJSON  `json:"root"`
	Messages   []friendThreadMessageJSON `json:"messages"`
	HasMore    bool                      `json:"hasMore"`
	NextCursor string                    `json:"nextCursor"`
}

func (s *subServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	hertzJWTWrapper := hertzadapter.RequireJWT(provider)
	return []server.Handler{
		// Presence stream — Hertz native handler, same shape as /events/stream.
		// Clients open this once and receive PresenceEvent JSON for every
		// online/offline transition (plus an initial snapshot of currently
		// online DIDs). Filtering by friend graph is done client-side.
		server.NewHertzHandler("fc-presence-stream", "/friend-chat/presence/stream", server.GET, s.handlePresenceStream, hertzJWTWrapper),
		server.NewTypedHandler("fc-session-create", "/friend-chat/session/create", server.POST, s.handleCreateSession, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-sessions", "/friend-chat/sessions", server.GET, s.handleGetSessions, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-settings", "/friend-chat/settings", server.GET, s.handleGetConversationSettings, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-update-settings", "/friend-chat/settings", server.PUT, s.handleUpdateConversationSettings, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-message-send", "/friend-chat/message/send", server.POST, s.handleSendMessage, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-message-sync", "/friend-chat/message/sync", server.POST, s.handleSyncMessages, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-messages", "/friend-chat/messages", server.GET, s.handleGetMessages, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-thread-messages", "/friend-chat/thread/messages", server.GET, s.handleListThreadMessages, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-thread-counts", "/friend-chat/thread/counts", server.POST, s.handleThreadCounts, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-thread-read", "/friend-chat/thread/read", server.POST, s.handleThreadRead, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-message-search", "/friend-chat/messages/search", server.GET, s.handleSearchMessages, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-message-ack", "/friend-chat/message/ack", server.POST, s.handleAckMessage, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-message-recall", "/friend-chat/message/recall", server.POST, s.handleRecallMessage, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-message-edit", "/friend-chat/message/edit", server.POST, s.handleEditMessage, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-message-delete", "/friend-chat/message/delete", server.POST, s.handleDeleteMessage, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-online", "/friend-chat/online", server.POST, s.handleOnline, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-offline", "/friend-chat/offline", server.POST, s.handleOffline, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-pending", "/friend-chat/pending", server.GET, s.handleGetPending, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-stats", "/friend-chat/stats", server.GET, s.handleStats, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-friend-request-send", "/friend-chat/friend-request/send", server.POST, s.handleSendFriendRequest, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-friend-request-accept", "/friend-chat/friend-request/accept", server.POST, s.handleAcceptFriendRequest, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-friend-request-reject", "/friend-chat/friend-request/reject", server.POST, s.handleRejectFriendRequest, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-friend-requests", "/friend-chat/friend-requests", server.GET, s.handleListFriendRequests, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-block-user", "/friend-chat/block", server.POST, s.handleBlockUser, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-unblock-user", "/friend-chat/block", server.DELETE, s.handleUnblockUser, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-blocked-users", "/friend-chat/blocked", server.GET, s.handleListBlockedUsers, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("fc-friendship-status", "/friend-chat/friendship/status", server.GET, s.handleGetFriendshipStatus, logIDWrapper, s.jwtWrapper),
	}
}

func (s *subServer) handleGetConversationSettings(ctx context.Context, req *chat.GetFriendConversationSettingsRequest) (*chat.GetFriendConversationSettingsResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.SessionUlid == "" {
		return nil, server.BadRequest("session_ulid is required")
	}
	settings, err := s.service.GetConversationSettingsByActor(subject.ID, req.SessionUlid)
	if err != nil {
		if err == application.ErrSessionNotFound {
			return nil, server.NotFound("session not found")
		}
		if err == application.ErrNotParticipant {
			return nil, server.Forbidden("not a session participant")
		}
		return nil, server.InternalErrorWithCause("failed to get conversation settings", err)
	}
	return &chat.GetFriendConversationSettingsResponse{Settings: toProtoConversationSettings(settings)}, nil
}

func (s *subServer) handleUpdateConversationSettings(ctx context.Context, req *chat.UpdateFriendConversationSettingsRequest) (*chat.UpdateFriendConversationSettingsResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.SessionUlid == "" {
		return nil, server.BadRequest("session_ulid is required")
	}
	settings, err := s.service.UpdateConversationSettingsByActor(subject.ID, req.SessionUlid, domain.ConversationSettingsPatch{
		IsMuted:         req.IsMuted,
		IsPinned:        req.IsPinned,
		AlertEnabled:    req.AlertEnabled,
		Background:      req.Background,
		ClearedAtUnixMs: req.ClearedAtUnixMs,
	})
	if err != nil {
		if err == application.ErrSessionNotFound {
			return nil, server.NotFound("session not found")
		}
		if err == application.ErrNotParticipant {
			return nil, server.Forbidden("not a session participant")
		}
		return nil, server.InternalErrorWithCause("failed to update conversation settings", err)
	}
	publishConversationSettingsChanged(req.SessionUlid, subject.ID, realtime.ConversationSettingsChanged_FRIEND)
	return &chat.UpdateFriendConversationSettingsResponse{Settings: toProtoConversationSettings(settings)}, nil
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
		if err == application.ErrBlocked {
			return nil, server.Forbidden("friendship blocked")
		}
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

	sessionActorIDs := make(map[string]struct{})
	for _, item := range items {
		if item.ParticipantADID != "" {
			sessionActorIDs[item.ParticipantADID] = struct{}{}
		}
		if item.ParticipantBDID != "" {
			sessionActorIDs[item.ParticipantBDID] = struct{}{}
		}
	}
	idSlice := make([]string, 0, len(sessionActorIDs))
	for id := range sessionActorIDs {
		idSlice = append(idSlice, id)
	}
	profiles := s.repo.BatchLoadActorSummaries(idSlice)

	// Snapshot the online map once so all sessions in this response see a
	// consistent view (avoids two participants in the same response
	// disagreeing because of an online flip mid-loop).
	s.mu.RLock()
	onlineSnapshot := make(map[string]struct{}, len(s.online))
	for did := range s.online {
		onlineSnapshot[did] = struct{}{}
	}
	s.mu.RUnlock()

	out := make([]*chat.FriendChatSession, 0, len(items))
	for _, item := range items {
		_, aOnline := onlineSnapshot[item.ParticipantADID]
		_, bOnline := onlineSnapshot[item.ParticipantBDID]
		sess := &chat.FriendChatSession{
			Ulid:               item.ID,
			ParticipantADid:    item.ParticipantADID,
			ParticipantBDid:    item.ParticipantBDID,
			LastMessageUlid:    item.LastMessageID,
			LastMessageAt:      timestamppb.New(item.LastMessageAt),
			UnreadCountA:       item.UnreadCountA,
			UnreadCountB:       item.UnreadCountB,
			CreatedAt:          timestamppb.New(item.CreatedAt),
			UpdatedAt:          timestamppb.New(item.UpdatedAt),
			ParticipantAOnline: aOnline,
			ParticipantBOnline: bOnline,
		}
		if p, ok := profiles[item.ParticipantADID]; ok {
			sess.ParticipantADisplayName = p.DisplayName
			sess.ParticipantAAvatar = p.Avatar
		}
		if p, ok := profiles[item.ParticipantBDID]; ok {
			sess.ParticipantBDisplayName = p.DisplayName
			sess.ParticipantBAvatar = p.Avatar
		}
		out = append(out, sess)
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
	if err := validateFriendEncryptedPayload(req.GetType(), enc); err != nil {
		return nil, server.BadRequestWithCause("invalid encrypted_payload", err)
	}
	hasEnc := len(enc) > 0
	if req.Content == "" && len(req.Attachments) == 0 && !hasEnc {
		return nil, server.BadRequest("content or attachments are required")
	}
	if friendAttachmentsExposeKeyMaterial(req.Attachments) {
		return nil, server.BadRequest("attachment encryption metadata must be carried inside encrypted_payload")
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
	message, err := s.service.SendMessageByActor(subject.ID, req.SessionUlid, req.ReceiverDid, msgType, content, req.ReplyToUlid, req.GetThreadRootUlid(), atts, enc, req.GetClientUlid())
	if err != nil {
		if err == application.ErrSessionNotFound {
			return nil, server.NotFound(err.Error())
		}
		if err == application.ErrNotParticipant || err == application.ErrInvalidReceiver || err == application.ErrBlocked {
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

	// Realtime fan-out: any device with a live SSE subscription on
	// /events/stream for the recipient gets this message envelope on
	// the same TCP connection. Offline recipients see nothing here;
	// the pending queue above + cold catch-up on reconnect (contract
	// §2.5 case-2) is their delivery path. Publishing is best-effort:
	// failure does NOT roll back the persisted message.
	//
	// Multi-device sender echo: the sender's other devices subscribe
	// to their own actor stream and need to see this outgoing message
	// in real time too. We publish to both actor buses; bus internally
	// clones so identical content with distinct event_ids reaches each
	// subscriber set without aliasing.
	if bus := events.GetBus(); bus != nil {
		publishMessageToBus(bus, message, req.SessionUlid, req.ReceiverDid)
		if subject.ID != req.ReceiverDid {
			publishMessageToBus(bus, message, req.SessionUlid, subject.ID)
		}
	}

	return &chat.SendMessageResponse{
		Message:     friendChatMessageFromDomain(message),
		RelayStatus: relayStatus,
	}, nil
}

func (s *subServer) handleBlockUser(ctx context.Context, req *chat.BlockUserRequest) (*chat.BlockUserResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	target := strings.TrimSpace(req.TargetDid)
	if target == "" {
		return nil, server.BadRequest("target_did is required")
	}
	friendship, err := s.service.BlockUser(subject.ID, target)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to block user", err)
	}
	return &chat.BlockUserResponse{
		Friend: &chat.Friend{
			ActorId:             friendship.PeerDID,
			Status:              chat.FriendshipStatus_FRIENDSHIP_STATUS_BLOCKED,
			FriendshipCreatedAt: timestamppb.New(friendship.CreatedAt),
		},
	}, nil
}

func (s *subServer) handleUnblockUser(ctx context.Context, req *chat.UnblockUserRequest) (*chat.UnblockUserResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	target := strings.TrimSpace(req.TargetDid)
	if target == "" {
		return nil, server.BadRequest("target_did is required")
	}
	if err := s.service.UnblockUser(subject.ID, target); err != nil {
		return nil, server.InternalErrorWithCause("failed to unblock user", err)
	}
	return &chat.UnblockUserResponse{Success: true}, nil
}

func (s *subServer) handleListBlockedUsers(ctx context.Context, req *chat.ListBlockedUsersRequest) (*chat.ListBlockedUsersResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	items, total, err := s.service.ListBlockedUsers(subject.ID, int(req.Limit), int(req.Offset))
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to list blocked users", err)
	}
	out := make([]*chat.Friend, 0, len(items))
	for _, item := range items {
		out = append(out, friendshipToProtoFriend(item))
	}
	return &chat.ListBlockedUsersResponse{BlockedUsers: out, Total: int32(total)}, nil
}

func (s *subServer) handleGetFriendshipStatus(ctx context.Context, req *chat.GetFriendshipStatusRequest) (*chat.GetFriendshipStatusResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	target := strings.TrimSpace(req.TargetDid)
	if target == "" {
		return nil, server.BadRequest("target_did is required")
	}
	friendship, err := s.service.GetFriendship(subject.ID, target)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get friendship status", err)
	}
	return &chat.GetFriendshipStatusResponse{Friend: friendshipToProtoFriend(friendship)}, nil
}

func friendshipToProtoFriend(friendship domain.Friendship) *chat.Friend {
	status := chat.FriendshipStatus_FRIENDSHIP_STATUS_UNSPECIFIED
	if friendship.Status == domain.FriendshipStatusBlocked {
		status = chat.FriendshipStatus_FRIENDSHIP_STATUS_BLOCKED
	}
	out := &chat.Friend{
		ActorId: friendship.PeerDID,
		Status:  status,
	}
	if !friendship.CreatedAt.IsZero() {
		out.FriendshipCreatedAt = timestamppb.New(friendship.CreatedAt)
	}
	return out
}

// publishMessageToBus emits a MessageEnvelope on the unified realtime
// stream. The wire's `ciphertext` field carries the marshaled
// FriendChatMessage today (before E2EE rolls out); receivers always
// decode via `unmarshal(decrypt(ciphertext))` where decrypt is the
// identity transform until sealed-sender lands. The wire schema does
// not change.
func publishMessageToBus(bus events.EventBus, m domain.Message, sessionULID, recipientID string) {
	fcm := friendChatMessageFromDomain(m)
	cipher, err := proto.Marshal(fcm)
	if err != nil {
		logger.DefaultHelper.Warnf("friend_chat: marshal message for bus failed: %v", err)
		return
	}
	ev := &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_Message{
			Message: &realtime.MessageEnvelope{
				SenderActorId:    m.SenderDID,
				RecipientActorId: recipientID,
				SessionUlid:      sessionULID,
				Ulid:             m.ID,
				Ciphertext:       cipher,
				SentTsUnixMs:     m.SentAt.UnixMilli(),
			},
		},
	}
	if _, err := bus.Publish(recipientID, ev); err != nil {
		logger.DefaultHelper.Warnf("friend_chat: realtime publish failed actor=%s: %v", recipientID, err)
	}
}

func publishConversationSettingsChanged(containerULID, actorID string, kind realtime.ConversationSettingsChanged_Kind) {
	bus := events.GetBus()
	if bus == nil {
		return
	}
	ev := &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_ConversationSettingsChanged{
			ConversationSettingsChanged: &realtime.ConversationSettingsChanged{
				ContainerUlid:   containerULID,
				Kind:            kind,
				ActorId:         actorID,
				ChangedTsUnixMs: time.Now().UTC().UnixMilli(),
			},
		},
	}
	if _, err := bus.Publish(actorID, ev); err != nil {
		logger.DefaultHelper.Warnf("friend_chat: settings changed publish failed container=%s actor=%s: %v", containerULID, actorID, err)
	}
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

func (s *subServer) handleListThreadMessages(ctx context.Context, req *listFriendThreadMessagesRequest) (*listFriendThreadMessagesResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.SessionUlid == "" || req.RootUlid == "" {
		return nil, server.BadRequest("session_ulid and root_ulid are required")
	}
	limit := int(req.Limit)
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	items, err := s.service.ListThreadMessagesByActor(subject.ID, req.SessionUlid, req.RootUlid, req.AfterUlid, limit+1)
	if err != nil {
		if err == application.ErrSessionNotFound {
			return nil, server.NotFound(err.Error())
		}
		if err == application.ErrNotParticipant {
			return nil, server.Forbidden(err.Error())
		}
		return nil, server.InternalErrorWithCause("failed to list thread messages", err)
	}
	if len(items) == 0 {
		return nil, server.NotFound("thread root not found")
	}
	hasMore := len(items) > limit+1
	if hasMore {
		items = items[:limit+1]
	}
	nextCursor := ""
	if hasMore && len(items) > 1 {
		nextCursor = items[len(items)-1].ID
	}
	messages := make([]friendThreadMessageJSON, 0, len(items))
	for _, item := range items {
		messages = append(messages, friendThreadMessageToJSON(item))
	}
	root := messages[0]
	return &listFriendThreadMessagesResponse{
		Root:       &root,
		Messages:   messages,
		HasMore:    hasMore,
		NextCursor: nextCursor,
	}, nil
}

func (s *subServer) handleThreadCounts(ctx context.Context, req *friendThreadCountsRequest) (*friendThreadCountsResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.SessionUlid == "" {
		return nil, server.BadRequest("session_ulid is required")
	}
	if len(req.RootUlids) == 0 {
		return &friendThreadCountsResponse{Counts: []threadCountJSON{}}, nil
	}
	items, err := s.service.ThreadCountsByActor(subject.ID, req.SessionUlid, req.RootUlids)
	if err != nil {
		if err == application.ErrSessionNotFound {
			return nil, server.NotFound(err.Error())
		}
		if err == application.ErrNotParticipant {
			return nil, server.Forbidden(err.Error())
		}
		return nil, server.InternalErrorWithCause("failed to load thread counts", err)
	}
	out := make([]threadCountJSON, 0, len(items))
	for _, item := range items {
		out = append(out, threadCountToJSON(item))
	}

	return &friendThreadCountsResponse{Counts: out}, nil
}

func (s *subServer) handleThreadRead(ctx context.Context, req *friendThreadReadRequest) (*friendThreadReadResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.SessionUlid == "" || req.RootUlid == "" {
		return nil, server.BadRequest("session_ulid and root_ulid are required")
	}
	if err := s.service.MarkThreadReadByActor(subject.ID, req.SessionUlid, req.RootUlid, req.LastReadUlid); err != nil {
		if err == application.ErrSessionNotFound || err == application.ErrMessageNotFound {
			return nil, server.NotFound(err.Error())
		}
		if err == application.ErrNotParticipant {
			return nil, server.Forbidden(err.Error())
		}
		return nil, server.InternalErrorWithCause("failed to mark thread read", err)
	}

	return &friendThreadReadResponse{Success: true}, nil
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
	acked, err := s.service.AckMessages(subject.ID, req.Ulids, req.Status)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to ack messages", err)
	}
	s.mu.Lock()
	delete(s.pending, subject.ID)
	s.mu.Unlock()

	// Realtime fan-out: each acked message gets a MessageReceipt
	// emitted onto the *original sender's* event stream, so the
	// sender's UI can flip the per-message status indicator without
	// waiting for a poll. The receipt's `from_actor_id` is the
	// receiver (this caller), since they're the actor reporting
	// "I got / read this".
	//
	// Best-effort: persistence has already succeeded, and dropping a
	// realtime receipt only delays the UI tick — the next time the
	// sender lists messages they'll see the updated status from the
	// DB. We translate FriendMessageStatus → MessageReceipt_Kind via
	// receiptKindFromFriendStatus; values outside that mapping
	// (SENDING, FAILED, UNSPECIFIED) are intentionally dropped here
	// because they have no meaning on the realtime plane.
	if len(acked) > 0 {
		if bus := events.GetBus(); bus != nil {
			rkind := receiptKindFromFriendStatus(req.Status)
			if rkind != realtime.MessageReceipt_KIND_UNSPECIFIED {
				publishReceiptsToSenders(bus, acked, subject.ID, rkind)
			}
		}
	}

	return &chat.MessageAckResponse{}, nil
}

// receiptKindFromFriendStatus maps the FriendMessageStatus enum (the
// chat subserver's wire form) onto the realtime MessageReceipt_Kind
// enum (the unified stream's form). The two enums live in different
// proto packages on purpose: the chat status has SENDING/SENT/FAILED
// states that only the chat protocol cares about, while the realtime
// receipt is a small DELIVERED/READ broadcast.
//
// Keep the desktop-side mirror (eventStream.ts::receiptKindFromEnum)
// aligned. Adding a new MessageReceipt_Kind on the proto side
// requires updating both.
func receiptKindFromFriendStatus(status int32) realtime.MessageReceipt_Kind {
	switch status {
	case 3: // FRIEND_MESSAGE_STATUS_DELIVERED
		return realtime.MessageReceipt_DELIVERED
	case 4: // FRIEND_MESSAGE_STATUS_READ
		return realtime.MessageReceipt_READ
	default:
		return realtime.MessageReceipt_KIND_UNSPECIFIED
	}
}

// publishReceiptsToSenders emits one MessageReceipt per acked message
// onto the original sender's actor stream. We do NOT also publish to
// the receiver's own bus — it's their own UI driving this call, and
// they already have the local persistence flip via the same response.
//
// Receiver's other devices DO need to see READ receipts so that
// "unread count = 0" sticks across devices; we cover that by
// additionally publishing to the receiver's bus when the kind is READ
// (skipped for DELIVERED to avoid the cross-device echo cost on the
// far more frequent DELIVERED traffic). This matches the multi-device
// behaviour of MessageEnvelope publish in handleSendMessage.
func publishReceiptsToSenders(bus events.EventBus, acked []domain.AckedMessage, fromActorID string, kind realtime.MessageReceipt_Kind) {
	for _, m := range acked {
		ev := &realtime.StreamEvent{
			Kind: &realtime.StreamEvent_Receipt{
				Receipt: &realtime.MessageReceipt{
					SessionUlid: m.SessionULID,
					Ulid:        m.Ulid,
					Kind:        kind,
					FromActorId: fromActorID,
				},
			},
		}
		if _, err := bus.Publish(m.SenderDID, ev); err != nil {
			logger.DefaultHelper.Warnf("friend_chat: realtime receipt publish failed sender=%s ulid=%s: %v",
				m.SenderDID, m.Ulid, err)
		}
		if kind == realtime.MessageReceipt_READ && m.SenderDID != fromActorID {
			// Multi-device echo on READ only — see the function-level
			// comment for the rationale.
			cloneEv := &realtime.StreamEvent{
				Kind: &realtime.StreamEvent_Receipt{
					Receipt: &realtime.MessageReceipt{
						SessionUlid: m.SessionULID,
						Ulid:        m.Ulid,
						Kind:        kind,
						FromActorId: fromActorID,
					},
				},
			}
			if _, err := bus.Publish(fromActorID, cloneEv); err != nil {
				logger.DefaultHelper.Warnf("friend_chat: realtime receipt self-echo failed actor=%s ulid=%s: %v",
					fromActorID, m.Ulid, err)
			}
		}
	}
}

// handleRecallMessage clears a message's content + encrypted payload
// in place, flips `recalled = true`, and publishes a realtime
// MessageMutation event on the recipient's (and the sender's other
// devices') stream. Only the original sender may recall, and only
// within the recall window (see application.DefaultMutationWindow).
func (s *subServer) handleRecallMessage(ctx context.Context, req *chat.RecallFriendMessageRequest) (*chat.RecallFriendMessageResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GetSessionUlid() == "" || req.GetMessageUlid() == "" {
		return nil, server.BadRequest("session_ulid and message_ulid are required")
	}
	out, err := s.service.RecallMessageByActor(subject.ID, req.GetSessionUlid(), req.GetMessageUlid())
	if err != nil {
		return nil, mutationErrorToHTTP(err)
	}
	publishMutationToParticipants(out, subject.ID)
	return &chat.RecallFriendMessageResponse{}, nil
}

// handleEditMessage replaces a message's body. Both `new_content`
// and `new_encrypted_payload` may be set; we persist whichever is
// provided. Edits are restricted to the original sender within the
// edit window, and an edit on a recalled message is rejected.
func (s *subServer) handleEditMessage(ctx context.Context, req *chat.EditFriendMessageRequest) (*chat.EditFriendMessageResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GetSessionUlid() == "" || req.GetMessageUlid() == "" {
		return nil, server.BadRequest("session_ulid and message_ulid are required")
	}
	if err := validateFriendEncryptedPayload(chat.FriendMessageType_FRIEND_MESSAGE_TYPE_TEXT, req.GetNewEncryptedPayload()); err != nil {
		return nil, server.BadRequestWithCause("invalid new_encrypted_payload", err)
	}
	out, err := s.service.EditMessageByActor(
		subject.ID,
		req.GetSessionUlid(),
		req.GetMessageUlid(),
		req.GetNewContent(),
		req.GetNewEncryptedPayload(),
	)
	if err != nil {
		return nil, mutationErrorToHTTP(err)
	}
	publishMutationToParticipants(out, subject.ID)
	return &chat.EditFriendMessageResponse{}, nil
}

func validateFriendEncryptedPayload(messageType chat.FriendMessageType, payload []byte) error {
	if len(payload) == 0 {
		return nil
	}
	if messageType == chat.FriendMessageType_FRIEND_MESSAGE_TYPE_SENDER_KEY_DISTRIBUTION {
		return nil
	}
	var frame chat.EncryptedMessage
	if err := proto.Unmarshal(payload, &frame); err != nil {
		return fmt.Errorf("decode encrypted message: %w", err)
	}
	if len(frame.Ciphertext) == 0 {
		return fmt.Errorf("ciphertext is required")
	}
	switch frame.Version {
	case 0:
		if frame.Counter == 0 && len(frame.EphemeralKey) == 0 {
			return fmt.Errorf("legacy payload requires counter or ephemeral_key")
		}
	case 1:
		if len(frame.RatchetPub) != 32 {
			return fmt.Errorf("double ratchet payload requires 32-byte ratchet_pub")
		}
	default:
		return fmt.Errorf("unsupported encrypted message version %d", frame.Version)
	}
	return nil
}

// handleDeleteMessage hard-deletes the message + its attachment rows
// and publishes a realtime MessageMutation event so peers remove the
// bubble from their UI without polling.
func (s *subServer) handleDeleteMessage(ctx context.Context, req *chat.DeleteFriendMessageRequest) (*chat.DeleteFriendMessageResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GetSessionUlid() == "" || req.GetMessageUlid() == "" {
		return nil, server.BadRequest("session_ulid and message_ulid are required")
	}
	out, err := s.service.DeleteMessageByActor(subject.ID, req.GetSessionUlid(), req.GetMessageUlid())
	if err != nil {
		return nil, mutationErrorToHTTP(err)
	}
	publishMutationToParticipants(out, subject.ID)
	return &chat.DeleteFriendMessageResponse{}, nil
}

// mutationErrorToHTTP maps the application sentinels onto HTTP
// status codes. We deliberately collapse "permission denied" + "row
// missing" onto 404 so a non-owner cannot enumerate other actors'
// message ulids by probing.
func mutationErrorToHTTP(err error) error {
	switch err {
	case application.ErrSessionNotFound, application.ErrNotParticipant, application.ErrMessageNotFound:
		return server.NotFound(err.Error())
	case application.ErrMutationWindowClosed:
		return server.BadRequest("mutation window has closed for this message")
	case application.ErrAlreadyRecalled:
		return server.BadRequest("message already recalled")
	case application.ErrEmptyEdit:
		return server.BadRequest(err.Error())
	default:
		return server.InternalErrorWithCause("mutation failed", err)
	}
}

// publishMutationToParticipants emits one MessageMutation StreamEvent
// onto the *receiver's* event stream and (when the sender has more
// than one logged-in client) the sender's stream too. We follow the
// same multi-device echo pattern as message send so that all of the
// sender's other devices see "this row was just recalled" without
// any local state divergence.
//
// Best-effort: persistence has already succeeded, so dropping a
// realtime mutation event only delays UI convergence — peers' next
// cold sync surfaces the same change from the DB. We log at warn
// level rather than failing the HTTP response.
//
// `senderActorID` is the authenticated subject for this request and
// equals `outcome.SenderDID`. We pass it explicitly so the helper
// does not have to re-resolve it from the outcome and so a future
// "moderator override" path (where the actor is not the sender) can
// pass its own id without touching the DB row.
func publishMutationToParticipants(outcome domain.MutationOutcome, senderActorID string) {
	bus := events.GetBus()
	if bus == nil {
		return
	}
	// Translate the repo-level kind int back into the proto enum.
	// We cannot import the proto package from the repo, hence the
	// numeric round-trip; the constants on both sides agree per
	// the contract.
	var kind realtime.MessageMutation_Kind
	switch outcome.Kind {
	case 1:
		kind = realtime.MessageMutation_RECALL
	case 2:
		kind = realtime.MessageMutation_EDIT
	case 3:
		kind = realtime.MessageMutation_DELETE
	default:
		kind = realtime.MessageMutation_KIND_UNSPECIFIED
	}
	build := func() *realtime.StreamEvent {
		return &realtime.StreamEvent{
			Kind: &realtime.StreamEvent_Mutation{
				Mutation: &realtime.MessageMutation{
					SessionUlid:     outcome.SessionULID,
					Ulid:            outcome.Ulid,
					FromActorId:     senderActorID,
					Kind:            kind,
					NewCiphertext:   append([]byte(nil), outcome.NewCiphertext...),
					NewContent:      outcome.NewContent,
					MutatedTsUnixMs: outcome.MutatedAt.UnixMilli(),
				},
			},
		}
	}
	if _, err := bus.Publish(outcome.ReceiverDID, build()); err != nil {
		logger.DefaultHelper.Warnf("friend_chat: realtime mutation publish failed receiver=%s ulid=%s kind=%v: %v",
			outcome.ReceiverDID, outcome.Ulid, kind, err)
	}
	if outcome.SenderDID != outcome.ReceiverDID {
		// Multi-device echo for the sender. Without this the
		// sender's other clients would still display the pre-mutation
		// content until the next list refresh.
		if _, err := bus.Publish(outcome.SenderDID, build()); err != nil {
			logger.DefaultHelper.Warnf("friend_chat: realtime mutation self-echo failed actor=%s ulid=%s: %v",
				outcome.SenderDID, outcome.Ulid, err)
		}
	}
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
			ID:               item.Ulid,
			SessionID:        item.SessionUlid,
			ReceiverDID:      item.ReceiverDid,
			Type:             msgType,
			Content:          item.Content,
			ReplyToID:        item.GetReplyToUlid(),
			ThreadRootID:     item.GetThreadRootUlid(),
			Attachments:      friendAttachmentsFromProto(item.Attachments),
			EncryptedPayload: append([]byte(nil), item.GetEncryptedPayload()...),
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
	// Only publish a presence change on the rising edge so reconnect storms
	// (every visibilitychange triggers /online) don't fan out a broadcast
	// per ping.
	s.mu.Lock()
	_, wasOnline := s.online[did]
	s.online[did] = timestamppb.Now().GetSeconds()
	s.mu.Unlock()
	if !wasOnline {
		s.publishPresence(did, true)
	}
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
	_, wasOnline := s.online[did]
	delete(s.online, did)
	s.mu.Unlock()
	if wasOnline {
		s.publishPresence(did, false)
	}
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
		if err == application.ErrBlocked {
			return nil, server.Forbidden(err.Error())
		}
		return nil, server.InternalErrorWithCause("failed to send friend request", err)
	}
	profiles := s.repo.BatchLoadActorSummaries([]string{fr.SenderDID, fr.ReceiverDID})
	proto := friendRequestToProto(fr)
	if p, ok := profiles[fr.SenderDID]; ok {
		proto.SenderDisplayName = p.DisplayName
		proto.SenderAvatar = p.Avatar
	}
	if p, ok := profiles[fr.ReceiverDID]; ok {
		proto.ReceiverDisplayName = p.DisplayName
		proto.ReceiverAvatar = p.Avatar
	}
	return &chat.SendFriendRequestResponse{
		Request: proto,
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
		if err == application.ErrBlocked {
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

	actorIDs := collectUniqueActorIDs(items)
	profiles := s.repo.BatchLoadActorSummaries(actorIDs)

	out := make([]*chat.FriendRequest, 0, len(items))
	for _, item := range items {
		fr := friendRequestToProto(item)
		if p, ok := profiles[item.SenderDID]; ok {
			fr.SenderDisplayName = p.DisplayName
			fr.SenderAvatar = p.Avatar
		}
		if p, ok := profiles[item.ReceiverDID]; ok {
			fr.ReceiverDisplayName = p.DisplayName
			fr.ReceiverAvatar = p.Avatar
		}
		out = append(out, fr)
	}
	return &chat.ListFriendRequestsResponse{Requests: out, Total: int32(total)}, nil
}

func collectUniqueActorIDs(items []domain.FriendRequest) []string {
	seen := make(map[string]struct{})
	for _, item := range items {
		if item.SenderDID != "" {
			seen[item.SenderDID] = struct{}{}
		}
		if item.ReceiverDID != "" {
			seen[item.ReceiverDID] = struct{}{}
		}
	}
	ids := make([]string, 0, len(seen))
	for id := range seen {
		ids = append(ids, id)
	}
	return ids
}

func friendChatMessageFromDomain(m domain.Message) *chat.FriendChatMessage {
	out := &chat.FriendChatMessage{
		Ulid:             m.ID,
		SessionUlid:      m.SessionID,
		SenderDid:        m.SenderDID,
		ReceiverDid:      m.ReceiverDID,
		Type:             chat.FriendMessageType(m.Type),
		Content:          m.Content,
		EncryptedPayload: append([]byte(nil), m.EncryptedPayload...),
		Attachments:      friendAttachmentsToProto(m.Attachments),
		ReplyToUlid:      m.ReplyToID,
		ThreadRootUlid:   m.ThreadRootID,
		Status:           chat.FriendMessageStatus(m.Status),
		Recalled:         m.Recalled,
		SentAt:           timestamppb.New(m.SentAt),
		CreatedAt:        timestamppb.New(m.CreatedAt),
		UpdatedAt:        timestamppb.New(m.UpdatedAt),
	}
	if !m.EditedAt.IsZero() {
		out.EditedAt = timestamppb.New(m.EditedAt)
	}
	return out
}

func toProtoConversationSettings(settings domain.ConversationSettings) *chat.FriendConversationSettings {
	return &chat.FriendConversationSettings{
		SessionUlid:     settings.SessionID,
		IsMuted:         settings.IsMuted,
		IsPinned:        settings.IsPinned,
		AlertEnabled:    settings.AlertEnabled,
		Background:      settings.Background,
		ClearedAtUnixMs: settings.ClearedAtUnixMs,
	}
}

func threadCountToJSON(item domain.ThreadCount) threadCountJSON {
	latestAt := int64(0)
	if !item.LatestReplyAt.IsZero() {
		latestAt = item.LatestReplyAt.UnixMilli()
	}

	return threadCountJSON{
		RootUlid:        item.RootULID,
		ReplyCount:      item.ReplyCount,
		LatestReplyUlid: item.LatestReplyULID,
		LatestReplyAt:   latestAt,
		UnreadCount:     item.UnreadCount,
	}
}

func friendThreadMessageToJSON(m domain.Message) friendThreadMessageJSON {
	attachments := make([]threadAttachmentJSON, 0, len(m.Attachments))
	for _, a := range m.Attachments {
		attachments = append(attachments, threadAttachmentJSON{
			CID:          a.CID,
			Filename:     a.Filename,
			MimeType:     a.MimeType,
			Size:         a.Size,
			ThumbnailCID: a.ThumbnailCID,
			Visibility:   a.Visibility,
		})
	}
	editedAt := int64(0)
	if !m.EditedAt.IsZero() {
		editedAt = m.EditedAt.UnixMilli()
	}
	encryptedPayload := ""
	if len(m.EncryptedPayload) > 0 {
		encryptedPayload = base64.StdEncoding.EncodeToString(m.EncryptedPayload)
	}
	sentAt := int64(0)
	if !m.SentAt.IsZero() {
		sentAt = m.SentAt.UnixMilli()
	}
	createdAt := int64(0)
	if !m.CreatedAt.IsZero() {
		createdAt = m.CreatedAt.UnixMilli()
	}
	updatedAt := int64(0)
	if !m.UpdatedAt.IsZero() {
		updatedAt = m.UpdatedAt.UnixMilli()
	}
	return friendThreadMessageJSON{
		Ulid:             m.ID,
		SessionUlid:      m.SessionID,
		SessionULID:      m.SessionID,
		SenderDid:        m.SenderDID,
		SenderDID:        m.SenderDID,
		ReceiverDid:      m.ReceiverDID,
		ReceiverDID:      m.ReceiverDID,
		Type:             m.Type,
		Content:          m.Content,
		Attachments:      attachments,
		ReplyToUlid:      m.ReplyToID,
		ReplyToULID:      m.ReplyToID,
		ThreadRootUlid:   m.ThreadRootID,
		ThreadRootULID:   m.ThreadRootID,
		Status:           m.Status,
		SentAt:           sentAt,
		SentAtUnixMs:     sentAt,
		CreatedAt:        createdAt,
		UpdatedAt:        updatedAt,
		EncryptedPayload: encryptedPayload,
		Recalled:         m.Recalled,
		EditedAt:         editedAt,
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
			Visibility:   a.GetVisibility(),
		})
	}
	return out
}

func friendAttachmentsExposeKeyMaterial(in []*chat.FriendMessageAttachment) bool {
	for _, a := range in {
		if a == nil || a.GetMediaEncryption() == nil {
			continue
		}
		media := a.GetMediaEncryption()
		if media.GetKeyB64() != "" || media.GetNonceB64() != "" || media.GetSuite() != "" {
			return true
		}
	}
	return false
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
			Visibility:   a.Visibility,
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
