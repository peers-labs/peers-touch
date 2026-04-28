package group_chat

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	application_group_chat "github.com/peers-labs/peers-touch/station/app/subserver/group_chat/application"
	group_chat_domain "github.com/peers-labs/peers-touch/station/app/subserver/group_chat/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *subServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()
	return []server.Handler{
		server.NewTypedHandler("gc-create", "/group-chat/create", server.POST, s.handleCreate, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("gc-list", "/group-chat/list", server.GET, s.handleList, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("gc-info", "/group-chat/info", server.GET, s.handleInfo, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("gc-update", "/group-chat/update", server.PUT, s.handleUpdate, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("gc-invite", "/group-chat/invite", server.POST, s.handleInvite, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("gc-join", "/group-chat/join", server.POST, s.handleJoin, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("gc-leave", "/group-chat/leave", server.POST, s.handleLeave, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("gc-members", "/group-chat/members", server.GET, s.handleMembers, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("gc-remove-member", "/group-chat/member/remove", server.POST, s.handleRemoveMember, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("gc-message-send", "/group-chat/message/send", server.POST, s.handleSendMessage, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("gc-messages", "/group-chat/messages", server.GET, s.handleGetMessages, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("gc-message-recall", "/group-chat/message/recall", server.POST, s.handleRecallMessage, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("gc-message-edit", "/group-chat/message/edit", server.POST, s.handleEditMessage, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("gc-message-delete", "/group-chat/message/delete", server.POST, s.handleDeleteMessage, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("gc-message-search", "/group-chat/messages/search", server.GET, s.handleSearchMessages, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("gc-update-nickname", "/group-chat/member/nickname", server.PUT, s.handleUpdateMyNickname, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("gc-my-settings", "/group-chat/my-settings", server.GET, s.handleGetMySettings, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("gc-update-my-settings", "/group-chat/my-settings", server.PUT, s.handleUpdateMySettings, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("gc-offline-messages", "/group-chat/offline-messages", server.GET, s.handleGetOfflineMessages, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("gc-offline-ack", "/group-chat/offline-messages/ack", server.POST, s.handleAckOfflineMessages, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("gc-unread-count", "/group-chat/unread-count", server.GET, s.handleUnreadCount, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("gc-mark-read", "/group-chat/mark-read", server.POST, s.handleMarkRead, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("gc-stats", "/group-chat/stats", server.GET, s.handleStats, logIDWrapper, s.jwtWrapper),
	}
}

func (s *subServer) handleCreate(ctx context.Context, req *chat.CreateGroupRequest) (*chat.CreateGroupResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.Name == "" {
		return nil, server.BadRequest("name is required")
	}
	item := s.appService.CreateGroup(subject.ID, req.Name, req.Description)
	// Honour `initial_member_dids` from the proto contract. Previously
	// this field was silently dropped on the floor, which made the
	// "Start Group Chat" UI look like it had failed -- the group was
	// created but only contained the owner, so neither side saw any
	// joinable conversation. We add members directly (as if the owner
	// invited and they accepted in one step) because the UI semantics
	// for `initial_member_dids` are "these people are already in the
	// group on creation," not "send them an invite they have to
	// accept." Self-DID is filtered out (the creator is added by
	// CreateGroup itself), duplicates are de-duped, and we re-fetch
	// the group at the end so the response carries the correct
	// MemberCount instead of the stale snapshot from CreateGroup.
	if len(req.InitialMemberDids) > 0 {
		seen := make(map[string]struct{}, len(req.InitialMemberDids))
		seen[subject.ID] = struct{}{}
		for _, did := range req.InitialMemberDids {
			if did == "" {
				continue
			}
			if _, dup := seen[did]; dup {
				continue
			}
			seen[did] = struct{}{}
			s.appService.AddMember(item.ID, did, subject.ID)
		}
		if refreshed, ok := s.appService.GetGroup(item.ID); ok {
			item = *refreshed
		}
	}
	return &chat.CreateGroupResponse{
		Group: &chat.Group{
			Ulid:        item.ID,
			Name:        item.Name,
			Description: item.Description,
			OwnerDid:    item.OwnerDID,
			MemberCount: item.MemberCount,
			CreatedAt:   timestamppb.New(item.CreatedAt),
			UpdatedAt:   timestamppb.New(item.UpdatedAt),
		},
	}, nil
}

func (s *subServer) handleList(ctx context.Context, req *chat.ListGroupsRequest) (*chat.ListGroupsResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	items := s.appService.ListGroups()
	limit := int(req.Limit)
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	offset := int(req.Offset)
	if offset < 0 {
		offset = 0
	}
	total := int32(len(items))
	if offset < len(items) {
		end := offset + limit
		if end > len(items) {
			end = len(items)
		}
		items = items[offset:end]
	} else {
		items = nil
	}
	out := make([]*chat.Group, 0, len(items))
	for _, item := range items {
		out = append(out, &chat.Group{
			Ulid:        item.ID,
			Name:        item.Name,
			Description: item.Description,
			OwnerDid:    item.OwnerDID,
			MemberCount: item.MemberCount,
			CreatedAt:   timestamppb.New(item.CreatedAt),
			UpdatedAt:   timestamppb.New(item.UpdatedAt),
		})
	}
	return &chat.ListGroupsResponse{
		Groups: out,
		Total:  total,
	}, nil
}

func (s *subServer) handleSendMessage(ctx context.Context, req *chat.SendGroupMessageRequest) (*chat.SendGroupMessageResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}
	if req.Content == "" && len(req.Attachments) == 0 && len(req.GetEncryptedPayload()) == 0 {
		return nil, server.BadRequest("content, attachments, or encrypted_payload are required")
	}
	msgType := int32(req.Type)
	if msgType == 0 {
		msgType = 1
	}
	atts := groupAttachmentsFromProto(req.Attachments)
	item := s.appService.SendMessage(req.GroupUlid, subject.ID, msgType, req.Content, req.ReplyToUlid, atts, req.GetEncryptedPayload())
	var respEnc []byte
	if len(item.EncryptedPayload) > 0 {
		respEnc = append([]byte(nil), item.EncryptedPayload...)
	}
	return &chat.SendGroupMessageResponse{
		Message: &chat.GroupMessage{
			Ulid:             item.ID,
			GroupUlid:        item.GroupID,
			SenderDid:        item.SenderDID,
			Type:             chat.GroupMessageType(item.Type),
			Content:          item.Content,
			ReplyToUlid:      item.ReplyToID,
			MentionedDids:    req.MentionedDids,
			MentionAll:       req.MentionAll,
			Attachments:      groupAttachmentsToProto(item.Attachments),
			EncryptedPayload: respEnc,
			SentAt:           timestamppb.New(item.SentAt),
		},
	}, nil
}

func (s *subServer) handleGetMessages(ctx context.Context, req *chat.GetGroupMessagesRequest) (*chat.GetGroupMessagesResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}
	limit := int(req.Limit)
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	items, err := s.appService.ListMessages(req.GroupUlid, req.BeforeUlid, limit+1)
	if err != nil {
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
	out := make([]*chat.GroupMessage, 0, len(items))
	for _, item := range items {
		var listEnc []byte
		if len(item.EncryptedPayload) > 0 {
			listEnc = append([]byte(nil), item.EncryptedPayload...)
		}
		out = append(out, &chat.GroupMessage{
			Ulid:             item.ID,
			GroupUlid:        item.GroupID,
			SenderDid:        item.SenderDID,
			Type:             chat.GroupMessageType(item.Type),
			Content:          item.Content,
			ReplyToUlid:      item.ReplyToID,
			Attachments:      groupAttachmentsToProto(item.Attachments),
			EncryptedPayload: listEnc,
			SentAt:           timestamppb.New(item.SentAt),
		})
	}
	return &chat.GetGroupMessagesResponse{Messages: out, HasMore: hasMore, NextCursor: nextCursor}, nil
}

func (s *subServer) handleUnreadCount(ctx context.Context, req *chat.GetUnreadCountRequest) (*chat.GetUnreadCountResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	return &chat.GetUnreadCountResponse{
		UnreadCount: s.appService.UnreadCount(subject.ID, req.GroupUlid),
	}, nil
}

func (s *subServer) handleMarkRead(ctx context.Context, req *chat.MarkGroupReadRequest) (*chat.MarkGroupReadResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}
	_, _ = s.appService.MarkRead(subject.ID, req.GroupUlid)
	return &chat.MarkGroupReadResponse{Success: true}, nil
}

func (s *subServer) handleInfo(ctx context.Context, req *chat.GetGroupRequest) (*chat.GetGroupResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	groupItem, ok := s.appService.GetGroup(req.GroupUlid)
	if !ok {
		return nil, server.NotFound("group not found")
	}
	memberItem, _ := s.appService.GetMember(req.GroupUlid, subject.ID)
	return &chat.GetGroupResponse{
		Group:        toProtoGroupFromDomain(groupItem),
		MyMembership: toProtoMemberFromDomain(memberItem),
	}, nil
}

func (s *subServer) handleUpdate(ctx context.Context, req *chat.UpdateGroupRequest) (*chat.UpdateGroupResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	groupItem, err := s.appService.UpdateGroupByActor(subject.ID, req.GroupUlid, req.Name, req.Description, req.Muted)
	if err != nil {
		if err == application_group_chat.ErrPermissionDenied || err == application_group_chat.ErrNotMember {
			return nil, server.Forbidden(err.Error())
		}
		if err == application_group_chat.ErrGroupNotFound {
			return nil, server.NotFound(err.Error())
		}
		return nil, server.InternalError("update group failed")
	}
	return &chat.UpdateGroupResponse{Group: toProtoGroupFromDomain(groupItem)}, nil
}

func (s *subServer) handleInvite(ctx context.Context, req *chat.InviteToGroupRequest) (*chat.InviteToGroupResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GroupUlid == "" || len(req.InviteeDids) == 0 {
		return nil, server.BadRequest("group_ulid and invitee_dids are required")
	}
	invitations, err := s.appService.InviteByActor(subject.ID, req.GroupUlid, req.InviteeDids)
	if err != nil {
		if err == application_group_chat.ErrNotMember {
			return nil, server.Forbidden(err.Error())
		}
		return nil, server.InternalError("invite failed")
	}
	items := make([]*chat.GroupInvitation, 0, len(invitations))
	for _, inv := range invitations {
		items = append(items, &chat.GroupInvitation{
			Ulid:       inv.ID,
			GroupUlid:  inv.GroupID,
			InviterDid: inv.InviterDID,
			InviteeDid: inv.InviteeDID,
			Status:     chat.GroupInvitationStatus(inv.Status),
			CreatedAt:  timestamppb.New(inv.CreatedAt),
		})
	}
	return &chat.InviteToGroupResponse{Invitations: items}, nil
}

func (s *subServer) handleJoin(ctx context.Context, req *chat.JoinGroupRequest) (*chat.JoinGroupResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}
	memberItem, err := s.appService.JoinByActor(subject.ID, req.GroupUlid, req.InvitationUlid)
	if err != nil {
		if err == application_group_chat.ErrInvalidInvitation {
			return nil, server.BadRequest(err.Error())
		}
		if err == application_group_chat.ErrGroupNotFound {
			return nil, server.NotFound(err.Error())
		}
		return nil, server.InternalError("join group failed")
	}
	return &chat.JoinGroupResponse{Membership: toProtoMemberFromDomain(memberItem)}, nil
}

func (s *subServer) handleLeave(ctx context.Context, req *chat.LeaveGroupRequest) (*chat.LeaveGroupResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}
	if err := s.appService.LeaveByActor(subject.ID, req.GroupUlid); err != nil {
		if err == application_group_chat.ErrOwnerCannotLeave {
			return nil, server.Forbidden(err.Error())
		}
		if err == application_group_chat.ErrNotMember {
			return nil, server.BadRequest(err.Error())
		}
		return nil, server.InternalError("leave group failed")
	}
	return &chat.LeaveGroupResponse{Success: true}, nil
}

func (s *subServer) handleMembers(ctx context.Context, req *chat.GetGroupMembersRequest) (*chat.GetGroupMembersResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}
	if _, ok := s.appService.GetMember(req.GroupUlid, subject.ID); !ok {
		return nil, server.Forbidden("not a member")
	}
	limit := int(req.Limit)
	offset := int(req.Offset)
	if limit <= 0 {
		limit = 100
	}
	items, total := s.appService.ListMembers(req.GroupUlid, limit, offset)
	out := make([]*chat.GroupMember, 0, len(items))
	for _, item := range items {
		copy := item
		out = append(out, toProtoMemberFromDomain(&copy))
	}
	return &chat.GetGroupMembersResponse{Members: out, Total: int32(total)}, nil
}

func (s *subServer) handleRemoveMember(ctx context.Context, req *chat.RemoveMemberRequest) (*chat.RemoveMemberResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GroupUlid == "" || req.ActorDid == "" {
		return nil, server.BadRequest("group_ulid and actor_did are required")
	}
	if err := s.appService.RemoveMemberByActor(subject.ID, req.GroupUlid, req.ActorDid); err != nil {
		if err == application_group_chat.ErrPermissionDenied || err == application_group_chat.ErrCannotRemoveOwner {
			return nil, server.Forbidden(err.Error())
		}
		if err == application_group_chat.ErrMemberNotFound {
			return nil, server.NotFound(err.Error())
		}
		return nil, server.InternalError("remove member failed")
	}
	return &chat.RemoveMemberResponse{Success: true}, nil
}

func (s *subServer) handleRecallMessage(ctx context.Context, req *chat.RecallGroupMessageRequest) (*chat.RecallGroupMessageResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GroupUlid == "" || req.MessageUlid == "" {
		return nil, server.BadRequest("group_ulid and message_ulid are required")
	}
	out, err := s.appService.RecallMessageByActor(subject.ID, req.GroupUlid, req.MessageUlid)
	if err != nil {
		return nil, groupMutationErrorToHTTP(err)
	}
	publishGroupMutation(out, subject.ID)
	return &chat.RecallGroupMessageResponse{Success: true}, nil
}

func (s *subServer) handleEditMessage(ctx context.Context, req *chat.EditGroupMessageRequest) (*chat.EditGroupMessageResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GroupUlid == "" || req.MessageUlid == "" {
		return nil, server.BadRequest("group_ulid and message_ulid are required")
	}
	out, err := s.appService.EditMessageByActor(
		subject.ID,
		req.GroupUlid,
		req.MessageUlid,
		req.GetNewContent(),
		req.GetNewEncryptedPayload(),
	)
	if err != nil {
		return nil, groupMutationErrorToHTTP(err)
	}
	publishGroupMutation(out, subject.ID)
	return &chat.EditGroupMessageResponse{Success: true}, nil
}

func (s *subServer) handleDeleteMessage(ctx context.Context, req *chat.DeleteGroupMessageRequest) (*chat.DeleteGroupMessageResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GroupUlid == "" || req.MessageUlid == "" {
		return nil, server.BadRequest("group_ulid and message_ulid are required")
	}
	out, err := s.appService.DeleteMessageByActor(subject.ID, req.GroupUlid, req.MessageUlid)
	if err != nil {
		return nil, groupMutationErrorToHTTP(err)
	}
	publishGroupMutation(out, subject.ID)
	return &chat.DeleteGroupMessageResponse{Success: true}, nil
}

// groupMutationErrorToHTTP mirrors friend_chat's mapper. We
// collapse missing-row + non-owner onto 404 so a non-sender can't
// enumerate other members' message ulids by probing.
func groupMutationErrorToHTTP(err error) error {
	switch err {
	case application_group_chat.ErrGroupNotFound,
		application_group_chat.ErrNotMember,
		application_group_chat.ErrMessageNotFound:
		return server.NotFound(err.Error())
	case application_group_chat.ErrPermissionDenied:
		return server.Forbidden(err.Error())
	case application_group_chat.ErrMutationWindowClosed:
		return server.BadRequest("mutation window has closed for this message")
	case application_group_chat.ErrAlreadyRecalled:
		return server.BadRequest("message already recalled")
	case application_group_chat.ErrEmptyEdit:
		return server.BadRequest(err.Error())
	default:
		return server.InternalErrorWithCause("mutation failed", err)
	}
}

// publishGroupMutation emits one `MessageMutation` StreamEvent per
// recipient (every member except the originator) and one self-echo
// onto the originator's stream so their other devices converge.
// Best-effort: persistence has already succeeded, so a failure here
// only delays UI convergence — peers' next cold sync surfaces the
// same change from the DB.
func publishGroupMutation(out group_chat_domain.MutationOutcome, originatorActorID string) {
	bus := events.GetBus()
	if bus == nil {
		return
	}
	var kind realtime.MessageMutation_Kind
	switch out.Kind {
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
					// SessionUlid for group chat carries the
					// group ulid — the receiver's store
					// indexes by `messages[<container>]` and
					// the container id is the group for group
					// messages. Friend chat carries the
					// session ulid the same way.
					SessionUlid:     out.GroupID,
					Ulid:            out.Ulid,
					FromActorId:     originatorActorID,
					Kind:            kind,
					NewCiphertext:   append([]byte(nil), out.NewCiphertext...),
					NewContent:      out.NewContent,
					MutatedTsUnixMs: out.MutatedAt.UnixMilli(),
				},
			},
		}
	}
	for _, did := range out.RecipientDIDs {
		if _, err := bus.Publish(did, build()); err != nil {
			logger.DefaultHelper.Warnf("group_chat: realtime mutation publish failed group=%s ulid=%s recipient=%s kind=%v: %v",
				out.GroupID, out.Ulid, did, kind, err)
		}
	}
	// Self-echo to the originator's other devices. The originator
	// is excluded from RecipientDIDs by construction
	// (`groupRecipients` filters them out), so this is the single
	// publish that lights up their multi-device set.
	if _, err := bus.Publish(originatorActorID, build()); err != nil {
		logger.DefaultHelper.Warnf("group_chat: realtime mutation self-echo failed group=%s ulid=%s actor=%s: %v",
			out.GroupID, out.Ulid, originatorActorID, err)
	}
}

func (s *subServer) handleSearchMessages(ctx context.Context, req *chat.SearchGroupMessagesRequest) (*chat.SearchGroupMessagesResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GroupUlid == "" || req.Query == "" {
		return nil, server.BadRequest("group_ulid and query are required")
	}
	limit := int(req.Limit)
	if limit <= 0 {
		limit = 50
	}
	items, err := s.appService.SearchMessagesByActor(subject.ID, req.GroupUlid, req.Query, limit)
	if err != nil {
		if err == application_group_chat.ErrNotMember {
			return nil, server.Forbidden(err.Error())
		}
		return nil, server.InternalError("search messages failed")
	}
	out := make([]*chat.GroupMessage, 0, len(items))
	for _, item := range items {
		copy := item
		out = append(out, toProtoMessageFromDomain(&copy))
	}
	return &chat.SearchGroupMessagesResponse{Messages: out, HasMore: false}, nil
}

func (s *subServer) handleUpdateMyNickname(ctx context.Context, req *chat.UpdateMyNicknameRequest) (*chat.UpdateMyNicknameResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}
	memberItem, ok := s.appService.UpdateNickname(req.GroupUlid, subject.ID, req.Nickname)
	if !ok {
		return nil, server.Forbidden("not a member")
	}
	return &chat.UpdateMyNicknameResponse{Member: toProtoMemberFromDomain(memberItem)}, nil
}

func (s *subServer) handleGetMySettings(ctx context.Context, req *chat.GetGroupSettingsRequest) (*chat.GetGroupSettingsResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}
	memberItem, ok := s.appService.GetMember(req.GroupUlid, subject.ID)
	if !ok {
		return nil, server.Forbidden("not a member")
	}
	settings := s.appService.GetSettings(req.GroupUlid, subject.ID)
	return &chat.GetGroupSettingsResponse{
		IsMuted:            settings.IsMuted,
		IsPinned:           settings.IsPinned,
		MyNickname:         memberItem.Nickname,
		ShowMemberNickname: settings.ShowMemberNickname,
	}, nil
}

func (s *subServer) handleUpdateMySettings(ctx context.Context, req *chat.UpdateGroupSettingsRequest) (*chat.UpdateGroupSettingsResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}
	if _, ok := s.appService.GetMember(req.GroupUlid, subject.ID); !ok {
		return nil, server.Forbidden("not a member")
	}
	s.appService.UpdateSettings(req.GroupUlid, subject.ID, req.IsMuted, req.IsPinned, req.ShowMemberNickname)
	return &chat.UpdateGroupSettingsResponse{Success: true}, nil
}

func (s *subServer) handleGetOfflineMessages(ctx context.Context, req *chat.GetOfflineMessagesRequest) (*chat.GetOfflineMessagesResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	limit := int(req.Limit)
	if limit <= 0 {
		limit = 100
	}
	items := s.appService.GetOfflineMessages(subject.ID, limit)
	out := make([]*chat.GroupOfflineMessage, 0, len(items))
	for _, item := range items {
		out = append(out, &chat.GroupOfflineMessage{
			Ulid:        item.ID,
			GroupUlid:   item.GroupID,
			ReceiverDid: item.ReceiverID,
			MessageUlid: item.MessageID,
			Status:      chat.GroupOfflineMessageStatus_GROUP_OFFLINE_MESSAGE_STATUS_PENDING,
			CreatedAt:   timestamppb.New(item.CreatedAt),
		})
	}
	return &chat.GetOfflineMessagesResponse{Messages: out}, nil
}

func (s *subServer) handleAckOfflineMessages(ctx context.Context, req *chat.AckOfflineMessagesRequest) (*chat.AckOfflineMessagesResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if len(req.Ulids) == 0 {
		return nil, server.BadRequest("ulids are required")
	}
	s.appService.AckOffline(req.Ulids)
	return &chat.AckOfflineMessagesResponse{Success: true}, nil
}

func (s *subServer) handleStats(ctx context.Context, req *chat.GetGroupStatsRequest) (*chat.GetGroupStatsResponse, error) {
	_ = ctx
	_ = req
	totalGroups, totalMembers, totalMessages, activeGroups := s.appService.Stats()
	return &chat.GetGroupStatsResponse{
		TotalGroups:   int64(totalGroups),
		TotalMembers:  int64(totalMembers),
		TotalMessages: totalMessages,
		ActiveGroups:  int64(activeGroups),
	}, nil
}

func toProtoGroup(item *group) *chat.Group {
	if item == nil {
		return nil
	}
	return &chat.Group{
		Ulid:        item.ID,
		Name:        item.Name,
		Description: item.Description,
		OwnerDid:    item.OwnerDID,
		MemberCount: item.MemberCount,
		CreatedAt:   timestamppb.New(item.CreatedAt),
		UpdatedAt:   timestamppb.New(item.UpdatedAt),
	}
}

func toProtoMember(item *member) *chat.GroupMember {
	if item == nil {
		return nil
	}
	return &chat.GroupMember{
		GroupUlid: item.GroupID,
		ActorDid:  item.ActorDID,
		Role:      chat.GroupRole(item.Role),
		Nickname:  item.Nickname,
		Muted:     item.Muted,
		JoinedAt:  timestamppb.New(item.JoinedAt),
		InvitedBy: item.InvitedBy,
	}
}

func toProtoMessage(item *message) *chat.GroupMessage {
	if item == nil {
		return nil
	}
	var enc []byte
	if len(item.EncryptedPayload) > 0 {
		enc = append([]byte(nil), item.EncryptedPayload...)
	}
	out := &chat.GroupMessage{
		Ulid:             item.ID,
		GroupUlid:        item.GroupID,
		SenderDid:        item.SenderDID,
		Type:             chat.GroupMessageType(item.Type),
		Content:          item.Content,
		ReplyToUlid:      item.ReplyToID,
		EncryptedPayload: enc,
		SentAt:           timestamppb.New(item.SentAt),
		CreatedAt:        timestamppb.New(item.SentAt),
		UpdatedAt:        timestamppb.New(item.SentAt),
		Recalled:         item.Recalled,
	}
	if !item.EditedAt.IsZero() {
		out.EditedAt = timestamppb.New(item.EditedAt)
	}
	return out
}

func toProtoMessageFromDomain(item *group_chat_domain.Message) *chat.GroupMessage {
	if item == nil {
		return nil
	}
	var enc []byte
	if len(item.EncryptedPayload) > 0 {
		enc = append([]byte(nil), item.EncryptedPayload...)
	}
	out := &chat.GroupMessage{
		Ulid:             item.ID,
		GroupUlid:        item.GroupID,
		SenderDid:        item.SenderDID,
		Type:             chat.GroupMessageType(item.Type),
		Content:          item.Content,
		ReplyToUlid:      item.ReplyToID,
		Attachments:      groupAttachmentsToProto(item.Attachments),
		EncryptedPayload: enc,
		SentAt:           timestamppb.New(item.SentAt),
		CreatedAt:        timestamppb.New(item.SentAt),
		UpdatedAt:        timestamppb.New(item.SentAt),
		Recalled:         item.Recalled,
	}
	if !item.EditedAt.IsZero() {
		out.EditedAt = timestamppb.New(item.EditedAt)
	}
	return out
}

func groupAttachmentsFromProto(in []*chat.GroupMessageAttachment) []group_chat_domain.Attachment {
	if len(in) == 0 {
		return nil
	}
	out := make([]group_chat_domain.Attachment, 0, len(in))
	for _, a := range in {
		if a == nil {
			continue
		}
		out = append(out, group_chat_domain.Attachment{
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

func groupAttachmentsToProto(in []group_chat_domain.Attachment) []*chat.GroupMessageAttachment {
	if len(in) == 0 {
		return nil
	}
	out := make([]*chat.GroupMessageAttachment, 0, len(in))
	for _, a := range in {
		out = append(out, &chat.GroupMessageAttachment{
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

func toProtoGroupFromDomain(item *group_chat_domain.Group) *chat.Group {
	if item == nil {
		return nil
	}
	return &chat.Group{
		Ulid:        item.ID,
		Name:        item.Name,
		Description: item.Description,
		OwnerDid:    item.OwnerDID,
		MemberCount: item.MemberCount,
		CreatedAt:   timestamppb.New(item.CreatedAt),
		UpdatedAt:   timestamppb.New(item.UpdatedAt),
	}
}

func toProtoMemberFromDomain(item *group_chat_domain.Member) *chat.GroupMember {
	if item == nil {
		return nil
	}
	return &chat.GroupMember{
		GroupUlid: item.GroupID,
		ActorDid:  item.ActorDID,
		Role:      chat.GroupRole(item.Role),
		Nickname:  item.Nickname,
		Muted:     item.Muted,
		JoinedAt:  timestamppb.New(item.JoinedAt),
		InvitedBy: item.InvitedBy,
	}
}
