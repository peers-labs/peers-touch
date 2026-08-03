package conversation

import (
	"context"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

// --- Legacy JSON request/response types ---
// These plain structs serve the 3 BFF functions that already call /conversation/* with JSON.
// Once P2 migrates the BFF to proto encoding, handlers will switch to chat.* proto types.

type listMessagesRequest struct {
	ConversationID string `json:"conversation_id" query:"conversation_id"`
	AfterSeq       int64  `json:"after_seq,string" query:"after_seq"`
	Limit          int    `json:"limit,string" query:"limit"`
}

type listMessagesResponse struct {
	Events  []*chat.CommittedConversationEvent `json:"events"`
	HasMore bool                               `json:"has_more"`
}

type listThreadMessagesRequest struct {
	ConversationID string `json:"conversation_id" query:"conversation_id"`
	RootID         string `json:"root_id" query:"root_id"`
	AfterSeq       int64  `json:"after_seq,string" query:"after_seq"`
	Limit          int    `json:"limit,string" query:"limit"`
}

type threadCountsRequest struct {
	ConversationID string   `json:"conversation_id"`
	RootIDs        []string `json:"root_ids"`
}

type threadCountEntry struct {
	RootID        string `json:"rootUlid"`
	ReplyCount    int64  `json:"replyCount"`
	LatestReplyID string `json:"latestReplyUlid"`
	LatestReplyAt int64  `json:"latestReplyAt"`
	UnreadCount   int    `json:"unreadCount"`
}

type threadCountsResponse struct {
	Counts []threadCountEntry `json:"counts"`
}

type setReadCursorRequest struct {
	ConversationID string `json:"conversation_id"`
	LastReadSeq    int64  `json:"last_read_seq"`
}

type setReadCursorResponse struct {
	Success bool `json:"success"`
}

type getUnreadRequest struct {
	ConversationID string `json:"conversation_id" query:"conversation_id"`
}

type getUnreadResponse struct {
	UnreadCount int64 `json:"unread_count"`
}

type getMemberSettingsRequest struct {
	ConversationID string `json:"conversation_id" query:"conversation_id"`
}

type memberSettingsResponse struct {
	Nickname     string `json:"nickname"`
	Muted        bool   `json:"muted"`
	AlertEnabled bool   `json:"alertEnabled"`
}

type updateMemberSettingsRequest struct {
	ConversationID string  `json:"conversation_id"`
	Nickname       *string `json:"nickname,omitempty"`
	Muted          *bool   `json:"muted,omitempty"`
}

// --- Handlers ---

func (s *subServer) handleListMessages(ctx context.Context, req *listMessagesRequest) (*listMessagesResponse, error) {
	if req.ConversationID == "" {
		return nil, server.BadRequest("conversation_id is required")
	}
	if err := s.requireActiveMembership(ctx, req.ConversationID); err != nil {
		return nil, err
	}
	limit := req.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	events, err := s.service.ListMessages(ctx, req.ConversationID, req.AfterSeq, limit)
	if err != nil {
		return nil, server.InternalErrorWithCause("list messages failed", err)
	}
	return &listMessagesResponse{
		Events:  events,
		HasMore: len(events) >= limit,
	}, nil
}

func (s *subServer) handleListThreadMessages(ctx context.Context, req *listThreadMessagesRequest) (*listMessagesResponse, error) {
	if req.ConversationID == "" || req.RootID == "" {
		return nil, server.BadRequest("conversation_id and root_id are required")
	}
	if err := s.requireActiveMembership(ctx, req.ConversationID); err != nil {
		return nil, err
	}
	limit := req.Limit
	if limit <= 0 {
		limit = 50
	}
	events, err := s.service.ListThreadMessages(ctx, req.ConversationID, req.RootID, req.AfterSeq, limit)
	if err != nil {
		return nil, server.InternalErrorWithCause("list thread messages failed", err)
	}
	return &listMessagesResponse{
		Events:  events,
		HasMore: len(events) >= limit,
	}, nil
}

func (s *subServer) handleGetThreadCounts(ctx context.Context, req *threadCountsRequest) (*threadCountsResponse, error) {
	if req.ConversationID == "" {
		return nil, server.BadRequest("conversation_id is required")
	}
	if err := s.requireActiveMembership(ctx, req.ConversationID); err != nil {
		return nil, err
	}
	summaries, err := s.service.GetThreadCounts(ctx, req.ConversationID, req.RootIDs)
	if err != nil {
		return nil, server.InternalErrorWithCause("get thread counts failed", err)
	}
	counts := make([]threadCountEntry, 0, len(req.RootIDs))
	for _, rootID := range req.RootIDs {
		summary := summaries[rootID]
		counts = append(counts, threadCountEntry{
			RootID:        rootID,
			ReplyCount:    summary.ReplyCount,
			LatestReplyID: summary.LatestReplyID,
			LatestReplyAt: summary.LatestReplyAtMs,
			UnreadCount:   0,
		})
	}
	return &threadCountsResponse{Counts: counts}, nil
}

func (s *subServer) handleSetReadCursor(ctx context.Context, req *setReadCursorRequest) (*setReadCursorResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.ConversationID == "" {
		return nil, server.BadRequest("conversation_id is required")
	}
	if err := s.requireActiveMembership(ctx, req.ConversationID); err != nil {
		return nil, err
	}
	if err := s.service.SetReadCursor(ctx, req.ConversationID, subject.ID, req.LastReadSeq); err != nil {
		return nil, server.InternalErrorWithCause("set read cursor failed", err)
	}
	return &setReadCursorResponse{Success: true}, nil
}

func (s *subServer) handleGetUnread(ctx context.Context, req *getUnreadRequest) (*getUnreadResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.ConversationID == "" {
		return nil, server.BadRequest("conversation_id is required")
	}
	if err := s.requireActiveMembership(ctx, req.ConversationID); err != nil {
		return nil, err
	}
	count, err := s.service.GetUnreadCount(ctx, req.ConversationID, subject.ID)
	if err != nil {
		return nil, server.InternalErrorWithCause("get unread count failed", err)
	}
	return &getUnreadResponse{UnreadCount: count}, nil
}

func (s *subServer) handleGetMemberSettings(ctx context.Context, req *getMemberSettingsRequest) (*memberSettingsResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.ConversationID == "" {
		return nil, server.BadRequest("conversation_id is required")
	}
	if err := s.requireActiveMembership(ctx, req.ConversationID); err != nil {
		return nil, err
	}
	member, err := s.service.GetMember(ctx, req.ConversationID, subject.ID)
	if err != nil {
		return nil, server.InternalErrorWithCause("get member settings failed", err)
	}
	return &memberSettingsResponse{
		Nickname:     member.Nickname,
		Muted:        member.Muted,
		AlertEnabled: !member.Muted,
	}, nil
}

func (s *subServer) handleUpdateMemberSettings(ctx context.Context, req *updateMemberSettingsRequest) (*memberSettingsResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.ConversationID == "" {
		return nil, server.BadRequest("conversation_id is required")
	}
	if err := s.requireActiveMembership(ctx, req.ConversationID); err != nil {
		return nil, err
	}
	member, err := s.service.GetMember(ctx, req.ConversationID, subject.ID)
	if err != nil {
		return nil, server.InternalErrorWithCause("get member settings failed", err)
	}
	if req.Nickname != nil {
		member.Nickname = *req.Nickname
	}
	if req.Muted != nil {
		member.Muted = *req.Muted
	}
	if err := s.service.UpsertMember(ctx, member); err != nil {
		return nil, server.InternalErrorWithCause("update member settings failed", err)
	}
	return &memberSettingsResponse{
		Nickname:     member.Nickname,
		Muted:        member.Muted,
		AlertEnabled: !member.Muted,
	}, nil
}
