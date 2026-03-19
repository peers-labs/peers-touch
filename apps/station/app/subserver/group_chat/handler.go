package group_chat

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/group_chat/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/event"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *groupChatSubServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()
	jwtWrapper := s.jwtWrapper
	return []server.Handler{
		server.NewTypedHandler("gc-create", "/group-chat/create", server.POST, s.handleCreate, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("gc-list", "/group-chat/list", server.GET, s.handleList, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("gc-info", "/group-chat/info", server.GET, s.handleInfo, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("gc-update", "/group-chat/update", server.PUT, s.handleUpdate, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("gc-invite", "/group-chat/invite", server.POST, s.handleInvite, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("gc-join", "/group-chat/join", server.POST, s.handleJoin, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("gc-leave", "/group-chat/leave", server.POST, s.handleLeave, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("gc-members", "/group-chat/members", server.GET, s.handleMembers, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("gc-remove-member", "/group-chat/member/remove", server.POST, s.handleRemoveMember, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("gc-message-send", "/group-chat/message/send", server.POST, s.handleSendMessage, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("gc-messages", "/group-chat/messages", server.GET, s.handleGetMessages, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("gc-message-recall", "/group-chat/message/recall", server.POST, s.handleRecallMessage, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("gc-message-delete", "/group-chat/message/delete", server.POST, s.handleDeleteMessage, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("gc-message-search", "/group-chat/messages/search", server.GET, s.handleSearchMessages, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("gc-update-nickname", "/group-chat/member/nickname", server.PUT, s.handleUpdateMyNickname, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("gc-my-settings", "/group-chat/my-settings", server.GET, s.handleGetMySettings, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("gc-update-my-settings", "/group-chat/my-settings", server.PUT, s.handleUpdateMySettings, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("gc-offline-messages", "/group-chat/offline-messages", server.GET, s.handleGetOfflineMessages, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("gc-offline-ack", "/group-chat/offline-messages/ack", server.POST, s.handleAckOfflineMessages, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("gc-unread-count", "/group-chat/unread-count", server.GET, s.handleGetUnreadCount, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("gc-mark-read", "/group-chat/mark-read", server.POST, s.handleMarkGroupRead, logIDWrapper, jwtWrapper),

		server.NewTypedHandler("gc-stats", "/group-chat/stats", server.GET, s.handleStats),
	}
}

func (s *groupChatSubServer) handleCreate(ctx context.Context, req *chat.CreateGroupRequest) (*chat.CreateGroupResponse, error) {
	logID := serverwrapper.GetLogID(ctx)

	if req.Name == "" {
		return nil, server.BadRequest("name is required")
	}

	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	ownerDID := subject.ID

	group, err := s.groupService.CreateGroup(ctx, ownerDID, req.Name, req.Description, int(req.Type), int(req.Visibility))
	if err != nil {
		logger.Errorf(ctx, "[%s] Failed to create group: %v", logID, err)
		return nil, server.InternalErrorWithCause("failed to create group", err)
	}

	if addErr := s.memberService.AddMember(ctx, group.ULID, ownerDID, model.GroupRoleOwner, ""); addErr != nil {
		logger.Errorf(ctx, "[%s] Failed to add owner as member: %v", logID, addErr)
		return nil, server.InternalErrorWithCause("failed to add owner as member", addErr)
	}

	for _, memberDID := range req.InitialMemberDids {
		if memberDID != ownerDID {
			if addErr := s.memberService.AddMember(ctx, group.ULID, memberDID, model.GroupRoleMember, ownerDID); addErr != nil {
				logger.Warnf(ctx, "[%s] Failed to add member %s: %v", logID, memberDID, addErr)
			}
		}
	}

	group, err = s.groupService.GetGroup(ctx, group.ULID)
	if err != nil {
		logger.Errorf(ctx, "[%s] Failed to reload group: %v", logID, err)
		return nil, server.InternalErrorWithCause("failed to reload group", err)
	}

	logger.Infof(ctx, "[%s] Group created: ulid=%s, name=%s, owner=%s, members=%d", logID, group.ULID, group.Name, ownerDID, group.MemberCount)

	return &chat.CreateGroupResponse{
		Group: toProtoGroup(group),
	}, nil
}

func (s *groupChatSubServer) handleList(ctx context.Context, req *chat.ListGroupsRequest) (*chat.ListGroupsResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorDID := subject.ID

	limit := int(req.Limit)
	offset := int(req.Offset)
	if limit <= 0 {
		limit = 50
	}

	groups, total, err := s.groupService.ListGroupsByMember(ctx, actorDID, limit, offset)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to list groups", err)
	}

	protoGroups := make([]*chat.Group, len(groups))
	for i, g := range groups {
		protoGroups[i] = toProtoGroup(&g)
	}

	return &chat.ListGroupsResponse{
		Groups: protoGroups,
		Total:  int32(total),
	}, nil
}

func (s *groupChatSubServer) handleInfo(ctx context.Context, req *chat.GetGroupRequest) (*chat.GetGroupResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorDID := subject.ID

	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}

	group, err := s.groupService.GetGroup(ctx, req.GroupUlid)
	if err != nil {
		return nil, server.NotFound("group not found")
	}

	member, _ := s.memberService.GetMember(ctx, req.GroupUlid, actorDID)

	return &chat.GetGroupResponse{
		Group:        toProtoGroup(group),
		MyMembership: toProtoGroupMember(member),
	}, nil
}

func (s *groupChatSubServer) handleUpdate(ctx context.Context, req *chat.UpdateGroupRequest) (*chat.UpdateGroupResponse, error) {
	logID := serverwrapper.GetLogID(ctx)

	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorDID := subject.ID

	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}

	member, err := s.memberService.GetMember(ctx, req.GroupUlid, actorDID)
	if err != nil || (member.Role != model.GroupRoleOwner && member.Role != model.GroupRoleAdmin) {
		return nil, server.Forbidden("permission denied")
	}

	var name, description, avatarCID *string
	var groupType, visibility *int
	var muted *bool

	if req.Name != nil {
		name = req.Name
	}
	if req.Description != nil {
		description = req.Description
	}
	if req.AvatarCid != nil {
		avatarCID = req.AvatarCid
	}
	if req.Type != nil {
		t := int(*req.Type)
		groupType = &t
	}
	if req.Visibility != nil {
		v := int(*req.Visibility)
		visibility = &v
	}
	if req.Muted != nil {
		muted = req.Muted
	}

	group, err := s.groupService.UpdateGroup(ctx, req.GroupUlid, name, description, avatarCID, groupType, visibility, muted)
	if err != nil {
		logger.Errorf(ctx, "[%s] Failed to update group: %v", logID, err)
		return nil, server.InternalErrorWithCause("failed to update group", err)
	}

	return &chat.UpdateGroupResponse{
		Group: toProtoGroup(group),
	}, nil
}

func (s *groupChatSubServer) handleInvite(ctx context.Context, req *chat.InviteToGroupRequest) (*chat.InviteToGroupResponse, error) {
	logID := serverwrapper.GetLogID(ctx)

	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	inviterDID := subject.ID

	if req.GroupUlid == "" || len(req.InviteeDids) == 0 {
		return nil, server.BadRequest("group_ulid and invitee_dids are required")
	}

	_, err := s.memberService.GetMember(ctx, req.GroupUlid, inviterDID)
	if err != nil {
		return nil, server.Forbidden("not a member")
	}

	invitations := make([]*chat.GroupInvitation, 0)
	for _, inviteeDID := range req.InviteeDids {
		inv, err := s.groupService.CreateInvitation(ctx, req.GroupUlid, inviterDID, inviteeDID)
		if err != nil {
			logger.Warnf(ctx, "[%s] Failed to create invitation for %s: %v", logID, inviteeDID, err)
			continue
		}
		invitations = append(invitations, toProtoGroupInvitation(inv))
	}

	return &chat.InviteToGroupResponse{
		Invitations: invitations,
	}, nil
}

func (s *groupChatSubServer) handleJoin(ctx context.Context, req *chat.JoinGroupRequest) (*chat.JoinGroupResponse, error) {
	logID := serverwrapper.GetLogID(ctx)

	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorDID := subject.ID

	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}

	group, err := s.groupService.GetGroup(ctx, req.GroupUlid)
	if err != nil {
		return nil, server.NotFound("group not found")
	}

	if group.Visibility == model.GroupVisibilityPrivate && req.InvitationUlid == "" {
		return nil, server.Forbidden("invitation required for private group")
	}

	if req.InvitationUlid != "" {
		if err := s.groupService.AcceptInvitation(ctx, req.InvitationUlid, actorDID); err != nil {
			logger.Errorf(ctx, "[%s] Failed to accept invitation: %v", logID, err)
			return nil, server.BadRequest("invalid invitation")
		}
	}

	if err := s.memberService.AddMember(ctx, req.GroupUlid, actorDID, model.GroupRoleMember, ""); err != nil {
		logger.Errorf(ctx, "[%s] Failed to add member: %v", logID, err)
		return nil, server.InternalErrorWithCause("failed to join group", err)
	}

	member, _ := s.memberService.GetMember(ctx, req.GroupUlid, actorDID)

	return &chat.JoinGroupResponse{
		Membership: toProtoGroupMember(member),
	}, nil
}

func (s *groupChatSubServer) handleLeave(ctx context.Context, req *chat.LeaveGroupRequest) (*chat.LeaveGroupResponse, error) {
	logID := serverwrapper.GetLogID(ctx)

	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorDID := subject.ID

	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}

	member, err := s.memberService.GetMember(ctx, req.GroupUlid, actorDID)
	if err != nil {
		return nil, server.BadRequest("not a member")
	}
	if member.Role == model.GroupRoleOwner {
		return nil, server.Forbidden("owner cannot leave group, transfer ownership first")
	}

	if err := s.memberService.RemoveMember(ctx, req.GroupUlid, actorDID); err != nil {
		logger.Errorf(ctx, "[%s] Failed to leave group: %v", logID, err)
		return nil, server.InternalErrorWithCause("failed to leave group", err)
	}

	return &chat.LeaveGroupResponse{
		Success: true,
	}, nil
}

func (s *groupChatSubServer) handleMembers(ctx context.Context, req *chat.GetGroupMembersRequest) (*chat.GetGroupMembersResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorDID := subject.ID

	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}

	_, err := s.memberService.GetMember(ctx, req.GroupUlid, actorDID)
	if err != nil {
		return nil, server.Forbidden("not a member")
	}

	limit := int(req.Limit)
	offset := int(req.Offset)
	if limit <= 0 {
		limit = 100
	}

	members, total, err := s.memberService.ListMembers(ctx, req.GroupUlid, limit, offset)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to list members", err)
	}

	ptids := make([]string, len(members))
	for i, m := range members {
		ptids[i] = m.ActorDID
	}

	actorMap, err := actor.GetActorsByPTIDs(ctx, ptids)
	if err != nil {
		logger.Warnf(ctx, "Failed to batch fetch actor info: %v", err)
		actorMap = make(map[string]*dbmodel.Actor)
	}

	protoMembers := make([]*chat.GroupMember, len(members))
	for i, m := range members {
		protoMembers[i] = toProtoGroupMemberWithActor(&m, actorMap[m.ActorDID])
	}

	return &chat.GetGroupMembersResponse{
		Members: protoMembers,
		Total:   int32(total),
	}, nil
}

func (s *groupChatSubServer) handleRemoveMember(ctx context.Context, req *chat.RemoveMemberRequest) (*chat.RemoveMemberResponse, error) {
	logID := serverwrapper.GetLogID(ctx)

	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorDID := subject.ID

	if req.GroupUlid == "" || req.ActorDid == "" {
		return nil, server.BadRequest("group_ulid and actor_did are required")
	}

	member, err := s.memberService.GetMember(ctx, req.GroupUlid, actorDID)
	if err != nil || (member.Role != model.GroupRoleOwner && member.Role != model.GroupRoleAdmin) {
		return nil, server.Forbidden("permission denied")
	}

	target, err := s.memberService.GetMember(ctx, req.GroupUlid, req.ActorDid)
	if err != nil {
		return nil, server.NotFound("member not found")
	}
	if target.Role == model.GroupRoleOwner {
		return nil, server.Forbidden("cannot remove owner")
	}

	if err := s.memberService.RemoveMember(ctx, req.GroupUlid, req.ActorDid); err != nil {
		logger.Errorf(ctx, "[%s] Failed to remove member: %v", logID, err)
		return nil, server.InternalErrorWithCause("failed to remove member", err)
	}

	return &chat.RemoveMemberResponse{
		Success: true,
	}, nil
}

func (s *groupChatSubServer) handleSendMessage(ctx context.Context, req *chat.SendGroupMessageRequest) (*chat.SendGroupMessageResponse, error) {
	logID := serverwrapper.GetLogID(ctx)

	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	senderDID := subject.ID

	if req.GroupUlid == "" || req.Content == "" {
		return nil, server.BadRequest("group_ulid and content are required")
	}

	member, err := s.memberService.GetMember(ctx, req.GroupUlid, senderDID)
	if err != nil {
		return nil, server.Forbidden("not a member")
	}

	if member.Muted {
		return nil, server.Forbidden("you are muted")
	}

	group, err := s.groupService.GetGroup(ctx, req.GroupUlid)
	if err != nil {
		return nil, server.NotFound("group not found")
	}
	if group.Muted && member.Role == model.GroupRoleMember {
		return nil, server.Forbidden("group is muted")
	}

	msg, err := s.messageService.SendMessage(ctx, req.GroupUlid, senderDID, int(req.Type), req.Content, req.ReplyToUlid, req.MentionedDids, req.MentionAll)
	if err != nil {
		logger.Errorf(ctx, "[%s] Failed to send message: %v", logID, err)
		return nil, server.InternalErrorWithCause("failed to send message", err)
	}

	go func() {
		members, _, err := s.memberService.ListMembers(ctx, req.GroupUlid, 1000, 0)
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
			if err := s.messageService.CreateOfflineMessages(ctx, req.GroupUlid, msg.ULID, receiverDIDs); err != nil {
				logger.Warnf(ctx, "[%s] Failed to create offline messages: %v", logID, err)
			} else {
				logger.Debugf(ctx, "[%s] Created offline messages for %d receivers", logID, len(receiverDIDs))
			}

			es := event.GetGlobalEventSystem()
			if es != nil {
				for _, receiverDID := range receiverDIDs {
					payload := event.ChatMessagePayload{
						ConvID:    req.GroupUlid,
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

	logger.Infof(ctx, "[%s] Group message sent: ulid=%s, group=%s, sender=%s", logID, msg.ULID, req.GroupUlid, senderDID)

	return &chat.SendGroupMessageResponse{
		Message: toProtoGroupMessage(msg),
	}, nil
}

func (s *groupChatSubServer) handleGetMessages(ctx context.Context, req *chat.GetGroupMessagesRequest) (*chat.GetGroupMessagesResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorDID := subject.ID

	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}

	_, err := s.memberService.GetMember(ctx, req.GroupUlid, actorDID)
	if err != nil {
		return nil, server.Forbidden("not a member")
	}

	limit := int(req.Limit)
	if limit <= 0 {
		limit = 50
	}

	messages, hasMore, err := s.messageService.GetMessages(ctx, req.GroupUlid, req.BeforeUlid, limit)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get messages", err)
	}

	protoMessages := make([]*chat.GroupMessage, len(messages))
	for i, m := range messages {
		protoMessages[i] = toProtoGroupMessage(&m)
	}

	return &chat.GetGroupMessagesResponse{
		Messages: protoMessages,
		HasMore:  hasMore,
	}, nil
}

func (s *groupChatSubServer) handleRecallMessage(ctx context.Context, req *chat.RecallGroupMessageRequest) (*chat.RecallGroupMessageResponse, error) {
	logID := serverwrapper.GetLogID(ctx)

	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorDID := subject.ID

	if req.GroupUlid == "" || req.MessageUlid == "" {
		return nil, server.BadRequest("group_ulid and message_ulid are required")
	}

	msg, err := s.messageService.GetMessage(ctx, req.MessageUlid)
	if err != nil {
		return nil, server.NotFound("message not found")
	}

	if msg.SenderDID != actorDID {
		member, err := s.memberService.GetMember(ctx, req.GroupUlid, actorDID)
		if err != nil || (member.Role != model.GroupRoleOwner && member.Role != model.GroupRoleAdmin) {
			return nil, server.Forbidden("permission denied")
		}
	}

	if err := s.messageService.RecallMessage(ctx, req.MessageUlid); err != nil {
		logger.Errorf(ctx, "[%s] Failed to recall message: %v", logID, err)
		return nil, server.InternalErrorWithCause("failed to recall message", err)
	}

	logger.Infof(ctx, "[%s] Message recalled: ulid=%s, by=%s", logID, req.MessageUlid, actorDID)

	return &chat.RecallGroupMessageResponse{
		Success: true,
	}, nil
}

func (s *groupChatSubServer) handleDeleteMessage(ctx context.Context, req *chat.DeleteGroupMessageRequest) (*chat.DeleteGroupMessageResponse, error) {
	logID := serverwrapper.GetLogID(ctx)

	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorDID := subject.ID

	if req.GroupUlid == "" || req.MessageUlid == "" {
		return nil, server.BadRequest("group_ulid and message_ulid are required")
	}

	member, err := s.memberService.GetMember(ctx, req.GroupUlid, actorDID)
	if err != nil || (member.Role != model.GroupRoleOwner && member.Role != model.GroupRoleAdmin) {
		return nil, server.Forbidden("permission denied")
	}

	if err := s.messageService.DeleteMessage(ctx, req.MessageUlid); err != nil {
		logger.Errorf(ctx, "[%s] Failed to delete message: %v", logID, err)
		return nil, server.InternalErrorWithCause("failed to delete message", err)
	}

	logger.Infof(ctx, "[%s] Message deleted: ulid=%s, by=%s", logID, req.MessageUlid, actorDID)

	return &chat.DeleteGroupMessageResponse{
		Success: true,
	}, nil
}

func (s *groupChatSubServer) handleSearchMessages(ctx context.Context, req *chat.SearchGroupMessagesRequest) (*chat.SearchGroupMessagesResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorDID := subject.ID

	if req.GroupUlid == "" || req.Query == "" {
		return nil, server.BadRequest("group_ulid and query are required")
	}

	_, err := s.memberService.GetMember(ctx, req.GroupUlid, actorDID)
	if err != nil {
		return nil, server.Forbidden("not a member")
	}

	limit := int(req.Limit)
	if limit <= 0 {
		limit = 50
	}

	messages, hasMore, err := s.messageService.SearchMessages(ctx, req.GroupUlid, req.Query, limit)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to search messages", err)
	}

	protoMessages := make([]*chat.GroupMessage, len(messages))
	for i, m := range messages {
		protoMessages[i] = toProtoGroupMessage(&m)
	}

	return &chat.SearchGroupMessagesResponse{
		Messages: protoMessages,
		HasMore:  hasMore,
	}, nil
}

func (s *groupChatSubServer) handleUpdateMyNickname(ctx context.Context, req *chat.UpdateMyNicknameRequest) (*chat.UpdateMyNicknameResponse, error) {
	logID := serverwrapper.GetLogID(ctx)

	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorDID := subject.ID

	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}

	_, err := s.memberService.GetMember(ctx, req.GroupUlid, actorDID)
	if err != nil {
		return nil, server.Forbidden("not a member")
	}

	if err := s.memberService.UpdateNickname(ctx, req.GroupUlid, actorDID, req.Nickname); err != nil {
		logger.Errorf(ctx, "[%s] Failed to update nickname: %v", logID, err)
		return nil, server.InternalErrorWithCause("failed to update nickname", err)
	}

	member, _ := s.memberService.GetMember(ctx, req.GroupUlid, actorDID)

	return &chat.UpdateMyNicknameResponse{
		Member: toProtoGroupMember(member),
	}, nil
}

func (s *groupChatSubServer) handleGetMySettings(ctx context.Context, req *chat.GetGroupSettingsRequest) (*chat.GetGroupSettingsResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorDID := subject.ID

	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}

	member, err := s.memberService.GetMember(ctx, req.GroupUlid, actorDID)
	if err != nil {
		return nil, server.Forbidden("not a member")
	}

	return &chat.GetGroupSettingsResponse{
		IsMuted:            false,
		IsPinned:           false,
		MyNickname:         member.Nickname,
		ShowMemberNickname: false,
	}, nil
}

func (s *groupChatSubServer) handleUpdateMySettings(ctx context.Context, req *chat.UpdateGroupSettingsRequest) (*chat.UpdateGroupSettingsResponse, error) {
	logID := serverwrapper.GetLogID(ctx)

	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorDID := subject.ID

	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}

	_, err := s.memberService.GetMember(ctx, req.GroupUlid, actorDID)
	if err != nil {
		return nil, server.Forbidden("not a member")
	}

	logger.Infof(ctx, "[%s] Update my settings: group=%s, actor=%s, muted=%v, pinned=%v",
		logID, req.GroupUlid, actorDID, req.IsMuted, req.IsPinned)

	return &chat.UpdateGroupSettingsResponse{
		Success: true,
	}, nil
}

func (s *groupChatSubServer) handleGetOfflineMessages(ctx context.Context, req *chat.GetOfflineMessagesRequest) (*chat.GetOfflineMessagesResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorDID := subject.ID

	limit := int(req.Limit)
	if limit <= 0 {
		limit = 100
	}

	offlineMessages, err := s.messageService.GetOfflineMessages(ctx, actorDID, limit)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get offline messages", err)
	}

	protoMessages := make([]*chat.GroupOfflineMessage, len(offlineMessages))
	for i, om := range offlineMessages {
		protoMessages[i] = toProtoGroupOfflineMessage(&om)
	}

	return &chat.GetOfflineMessagesResponse{
		Messages: protoMessages,
	}, nil
}

func (s *groupChatSubServer) handleAckOfflineMessages(ctx context.Context, req *chat.AckOfflineMessagesRequest) (*chat.AckOfflineMessagesResponse, error) {
	logID := serverwrapper.GetLogID(ctx)

	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	if len(req.Ulids) == 0 {
		return nil, server.BadRequest("ulids are required")
	}

	acked := 0
	for _, ulid := range req.Ulids {
		if err := s.messageService.MarkOfflineMessageDelivered(ctx, ulid); err != nil {
			logger.Warnf(ctx, "[%s] Failed to ack offline message %s: %v", logID, ulid, err)
		} else {
			acked++
		}
	}

	return &chat.AckOfflineMessagesResponse{
		Success: true,
	}, nil
}

func (s *groupChatSubServer) handleGetUnreadCount(ctx context.Context, req *chat.GetUnreadCountRequest) (*chat.GetUnreadCountResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorDID := subject.ID

	count, err := s.messageService.GetUndeliveredCount(ctx, actorDID, req.GroupUlid)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get unread count", err)
	}

	return &chat.GetUnreadCountResponse{
		UnreadCount: int64(count),
	}, nil
}

func (s *groupChatSubServer) handleMarkGroupRead(ctx context.Context, req *chat.MarkGroupReadRequest) (*chat.MarkGroupReadResponse, error) {
	logID := serverwrapper.GetLogID(ctx)

	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorDID := subject.ID

	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}

	count, err := s.messageService.MarkGroupOfflineMessagesDelivered(ctx, actorDID, req.GroupUlid)
	if err != nil {
		logger.Warnf(ctx, "[%s] Failed to mark group %s as read: %v", logID, req.GroupUlid, err)
		return nil, server.InternalErrorWithCause("failed to mark as read", err)
	}

	logger.Infof(ctx, "[%s] Marked %d messages as read for group %s by user %s", logID, count, req.GroupUlid, actorDID)

	return &chat.MarkGroupReadResponse{
		Success: true,
	}, nil
}

func (s *groupChatSubServer) handleStats(ctx context.Context, req *chat.GetGroupStatsRequest) (*chat.GetGroupStatsResponse, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return &chat.GetGroupStatsResponse{
		TotalGroups:   0,
		TotalMembers:  0,
		TotalMessages: 0,
		ActiveGroups:  0,
	}, nil
}

func toProtoGroup(g *model.Group) *chat.Group {
	if g == nil {
		return nil
	}
	return &chat.Group{
		Ulid:        g.ULID,
		Name:        g.Name,
		Description: g.Description,
		AvatarCid:   g.AvatarCID,
		OwnerDid:    g.OwnerDID,
		Type:        chat.GroupType(g.Type),
		Visibility:  chat.GroupVisibility(g.Visibility),
		MemberCount: int32(g.MemberCount),
		MaxMembers:  int32(g.MaxMembers),
		Muted:       g.Muted,
		CreatedAt:   timestamppb.New(g.CreatedAt),
		UpdatedAt:   timestamppb.New(g.UpdatedAt),
	}
}

func toProtoGroupMember(m *model.GroupMember) *chat.GroupMember {
	if m == nil {
		return nil
	}
	return &chat.GroupMember{
		GroupUlid:  m.GroupULID,
		ActorDid:   m.ActorDID,
		Role:       chat.GroupRole(m.Role),
		Nickname:   m.Nickname,
		Muted:      m.Muted,
		MutedUntil: timestamppb.New(m.MutedUntil),
		JoinedAt:   timestamppb.New(m.JoinedAt),
		InvitedBy:  m.InvitedBy,
	}
}

func toProtoGroupMemberWithActor(m *model.GroupMember, _ *dbmodel.Actor) *chat.GroupMember {
	if m == nil {
		return nil
	}
	return toProtoGroupMember(m)
}

func toProtoGroupMessage(m *model.GroupMessage) *chat.GroupMessage {
	if m == nil {
		return nil
	}
	return &chat.GroupMessage{
		Ulid:          m.ULID,
		GroupUlid:     m.GroupULID,
		SenderDid:     m.SenderDID,
		Type:          chat.GroupMessageType(m.Type),
		Content:       m.Content,
		ReplyToUlid:   m.ReplyToULID,
		MentionedDids: m.MentionedDIDs,
		MentionAll:    m.MentionAll,
		SentAt:        timestamppb.New(m.SentAt),
		Deleted:       m.Deleted,
	}
}

func toProtoGroupInvitation(inv *model.GroupInvitation) *chat.GroupInvitation {
	if inv == nil {
		return nil
	}
	return &chat.GroupInvitation{
		Ulid:        inv.ULID,
		GroupUlid:   inv.GroupULID,
		InviterDid:  inv.InviterDID,
		InviteeDid:  inv.InviteeDID,
		Status:      chat.GroupInvitationStatus(inv.Status),
		ExpireAt:    timestamppb.New(inv.ExpireAt),
		CreatedAt:   timestamppb.New(inv.CreatedAt),
	}
}

func toProtoGroupOfflineMessage(om *model.GroupOfflineMessage) *chat.GroupOfflineMessage {
	if om == nil {
		return nil
	}
	return &chat.GroupOfflineMessage{
		Ulid:        om.ULID,
		GroupUlid:   om.GroupULID,
		ReceiverDid: om.ReceiverDID,
		MessageUlid: om.MessageULID,
		Status:      chat.GroupOfflineMessageStatus(om.Status),
		ExpireAt:    timestamppb.New(om.ExpireAt),
		DeliveredAt: timestamppb.New(om.DeliveredAt),
		CreatedAt:   timestamppb.New(om.CreatedAt),
	}
}
