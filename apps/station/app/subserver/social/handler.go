package social

import (
	"context"
	"fmt"
	"math"
	nethttp "net/http"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Route constants. The legacy `/api/v1/social/posts*` routes are
// preserved for backward compatibility with the desktop scaffold; new
// clients SHOULD prefer the `/api/v1/social/moments*` family which
// exposes the Audience-aware semantics directly. Both groups route to
// the same MomentService internally.
//
// Reactions and circles are first-class P1 surfaces with their own
// route prefixes.
const (
	// Posts (legacy aliases)
	routeSocialPosts        = "/api/v1/social/posts"
	routeSocialPost         = "/api/v1/social/posts/:id"
	routeSocialPostRepost   = "/api/v1/social/posts/:id/repost"
	routeSocialPostComments = "/api/v1/social/posts/:id/comments"
	routeSocialUserPosts    = "/api/v1/social/users/:userId/posts"

	// Moments (preferred)
	routeSocialMoments       = "/api/v1/social/moments"
	routeSocialMoment        = "/api/v1/social/moments/:id"
	routeSocialMomentComment = "/api/v1/social/moments/:id/comments"

	// Reactions
	routeSocialPostReact   = "/api/v1/social/posts/:id/react"
	routeSocialPostUnreact = "/api/v1/social/posts/:id/unreact"

	// Comments (top-level)
	routeSocialComment = "/api/v1/social/comments/:commentId"

	// Timeline
	routeSocialTimeline    = "/api/v1/social/timeline"
	routeSocialMomentsSync = "/api/v1/social/moments/sync"

	// Relationships
	routeSocialFollow       = "/api/v1/social/relationships/follow"
	routeSocialUnfollow     = "/api/v1/social/relationships/unfollow"
	routeSocialRelationship = "/api/v1/social/relationships"
	routeSocialFollowers    = "/api/v1/social/relationships/followers"
	routeSocialFollowing    = "/api/v1/social/relationships/following"

	// User search / me
	routeSocialUserSearch = "/api/v1/social/users/search"
	routeSocialUserMe     = "/api/v1/social/users/me"

	// Self-stats (drives the user-side dashboard panel)
	routeSocialMyStats = "/api/v1/social/me/stats"

	// Moderation / Station trust policy
	routeSocialStationModeration = "/api/v1/social/moderation/stations"

	// Circles
	routeSocialCircles      = "/api/v1/social/circles"
	routeSocialCircle       = "/api/v1/social/circles/:id"
	routeSocialCircleMember = "/api/v1/social/circles/:id/members"

	// Friend Requests
	routeSocialFriendRequestSend   = "/api/v1/social/friend-request/send"
	routeSocialFriendRequestAccept = "/api/v1/social/friend-request/accept"
	routeSocialFriendRequestReject = "/api/v1/social/friend-request/reject"
	routeSocialFriendRequests      = "/api/v1/social/friend-requests"
)

func (s *subServer) Handlers() []server.Handler {
	cw := s.commonWrapper
	jw := s.jwtWrapper
	deviceIDWrapper := serverwrapper.DeviceID()

	return []server.Handler{
		// Moments / Posts (write)
		server.NewTypedHandler("social-create-post", routeSocialPosts, server.POST, s.handleCreatePost, cw, jw),
		server.NewTypedHandler("social-create-moment", routeSocialMoments, server.POST, s.handleCreatePost, cw, jw),
		server.NewTypedHandler("social-update-post", routeSocialPost, server.PUT, s.handleUpdatePost, cw, jw),
		server.NewTypedHandler("social-delete-post", routeSocialPost, server.DELETE, s.handleDeletePost, cw, jw),
		server.NewTypedHandler("social-delete-moment", routeSocialMoment, server.DELETE, s.handleDeletePost, cw, jw),
		server.NewTypedHandler("social-repost-post", routeSocialPostRepost, server.POST, s.handleRepostPost, cw, jw),

		// Moments / Posts (read)
		server.NewTypedHandler("social-get-post", routeSocialPost, server.GET, s.handleGetPost, cw),
		server.NewTypedHandler("social-get-moment", routeSocialMoment, server.GET, s.handleGetPost, cw),
		server.NewTypedHandler("social-get-timeline", routeSocialTimeline, server.GET, s.handleGetTimeline, cw, jw),
		server.NewTypedHandler("social-sync-moments-projection", routeSocialMomentsSync, server.POST, s.handleSyncMomentsProjection, cw, jw),
		server.NewTypedHandler("social-get-user-posts", routeSocialUserPosts, server.GET, s.handleGetUserPosts, cw, jw),

		// Reactions
		server.NewTypedHandler("social-react", routeSocialPostReact, server.POST, s.handleReact, cw, jw),
		server.NewTypedHandler("social-unreact", routeSocialPostUnreact, server.POST, s.handleUnreact, cw, jw),

		// Comments
		server.NewTypedHandler("social-get-post-comments", routeSocialPostComments, server.GET, s.handleGetPostComments, cw),
		server.NewTypedHandler("social-get-moment-comments", routeSocialMomentComment, server.GET, s.handleGetPostComments, cw),
		server.NewTypedHandler("social-create-comment", routeSocialPostComments, server.POST, s.handleCreateComment, cw, jw),
		server.NewTypedHandler("social-create-moment-comment", routeSocialMomentComment, server.POST, s.handleCreateComment, cw, jw),
		server.NewTypedHandler("social-delete-comment", routeSocialComment, server.DELETE, s.handleDeleteComment, cw, jw),

		// Relationships
		server.NewTypedHandler("social-follow", routeSocialFollow, server.POST, s.handleFollow, cw, jw),
		server.NewTypedHandler("social-unfollow", routeSocialUnfollow, server.POST, s.handleUnfollow, cw, jw),
		server.NewTypedHandler("social-get-relationship", routeSocialRelationship, server.GET, s.handleGetRelationship, cw, jw),
		server.NewTypedHandler("social-get-relationships", routeSocialRelationship, server.POST, s.handleGetRelationships, cw, jw),
		server.NewTypedHandler("social-get-followers", routeSocialFollowers, server.GET, s.handleGetFollowers, cw, jw),
		server.NewTypedHandler("social-get-following", routeSocialFollowing, server.GET, s.handleGetFollowing, cw, jw),

		// User search / me
		server.NewTypedHandler("social-search-users", routeSocialUserSearch, server.GET, s.handleSearchUsers, cw, jw),
		server.NewTypedHandler("social-get-me", routeSocialUserMe, server.GET, s.handleGetMe, cw, jw),
		server.NewTypedHandler("social-my-stats", routeSocialMyStats, server.GET, s.handleGetMyStats, cw, jw),

		// Moderation
		server.NewTypedHandler("social-upsert-station-moderation", routeSocialStationModeration, server.POST, s.handleUpsertStationModerationPolicy, cw, jw),
		server.NewTypedHandler("social-list-station-moderation", routeSocialStationModeration, server.GET, s.handleListStationModerationPolicies, cw, jw),
		server.NewTypedHandler("social-delete-station-moderation", routeSocialStationModeration, server.DELETE, s.handleDeleteStationModerationPolicy, cw, jw),

		// Circles
		server.NewTypedHandler("social-create-circle", routeSocialCircles, server.POST, s.handleCreateCircle, cw, jw),
		server.NewTypedHandler("social-list-circles", routeSocialCircles, server.GET, s.handleListMyCircles, cw, jw),
		server.NewTypedHandler("social-rename-circle", routeSocialCircle, server.PUT, s.handleRenameCircle, cw, jw),
		server.NewTypedHandler("social-delete-circle", routeSocialCircle, server.DELETE, s.handleDeleteCircle, cw, jw),
		server.NewTypedHandler("social-add-circle-member", routeSocialCircleMember, server.POST, s.handleAddCircleMembers, cw, jw),
		server.NewTypedHandler("social-remove-circle-member", routeSocialCircleMember, server.DELETE, s.handleRemoveCircleMembers, cw, jw),
		server.NewTypedHandler("social-list-circle-members", routeSocialCircleMember, server.GET, s.handleListCircleMembers, cw, jw),

		// Friend Requests
		server.NewTypedHandler("social-send-friend-request", routeSocialFriendRequestSend, server.POST, s.handleSendFriendRequest, cw, deviceIDWrapper, jw),
		server.NewTypedHandler("social-accept-friend-request", routeSocialFriendRequestAccept, server.POST, s.handleAcceptFriendRequest, cw, deviceIDWrapper, jw),
		server.NewTypedHandler("social-reject-friend-request", routeSocialFriendRequestReject, server.POST, s.handleRejectFriendRequest, cw, deviceIDWrapper, jw),
		server.NewTypedHandler("social-list-friend-requests", routeSocialFriendRequests, server.GET, s.handleListFriendRequests, cw, jw),
	}
}

// getUserID extracts the authenticated user ID from context.
func getUserID(c context.Context) (uint64, bool) {
	subject := coreauth.GetSubject(c)
	if subject == nil {
		return 0, false
	}
	record, err := actor.GetActorByPTID(c, subject.ID)
	if err != nil || record == nil {
		return 0, false
	}
	return record.ID, true
}

func getActorPTID(c context.Context) (string, bool) {
	subject := coreauth.GetSubject(c)
	if subject == nil || strings.TrimSpace(subject.ID) == "" {
		return "", false
	}
	return subject.ID, true
}

// --- Post / Moment handlers --------------------------------------------------

func (s *subServer) handleCreatePost(ctx context.Context, req *model.CreatePostRequest) (*model.CreatePostResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req == nil {
		return nil, server.BadRequest("request body is required")
	}
	if req.Audience == nil {
		// Backward-compat: synthesize an Audience from the legacy
		// `visibility` field for clients that haven't migrated yet.
		req.Audience = audienceFromLegacyVisibility(req.Visibility)
	}
	post, err := s.momentSvc.CreateMoment(ctx, req, actorPTID)
	if err != nil {
		logger.Error(ctx, "failed to create moment", "error", err, "audience_kind", req.Audience.Kind)
		return nil, server.InternalErrorWithCause("failed to create moment", err)
	}
	return &model.CreatePostResponse{Post: post}, nil
}

// handleUpdatePost is intentionally unsupported in v1 — the new
// audience model freezes audience at creation, and editing the body
// after publication needs a separate edit-history pipeline that's out
// of scope. Returns a clear 501.
func (s *subServer) handleUpdatePost(_ context.Context, _ *model.UpdatePostRequest) (*model.UpdatePostResponse, error) {
	return nil, server.BadRequest("post update is not supported in v1; delete and re-create instead")
}

func (s *subServer) handleDeletePost(ctx context.Context, req *model.DeletePostRequest) (*model.DeletePostResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}
	if err := s.momentSvc.DeleteMoment(ctx, req.PostId, actorPTID); err != nil {
		logger.Error(ctx, "failed to delete moment", "error", err, "post_id", req.PostId)
		return nil, server.InternalErrorWithCause("failed to delete moment", err)
	}
	return &model.DeletePostResponse{Success: true}, nil
}

// handleRepostPost wraps the legacy `/repost` endpoint by constructing
// a CreatePostRequest with `Type=REPOST` and forwarding to MomentService.
func (s *subServer) handleRepostPost(ctx context.Context, req *model.RepostRequest) (*model.RepostResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}
	createReq := &model.CreatePostRequest{
		Type:     model.PostType_REPOST,
		Audience: &model.Audience{Kind: model.Audience_PUBLIC},
		Content: &model.CreatePostRequest_Repost{
			Repost: &model.CreateRepostRequest{
				OriginalPostId: req.PostId,
				Comment:        req.GetComment(),
			},
		},
	}
	post, err := s.momentSvc.CreateMoment(ctx, createReq, actorPTID)
	if err != nil {
		logger.Error(ctx, "failed to repost", "error", err, "original_post_id", req.PostId)
		return nil, server.InternalErrorWithCause("failed to repost", err)
	}
	return &model.RepostResponse{Repost: post}, nil
}

func (s *subServer) handleGetPost(ctx context.Context, req *model.GetPostRequest) (*model.GetPostResponse, error) {
	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}
	var viewerPTID string
	if ptid, ok := getActorPTID(ctx); ok {
		viewerPTID = ptid
	}
	post, err := s.momentSvc.GetMoment(ctx, req.PostId, viewerPTID)
	if err != nil {
		logger.Error(ctx, "failed to get post", "error", err, "post_id", req.PostId)
		return nil, server.InternalErrorWithCause("failed to get post", err)
	}
	if post == nil {
		return nil, server.NotFound("post not found")
	}
	if blocked, err := s.moderationSvc.IsPostAuthorStationBlocked(ctx, post); err != nil {
		return nil, server.InternalErrorWithCause("station moderation check failed", err)
	} else if blocked {
		return nil, server.NotFound("post not found")
	}
	return &model.GetPostResponse{
		Post:        post,
		Explanation: application.BuildFeedObjectExplanation(post, model.RelationshipReason_RELATIONSHIP_REASON_PROFILE_VIEW),
	}, nil
}

func (s *subServer) handleGetUserPosts(ctx context.Context, req *model.ListPostsRequest) (*model.ListPostsResponse, error) {
	if req.Filter == nil {
		req.Filter = &model.PostFilter{}
	}
	authorPTID := req.Filter.AuthorPtid
	if authorPTID == "" {
		return nil, server.BadRequest("author_ptid is required")
	}
	var viewerPTID string
	if ptid, ok := getActorPTID(ctx); ok {
		viewerPTID = ptid
	}

	posts, nextCursor, hasMore, err := s.momentSvc.ListByAuthor(ctx, authorPTID, viewerPTID, "", int(req.Limit))
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to list user posts", err)
	}
	return &model.ListPostsResponse{
		Posts:        posts,
		NextCursor:   nextCursor,
		HasMore:      hasMore,
		Explanations: buildProfileExplanations(posts),
	}, nil
}

func buildProfileExplanations(posts []*model.Post) []*model.FeedObjectExplanation {
	if len(posts) == 0 {
		return nil
	}

	explanations := make([]*model.FeedObjectExplanation, 0, len(posts))
	for _, post := range posts {
		explanation := application.BuildFeedObjectExplanation(post, model.RelationshipReason_RELATIONSHIP_REASON_PROFILE_VIEW)
		if explanation != nil {
			explanations = append(explanations, explanation)
		}
	}
	return explanations
}

// --- Reaction handlers ----------------------------------------------------

func (s *subServer) handleReact(ctx context.Context, req *model.ReactToPostRequest) (*model.ReactToPostResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}
	if req.Kind == model.ReactionKind_REACTION_UNSPECIFIED {
		return nil, server.BadRequest("reaction kind is required")
	}
	if err := s.assertReadable(ctx, req.PostId, actorPTID); err != nil {
		return nil, err
	}
	summaries, err := s.reactionSvc.React(ctx, req.PostId, actorPTID, req.Kind)
	if err != nil {
		return nil, server.InternalErrorWithCause("react failed", err)
	}
	return &model.ReactToPostResponse{Success: true, Reactions: summaries}, nil
}

func (s *subServer) handleUnreact(ctx context.Context, req *model.UnreactToPostRequest) (*model.UnreactToPostResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}
	if err := s.assertReadable(ctx, req.PostId, actorPTID); err != nil {
		return nil, err
	}
	summaries, err := s.reactionSvc.Unreact(ctx, req.PostId, actorPTID, req.Kind)
	if err != nil {
		return nil, server.InternalErrorWithCause("unreact failed", err)
	}
	return &model.UnreactToPostResponse{Success: true, Reactions: summaries}, nil
}

// assertReadable is the single-source-of-truth visibility gate used by
// every endpoint that mutates a post-bound resource WITHOUT going
// through MomentService directly (React / Unreact / list-comments).
//
// It must be called BEFORE the underlying service operates on the
// post — otherwise the service would happily write a row keyed on a
// post id the caller has no right to know exists, leaking existence
// + state through side-channels (reaction count bumps, comment-list
// non-emptiness).
//
// The check is intentionally identical in shape to the read path:
// MomentService.GetMoment applies CanRead with the viewer's own
// relationship graph. A nil result here means "post doesn't exist OR
// caller can't read it" — surfaced as 404, never 403, so the wire
// shape doesn't disclose existence to non-readers.
func (s *subServer) assertReadable(ctx context.Context, postID, viewerPTID string) error {
	post, err := s.momentSvc.GetMoment(ctx, postID, viewerPTID)
	if err != nil {
		return server.InternalErrorWithCause("visibility check failed", err)
	}
	if post == nil {
		return server.NotFound("post not found")
	}
	return nil
}

// --- Comment handlers ----------------------------------------------------

func (s *subServer) handleGetPostComments(ctx context.Context, req *model.GetCommentsRequest) (*model.GetCommentsResponse, error) {
	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}
	postID := domain.ParseID(req.PostId)
	if postID == 0 {
		return nil, server.BadRequest("invalid post_id")
	}
	// Comments inherit visibility from the parent post — gate on the
	// parent BEFORE listing rows, otherwise we'd happily return a
	// SELF post's comment thread to anyone holding the post id.
	// Anonymous viewers (viewerID == 0) get the same gate; PUBLIC
	// posts pass, anything else 404s on them.
	var viewerPTID string
	if ptid, ok := getActorPTID(ctx); ok {
		viewerPTID = ptid
	}
	resp, err := s.commentSvc.ListByPost(ctx, postID, viewerPTID, req.Cursor, int(req.Limit))
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to list comments", err)
	}
	return resp, nil
}

func (s *subServer) handleCreateComment(ctx context.Context, req *model.CreateCommentRequest) (*model.CreateCommentResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}
	postID := domain.ParseID(req.PostId)
	if postID == 0 {
		return nil, server.BadRequest("invalid post_id")
	}
	comment, err := s.commentSvc.CreateComment(ctx, req, postID, actorPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to create comment", err)
	}
	return &model.CreateCommentResponse{Comment: comment}, nil
}

func (s *subServer) handleDeleteComment(ctx context.Context, req *model.DeleteCommentRequest) (*model.DeleteCommentResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.CommentId == "" {
		return nil, server.BadRequest("comment_id is required")
	}
	commentID := domain.ParseID(req.CommentId)
	if commentID == 0 {
		return nil, server.BadRequest("invalid comment_id")
	}
	if err := s.commentSvc.DeleteComment(ctx, commentID, actorPTID); err != nil {
		return nil, server.InternalErrorWithCause("failed to delete comment", err)
	}
	return &model.DeleteCommentResponse{Success: true}, nil
}

// --- Timeline handler ----------------------------------------------------

func (s *subServer) handleGetTimeline(ctx context.Context, req *model.GetTimelineRequest) (*model.GetTimelineResponse, error) {
	var viewerPTID string
	if ptid, ok := getActorPTID(ctx); ok {
		viewerPTID = ptid
	}
	resp, err := s.timelineSvc.GetTimeline(ctx, req, viewerPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get timeline", err)
	}
	return resp, nil
}

func (s *subServer) handleSyncMomentsProjection(ctx context.Context, req *model.SyncMomentsProjectionRequest) (*model.SyncMomentsProjectionResponse, error) {
	viewerPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req == nil {
		req = &model.SyncMomentsProjectionRequest{}
	}
	limit := req.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}

	home, err := s.timelineSvc.GetTimeline(ctx, &model.GetTimelineRequest{
		Type:   model.TimelineType_TIMELINE_HOME,
		Cursor: req.HomeCursor,
		Limit:  limit,
	}, viewerPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to sync home moments projection", err)
	}

	public, err := s.timelineSvc.GetTimeline(ctx, &model.GetTimelineRequest{
		Type:   model.TimelineType_TIMELINE_PUBLIC,
		Cursor: req.PublicCursor,
		Limit:  limit,
		Sort:   req.PublicSort,
	}, viewerPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to sync public moments projection", err)
	}

	return &model.SyncMomentsProjectionResponse{
		HomeTimeline:   home,
		PublicTimeline: public,
		SyncToken:      fmt.Sprintf("%s:%s", home.GetNextCursor(), public.GetNextCursor()),
	}, nil
}

// --- Relationship handlers ----------------------------------------------------

func (s *subServer) handleFollow(ctx context.Context, req *model.FollowRequest) (*model.FollowResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.TargetActorPtid == "" {
		return nil, server.BadRequest("target_actor_ptid is required")
	}
	relationship, err := s.relationshipSvc.Follow(ctx, actorPTID, req.TargetActorPtid)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to follow", err)
	}
	return &model.FollowResponse{Success: true, Relationship: relationship}, nil
}

func (s *subServer) handleUnfollow(ctx context.Context, req *model.UnfollowRequest) (*model.UnfollowResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.TargetActorPtid == "" {
		return nil, server.BadRequest("target_actor_ptid is required")
	}
	if err := s.relationshipSvc.Unfollow(ctx, actorPTID, req.TargetActorPtid); err != nil {
		return nil, server.InternalErrorWithCause("failed to unfollow", err)
	}
	return &model.UnfollowResponse{Success: true}, nil
}

func (s *subServer) handleGetRelationship(ctx context.Context, req *model.GetRelationshipRequest) (*model.GetRelationshipResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.TargetActorPtid == "" {
		return nil, server.BadRequest("target_actor_ptid is required")
	}
	rel, err := s.relationshipSvc.GetRelationship(ctx, actorPTID, req.TargetActorPtid)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get relationship", err)
	}
	return &model.GetRelationshipResponse{Relationship: rel}, nil
}

func (s *subServer) handleGetRelationships(ctx context.Context, req *model.GetRelationshipsRequest) (*model.GetRelationshipsResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	rels, err := s.relationshipSvc.GetRelationships(ctx, actorPTID, req.TargetActorPtids)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get relationships", err)
	}
	return &model.GetRelationshipsResponse{Relationships: rels}, nil
}

func (s *subServer) handleGetFollowers(ctx context.Context, req *model.GetFollowersRequest) (*model.GetFollowersResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	targetActorPTID := actorPTID
	if req.ActorPtid != "" {
		targetActorPTID = req.ActorPtid
	}
	limit := int(req.Limit)
	if limit <= 0 {
		limit = 20
	}
	followers, nextCursor, total, err := s.relationshipSvc.GetFollowers(ctx, targetActorPTID, req.Cursor, limit)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get followers", err)
	}
	return &model.GetFollowersResponse{Followers: followers, NextCursor: nextCursor, Total: total}, nil
}

func (s *subServer) handleGetFollowing(ctx context.Context, req *model.GetFollowingRequest) (*model.GetFollowingResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	targetActorPTID := actorPTID
	if req.ActorPtid != "" {
		targetActorPTID = req.ActorPtid
	}
	limit := int(req.Limit)
	if limit <= 0 {
		limit = 20
	}
	following, nextCursor, total, err := s.relationshipSvc.GetFollowing(ctx, targetActorPTID, req.Cursor, limit)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get following", err)
	}
	return &model.GetFollowingResponse{Following: following, NextCursor: nextCursor, Total: total}, nil
}

// --- User search / me ----------------------------------------------------

func (s *subServer) handleSearchUsers(ctx context.Context, req *model.SearchUsersRequest) (*model.ActorList, error) {
	userID, ok := getUserID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.Q == "" {
		return nil, server.BadRequest("query parameter 'q' is required")
	}
	actors, err := actor.SearchActors(ctx, req.Q, userID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to search users", err)
	}
	items := make([]*model.Actor, 0, len(actors))
	for _, a := range actors {
		blocked, err := s.moderationSvc.IsStationBlocked(ctx, a.HomeStationDomain, a.HomeStationPeerID)
		if err != nil {
			return nil, server.InternalErrorWithCause("station moderation check failed", err)
		}
		if blocked {
			continue
		}
		items = append(items, actorSearchResult(a))
	}
	return &model.ActorList{Items: items, Total: int64(len(items))}, nil
}

func actorSearchResult(a *db.Actor) *model.Actor {
	return &model.Actor{
		Username:          a.PreferredUsername,
		DisplayName:       a.Name,
		Email:             a.Email,
		Avatar:            a.Icon,
		FederatedHandle:   a.FederatedHandle,
		HomeStationPeerId: a.HomeStationPeerID,
		HomeStationDomain: a.HomeStationDomain,
		Ref:               actor.ProtoActorRef(a, ""),
	}
}

func (s *subServer) handleGetMe(ctx context.Context, _ *model.GetMeRequest) (*model.ActorProfile, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	a, err := actor.GetActorByPTID(ctx, actorPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get current user", err)
	}
	return &model.ActorProfile{
		Id:           a.PTID,
		DisplayName:  a.Name,
		Username:     a.PreferredUsername,
		Avatar:       a.Icon,
		ServerDomain: a.HomeStationDomain,
		Acct:         a.FederatedHandle,
		Ref:          actor.ProtoActorRef(a, ""),
	}, nil
}

// --- Circle handlers ----------------------------------------------------

func (s *subServer) handleCreateCircle(ctx context.Context, req *model.CreateCircleRequest) (*model.CreateCircleResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	c, err := s.circleSvc.Create(ctx, req, actorPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to create circle", err)
	}
	return &model.CreateCircleResponse{Circle: c}, nil
}

func (s *subServer) handleListMyCircles(ctx context.Context, req *model.ListMyCirclesRequest) (*model.ListMyCirclesResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	resp, err := s.circleSvc.ListMine(ctx, actorPTID, req.Cursor, int(req.Limit))
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to list circles", err)
	}
	return resp, nil
}

func (s *subServer) handleRenameCircle(ctx context.Context, req *model.RenameCircleRequest) (*model.RenameCircleResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	c, err := s.circleSvc.Rename(ctx, req, actorPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to rename circle", err)
	}
	return &model.RenameCircleResponse{Circle: c}, nil
}

func (s *subServer) handleDeleteCircle(ctx context.Context, req *model.DeleteCircleRequest) (*model.DeleteCircleResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if err := s.circleSvc.Delete(ctx, req.CircleId, actorPTID); err != nil {
		return nil, server.InternalErrorWithCause("failed to delete circle", err)
	}
	return &model.DeleteCircleResponse{Success: true}, nil
}

func (s *subServer) handleAddCircleMembers(ctx context.Context, req *model.AddCircleMemberRequest) (*model.AddCircleMemberResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	added, total, err := s.circleSvc.AddMembers(ctx, req, actorPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to add circle members", err)
	}
	return &model.AddCircleMemberResponse{AddedCount: added, MemberCount: total}, nil
}

func (s *subServer) handleRemoveCircleMembers(ctx context.Context, req *model.RemoveCircleMemberRequest) (*model.RemoveCircleMemberResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	removed, total, err := s.circleSvc.RemoveMembers(ctx, req, actorPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to remove circle members", err)
	}
	return &model.RemoveCircleMemberResponse{RemovedCount: removed, MemberCount: total}, nil
}

func (s *subServer) handleListCircleMembers(ctx context.Context, req *model.ListCircleMembersRequest) (*model.ListCircleMembersResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	resp, err := s.circleSvc.ListMembers(ctx, req, actorPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to list circle members", err)
	}
	return resp, nil
}

// --- Stats ---------------------------------------------------------

func (s *subServer) handleGetMyStats(ctx context.Context, _ *model.GetMyMomentsStatsRequest) (*model.GetMyMomentsStatsResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	stats, err := s.statsSvc.MyStats(ctx, actorPTID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to compute moments stats", err)
	}
	return &model.GetMyMomentsStatsResponse{
		PostsCount:             stats.PostsCount,
		CommentsCount:          stats.CommentsCount,
		ReactionsGivenCount:    stats.ReactionsGivenCount,
		CommentsReceivedCount:  stats.CommentsReceivedCount,
		ReactionsReceivedCount: stats.ReactionsReceivedCount,
		FollowingCount:         stats.FollowingCount,
		FollowersCount:         stats.FollowersCount,
		CirclesCount:           stats.CirclesCount,
	}, nil
}

// --- Moderation ---------------------------------------------------------

func (s *subServer) handleUpsertStationModerationPolicy(
	ctx context.Context,
	req *model.UpsertStationModerationPolicyRequest,
) (*model.UpsertStationModerationPolicyResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	policy, err := s.moderationSvc.UpsertStationPolicy(ctx, req, actorPTID)
	if err != nil {
		return nil, server.BadRequest(err.Error())
	}
	return &model.UpsertStationModerationPolicyResponse{Policy: policy}, nil
}

func (s *subServer) handleDeleteStationModerationPolicy(
	ctx context.Context,
	req *model.DeleteStationModerationPolicyRequest,
) (*model.DeleteStationModerationPolicyResponse, error) {
	if _, ok := getActorPTID(ctx); !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if err := s.moderationSvc.DeleteStationPolicy(ctx, req); err != nil {
		return nil, server.BadRequest(err.Error())
	}
	return &model.DeleteStationModerationPolicyResponse{Success: true}, nil
}

func (s *subServer) handleListStationModerationPolicies(
	ctx context.Context,
	req *model.ListStationModerationPoliciesRequest,
) (*model.ListStationModerationPoliciesResponse, error) {
	if _, ok := getActorPTID(ctx); !ok {
		return nil, server.Unauthorized("authentication required")
	}
	resp, err := s.moderationSvc.ListStationPolicies(ctx, req)
	if err != nil {
		return nil, server.BadRequest(err.Error())
	}
	return resp, nil
}

// --- Helpers ----------------------------------------------------

// audienceFromLegacyVisibility synthesizes an Audience from the old
// `PostVisibility` enum so legacy clients (without an audience field)
// still get a sensible default during the transition window.
func audienceFromLegacyVisibility(v model.PostVisibility) *model.Audience {
	switch v {
	case model.PostVisibility_PRIVATE:
		return &model.Audience{Kind: model.Audience_SELF}
	case model.PostVisibility_FOLLOWERS_ONLY:
		return &model.Audience{Kind: model.Audience_FOLLOWERS}
	default:
		return &model.Audience{Kind: model.Audience_PUBLIC}
	}
}

// --- Friend Request handlers -------------------------------------------------

type federatedFriendRequestAPI interface {
	SubmitFriendRequestCommand(
		context.Context,
		*model.FriendRequestCommand,
	) (application.SubmitFriendRequestCommandResult, error)
	ListFriendRequestProjections(
		context.Context,
		string,
		model.FriendRequestState,
		int32,
		int32,
	) ([]domain.FriendRequestProjection, int64, error)
}

func (s *subServer) handleSendFriendRequest(
	ctx context.Context,
	req *model.SendSocialFriendRequestRequest,
) (*model.SendSocialFriendRequestResponse, error) {
	actorPTID, deviceID, api, err := s.authenticatedFriendRequestAPI(ctx)
	if err != nil {
		return nil, err
	}

	projection, err := submitFriendRequestCommand(
		ctx,
		actorPTID,
		deviceID,
		req.GetCommand(),
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		api,
	)
	if err != nil {
		return nil, err
	}
	return &model.SendSocialFriendRequestResponse{
		Request: socialFriendRequestFromProjection(projection),
	}, nil
}

func (s *subServer) handleAcceptFriendRequest(
	ctx context.Context,
	req *model.AcceptSocialFriendRequestRequest,
) (*model.AcceptSocialFriendRequestResponse, error) {
	actorPTID, deviceID, api, err := s.authenticatedFriendRequestAPI(ctx)
	if err != nil {
		return nil, err
	}

	projection, err := submitFriendRequestCommand(
		ctx,
		actorPTID,
		deviceID,
		req.GetCommand(),
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_ACCEPT,
		api,
	)
	if err != nil {
		return nil, err
	}
	return &model.AcceptSocialFriendRequestResponse{
		Request: socialFriendRequestFromProjection(projection),
	}, nil
}

func (s *subServer) handleRejectFriendRequest(
	ctx context.Context,
	req *model.RejectSocialFriendRequestRequest,
) (*model.RejectSocialFriendRequestResponse, error) {
	actorPTID, deviceID, api, err := s.authenticatedFriendRequestAPI(ctx)
	if err != nil {
		return nil, err
	}

	projection, err := submitFriendRequestCommand(
		ctx,
		actorPTID,
		deviceID,
		req.GetCommand(),
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_REJECT,
		api,
	)
	if err != nil {
		return nil, err
	}
	return &model.RejectSocialFriendRequestResponse{
		Request: socialFriendRequestFromProjection(projection),
	}, nil
}

func (s *subServer) handleListFriendRequests(
	ctx context.Context,
	req *model.ListSocialFriendRequestsRequest,
) (*model.ListSocialFriendRequestsResponse, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	api, err := s.canonicalFriendRequestAPI()
	if err != nil {
		return nil, err
	}

	return handleListFriendRequestsWithAPI(ctx, actorPTID, req, api)
}

func handleListFriendRequestsWithAPI(
	ctx context.Context,
	actorPTID string,
	req *model.ListSocialFriendRequestsRequest,
	api federatedFriendRequestAPI,
) (*model.ListSocialFriendRequestsResponse, error) {
	if req == nil {
		return nil, server.BadRequest("request body is required")
	}

	projections, total, err := api.ListFriendRequestProjections(
		ctx,
		actorPTID,
		req.GetState(),
		req.GetLimit(),
		req.GetOffset(),
	)
	if err != nil {
		return nil, mapFederatedFriendRequestError(
			ctx,
			"list Friend Requests",
			err,
		)
	}
	if total > math.MaxInt32 {
		return nil, server.InternalErrorWithCause(
			"Friend Request projection count exceeds the public API range",
			fmt.Errorf("projection count %d exceeds int32", total),
		)
	}
	requests := make([]*model.SocialFriendRequest, 0, len(projections))
	for _, projection := range projections {
		request := socialFriendRequestFromProjection(projection)
		if request == nil {
			return nil, server.InternalError(
				"Friend Request projection is missing its request identity",
			)
		}
		requests = append(requests, request)
	}
	return &model.ListSocialFriendRequestsResponse{
		Requests: requests,
		Total:    int32(total),
	}, nil
}

func (s *subServer) canonicalFriendRequestAPI() (
	federatedFriendRequestAPI,
	error,
) {
	if s == nil || s.federatedFriendRequestSvc == nil {
		return nil, server.InternalError(
			"federated Friend Request service is not initialized",
		)
	}
	return s.federatedFriendRequestSvc, nil
}

func (s *subServer) authenticatedFriendRequestAPI(
	ctx context.Context,
) (string, string, federatedFriendRequestAPI, error) {
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		return "", "", nil, server.Unauthorized(
			"authenticated Friend Request actor required",
		)
	}
	deviceID := strings.TrimSpace(serverwrapper.GetDeviceID(ctx))
	if deviceID == "" {
		return "", "", nil, server.Unauthorized(
			"authenticated Friend Request device required",
		)
	}
	api, err := s.canonicalFriendRequestAPI()
	if err != nil {
		return "", "", nil, err
	}
	return strings.TrimSpace(actorPTID), deviceID, api, nil
}

func submitFriendRequestCommand(
	ctx context.Context,
	authenticatedActorPTID string,
	authenticatedDeviceID string,
	command *model.FriendRequestCommand,
	expectedAction model.FriendRequestAction,
	api federatedFriendRequestAPI,
) (domain.FriendRequestProjection, error) {
	if api == nil {
		return domain.FriendRequestProjection{}, server.InternalError(
			"federated Friend Request service is not initialized",
		)
	}
	if strings.TrimSpace(authenticatedActorPTID) == "" ||
		strings.TrimSpace(authenticatedDeviceID) == "" {
		return domain.FriendRequestProjection{}, server.Unauthorized(
			"authenticated Friend Request actor and device required",
		)
	}
	if command == nil || command.GetBody() == nil {
		return domain.FriendRequestProjection{}, server.BadRequest(
			"command.body is required",
		)
	}
	body := command.GetBody()
	if body.GetAction() != expectedAction {
		return domain.FriendRequestProjection{}, server.BadRequest(
			"command action does not match the Friend Request endpoint",
		)
	}
	authorizingDevice := body.GetAuthorizingDevice()
	if authorizingDevice == nil || authorizingDevice.GetActor() == nil {
		return domain.FriendRequestProjection{}, server.BadRequest(
			"command.body.authorizing_device is required",
		)
	}
	if authorizingDevice.GetActor().GetPtid() != authenticatedActorPTID ||
		authorizingDevice.GetDeviceId() != authenticatedDeviceID {
		return domain.FriendRequestProjection{}, server.Forbidden(
			"command authorizing device does not match the authenticated actor and device",
		)
	}

	result, err := api.SubmitFriendRequestCommand(ctx, command)
	if err != nil {
		return domain.FriendRequestProjection{}, mapFederatedFriendRequestError(
			ctx,
			"submit Friend Request command",
			err,
		)
	}
	return result.Projection, nil
}

func socialFriendRequestFromProjection(
	projection domain.FriendRequestProjection,
) *model.SocialFriendRequest {
	if projection.RequestID == "" {
		return nil
	}

	request := &model.SocialFriendRequest{
		RequestId:                 projection.RequestID,
		Sender:                    projection.Sender,
		Receiver:                  projection.Receiver,
		Message:                   projection.Message,
		State:                     projection.State,
		FederationId:              projection.FederationID,
		SenderHomeStationPeerId:   projection.SenderHomeStationPeerID,
		ReceiverHomeStationPeerId: projection.ReceiverHomeStationPeerID,
	}
	if !projection.CreatedAt.IsZero() {
		request.CreatedAt = timestamppb.New(projection.CreatedAt.UTC())
	}
	if projection.RespondedAt != nil {
		request.RespondedAt = timestamppb.New(projection.RespondedAt.UTC())
	}
	return request
}

func mapFederatedFriendRequestError(
	ctx context.Context,
	operation string,
	err error,
) error {
	if err == nil {
		return nil
	}

	logger.Warnf(ctx, "%s failed: %v", operation, err)
	switch domain.FederationErrorCodeOf(err) {
	case domain.FederationErrorInvalidArgument:
		return server.NewHandlerErrorWithCause(
			nethttp.StatusBadRequest,
			"invalid Friend Request operation",
			err,
		)
	case domain.FederationErrorUnauthorized,
		domain.FederationErrorInvalidSignature,
		domain.FederationErrorBlocked:
		return server.NewHandlerErrorWithCause(
			nethttp.StatusForbidden,
			"Friend Request operation is not authorized",
			err,
		)
	case domain.FederationErrorNotFound:
		return server.NewHandlerErrorWithCause(
			nethttp.StatusNotFound,
			"Friend Request was not found",
			err,
		)
	case domain.FederationErrorAlreadyFriends,
		domain.FederationErrorStateConflict,
		domain.FederationErrorIdempotencyConflict:
		return server.NewHandlerErrorWithCause(
			nethttp.StatusConflict,
			"Friend Request conflicts with current state",
			err,
		)
	case domain.FederationErrorIdentityUnavailable:
		return server.NewHandlerErrorWithCause(
			nethttp.StatusServiceUnavailable,
			"Friend Request identity is temporarily unavailable",
			err,
		)
	default:
		return server.InternalErrorWithCause(
			"Friend Request operation failed",
			err,
		)
	}
}
