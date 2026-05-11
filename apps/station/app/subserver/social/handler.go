package social

import (
	"context"
	"fmt"
	"strconv"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
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

	// Circles
	routeSocialCircles      = "/api/v1/social/circles"
	routeSocialCircle       = "/api/v1/social/circles/:id"
	routeSocialCircleMember = "/api/v1/social/circles/:id/members"
)

func (s *subServer) Handlers() []server.Handler {
	cw := s.commonWrapper
	jw := s.jwtWrapper

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

		// Circles
		server.NewTypedHandler("social-create-circle", routeSocialCircles, server.POST, s.handleCreateCircle, cw, jw),
		server.NewTypedHandler("social-list-circles", routeSocialCircles, server.GET, s.handleListMyCircles, cw, jw),
		server.NewTypedHandler("social-rename-circle", routeSocialCircle, server.PUT, s.handleRenameCircle, cw, jw),
		server.NewTypedHandler("social-delete-circle", routeSocialCircle, server.DELETE, s.handleDeleteCircle, cw, jw),
		server.NewTypedHandler("social-add-circle-member", routeSocialCircleMember, server.POST, s.handleAddCircleMembers, cw, jw),
		server.NewTypedHandler("social-remove-circle-member", routeSocialCircleMember, server.DELETE, s.handleRemoveCircleMembers, cw, jw),
		server.NewTypedHandler("social-list-circle-members", routeSocialCircleMember, server.GET, s.handleListCircleMembers, cw, jw),
	}
}

// getUserID extracts the authenticated user ID from context.
func getUserID(c context.Context) (uint64, bool) {
	subject := coreauth.GetSubject(c)
	if subject == nil {
		return 0, false
	}
	userID, err := strconv.ParseUint(subject.ID, 10, 64)
	if err != nil {
		return 0, false
	}
	return userID, true
}

// --- Post / Moment handlers --------------------------------------------------

func (s *subServer) handleCreatePost(ctx context.Context, req *model.CreatePostRequest) (*model.CreatePostResponse, error) {
	userID, ok := getUserID(ctx)
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
	post, err := s.momentSvc.CreateMoment(ctx, req, userID)
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
	userID, ok := getUserID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}
	if err := s.momentSvc.DeleteMoment(ctx, req.PostId, userID); err != nil {
		logger.Error(ctx, "failed to delete moment", "error", err, "post_id", req.PostId)
		return nil, server.InternalErrorWithCause("failed to delete moment", err)
	}
	return &model.DeletePostResponse{Success: true}, nil
}

// handleRepostPost wraps the legacy `/repost` endpoint by constructing
// a CreatePostRequest with `Type=REPOST` and forwarding to MomentService.
func (s *subServer) handleRepostPost(ctx context.Context, req *model.RepostRequest) (*model.RepostResponse, error) {
	userID, ok := getUserID(ctx)
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
	post, err := s.momentSvc.CreateMoment(ctx, createReq, userID)
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
	var viewerID uint64
	if id, ok := getUserID(ctx); ok {
		viewerID = id
	}
	post, err := s.momentSvc.GetMoment(ctx, req.PostId, viewerID)
	if err != nil {
		logger.Error(ctx, "failed to get post", "error", err, "post_id", req.PostId)
		return nil, server.InternalErrorWithCause("failed to get post", err)
	}
	if post == nil {
		return nil, server.NotFound("post not found")
	}
	return &model.GetPostResponse{Post: post}, nil
}

func (s *subServer) handleGetUserPosts(ctx context.Context, req *model.ListPostsRequest) (*model.ListPostsResponse, error) {
	if req.Filter == nil {
		req.Filter = &model.PostFilter{}
	}
	authorID := req.Filter.AuthorId
	if authorID == "" {
		return nil, server.BadRequest("author_id is required")
	}

	authorActorID, err := strconv.ParseUint(authorID, 10, 64)
	if err != nil {
		// Treat the parameter as a username and resolve it.
		actorInfo, err := actor.GetActorByUsername(ctx, authorID)
		if err != nil || actorInfo == nil {
			return nil, server.NotFound("user not found")
		}
		authorActorID = actorInfo.ID
	}

	var viewerID uint64
	if id, ok := getUserID(ctx); ok {
		viewerID = id
	}

	posts, nextCursor, hasMore, err := s.momentSvc.ListByAuthor(ctx, authorActorID, viewerID, "", int(req.Limit))
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to list user posts", err)
	}
	return &model.ListPostsResponse{
		Posts:      posts,
		NextCursor: nextCursor,
		HasMore:    hasMore,
	}, nil
}

// --- Reaction handlers ----------------------------------------------------

func (s *subServer) handleReact(ctx context.Context, req *model.ReactToPostRequest) (*model.ReactToPostResponse, error) {
	userID, ok := getUserID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}
	if req.Kind == model.ReactionKind_REACTION_UNSPECIFIED {
		return nil, server.BadRequest("reaction kind is required")
	}
	if err := s.assertReadable(ctx, req.PostId, userID); err != nil {
		return nil, err
	}
	summaries, err := s.reactionSvc.React(ctx, req.PostId, userID, req.Kind)
	if err != nil {
		return nil, server.InternalErrorWithCause("react failed", err)
	}
	return &model.ReactToPostResponse{Success: true, Reactions: summaries}, nil
}

func (s *subServer) handleUnreact(ctx context.Context, req *model.UnreactToPostRequest) (*model.UnreactToPostResponse, error) {
	userID, ok := getUserID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}
	if err := s.assertReadable(ctx, req.PostId, userID); err != nil {
		return nil, err
	}
	summaries, err := s.reactionSvc.Unreact(ctx, req.PostId, userID, req.Kind)
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
func (s *subServer) assertReadable(ctx context.Context, postID string, viewerID uint64) error {
	post, err := s.momentSvc.GetMoment(ctx, postID, viewerID)
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
	var viewerID uint64
	if id, ok := getUserID(ctx); ok {
		viewerID = id
	}
	resp, err := s.commentSvc.ListByPost(ctx, postID, viewerID, req.Cursor, int(req.Limit))
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to list comments", err)
	}
	return resp, nil
}

func (s *subServer) handleCreateComment(ctx context.Context, req *model.CreateCommentRequest) (*model.CreateCommentResponse, error) {
	userID, ok := getUserID(ctx)
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
	comment, err := s.commentSvc.CreateComment(ctx, req, postID, userID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to create comment", err)
	}
	return &model.CreateCommentResponse{Comment: comment}, nil
}

func (s *subServer) handleDeleteComment(ctx context.Context, req *model.DeleteCommentRequest) (*model.DeleteCommentResponse, error) {
	userID, ok := getUserID(ctx)
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
	if err := s.commentSvc.DeleteComment(ctx, commentID, userID); err != nil {
		return nil, server.InternalErrorWithCause("failed to delete comment", err)
	}
	return &model.DeleteCommentResponse{Success: true}, nil
}

// --- Timeline handler ----------------------------------------------------

func (s *subServer) handleGetTimeline(ctx context.Context, req *model.GetTimelineRequest) (*model.GetTimelineResponse, error) {
	var viewerID uint64
	if id, ok := getUserID(ctx); ok {
		viewerID = id
	}
	resp, err := s.timelineSvc.GetTimeline(ctx, req, viewerID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get timeline", err)
	}
	return resp, nil
}

func (s *subServer) handleSyncMomentsProjection(ctx context.Context, req *model.SyncMomentsProjectionRequest) (*model.SyncMomentsProjectionResponse, error) {
	viewerID, ok := getUserID(ctx)
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
	}, viewerID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to sync home moments projection", err)
	}

	public, err := s.timelineSvc.GetTimeline(ctx, &model.GetTimelineRequest{
		Type:   model.TimelineType_TIMELINE_PUBLIC,
		Cursor: req.PublicCursor,
		Limit:  limit,
		Sort:   req.PublicSort,
	}, viewerID)
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
	userID, ok := getUserID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.TargetActorId == "" {
		return nil, server.BadRequest("target_actor_id is required")
	}
	relationship, err := s.relationshipSvc.Follow(ctx, userID, req.TargetActorId)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to follow", err)
	}
	return &model.FollowResponse{Success: true, Relationship: relationship}, nil
}

func (s *subServer) handleUnfollow(ctx context.Context, req *model.UnfollowRequest) (*model.UnfollowResponse, error) {
	userID, ok := getUserID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.TargetActorId == "" {
		return nil, server.BadRequest("target_actor_id is required")
	}
	if err := s.relationshipSvc.Unfollow(ctx, userID, req.TargetActorId); err != nil {
		return nil, server.InternalErrorWithCause("failed to unfollow", err)
	}
	return &model.UnfollowResponse{Success: true}, nil
}

func (s *subServer) handleGetRelationship(ctx context.Context, req *model.GetRelationshipRequest) (*model.GetRelationshipResponse, error) {
	userID, ok := getUserID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if req.TargetActorId == "" {
		return nil, server.BadRequest("target_actor_id is required")
	}
	rel, err := s.relationshipSvc.GetRelationship(ctx, userID, req.TargetActorId)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get relationship", err)
	}
	return &model.GetRelationshipResponse{Relationship: rel}, nil
}

func (s *subServer) handleGetRelationships(ctx context.Context, req *model.GetRelationshipsRequest) (*model.GetRelationshipsResponse, error) {
	userID, ok := getUserID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	rels, err := s.relationshipSvc.GetRelationships(ctx, userID, req.TargetActorIds)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get relationships", err)
	}
	return &model.GetRelationshipsResponse{Relationships: rels}, nil
}

func (s *subServer) handleGetFollowers(ctx context.Context, req *model.GetFollowersRequest) (*model.GetFollowersResponse, error) {
	userID, ok := getUserID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	actorID := userID
	if req.ActorId != "" {
		var err error
		actorID, err = strconv.ParseUint(req.ActorId, 10, 64)
		if err != nil {
			return nil, server.BadRequest("invalid actor_id")
		}
	}
	limit := int(req.Limit)
	if limit <= 0 {
		limit = 20
	}
	followers, nextCursor, total, err := s.relationshipSvc.GetFollowers(ctx, actorID, req.Cursor, limit)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get followers", err)
	}
	return &model.GetFollowersResponse{Followers: followers, NextCursor: nextCursor, Total: total}, nil
}

func (s *subServer) handleGetFollowing(ctx context.Context, req *model.GetFollowingRequest) (*model.GetFollowingResponse, error) {
	userID, ok := getUserID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	actorID := userID
	if req.ActorId != "" {
		var err error
		actorID, err = strconv.ParseUint(req.ActorId, 10, 64)
		if err != nil {
			return nil, server.BadRequest("invalid actor_id")
		}
	}
	limit := int(req.Limit)
	if limit <= 0 {
		limit = 20
	}
	following, nextCursor, total, err := s.relationshipSvc.GetFollowing(ctx, actorID, req.Cursor, limit)
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
	items := make([]*model.Actor, len(actors))
	for i, a := range actors {
		items[i] = &model.Actor{
			Id:          fmt.Sprintf("%d", a.ID),
			Username:    a.PreferredUsername,
			DisplayName: a.Name,
			Email:       a.Email,
			ActorId:     a.ID,
			Avatar:      a.Icon,
		}
	}
	return &model.ActorList{Items: items, Total: int64(len(items))}, nil
}

func (s *subServer) handleGetMe(ctx context.Context, _ *model.GetMeRequest) (*model.ActorProfile, error) {
	userID, ok := getUserID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	a, err := actor.GetActorByID(ctx, userID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to get current user", err)
	}
	return &model.ActorProfile{
		Id:          fmt.Sprintf("%d", a.ID),
		DisplayName: a.Name,
		Username:    a.PreferredUsername,
		Avatar:      a.Icon,
	}, nil
}

// --- Circle handlers ----------------------------------------------------

func (s *subServer) handleCreateCircle(ctx context.Context, req *model.CreateCircleRequest) (*model.CreateCircleResponse, error) {
	userID, ok := getUserID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	c, err := s.circleSvc.Create(ctx, req, userID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to create circle", err)
	}
	return &model.CreateCircleResponse{Circle: c}, nil
}

func (s *subServer) handleListMyCircles(ctx context.Context, req *model.ListMyCirclesRequest) (*model.ListMyCirclesResponse, error) {
	userID, ok := getUserID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	resp, err := s.circleSvc.ListMine(ctx, userID, req.Cursor, int(req.Limit))
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to list circles", err)
	}
	return resp, nil
}

func (s *subServer) handleRenameCircle(ctx context.Context, req *model.RenameCircleRequest) (*model.RenameCircleResponse, error) {
	userID, ok := getUserID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	c, err := s.circleSvc.Rename(ctx, req, userID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to rename circle", err)
	}
	return &model.RenameCircleResponse{Circle: c}, nil
}

func (s *subServer) handleDeleteCircle(ctx context.Context, req *model.DeleteCircleRequest) (*model.DeleteCircleResponse, error) {
	userID, ok := getUserID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	if err := s.circleSvc.Delete(ctx, req.CircleId, userID); err != nil {
		return nil, server.InternalErrorWithCause("failed to delete circle", err)
	}
	return &model.DeleteCircleResponse{Success: true}, nil
}

func (s *subServer) handleAddCircleMembers(ctx context.Context, req *model.AddCircleMemberRequest) (*model.AddCircleMemberResponse, error) {
	userID, ok := getUserID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	added, total, err := s.circleSvc.AddMembers(ctx, req, userID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to add circle members", err)
	}
	return &model.AddCircleMemberResponse{AddedCount: added, MemberCount: total}, nil
}

func (s *subServer) handleRemoveCircleMembers(ctx context.Context, req *model.RemoveCircleMemberRequest) (*model.RemoveCircleMemberResponse, error) {
	userID, ok := getUserID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	removed, total, err := s.circleSvc.RemoveMembers(ctx, req, userID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to remove circle members", err)
	}
	return &model.RemoveCircleMemberResponse{RemovedCount: removed, MemberCount: total}, nil
}

func (s *subServer) handleListCircleMembers(ctx context.Context, req *model.ListCircleMembersRequest) (*model.ListCircleMembersResponse, error) {
	userID, ok := getUserID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	resp, err := s.circleSvc.ListMembers(ctx, req, userID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to list circle members", err)
	}
	return resp, nil
}

// --- Stats ---------------------------------------------------------

func (s *subServer) handleGetMyStats(ctx context.Context, _ *model.GetMyMomentsStatsRequest) (*model.GetMyMomentsStatsResponse, error) {
	userID, ok := getUserID(ctx)
	if !ok {
		return nil, server.Unauthorized("authentication required")
	}
	stats, err := s.statsSvc.MyStats(ctx, userID)
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
