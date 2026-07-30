package compat_chat

import (
	"context"

	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"

	convsub "github.com/peers-labs/peers-touch/station/app/subserver/conversation"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

// --- /group-chat/create ---

func (s *subServer) handleGroupCreate(ctx context.Context, req *chat.CreateGroupRequest) (*chat.CreateGroupResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.Name == "" {
		return nil, server.BadRequest("name is required")
	}

	members := make([]convsub.MemberEntry, 0, len(req.InitialMemberDids)+len(req.InitialFederatedMembers)+1)
	members = append(members, convsub.MemberEntry{
		Ptid:      subject.ID,
		StationID: s.localStationID,
		Role:      chat.MemberRole_MEMBER_ROLE_OWNER,
	})
	for _, did := range req.InitialMemberDids {
		if did == subject.ID {
			continue
		}
		members = append(members, convsub.MemberEntry{
			Ptid:      did,
			StationID: s.localStationID,
			Role:      chat.MemberRole_MEMBER_ROLE_MEMBER,
		})
	}
	for _, fm := range req.InitialFederatedMembers {
		members = append(members, convsub.MemberEntry{
			Ptid:      fm.Ptid,
			StationID: fm.HomeStationPeerId,
			Role:      chat.MemberRole_MEMBER_ROLE_MEMBER,
		})
	}

	conv, err := s.convService.CreateGroup(ctx, req.Name, subject.ID, s.localStationID, members)
	if err != nil {
		return nil, server.InternalErrorWithCause("create group failed", err)
	}

	group := conversationToGroup(conv)
	return &chat.CreateGroupResponse{Group: group}, nil
}

// --- /group-chat/list ---

func (s *subServer) handleGroupList(ctx context.Context, req *chat.ListGroupsRequest) (*chat.ListGroupsResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	convs, err := s.convService.ListConversations(ctx, subject.ID)
	if err != nil {
		return nil, server.InternalErrorWithCause("list groups failed", err)
	}

	groups := make([]*chat.Group, 0, len(convs))
	for _, c := range convs {
		if c.Kind == chat.ConversationKind_CONVERSATION_KIND_GROUP {
			groups = append(groups, conversationToGroup(c))
		}
	}

	return &chat.ListGroupsResponse{Groups: groups, Total: int32(len(groups))}, nil
}

// --- /group-chat/info ---

func (s *subServer) handleGroupInfo(ctx context.Context, req *chat.GetGroupRequest) (*chat.GetGroupResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}

	conv, err := s.convService.GetConversation(ctx, req.GroupUlid)
	if err != nil {
		return nil, server.InternalErrorWithCause("get group failed", err)
	}

	members, _ := s.convService.GetMembers(ctx, req.GroupUlid)
	var myMembership *chat.GroupMember
	for _, m := range members {
		if m.Ptid == subject.ID {
			myMembership = convMemberToGroupMember(m, req.GroupUlid)
			break
		}
	}

	group := conversationToGroup(conv)
	group.MemberCount = int32(len(members))
	return &chat.GetGroupResponse{Group: group, MyMembership: myMembership}, nil
}

// --- /group-chat/update ---

func (s *subServer) handleGroupUpdate(ctx context.Context, req *chat.UpdateGroupRequest) (*chat.UpdateGroupResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	cmd := &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: req.GroupUlid,
		SenderPtid:     subject.ID,
		ClientTs:       timestamppb.Now(),
		Payload: &chat.ConversationCommand_UpdateSettings{
			UpdateSettings: &chat.UpdateSettingsCommand{
				Name:        req.Name,
				Description: req.Description,
				AvatarCid:   req.AvatarCid,
			},
		},
	}

	if _, err := s.convService.SubmitCommand(ctx, cmd); err != nil {
		return nil, server.InternalErrorWithCause("update group failed", err)
	}

	conv, _ := s.convService.GetConversation(ctx, req.GroupUlid)
	return &chat.UpdateGroupResponse{Group: conversationToGroup(conv)}, nil
}

// --- /group-chat/message/send ---

func (s *subServer) handleGroupSendMessage(ctx context.Context, req *chat.SendGroupMessageRequest) (*chat.SendGroupMessageResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}

	deviceID := serverwrapper.GetDeviceID(ctx)

	cmd := &chat.ConversationCommand{
		CommandId:               uuid.NewString(),
		ConversationId:          req.GroupUlid,
		SenderPtid:              subject.ID,
		SenderDeviceId:          deviceID,
		ObservedMembershipEpoch: req.ObservedMembershipEpoch,
		ClientTs:                timestamppb.Now(),
		Payload: &chat.ConversationCommand_SendMessage{
			SendMessage: &chat.SendMessageCommand{
				EncryptedPayload:    req.EncryptedPayload,
				ContentType:         groupMessageTypeToContentType(req.Type),
				ReplyToMessageId:    req.ReplyToUlid,
				ThreadRootMessageId: req.ThreadRootUlid,
				Attachments:         groupAttachmentsToEncrypted(req.Attachments),
			},
		},
	}

	event, err := s.convService.SubmitCommand(ctx, cmd)
	if err != nil {
		return nil, server.InternalErrorWithCause("send group message failed", err)
	}

	msg := eventToGroupMessage(event, req.GroupUlid, subject.ID)
	return &chat.SendGroupMessageResponse{Message: msg}, nil
}

// --- /group-chat/messages ---

func (s *subServer) handleGroupListMessages(ctx context.Context, req *chat.GetGroupMessagesRequest) (*chat.GetGroupMessagesResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}

	limit := int(req.Limit)
	if limit <= 0 {
		limit = 50
	}

	events, err := s.convService.ListEvents(ctx, req.GroupUlid, 0, limit)
	if err != nil {
		return nil, server.InternalErrorWithCause("list group messages failed", err)
	}

	messages := make([]*chat.GroupMessage, 0, len(events))
	for _, ev := range events {
		if mc := ev.GetMessageCommitted(); mc != nil {
			messages = append(messages, eventToGroupMessage(ev, req.GroupUlid, mc.SenderPtid))
		}
	}

	hasMore := len(messages) >= limit
	return &chat.GetGroupMessagesResponse{Messages: messages, HasMore: hasMore}, nil
}

// --- /group-chat/members ---

func (s *subServer) handleGroupGetMembers(ctx context.Context, req *chat.GetGroupMembersRequest) (*chat.GetGroupMembersResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GroupUlid == "" {
		return nil, server.BadRequest("group_ulid is required")
	}

	members, err := s.convService.GetMembers(ctx, req.GroupUlid)
	if err != nil {
		return nil, server.InternalErrorWithCause("get members failed", err)
	}

	groupMembers := make([]*chat.GroupMember, 0, len(members))
	for _, m := range members {
		if m.MemberStatus == chat.MemberStatus_MEMBER_STATUS_ACTIVE {
			groupMembers = append(groupMembers, convMemberToGroupMember(m, req.GroupUlid))
		}
	}

	return &chat.GetGroupMembersResponse{Members: groupMembers, Total: int32(len(groupMembers))}, nil
}

// --- /group-chat/leave ---

func (s *subServer) handleGroupLeave(ctx context.Context, req *chat.LeaveGroupRequest) (*chat.LeaveGroupResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	cmd := &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: req.GroupUlid,
		SenderPtid:     subject.ID,
		SenderDeviceId: serverwrapper.GetDeviceID(ctx),
		ClientTs:       timestamppb.Now(),
		Payload:        &chat.ConversationCommand_Leave{Leave: &chat.LeaveCommand{}},
	}

	if _, err := s.convService.SubmitCommand(ctx, cmd); err != nil {
		return nil, server.InternalErrorWithCause("leave group failed", err)
	}
	return &chat.LeaveGroupResponse{Success: true}, nil
}

// --- /group-chat/invite ---

func (s *subServer) handleGroupInvite(ctx context.Context, req *chat.InviteToGroupRequest) (*chat.InviteToGroupResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	entries := make([]*chat.MemberAddEntry, 0, len(req.InviteeDids))
	for _, did := range req.InviteeDids {
		entries = append(entries, &chat.MemberAddEntry{
			Ptid:                    did,
			ActorHomeStationPeerId: s.localStationID,
			Role:                    chat.MemberRole_MEMBER_ROLE_MEMBER,
		})
	}

	cmd := &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: req.GroupUlid,
		SenderPtid:     subject.ID,
		ClientTs:       timestamppb.Now(),
		Payload: &chat.ConversationCommand_AddMembers{
			AddMembers: &chat.AddMembersCommand{Members: entries},
		},
	}

	if _, err := s.convService.SubmitCommand(ctx, cmd); err != nil {
		return nil, server.InternalErrorWithCause("invite failed", err)
	}
	return &chat.InviteToGroupResponse{}, nil
}

// --- /group-chat/join ---

func (s *subServer) handleGroupJoin(ctx context.Context, req *chat.JoinGroupRequest) (*chat.JoinGroupResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	entries := []*chat.MemberAddEntry{{
		Ptid:                    subject.ID,
		ActorHomeStationPeerId: s.localStationID,
		Role:                    chat.MemberRole_MEMBER_ROLE_MEMBER,
	}}

	cmd := &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: req.GroupUlid,
		SenderPtid:     subject.ID,
		ClientTs:       timestamppb.Now(),
		Payload: &chat.ConversationCommand_AddMembers{
			AddMembers: &chat.AddMembersCommand{Members: entries},
		},
	}

	if _, err := s.convService.SubmitCommand(ctx, cmd); err != nil {
		return nil, server.InternalErrorWithCause("join failed", err)
	}

	return &chat.JoinGroupResponse{Membership: &chat.GroupMember{
		GroupUlid: req.GroupUlid,
		Ptid:      subject.ID,
		Role:      chat.GroupRole_GROUP_ROLE_MEMBER,
	}}, nil
}

// --- /group-chat/member/remove ---

func (s *subServer) handleGroupRemoveMember(ctx context.Context, req *chat.RemoveMemberRequest) (*chat.RemoveMemberResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	cmd := &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: req.GroupUlid,
		SenderPtid:     subject.ID,
		ClientTs:       timestamppb.Now(),
		Payload: &chat.ConversationCommand_RemoveMembers{
			RemoveMembers: &chat.RemoveMembersCommand{Ptids: []string{req.Ptid}},
		},
	}

	if _, err := s.convService.SubmitCommand(ctx, cmd); err != nil {
		return nil, server.InternalErrorWithCause("remove member failed", err)
	}
	return &chat.RemoveMemberResponse{Success: true}, nil
}

// --- /group-chat/member/update ---

func (s *subServer) handleGroupUpdateMember(ctx context.Context, req *chat.UpdateMemberRequest) (*chat.UpdateMemberResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	newRole := chat.MemberRole_MEMBER_ROLE_UNSPECIFIED
	if req.Role != nil {
		newRole = chat.MemberRole(int32(*req.Role))
	}
	muted := false
	if req.Muted != nil {
		muted = *req.Muted
	}

	cmd := &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: req.GroupUlid,
		SenderPtid:     subject.ID,
		ClientTs:       timestamppb.Now(),
		Payload: &chat.ConversationCommand_UpdateMember{
			UpdateMember: &chat.UpdateMemberCommand{
				TargetPtid: req.Ptid,
				NewRole:    newRole,
				Muted:      muted,
			},
		},
	}

	if _, err := s.convService.SubmitCommand(ctx, cmd); err != nil {
		return nil, server.InternalErrorWithCause("update member failed", err)
	}

	return &chat.UpdateMemberResponse{Member: &chat.GroupMember{
		GroupUlid: req.GroupUlid,
		Ptid:      req.Ptid,
		Role:      chat.GroupRole(newRole),
		Muted:     muted,
	}}, nil
}

// --- /group-chat/ownership/transfer ---

func (s *subServer) handleGroupTransferOwnership(ctx context.Context, req *chat.TransferGroupOwnershipRequest) (*chat.TransferGroupOwnershipResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	// TODO: implement ownership transfer when F3 lands
	conv, _ := s.convService.GetConversation(ctx, req.GroupUlid)
	return &chat.TransferGroupOwnershipResponse{Group: conversationToGroup(conv)}, nil
}

// --- /group-chat/dissolve ---

func (s *subServer) handleGroupDissolve(ctx context.Context, req *chat.DissolveGroupRequest) (*chat.DissolveGroupResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	cmd := &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: req.GroupUlid,
		SenderPtid:     subject.ID,
		SenderDeviceId: serverwrapper.GetDeviceID(ctx),
		ClientTs:       timestamppb.Now(),
		Payload:        &chat.ConversationCommand_Dissolve{Dissolve: &chat.DissolveCommand{}},
	}

	if _, err := s.convService.SubmitCommand(ctx, cmd); err != nil {
		return nil, server.InternalErrorWithCause("dissolve failed", err)
	}
	return &chat.DissolveGroupResponse{Success: true}, nil
}

// --- /group-chat/message/recall ---

func (s *subServer) handleGroupRecallMessage(ctx context.Context, req *chat.RecallGroupMessageRequest) (*chat.RecallGroupMessageResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	cmd := &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: req.GroupUlid,
		SenderPtid:     subject.ID,
		SenderDeviceId: serverwrapper.GetDeviceID(ctx),
		ClientTs:       timestamppb.Now(),
		Payload: &chat.ConversationCommand_RetractMessage{
			RetractMessage: &chat.RetractMessageCommand{TargetMessageId: req.MessageUlid},
		},
	}

	if _, err := s.convService.SubmitCommand(ctx, cmd); err != nil {
		return nil, server.InternalErrorWithCause("recall failed", err)
	}
	return &chat.RecallGroupMessageResponse{Success: true}, nil
}

// --- /group-chat/message/edit ---

func (s *subServer) handleGroupEditMessage(ctx context.Context, req *chat.EditGroupMessageRequest) (*chat.EditGroupMessageResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	cmd := &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: req.GroupUlid,
		SenderPtid:     subject.ID,
		SenderDeviceId: serverwrapper.GetDeviceID(ctx),
		ClientTs:       timestamppb.Now(),
		Payload: &chat.ConversationCommand_EditMessage{
			EditMessage: &chat.EditMessageCommand{
				TargetMessageId:  req.MessageUlid,
				EncryptedPayload: req.NewEncryptedPayload,
			},
		},
	}

	if _, err := s.convService.SubmitCommand(ctx, cmd); err != nil {
		return nil, server.InternalErrorWithCause("edit failed", err)
	}
	return &chat.EditGroupMessageResponse{Success: true}, nil
}

// --- /group-chat/message/delete ---

func (s *subServer) handleGroupDeleteMessage(ctx context.Context, req *chat.DeleteGroupMessageRequest) (*chat.DeleteGroupMessageResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	cmd := &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: req.GroupUlid,
		SenderPtid:     subject.ID,
		SenderDeviceId: serverwrapper.GetDeviceID(ctx),
		ClientTs:       timestamppb.Now(),
		Payload: &chat.ConversationCommand_RetractMessage{
			RetractMessage: &chat.RetractMessageCommand{TargetMessageId: req.MessageUlid},
		},
	}

	if _, err := s.convService.SubmitCommand(ctx, cmd); err != nil {
		return nil, server.InternalErrorWithCause("delete failed", err)
	}
	return &chat.DeleteGroupMessageResponse{Success: true}, nil
}

// --- /group-chat/unread-count ---

func (s *subServer) handleGroupUnreadCount(ctx context.Context, _ *chat.GetUnreadCountRequest) (*chat.GetUnreadCountResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	// Unread tracking will be fully wired later; for now return 0 to unblock BFF.
	return &chat.GetUnreadCountResponse{UnreadCount: 0}, nil
}

// --- /group-chat/mark-read ---

func (s *subServer) handleGroupMarkRead(ctx context.Context, req *chat.MarkGroupReadRequest) (*chat.MarkGroupReadResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	return &chat.MarkGroupReadResponse{Success: true}, nil
}

// --- /group-chat/skdm/submit ---

func (s *subServer) handleGroupSkdmSubmit(ctx context.Context, req *chat.SubmitGroupSkdmEnvelopeRequest) (*chat.SubmitGroupSkdmEnvelopeResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.Envelope == nil {
		return nil, server.BadRequest("envelope is required")
	}

	env := &chat.StationEnvelope{
		EnvelopeId:                 uuid.NewString(),
		IdempotencyKey:             req.Envelope.IdempotencyKey,
		ConversationId:             req.Envelope.GroupUlid,
		SenderPtid:                 subject.ID,
		SenderDeviceId:             serverwrapper.GetDeviceID(ctx),
		RecipientPtid:              req.Envelope.RecipientDid,
		RecipientHomeStationPeerId: req.Envelope.RecipientHomeStationPeerId,
		MembershipEpoch:            req.Envelope.MembershipEpoch,
		PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_MLS_KEY_DELIVERY,
		PayloadBytes:               req.Envelope.EncryptedPayload,
	}

	envelopeID, err := s.envService.Submit(ctx, env)
	if err != nil {
		return nil, server.InternalErrorWithCause("skdm submit failed", err)
	}

	return &chat.SubmitGroupSkdmEnvelopeResponse{OutboxUlid: envelopeID, Status: "submitted"}, nil
}

// --- /group-chat/my-settings (GET) ---

func (s *subServer) handleGroupGetSettings(ctx context.Context, req *chat.GetGroupSettingsRequest) (*chat.GetGroupSettingsResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	member, _ := s.convService.GetMember(ctx, req.GroupUlid, subject.ID)
	alertEnabled := true
	if member != nil {
		alertEnabled = !member.Muted
	}
	return &chat.GetGroupSettingsResponse{AlertEnabled: alertEnabled}, nil
}

// --- /group-chat/my-settings (PUT) ---

func (s *subServer) handleGroupUpdateSettings(ctx context.Context, req *chat.UpdateGroupSettingsRequest) (*chat.UpdateGroupSettingsResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.IsMuted == nil {
		return &chat.UpdateGroupSettingsResponse{Success: true}, nil
	}
	member, err := s.convService.GetMember(ctx, req.GroupUlid, subject.ID)
	if err != nil || member == nil {
		return &chat.UpdateGroupSettingsResponse{Success: true}, nil
	}
	member.Muted = *req.IsMuted
	if err := s.convService.UpsertMember(ctx, member); err != nil {
		return nil, server.InternalErrorWithCause("update settings failed", err)
	}
	return &chat.UpdateGroupSettingsResponse{Success: true}, nil
}

// --- /group-chat/member/nickname ---

func (s *subServer) handleGroupUpdateNickname(ctx context.Context, req *chat.UpdateMyNicknameRequest) (*chat.UpdateMyNicknameResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	member, err := s.convService.GetMember(ctx, req.GroupUlid, subject.ID)
	if err != nil || member == nil {
		return nil, server.BadRequest("not a member of this group")
	}
	member.Nickname = req.Nickname
	if err := s.convService.UpsertMember(ctx, member); err != nil {
		return nil, server.InternalErrorWithCause("update nickname failed", err)
	}
	return &chat.UpdateMyNicknameResponse{Member: &chat.GroupMember{
		GroupUlid: req.GroupUlid,
		Ptid:      subject.ID,
		Nickname:  req.Nickname,
	}}, nil
}

// --- /group-chat/messages/search ---

func (s *subServer) handleGroupSearchMessages(ctx context.Context, req *chat.SearchGroupMessagesRequest) (*chat.SearchGroupMessagesResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	// TODO: implement search with full-text indexing
	return &chat.SearchGroupMessagesResponse{}, nil
}

// --- /group-chat/offline-messages ---

func (s *subServer) handleGroupOfflineMessages(ctx context.Context, _ *chat.GetOfflineMessagesRequest) (*chat.GetOfflineMessagesResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	_ = subject
	return &chat.GetOfflineMessagesResponse{}, nil
}

// --- /group-chat/offline-messages/ack ---

func (s *subServer) handleGroupOfflineMessagesAck(ctx context.Context, req *chat.AckOfflineMessagesRequest) (*chat.AckOfflineMessagesResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	return &chat.AckOfflineMessagesResponse{Success: true}, nil
}

// --- /group-chat/stats ---

func (s *subServer) handleGroupStats(ctx context.Context, _ *chat.GetGroupStatsRequest) (*chat.GetGroupStatsResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	_ = subject
	return &chat.GetGroupStatsResponse{}, nil
}

// --- /group-chat/member/federated-add ---

func (s *subServer) handleGroupFederatedAdd(ctx context.Context, req *chat.InviteToGroupRequest) (*chat.InviteToGroupResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	// Federated member add is the same as invite but with station peer info.
	return s.handleGroupInvite(ctx, req)
}

// --- Mappers ---

func conversationToGroup(conv *chat.Conversation) *chat.Group {
	if conv == nil {
		return &chat.Group{}
	}

	status := chat.GroupStatus_GROUP_STATUS_ACTIVE
	if conv.Status == chat.ConversationStatus_CONVERSATION_STATUS_DISSOLVED {
		status = chat.GroupStatus_GROUP_STATUS_DISSOLVED
	}

	return &chat.Group{
		Ulid:            conv.ConversationId,
		Name:            conv.Name,
		Description:     conv.Description,
		AvatarCid:       conv.AvatarCid,
		OwnerDid:        conv.OwnerPtid,
		MaxMembers:      conv.MaxMembers,
		MembershipEpoch: conv.MembershipEpoch,
		Status:          status,
		CreatedAt:       conv.CreatedAt,
		UpdatedAt:       conv.UpdatedAt,
	}
}

func convMemberToGroupMember(m *chat.ConversationMember, groupUlid string) *chat.GroupMember {
	role := chat.GroupRole_GROUP_ROLE_MEMBER
	switch m.Role {
	case chat.MemberRole_MEMBER_ROLE_OWNER:
		role = chat.GroupRole_GROUP_ROLE_OWNER
	case chat.MemberRole_MEMBER_ROLE_ADMIN:
		role = chat.GroupRole_GROUP_ROLE_ADMIN
	}

	return &chat.GroupMember{
		GroupUlid:                groupUlid,
		Ptid:                     m.Ptid,
		Role:                     role,
		Nickname:                 m.Nickname,
		Muted:                    m.Muted,
		MutedUntil:               m.MutedUntil,
		JoinedAt:                 m.JoinedAt,
		ActorHomeStationPeerId:   m.ActorHomeStationPeerId,
		ActorHomeStationDomain:   m.ActorHomeStationDomain,
	}
}

func eventToGroupMessage(event *chat.CommittedConversationEvent, groupUlid, senderDid string) *chat.GroupMessage {
	mc := event.GetMessageCommitted()
	if mc == nil {
		return &chat.GroupMessage{
			Ulid:      event.EventId,
			GroupUlid: groupUlid,
			SenderDid: senderDid,
			Type:      chat.GroupMessageType_GROUP_MESSAGE_TYPE_TEXT,
			SentAt:    event.CommittedAt,
			CreatedAt: event.CommittedAt,
		}
	}

	return &chat.GroupMessage{
		Ulid:             mc.MessageId,
		GroupUlid:        groupUlid,
		SenderDid:        mc.SenderPtid,
		Type:             contentTypeToGroupMessageType(mc.ContentType),
		EncryptedPayload: mc.EncryptedPayload,
		ReplyToUlid:      mc.ReplyToMessageId,
		ThreadRootUlid:   mc.ThreadRootMessageId,
		SentAt:           event.CommittedAt,
		CreatedAt:        event.CommittedAt,
	}
}

func groupMessageTypeToContentType(t chat.GroupMessageType) chat.MessageContentType {
	switch t {
	case chat.GroupMessageType_GROUP_MESSAGE_TYPE_TEXT:
		return chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT
	case chat.GroupMessageType_GROUP_MESSAGE_TYPE_IMAGE:
		return chat.MessageContentType_MESSAGE_CONTENT_TYPE_IMAGE
	case chat.GroupMessageType_GROUP_MESSAGE_TYPE_FILE:
		return chat.MessageContentType_MESSAGE_CONTENT_TYPE_FILE
	case chat.GroupMessageType_GROUP_MESSAGE_TYPE_AUDIO:
		return chat.MessageContentType_MESSAGE_CONTENT_TYPE_AUDIO
	case chat.GroupMessageType_GROUP_MESSAGE_TYPE_VIDEO:
		return chat.MessageContentType_MESSAGE_CONTENT_TYPE_VIDEO
	default:
		return chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT
	}
}

func contentTypeToGroupMessageType(t chat.MessageContentType) chat.GroupMessageType {
	switch t {
	case chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT:
		return chat.GroupMessageType_GROUP_MESSAGE_TYPE_TEXT
	case chat.MessageContentType_MESSAGE_CONTENT_TYPE_IMAGE:
		return chat.GroupMessageType_GROUP_MESSAGE_TYPE_IMAGE
	case chat.MessageContentType_MESSAGE_CONTENT_TYPE_FILE:
		return chat.GroupMessageType_GROUP_MESSAGE_TYPE_FILE
	case chat.MessageContentType_MESSAGE_CONTENT_TYPE_AUDIO:
		return chat.GroupMessageType_GROUP_MESSAGE_TYPE_AUDIO
	case chat.MessageContentType_MESSAGE_CONTENT_TYPE_VIDEO:
		return chat.GroupMessageType_GROUP_MESSAGE_TYPE_VIDEO
	default:
		return chat.GroupMessageType_GROUP_MESSAGE_TYPE_TEXT
	}
}

func groupAttachmentsToEncrypted(attachments []*chat.GroupMessageAttachment) []*chat.EncryptedAttachment {
	if len(attachments) == 0 {
		return nil
	}
	result := make([]*chat.EncryptedAttachment, 0, len(attachments))
	for _, a := range attachments {
		result = append(result, &chat.EncryptedAttachment{
			AttachmentId: a.Cid,
			Filename:     a.Filename,
			SizeBytes:    a.Size,
			MimeType:     a.MimeType,
			StorageRef:   a.Cid,
		})
	}
	return result
}
