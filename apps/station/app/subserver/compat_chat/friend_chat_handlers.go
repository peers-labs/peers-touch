package compat_chat

import (
	"context"
	"time"

	"github.com/google/uuid"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

// --- /friend-chat/session/create ---

func (s *subServer) handleFriendCreateSession(ctx context.Context, req *chat.CreateSessionRequest) (*chat.CreateSessionResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.ParticipantDid == "" {
		return nil, server.BadRequest("participant_did is required")
	}

	conv, err := s.convService.CreateDirect(ctx, subject.ID, req.ParticipantDid, s.localStationID, s.localStationID)
	if err != nil {
		return nil, server.InternalErrorWithCause("create session failed", err)
	}

	session := conversationToFriendSession(conv, subject.ID)
	return &chat.CreateSessionResponse{Session: session, Created: true}, nil
}

// --- /friend-chat/sessions ---

func (s *subServer) handleFriendListSessions(ctx context.Context, req *chat.GetSessionsRequest) (*chat.GetSessionsResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	convs, err := s.convService.ListConversations(ctx, subject.ID)
	if err != nil {
		return nil, server.InternalErrorWithCause("list sessions failed", err)
	}

	sessions := make([]*chat.FriendChatSession, 0, len(convs))
	for _, c := range convs {
		if c.Kind == chat.ConversationKind_CONVERSATION_KIND_DIRECT {
			sessions = append(sessions, conversationToFriendSession(c, subject.ID))
		}
	}

	return &chat.GetSessionsResponse{Sessions: sessions, Total: int32(len(sessions))}, nil
}

// --- /friend-chat/message/send ---

func (s *subServer) handleFriendSendMessage(ctx context.Context, req *chat.SendMessageRequest) (*chat.SendMessageResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.SessionUlid == "" {
		return nil, server.BadRequest("session_ulid is required")
	}

	deviceID := serverwrapper.GetDeviceID(ctx)

	cmd := &chat.ConversationCommand{
		CommandId:               uuid.NewString(),
		ConversationId:          req.SessionUlid,
		SenderPtid:              subject.ID,
		SenderDeviceId:          deviceID,
		ObservedMembershipEpoch: 0,
		ClientTs:                timestamppb.Now(),
		Payload: &chat.ConversationCommand_SendMessage{
			SendMessage: &chat.SendMessageCommand{
				EncryptedPayload:     req.EncryptedPayload,
				ContentType:          friendMessageTypeToContentType(req.Type),
				ReplyToMessageId:     req.ReplyToUlid,
				ThreadRootMessageId:  req.ThreadRootUlid,
				Attachments:          friendAttachmentsToEncrypted(req.Attachments),
			},
		},
	}

	event, err := s.convService.SubmitCommand(ctx, cmd)
	if err != nil {
		return nil, server.InternalErrorWithCause("send message failed", err)
	}

	msg := eventToFriendMessage(event, req.SessionUlid, subject.ID, req.ReceiverDid)
	return &chat.SendMessageResponse{Message: msg}, nil
}

// --- /friend-chat/messages ---

func (s *subServer) handleFriendListMessages(ctx context.Context, req *chat.GetMessagesRequest) (*chat.GetMessagesResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.SessionUlid == "" {
		return nil, server.BadRequest("session_ulid is required")
	}

	limit := int(req.Limit)
	if limit <= 0 {
		limit = 50
	}

	events, err := s.convService.ListEvents(ctx, req.SessionUlid, 0, limit)
	if err != nil {
		return nil, server.InternalErrorWithCause("list messages failed", err)
	}

	members, _ := s.convService.GetMembers(ctx, req.SessionUlid)
	peerID := resolvePeer(members, subject.ID)

	messages := make([]*chat.FriendChatMessage, 0, len(events))
	for _, ev := range events {
		if mc := ev.GetMessageCommitted(); mc != nil {
			receiverDid := peerID
			if mc.SenderPtid == peerID {
				receiverDid = subject.ID
			}
			messages = append(messages, eventToFriendMessage(ev, req.SessionUlid, mc.SenderPtid, receiverDid))
		}
	}

	hasMore := len(messages) >= limit
	return &chat.GetMessagesResponse{Messages: messages, HasMore: hasMore}, nil
}

// --- /friend-chat/message/ack ---

func (s *subServer) handleFriendAckMessages(ctx context.Context, req *chat.MessageAckRequest) (*chat.MessageAckResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	deviceID := serverwrapper.GetDeviceID(ctx)
	for _, itemID := range req.Ulids {
		_ = s.envService.Ack(ctx, subject.ID, deviceID, itemID)
	}

	return &chat.MessageAckResponse{}, nil
}

// --- /friend-chat/message/recall ---

func (s *subServer) handleFriendRecallMessage(ctx context.Context, req *chat.RecallFriendMessageRequest) (*chat.RecallFriendMessageResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	cmd := &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: req.SessionUlid,
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
	return &chat.RecallFriendMessageResponse{}, nil
}

// --- /friend-chat/message/edit ---

func (s *subServer) handleFriendEditMessage(ctx context.Context, req *chat.EditFriendMessageRequest) (*chat.EditFriendMessageResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	cmd := &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: req.SessionUlid,
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
	return &chat.EditFriendMessageResponse{}, nil
}

// --- /friend-chat/message/delete ---

func (s *subServer) handleFriendDeleteMessage(ctx context.Context, req *chat.DeleteFriendMessageRequest) (*chat.DeleteFriendMessageResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	cmd := &chat.ConversationCommand{
		CommandId:      uuid.NewString(),
		ConversationId: req.SessionUlid,
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
	return &chat.DeleteFriendMessageResponse{}, nil
}

// --- /friend-chat/settings (GET) ---

func (s *subServer) handleFriendGetSettings(ctx context.Context, req *chat.GetFriendConversationSettingsRequest) (*chat.GetFriendConversationSettingsResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	return &chat.GetFriendConversationSettingsResponse{
		Settings: &chat.FriendConversationSettings{
			SessionUlid:  req.SessionUlid,
			AlertEnabled: true,
		},
	}, nil
}

// --- /friend-chat/settings (PUT) ---

func (s *subServer) handleFriendUpdateSettings(ctx context.Context, req *chat.UpdateFriendConversationSettingsRequest) (*chat.UpdateFriendConversationSettingsResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	return &chat.UpdateFriendConversationSettingsResponse{
		Settings: &chat.FriendConversationSettings{
			SessionUlid:  req.SessionUlid,
			AlertEnabled: true,
		},
	}, nil
}

// --- /friend-chat/pending ---

func (s *subServer) handleFriendGetPending(ctx context.Context, req *chat.GetPendingRequest) (*chat.GetPendingResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	deviceID := serverwrapper.GetDeviceID(ctx)
	items, err := s.envService.Resume(ctx, subject.ID, deviceID, "")
	if err != nil {
		return nil, server.InternalErrorWithCause("get pending failed", err)
	}

	pending := make([]*chat.PendingMessageInfo, 0, len(items))
	for _, item := range items {
		if item.Envelope == nil {
			continue
		}
		pending = append(pending, &chat.PendingMessageInfo{
			Ulid:             item.InboxItemId,
			SenderDid:        item.Envelope.SenderPtid,
			SessionUlid:      item.Envelope.ConversationId,
			EncryptedPayload: item.Envelope.PayloadBytes,
			CreatedAt:        item.FirstQueuedAt.GetSeconds(),
		})
	}
	return &chat.GetPendingResponse{Messages: pending}, nil
}

// --- /friend-chat/stats ---

func (s *subServer) handleFriendGetStats(ctx context.Context, _ *chat.GetStatsRequest) (*chat.GetStatsResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	return &chat.GetStatsResponse{Status: "ok"}, nil
}

// --- /friend-chat/message/sync ---

func (s *subServer) handleFriendSyncMessages(ctx context.Context, req *chat.SyncMessagesRequest) (*chat.SyncMessagesResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	synced := int32(0)
	for _, item := range req.Messages {
		cmd := &chat.ConversationCommand{
			CommandId:      item.Ulid,
			ConversationId: item.SessionUlid,
			SenderPtid:     subject.ID,
			ClientTs:       timestamppb.Now(),
			Payload: &chat.ConversationCommand_SendMessage{
				SendMessage: &chat.SendMessageCommand{
					EncryptedPayload: item.EncryptedPayload,
					ContentType:      friendMessageTypeToContentType(item.Type),
					ReplyToMessageId: item.ReplyToUlid,
					ThreadRootMessageId: item.ThreadRootUlid,
				},
			},
		}
		if _, err := s.convService.SubmitCommand(ctx, cmd); err == nil {
			synced++
		}
	}

	return &chat.SyncMessagesResponse{Synced: synced}, nil
}

// --- Mappers ---

func conversationToFriendSession(conv *chat.Conversation, selfPtid string) *chat.FriendChatSession {
	now := timestamppb.New(time.Now())
	return &chat.FriendChatSession{
		Ulid:              conv.ConversationId,
		ParticipantADid:   selfPtid,
		ParticipantBDid:   "", // Populated by members lookup when needed
		CreatedAt:         conv.CreatedAt,
		UpdatedAt:         conv.UpdatedAt,
		LastMessageAt:     now,
	}
}

func eventToFriendMessage(event *chat.CommittedConversationEvent, sessionUlid, senderDid, receiverDid string) *chat.FriendChatMessage {
	mc := event.GetMessageCommitted()
	if mc == nil {
		return &chat.FriendChatMessage{
			Ulid:        event.EventId,
			SessionUlid: sessionUlid,
			SenderDid:   senderDid,
			ReceiverDid: receiverDid,
			Type:        chat.FriendMessageType_FRIEND_MESSAGE_TYPE_TEXT,
			Status:      chat.FriendMessageStatus_FRIEND_MESSAGE_STATUS_SENT,
			SentAt:      event.CommittedAt,
			CreatedAt:   event.CommittedAt,
		}
	}

	return &chat.FriendChatMessage{
		Ulid:             mc.MessageId,
		SessionUlid:      sessionUlid,
		SenderDid:        mc.SenderPtid,
		ReceiverDid:      receiverDid,
		Type:             contentTypeToFriendMessageType(mc.ContentType),
		EncryptedPayload: mc.EncryptedPayload,
		ReplyToUlid:      mc.ReplyToMessageId,
		ThreadRootUlid:   mc.ThreadRootMessageId,
		Status:           chat.FriendMessageStatus_FRIEND_MESSAGE_STATUS_SENT,
		SentAt:           event.CommittedAt,
		CreatedAt:        event.CommittedAt,
	}
}

func friendMessageTypeToContentType(t chat.FriendMessageType) chat.MessageContentType {
	switch t {
	case chat.FriendMessageType_FRIEND_MESSAGE_TYPE_TEXT:
		return chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT
	case chat.FriendMessageType_FRIEND_MESSAGE_TYPE_IMAGE:
		return chat.MessageContentType_MESSAGE_CONTENT_TYPE_IMAGE
	case chat.FriendMessageType_FRIEND_MESSAGE_TYPE_FILE:
		return chat.MessageContentType_MESSAGE_CONTENT_TYPE_FILE
	case chat.FriendMessageType_FRIEND_MESSAGE_TYPE_AUDIO:
		return chat.MessageContentType_MESSAGE_CONTENT_TYPE_AUDIO
	case chat.FriendMessageType_FRIEND_MESSAGE_TYPE_VIDEO:
		return chat.MessageContentType_MESSAGE_CONTENT_TYPE_VIDEO
	default:
		return chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT
	}
}

func contentTypeToFriendMessageType(t chat.MessageContentType) chat.FriendMessageType {
	switch t {
	case chat.MessageContentType_MESSAGE_CONTENT_TYPE_TEXT:
		return chat.FriendMessageType_FRIEND_MESSAGE_TYPE_TEXT
	case chat.MessageContentType_MESSAGE_CONTENT_TYPE_IMAGE:
		return chat.FriendMessageType_FRIEND_MESSAGE_TYPE_IMAGE
	case chat.MessageContentType_MESSAGE_CONTENT_TYPE_FILE:
		return chat.FriendMessageType_FRIEND_MESSAGE_TYPE_FILE
	case chat.MessageContentType_MESSAGE_CONTENT_TYPE_AUDIO:
		return chat.FriendMessageType_FRIEND_MESSAGE_TYPE_AUDIO
	case chat.MessageContentType_MESSAGE_CONTENT_TYPE_VIDEO:
		return chat.FriendMessageType_FRIEND_MESSAGE_TYPE_VIDEO
	default:
		return chat.FriendMessageType_FRIEND_MESSAGE_TYPE_TEXT
	}
}

func friendAttachmentsToEncrypted(attachments []*chat.FriendMessageAttachment) []*chat.EncryptedAttachment {
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

func resolvePeer(members []*chat.ConversationMember, selfPtid string) string {
	for _, m := range members {
		if m.Ptid != selfPtid {
			return m.Ptid
		}
	}
	return ""
}

// Ensure the proto import is used.
var _ = proto.Marshal
