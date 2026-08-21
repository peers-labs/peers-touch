package conversation

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
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

type getMemberSettingsRequest struct {
	ConversationID string `json:"conversation_id" query:"conversation_id"`
}

type memberSettingsResponse struct {
	Nickname        string `json:"nickname"`
	Muted           bool   `json:"muted"`
	AlertEnabled    bool   `json:"alertEnabled"`
	Pinned          bool   `json:"pinned"`
	Background      string `json:"background"`
	BackgroundImage string `json:"backgroundImage"`
	ClearedAtUnixMs int64  `json:"clearedAtUnixMs"`
}

type updateMemberSettingsRequest struct {
	ConversationID  string  `json:"conversation_id"`
	Nickname        *string `json:"nickname,omitempty"`
	Muted           *bool   `json:"muted,omitempty"`
	AlertEnabled    *bool   `json:"alertEnabled,omitempty"`
	Pinned          *bool   `json:"pinned,omitempty"`
	Background      *string `json:"background,omitempty"`
	BackgroundImage *string `json:"backgroundImage,omitempty"`
	ClearedAtUnixMs *int64  `json:"clearedAtUnixMs,omitempty"`
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
	settings, err := s.memberSettings.Get(ctx, req.ConversationID, subject.ID)
	if err != nil {
		return nil, server.InternalErrorWithCause("get member preferences failed", err)
	}
	return memberSettingsResponseFrom(member.Nickname, settings), nil
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
	if req.Muted != nil && req.AlertEnabled != nil && *req.Muted == *req.AlertEnabled {
		return nil, server.BadRequest("muted and alertEnabled conflict")
	}
	if req.Muted != nil && req.AlertEnabled == nil {
		alertEnabled := !*req.Muted
		req.AlertEnabled = &alertEnabled
	}
	if req.AlertEnabled != nil && req.Muted == nil {
		muted := !*req.AlertEnabled
		req.Muted = &muted
	}
	if req.BackgroundImage != nil {
		backgroundImage := strings.TrimSpace(*req.BackgroundImage)
		if backgroundImage != "" &&
			(!strings.HasPrefix(backgroundImage, "oss://") || len(backgroundImage) > 2048) {
			return nil, server.BadRequest("backgroundImage must be an OSS reference")
		}
		req.BackgroundImage = &backgroundImage
	}
	if req.Nickname != nil {
		member.Nickname = *req.Nickname
		if err := s.service.UpsertMember(ctx, member); err != nil {
			return nil, server.InternalErrorWithCause("update member nickname failed", err)
		}
	}
	settings, err := s.memberSettings.Update(ctx, req.ConversationID, subject.ID, memberSettingsPatch{
		Muted:               req.Muted,
		Pinned:              req.Pinned,
		AlertEnabled:        req.AlertEnabled,
		Background:          req.Background,
		BackgroundImage:     req.BackgroundImage,
		ClearedAtUnixMillis: req.ClearedAtUnixMs,
	})
	if err != nil {
		return nil, server.InternalErrorWithCause("update member preferences failed", err)
	}
	if err := s.publishMemberSettingsChanged(ctx, req.ConversationID, subject.ID); err != nil {
		return nil, server.InternalErrorWithCause("publish member settings change failed", err)
	}
	return memberSettingsResponseFrom(member.Nickname, settings), nil
}

func memberSettingsResponseFrom(
	nickname string,
	settings memberSettingsProjection,
) *memberSettingsResponse {
	return &memberSettingsResponse{
		Nickname:        nickname,
		Muted:           settings.Muted,
		AlertEnabled:    settings.AlertEnabled,
		Pinned:          settings.Pinned,
		Background:      settings.Background,
		BackgroundImage: settings.BackgroundImage,
		ClearedAtUnixMs: settings.ClearedAtUnixMillis,
	}
}

func (s *subServer) publishMemberSettingsChanged(
	ctx context.Context,
	conversationID string,
	ptid string,
) error {
	bus := events.GetBus()
	if bus == nil {
		return fmt.Errorf("conversation settings event bus is unavailable")
	}
	actor, err := touchactor.GetActorByPTID(ctx, ptid)
	if err != nil || actor == nil {
		return fmt.Errorf("resolve settings actor %q: %w", ptid, err)
	}
	conversation, err := s.service.GetConversation(ctx, conversationID)
	if err != nil {
		return fmt.Errorf("resolve settings conversation %q: %w", conversationID, err)
	}
	kind := realtime.ConversationSettingsChanged_FRIEND
	if conversation.Kind == chat.ConversationKind_CONVERSATION_KIND_GROUP {
		kind = realtime.ConversationSettingsChanged_GROUP
	}
	_, err = bus.Publish(fmt.Sprintf("%d", actor.ID), &realtime.StreamEvent{
		Kind: &realtime.StreamEvent_ConversationSettingsChanged{
			ConversationSettingsChanged: &realtime.ConversationSettingsChanged{
				ContainerUlid:   conversationID,
				Kind:            kind,
				ActorId:         ptid,
				ChangedTsUnixMs: time.Now().UnixMilli(),
			},
		},
	})
	return err
}
