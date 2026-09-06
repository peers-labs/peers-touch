package conversation

import (
	"context"

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
