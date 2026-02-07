package group_chat

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/peers-labs/peers-touch/station/app/subserver/group_chat/db/model"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/event"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

func (s *groupChatSubServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()
	jwtWrapper := s.jwtWrapper
	return []server.Handler{
		// Group management
		server.NewHTTPHandler("gc-create", "/group-chat/create", server.POST, server.HTTPHandlerFunc(s.handleCreate), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("gc-list", "/group-chat/list", server.GET, server.HTTPHandlerFunc(s.handleList), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("gc-info", "/group-chat/info", server.GET, server.HTTPHandlerFunc(s.handleInfo), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("gc-update", "/group-chat/update", server.PUT, server.HTTPHandlerFunc(s.handleUpdate), logIDWrapper, jwtWrapper),

		// Member management
		server.NewHTTPHandler("gc-invite", "/group-chat/invite", server.POST, server.HTTPHandlerFunc(s.handleInvite), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("gc-join", "/group-chat/join", server.POST, server.HTTPHandlerFunc(s.handleJoin), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("gc-leave", "/group-chat/leave", server.POST, server.HTTPHandlerFunc(s.handleLeave), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("gc-members", "/group-chat/members", server.GET, server.HTTPHandlerFunc(s.handleMembers), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("gc-remove-member", "/group-chat/member/remove", server.POST, server.HTTPHandlerFunc(s.handleRemoveMember), logIDWrapper, jwtWrapper),

		// Messages
		server.NewHTTPHandler("gc-message-send", "/group-chat/message/send", server.POST, server.HTTPHandlerFunc(s.handleSendMessage), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("gc-messages", "/group-chat/messages", server.GET, server.HTTPHandlerFunc(s.handleGetMessages), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("gc-message-recall", "/group-chat/message/recall", server.POST, server.HTTPHandlerFunc(s.handleRecallMessage), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("gc-message-delete", "/group-chat/message/delete", server.POST, server.HTTPHandlerFunc(s.handleDeleteMessage), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("gc-message-search", "/group-chat/messages/search", server.GET, server.HTTPHandlerFunc(s.handleSearchMessages), logIDWrapper, jwtWrapper),

		// Member settings
		server.NewHTTPHandler("gc-update-nickname", "/group-chat/member/nickname", server.PUT, server.HTTPHandlerFunc(s.handleUpdateMyNickname), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("gc-my-settings", "/group-chat/my-settings", server.GET, server.HTTPHandlerFunc(s.handleGetMySettings), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("gc-update-my-settings", "/group-chat/my-settings", server.PUT, server.HTTPHandlerFunc(s.handleUpdateMySettings), logIDWrapper, jwtWrapper),

		// Offline messages
		server.NewHTTPHandler("gc-offline-messages", "/group-chat/offline-messages", server.GET, server.HTTPHandlerFunc(s.handleGetOfflineMessages), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("gc-offline-ack", "/group-chat/offline-messages/ack", server.POST, server.HTTPHandlerFunc(s.handleAckOfflineMessages), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("gc-unread-count", "/group-chat/unread-count", server.GET, server.HTTPHandlerFunc(s.handleGetUnreadCount), logIDWrapper, jwtWrapper),
		server.NewHTTPHandler("gc-mark-read", "/group-chat/mark-read", server.POST, server.HTTPHandlerFunc(s.handleMarkGroupRead), logIDWrapper, jwtWrapper),

		// Stats
		server.NewHTTPHandler("gc-stats", "/group-chat/stats", server.GET, server.HTTPHandlerFunc(s.handleStats)),
	}
}

// ==================== Request/Response types ====================

type createGroupReq struct {
	Name             string   `json:"name"`
	Description      string   `json:"description"`
	Type             int      `json:"type"`
	Visibility       int      `json:"visibility"`
	InitialMemberDIDs []string `json:"initial_member_dids"`
}

type groupInfo struct {
	ULID        string            `json:"ulid"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	AvatarCID   string            `json:"avatar_cid"`
	OwnerDID    string            `json:"owner_did"`
	Type        int               `json:"type"`
	Visibility  int               `json:"visibility"`
	MemberCount int               `json:"member_count"`
	MaxMembers  int               `json:"max_members"`
	Muted       bool              `json:"muted"`
	CreatedAt   int64             `json:"created_at"`
	UpdatedAt   int64             `json:"updated_at"`
}

type memberInfo struct {
	GroupULID   string `json:"group_ulid"`
	ActorDID    string `json:"actor_did"`
	Role        int    `json:"role"`
	Nickname    string `json:"nickname"`
	DisplayName string `json:"display_name"` // User's display name (from actor table)
	Username    string `json:"username"`     // User's username
	AvatarURL   string `json:"avatar_url"`   // User's avatar URL
	Muted       bool   `json:"muted"`
	MutedUntil  int64  `json:"muted_until"`
	JoinedAt    int64  `json:"joined_at"`
	InvitedBy   string `json:"invited_by"`
}

type messageInfo struct {
	ULID          string   `json:"ulid"`
	GroupULID     string   `json:"group_ulid"`
	SenderDID     string   `json:"sender_did"`
	Type          int      `json:"type"`
	Content       string   `json:"content"`
	ReplyToULID   string   `json:"reply_to_ulid"`
	MentionedDIDs []string `json:"mentioned_dids"`
	MentionAll    bool     `json:"mention_all"`
	SentAt        int64    `json:"sent_at"`
	Deleted       bool     `json:"deleted"`
}

// ==================== Handlers ====================

func (s *groupChatSubServer) handleCreate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logID := serverwrapper.GetLogID(ctx)

	var req createGroupReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		logger.Errorf(ctx, "[%s] Invalid create group request: err=%v", logID, err)
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	ownerDID := subject.ID

	group, err := s.groupService.CreateGroup(ctx, ownerDID, req.Name, req.Description, req.Type, req.Visibility)
	if err != nil {
		logger.Errorf(ctx, "[%s] Failed to create group: %v", logID, err)
		http.Error(w, "failed to create group", http.StatusInternalServerError)
		return
	}

	// Add owner as the first member with OWNER role
	if err := s.memberService.AddMember(ctx, group.ULID, ownerDID, model.GroupRoleOwner, ""); err != nil {
		logger.Errorf(ctx, "[%s] Failed to add owner as member: %v", logID, err)
		http.Error(w, "failed to add owner as member", http.StatusInternalServerError)
		return
	}

	// Add initial members
	for _, memberDID := range req.InitialMemberDIDs {
		if memberDID != ownerDID {
			if err := s.memberService.AddMember(ctx, group.ULID, memberDID, model.GroupRoleMember, ownerDID); err != nil {
				logger.Warnf(ctx, "[%s] Failed to add member %s: %v", logID, memberDID, err)
			}
		}
	}

	// Reload group to get updated member_count
	group, err = s.groupService.GetGroup(ctx, group.ULID)
	if err != nil {
		logger.Errorf(ctx, "[%s] Failed to reload group: %v", logID, err)
		http.Error(w, "failed to reload group", http.StatusInternalServerError)
		return
	}

	logger.Infof(ctx, "[%s] Group created: ulid=%s, name=%s, owner=%s, members=%d", logID, group.ULID, group.Name, ownerDID, group.MemberCount)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"group": toGroupInfo(group),
	})
}

func (s *groupChatSubServer) handleList(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	actorDID := subject.ID

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit <= 0 {
		limit = 50
	}

	groups, total, err := s.groupService.ListGroupsByMember(ctx, actorDID, limit, offset)
	if err != nil {
		http.Error(w, "failed to list groups", http.StatusInternalServerError)
		return
	}

	result := make([]groupInfo, len(groups))
	for i, g := range groups {
		result[i] = toGroupInfo(&g)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"groups": result,
		"total":  total,
	})
}

func (s *groupChatSubServer) handleInfo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	actorDID := subject.ID

	groupULID := r.URL.Query().Get("group_ulid")
	if groupULID == "" {
		http.Error(w, "group_ulid required", http.StatusBadRequest)
		return
	}

	group, err := s.groupService.GetGroup(ctx, groupULID)
	if err != nil {
		http.Error(w, "group not found", http.StatusNotFound)
		return
	}

	member, _ := s.memberService.GetMember(ctx, groupULID, actorDID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"group":         toGroupInfo(group),
		"my_membership": toMemberInfo(member),
	})
}

func (s *groupChatSubServer) handleUpdate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logID := serverwrapper.GetLogID(ctx)

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	actorDID := subject.ID

	var req struct {
		GroupULID   string  `json:"group_ulid"`
		Name        *string `json:"name"`
		Description *string `json:"description"`
		AvatarCID   *string `json:"avatar_cid"`
		Type        *int    `json:"type"`
		Visibility  *int    `json:"visibility"`
		Muted       *bool   `json:"muted"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.GroupULID == "" {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	// Check permission (must be admin or owner)
	member, err := s.memberService.GetMember(ctx, req.GroupULID, actorDID)
	if err != nil || (member.Role != model.GroupRoleOwner && member.Role != model.GroupRoleAdmin) {
		http.Error(w, "permission denied", http.StatusForbidden)
		return
	}

	group, err := s.groupService.UpdateGroup(ctx, req.GroupULID, req.Name, req.Description, req.AvatarCID, req.Type, req.Visibility, req.Muted)
	if err != nil {
		logger.Errorf(ctx, "[%s] Failed to update group: %v", logID, err)
		http.Error(w, "failed to update group", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"group": toGroupInfo(group),
	})
}

func (s *groupChatSubServer) handleInvite(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logID := serverwrapper.GetLogID(ctx)

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	inviterDID := subject.ID

	var req struct {
		GroupULID   string   `json:"group_ulid"`
		InviteeDIDs []string `json:"invitee_dids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.GroupULID == "" || len(req.InviteeDIDs) == 0 {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	// Check if inviter is a member
	_, err := s.memberService.GetMember(ctx, req.GroupULID, inviterDID)
	if err != nil {
		http.Error(w, "not a member", http.StatusForbidden)
		return
	}

	invitations := make([]map[string]interface{}, 0)
	for _, inviteeDID := range req.InviteeDIDs {
		inv, err := s.groupService.CreateInvitation(ctx, req.GroupULID, inviterDID, inviteeDID)
		if err != nil {
			logger.Warnf(ctx, "[%s] Failed to create invitation for %s: %v", logID, inviteeDID, err)
			continue
		}
		invitations = append(invitations, map[string]interface{}{
			"ulid":        inv.ULID,
			"group_ulid":  inv.GroupULID,
			"inviter_did": inv.InviterDID,
			"invitee_did": inv.InviteeDID,
			"status":      inv.Status,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"invitations": invitations,
	})
}

func (s *groupChatSubServer) handleJoin(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logID := serverwrapper.GetLogID(ctx)

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	actorDID := subject.ID

	var req struct {
		GroupULID      string `json:"group_ulid"`
		InvitationULID string `json:"invitation_ulid"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.GroupULID == "" {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	// Check group visibility or invitation
	group, err := s.groupService.GetGroup(ctx, req.GroupULID)
	if err != nil {
		http.Error(w, "group not found", http.StatusNotFound)
		return
	}

	if group.Visibility == model.GroupVisibilityPrivate && req.InvitationULID == "" {
		http.Error(w, "invitation required for private group", http.StatusForbidden)
		return
	}

	// If invitation provided, validate it
	if req.InvitationULID != "" {
		if err := s.groupService.AcceptInvitation(ctx, req.InvitationULID, actorDID); err != nil {
			logger.Errorf(ctx, "[%s] Failed to accept invitation: %v", logID, err)
			http.Error(w, "invalid invitation", http.StatusBadRequest)
			return
		}
	}

	// Add member
	if err := s.memberService.AddMember(ctx, req.GroupULID, actorDID, model.GroupRoleMember, ""); err != nil {
		logger.Errorf(ctx, "[%s] Failed to add member: %v", logID, err)
		http.Error(w, "failed to join group", http.StatusInternalServerError)
		return
	}

	member, _ := s.memberService.GetMember(ctx, req.GroupULID, actorDID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"membership": toMemberInfo(member),
	})
}

func (s *groupChatSubServer) handleLeave(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logID := serverwrapper.GetLogID(ctx)

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	actorDID := subject.ID

	var req struct {
		GroupULID string `json:"group_ulid"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.GroupULID == "" {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	// Check if owner (owner cannot leave)
	member, err := s.memberService.GetMember(ctx, req.GroupULID, actorDID)
	if err != nil {
		http.Error(w, "not a member", http.StatusBadRequest)
		return
	}
	if member.Role == model.GroupRoleOwner {
		http.Error(w, "owner cannot leave group, transfer ownership first", http.StatusForbidden)
		return
	}

	if err := s.memberService.RemoveMember(ctx, req.GroupULID, actorDID); err != nil {
		logger.Errorf(ctx, "[%s] Failed to leave group: %v", logID, err)
		http.Error(w, "failed to leave group", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func (s *groupChatSubServer) handleMembers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	actorDID := subject.ID

	groupULID := r.URL.Query().Get("group_ulid")
	if groupULID == "" {
		http.Error(w, "group_ulid required", http.StatusBadRequest)
		return
	}

	// Check if requester is a member
	_, err := s.memberService.GetMember(ctx, groupULID, actorDID)
	if err != nil {
		http.Error(w, "not a member", http.StatusForbidden)
		return
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit <= 0 {
		limit = 100
	}

	members, total, err := s.memberService.ListMembers(ctx, groupULID, limit, offset)
	if err != nil {
		http.Error(w, "failed to list members", http.StatusInternalServerError)
		return
	}

	// Collect all actor DIDs for batch lookup
	ptids := make([]string, len(members))
	for i, m := range members {
		ptids[i] = m.ActorDID
	}

	// Batch fetch actor info
	actorMap, err := actor.GetActorsByPTIDs(ctx, ptids)
	if err != nil {
		logger.Warnf(ctx, "Failed to batch fetch actor info: %v", err)
		actorMap = make(map[string]*dbmodel.Actor) // Continue with empty map
	}

	result := make([]memberInfo, len(members))
	for i, m := range members {
		result[i] = toMemberInfoWithActor(&m, actorMap[m.ActorDID])
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"members": result,
		"total":   total,
	})
}

func (s *groupChatSubServer) handleRemoveMember(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logID := serverwrapper.GetLogID(ctx)

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	actorDID := subject.ID

	var req struct {
		GroupULID string `json:"group_ulid"`
		ActorDID  string `json:"actor_did"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.GroupULID == "" || req.ActorDID == "" {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	// Check permission (must be admin or owner)
	member, err := s.memberService.GetMember(ctx, req.GroupULID, actorDID)
	if err != nil || (member.Role != model.GroupRoleOwner && member.Role != model.GroupRoleAdmin) {
		http.Error(w, "permission denied", http.StatusForbidden)
		return
	}

	// Cannot remove owner
	target, err := s.memberService.GetMember(ctx, req.GroupULID, req.ActorDID)
	if err != nil {
		http.Error(w, "member not found", http.StatusNotFound)
		return
	}
	if target.Role == model.GroupRoleOwner {
		http.Error(w, "cannot remove owner", http.StatusForbidden)
		return
	}

	if err := s.memberService.RemoveMember(ctx, req.GroupULID, req.ActorDID); err != nil {
		logger.Errorf(ctx, "[%s] Failed to remove member: %v", logID, err)
		http.Error(w, "failed to remove member", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func (s *groupChatSubServer) handleSendMessage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logID := serverwrapper.GetLogID(ctx)

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	senderDID := subject.ID

	var req struct {
		GroupULID    string   `json:"group_ulid"`
		Type         int      `json:"type"`
		Content      string   `json:"content"`
		ReplyToULID  string   `json:"reply_to_ulid"`
		MentionedDIDs []string `json:"mentioned_dids"`
		MentionAll   bool     `json:"mention_all"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.GroupULID == "" || req.Content == "" {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	// Check if sender is a member
	member, err := s.memberService.GetMember(ctx, req.GroupULID, senderDID)
	if err != nil {
		http.Error(w, "not a member", http.StatusForbidden)
		return
	}

	// Check if muted
	if member.Muted {
		http.Error(w, "you are muted", http.StatusForbidden)
		return
	}

	// Check group mute status
	group, err := s.groupService.GetGroup(ctx, req.GroupULID)
	if err != nil {
		http.Error(w, "group not found", http.StatusNotFound)
		return
	}
	if group.Muted && member.Role == model.GroupRoleMember {
		http.Error(w, "group is muted", http.StatusForbidden)
		return
	}

	msg, err := s.messageService.SendMessage(ctx, req.GroupULID, senderDID, req.Type, req.Content, req.ReplyToULID, req.MentionedDIDs, req.MentionAll)
	if err != nil {
		logger.Errorf(ctx, "[%s] Failed to send message: %v", logID, err)
		http.Error(w, "failed to send message", http.StatusInternalServerError)
		return
	}

	// Create offline messages and push real-time events to all other members
	go func() {
		members, _, err := s.memberService.ListMembers(ctx, req.GroupULID, 1000, 0)
		if err != nil {
			logger.Warnf(ctx, "[%s] Failed to list members for offline messages: %v", logID, err)
			return
		}

		var receiverDIDs []string
		for _, m := range members {
			if m.ActorDID != senderDID {
				receiverDIDs = append(receiverDIDs, m.ActorDID)
			}
		}

		if len(receiverDIDs) > 0 {
			// Store offline messages for catch-up
			if err := s.messageService.CreateOfflineMessages(ctx, req.GroupULID, msg.ULID, receiverDIDs); err != nil {
				logger.Warnf(ctx, "[%s] Failed to create offline messages: %v", logID, err)
			} else {
				logger.Debugf(ctx, "[%s] Created offline messages for %d receivers", logID, len(receiverDIDs))
			}
			
			// Push real-time events via SSE to online members
			es := event.GetGlobalEventSystem()
			if es != nil {
				for _, receiverDID := range receiverDIDs {
					payload := event.ChatMessagePayload{
						ConvID:    req.GroupULID,
						MessageID: msg.ULID,
						SenderID:  senderDID,
						Content:   req.Content,
						MsgType:   "group",
						Timestamp: msg.SentAt.UnixMilli(),
					}
					if err := es.Router.PublishEvent(
						ctx,
						event.EventChatMessageAppended,
						senderDID,
						receiverDID,
						msg.ULID,
						event.ScopeActor,
						payload,
					); err != nil {
						logger.Warnf(ctx, "[%s] Failed to publish event to %s: %v", logID, receiverDID, err)
					}
				}
				logger.Debugf(ctx, "[%s] Published SSE events to %d receivers", logID, len(receiverDIDs))
			}
		}
	}()

	logger.Infof(ctx, "[%s] Group message sent: ulid=%s, group=%s, sender=%s", logID, msg.ULID, req.GroupULID, senderDID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": toMessageInfo(msg),
	})
}

func (s *groupChatSubServer) handleGetMessages(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	actorDID := subject.ID

	groupULID := r.URL.Query().Get("group_ulid")
	if groupULID == "" {
		http.Error(w, "group_ulid required", http.StatusBadRequest)
		return
	}

	// Check if requester is a member
	_, err := s.memberService.GetMember(ctx, groupULID, actorDID)
	if err != nil {
		http.Error(w, "not a member", http.StatusForbidden)
		return
	}

	beforeULID := r.URL.Query().Get("before_ulid")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 50
	}

	messages, hasMore, err := s.messageService.GetMessages(ctx, groupULID, beforeULID, limit)
	if err != nil {
		http.Error(w, "failed to get messages", http.StatusInternalServerError)
		return
	}

	result := make([]messageInfo, len(messages))
	for i, m := range messages {
		result[i] = toMessageInfo(&m)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"messages": result,
		"has_more": hasMore,
	})
}

func (s *groupChatSubServer) handleStats(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "running",
	})
}

// ==================== Helper functions ====================

func toGroupInfo(g *model.Group) groupInfo {
	if g == nil {
		return groupInfo{}
	}
	return groupInfo{
		ULID:        g.ULID,
		Name:        g.Name,
		Description: g.Description,
		AvatarCID:   g.AvatarCID,
		OwnerDID:    g.OwnerDID,
		Type:        g.Type,
		Visibility:  g.Visibility,
		MemberCount: g.MemberCount,
		MaxMembers:  g.MaxMembers,
		Muted:       g.Muted,
		CreatedAt:   g.CreatedAt.Unix(),
		UpdatedAt:   g.UpdatedAt.Unix(),
	}
}

func toMemberInfo(m *model.GroupMember) memberInfo {
	if m == nil {
		return memberInfo{}
	}
	return memberInfo{
		GroupULID:  m.GroupULID,
		ActorDID:   m.ActorDID,
		Role:       m.Role,
		Nickname:   m.Nickname,
		Muted:      m.Muted,
		MutedUntil: m.MutedUntil.Unix(),
		JoinedAt:   m.JoinedAt.Unix(),
		InvitedBy:  m.InvitedBy,
	}
}

func toMemberInfoWithActor(m *model.GroupMember, a *dbmodel.Actor) memberInfo {
	if m == nil {
		return memberInfo{}
	}
	info := memberInfo{
		GroupULID:  m.GroupULID,
		ActorDID:   m.ActorDID,
		Role:       m.Role,
		Nickname:   m.Nickname,
		Muted:      m.Muted,
		MutedUntil: m.MutedUntil.Unix(),
		JoinedAt:   m.JoinedAt.Unix(),
		InvitedBy:  m.InvitedBy,
	}
	if a != nil {
		info.DisplayName = a.Name
		info.Username = a.PreferredUsername
		info.AvatarURL = a.Icon
	}
	return info
}

func toMessageInfo(m *model.GroupMessage) messageInfo {
	if m == nil {
		return messageInfo{}
	}
	return messageInfo{
		ULID:          m.ULID,
		GroupULID:     m.GroupULID,
		SenderDID:     m.SenderDID,
		Type:          m.Type,
		Content:       m.Content,
		ReplyToULID:   m.ReplyToULID,
		MentionedDIDs: m.MentionedDIDs,
		MentionAll:    m.MentionAll,
		SentAt:        m.SentAt.Unix(),
		Deleted:       m.Deleted,
	}
}

// ==================== Offline Messages Handlers ====================

func (s *groupChatSubServer) handleGetOfflineMessages(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	actorDID := subject.ID

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 100
	}

	offlineMessages, err := s.messageService.GetOfflineMessages(ctx, actorDID, limit)
	if err != nil {
		http.Error(w, "failed to get offline messages", http.StatusInternalServerError)
		return
	}

	// Group by group_ulid and fetch actual messages
	type offlineInfo struct {
		ULID        string `json:"ulid"`
		GroupULID   string `json:"group_ulid"`
		MessageULID string `json:"message_ulid"`
		CreatedAt   int64  `json:"created_at"`
	}

	result := make([]offlineInfo, len(offlineMessages))
	for i, om := range offlineMessages {
		result[i] = offlineInfo{
			ULID:        om.ULID,
			GroupULID:   om.GroupULID,
			MessageULID: om.MessageULID,
			CreatedAt:   om.CreatedAt.Unix(),
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"offline_messages": result,
	})
}

func (s *groupChatSubServer) handleAckOfflineMessages(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logID := serverwrapper.GetLogID(ctx)

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		OfflineMessageULIDs []string `json:"offline_message_ulids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.OfflineMessageULIDs) == 0 {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	acked := 0
	for _, ulid := range req.OfflineMessageULIDs {
		if err := s.messageService.MarkOfflineMessageDelivered(ctx, ulid); err != nil {
			logger.Warnf(ctx, "[%s] Failed to ack offline message %s: %v", logID, ulid, err)
		} else {
			acked++
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"acked": acked,
	})
}

func (s *groupChatSubServer) handleGetUnreadCount(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	actorDID := subject.ID

	groupULID := r.URL.Query().Get("group_ulid")

	count, err := s.messageService.GetUndeliveredCount(ctx, actorDID, groupULID)
	if err != nil {
		http.Error(w, "failed to get unread count", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"unread_count": count,
		"group_ulid":   groupULID,
	})
}

// handleMarkGroupRead marks all offline messages in a group as read for the current user
func (s *groupChatSubServer) handleMarkGroupRead(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logID := serverwrapper.GetLogID(ctx)

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	actorDID := subject.ID

	var req struct {
		GroupULID string `json:"group_ulid"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.GroupULID == "" {
		http.Error(w, "invalid request: group_ulid required", http.StatusBadRequest)
		return
	}

	// Mark all offline messages for this group as delivered
	count, err := s.messageService.MarkGroupOfflineMessagesDelivered(ctx, actorDID, req.GroupULID)
	if err != nil {
		logger.Warnf(ctx, "[%s] Failed to mark group %s as read: %v", logID, req.GroupULID, err)
		http.Error(w, "failed to mark as read", http.StatusInternalServerError)
		return
	}

	logger.Infof(ctx, "[%s] Marked %d messages as read for group %s by user %s", logID, count, req.GroupULID, actorDID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"marked_count": count,
		"group_ulid":   req.GroupULID,
	})
}

// ==================== Message Recall/Delete Handlers ====================

func (s *groupChatSubServer) handleRecallMessage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logID := serverwrapper.GetLogID(ctx)

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	actorDID := subject.ID

	var req struct {
		GroupULID   string `json:"group_ulid"`
		MessageULID string `json:"message_ulid"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.GroupULID == "" || req.MessageULID == "" {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	// Get message to check ownership and time
	msg, err := s.messageService.GetMessage(ctx, req.MessageULID)
	if err != nil {
		http.Error(w, "message not found", http.StatusNotFound)
		return
	}

	// Check if sender
	if msg.SenderDID != actorDID {
		// Check if admin/owner can recall any message
		member, err := s.memberService.GetMember(ctx, req.GroupULID, actorDID)
		if err != nil || (member.Role != model.GroupRoleOwner && member.Role != model.GroupRoleAdmin) {
			http.Error(w, "permission denied", http.StatusForbidden)
			return
		}
	} else {
		// Check recall time limit (2 minutes for regular users)
		// elapsed := time.Since(msg.SentAt)
		// if elapsed > 2*time.Minute {
		// 	http.Error(w, "message too old to recall", http.StatusBadRequest)
		// 	return
		// }
	}

	if err := s.messageService.RecallMessage(ctx, req.MessageULID); err != nil {
		logger.Errorf(ctx, "[%s] Failed to recall message: %v", logID, err)
		http.Error(w, "failed to recall message", http.StatusInternalServerError)
		return
	}

	logger.Infof(ctx, "[%s] Message recalled: ulid=%s, by=%s", logID, req.MessageULID, actorDID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func (s *groupChatSubServer) handleDeleteMessage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logID := serverwrapper.GetLogID(ctx)

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	actorDID := subject.ID

	var req struct {
		GroupULID   string `json:"group_ulid"`
		MessageULID string `json:"message_ulid"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.GroupULID == "" || req.MessageULID == "" {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	// Check permission (must be admin/owner)
	member, err := s.memberService.GetMember(ctx, req.GroupULID, actorDID)
	if err != nil || (member.Role != model.GroupRoleOwner && member.Role != model.GroupRoleAdmin) {
		http.Error(w, "permission denied", http.StatusForbidden)
		return
	}

	if err := s.messageService.DeleteMessage(ctx, req.MessageULID); err != nil {
		logger.Errorf(ctx, "[%s] Failed to delete message: %v", logID, err)
		http.Error(w, "failed to delete message", http.StatusInternalServerError)
		return
	}

	logger.Infof(ctx, "[%s] Message deleted: ulid=%s, by=%s", logID, req.MessageULID, actorDID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

func (s *groupChatSubServer) handleSearchMessages(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	actorDID := subject.ID

	groupULID := r.URL.Query().Get("group_ulid")
	query := r.URL.Query().Get("query")
	if groupULID == "" || query == "" {
		http.Error(w, "group_ulid and query required", http.StatusBadRequest)
		return
	}

	// Check if requester is a member
	_, err := s.memberService.GetMember(ctx, groupULID, actorDID)
	if err != nil {
		http.Error(w, "not a member", http.StatusForbidden)
		return
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 50
	}

	messages, hasMore, err := s.messageService.SearchMessages(ctx, groupULID, query, limit)
	if err != nil {
		http.Error(w, "failed to search messages", http.StatusInternalServerError)
		return
	}

	result := make([]messageInfo, len(messages))
	for i, m := range messages {
		result[i] = toMessageInfo(&m)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"messages": result,
		"has_more": hasMore,
	})
}

// ==================== Member Settings Handlers ====================

func (s *groupChatSubServer) handleUpdateMyNickname(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logID := serverwrapper.GetLogID(ctx)

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	actorDID := subject.ID

	var req struct {
		GroupULID string `json:"group_ulid"`
		Nickname  string `json:"nickname"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.GroupULID == "" {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	// Check if member
	_, err := s.memberService.GetMember(ctx, req.GroupULID, actorDID)
	if err != nil {
		http.Error(w, "not a member", http.StatusForbidden)
		return
	}

	if err := s.memberService.UpdateNickname(ctx, req.GroupULID, actorDID, req.Nickname); err != nil {
		logger.Errorf(ctx, "[%s] Failed to update nickname: %v", logID, err)
		http.Error(w, "failed to update nickname", http.StatusInternalServerError)
		return
	}

	member, _ := s.memberService.GetMember(ctx, req.GroupULID, actorDID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"member": toMemberInfo(member),
	})
}

func (s *groupChatSubServer) handleGetMySettings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	actorDID := subject.ID

	groupULID := r.URL.Query().Get("group_ulid")
	if groupULID == "" {
		http.Error(w, "group_ulid required", http.StatusBadRequest)
		return
	}

	member, err := s.memberService.GetMember(ctx, groupULID, actorDID)
	if err != nil {
		http.Error(w, "not a member", http.StatusForbidden)
		return
	}

	// Get user's personal settings for this group (stored in member or separate table)
	// For now, return member info with settings fields
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"group_ulid":  groupULID,
		"is_muted":    false, // TODO: store in member_settings table
		"is_pinned":   false, // TODO: store in member_settings table
		"my_nickname": member.Nickname,
	})
}

func (s *groupChatSubServer) handleUpdateMySettings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logID := serverwrapper.GetLogID(ctx)

	subject := httpadapter.GetSubject(r)
	if subject == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	actorDID := subject.ID

	var req struct {
		GroupULID string `json:"group_ulid"`
		IsMuted   *bool  `json:"is_muted"`
		IsPinned  *bool  `json:"is_pinned"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.GroupULID == "" {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	// Check if member
	_, err := s.memberService.GetMember(ctx, req.GroupULID, actorDID)
	if err != nil {
		http.Error(w, "not a member", http.StatusForbidden)
		return
	}

	// TODO: Store settings in member_settings table
	// For now, just log and return success
	logger.Infof(ctx, "[%s] Update my settings: group=%s, actor=%s, muted=%v, pinned=%v",
		logID, req.GroupULID, actorDID, req.IsMuted, req.IsPinned)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}
