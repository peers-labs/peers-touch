package social

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
)

// Route constants
const (
	routeSocialPosts        = "/api/v1/social/posts"
	routeSocialPost         = "/api/v1/social/posts/:id"
	routeSocialPostLike     = "/api/v1/social/posts/:id/like"
	routeSocialPostUnlike   = "/api/v1/social/posts/:id/unlike"
	routeSocialPostRepost   = "/api/v1/social/posts/:id/repost"
	routeSocialPostLikers   = "/api/v1/social/posts/:id/likers"
	routeSocialPostComments = "/api/v1/social/posts/:id/comments"
	routeSocialComment      = "/api/v1/social/comments/:commentId"
	routeSocialTimeline     = "/api/v1/social/timeline"
	routeSocialUserPosts    = "/api/v1/social/users/:userId/posts"
	routeSocialFollow       = "/api/v1/social/relationships/follow"
	routeSocialUnfollow     = "/api/v1/social/relationships/unfollow"
	routeSocialRelationship = "/api/v1/social/relationships"
	routeSocialFollowers    = "/api/v1/social/relationships/followers"
	routeSocialFollowing    = "/api/v1/social/relationships/following"
	routeSocialUserSearch   = "/api/v1/social/users/search"
	routeSocialUserMe       = "/api/v1/social/users/me"
)

func (s *subServer) Handlers() []server.Handler {
	cw := s.commonWrapper
	jw := s.jwtWrapper

	return []server.Handler{
		server.NewTypedHandler("social-create-post", routeSocialPosts, server.POST, s.handleCreatePost, cw, jw),
		server.NewTypedHandler("social-get-post", routeSocialPost, server.GET, s.handleGetPost, cw),
		server.NewTypedHandler("social-update-post", routeSocialPost, server.PUT, s.handleUpdatePost, cw, jw),
		server.NewTypedHandler("social-delete-post", routeSocialPost, server.DELETE, s.handleDeletePost, cw, jw),
		server.NewTypedHandler("social-like-post", routeSocialPostLike, server.POST, s.handleLikePost, cw, jw),
		server.NewTypedHandler("social-unlike-post", routeSocialPostUnlike, server.POST, s.handleUnlikePost, cw, jw),
		server.NewTypedHandler("social-get-post-likers", routeSocialPostLikers, server.GET, s.handleGetPostLikers, cw),
		server.NewTypedHandler("social-repost-post", routeSocialPostRepost, server.POST, s.handleRepostPost, cw, jw),
		server.NewTypedHandler("social-get-timeline", routeSocialTimeline, server.GET, s.handleGetTimeline, cw, jw),
		server.NewTypedHandler("social-get-user-posts", routeSocialUserPosts, server.GET, s.handleGetUserPosts, cw, jw),
		server.NewTypedHandler("social-get-post-comments", routeSocialPostComments, server.GET, s.handleGetPostComments, cw),
		server.NewTypedHandler("social-create-comment", routeSocialPostComments, server.POST, s.handleCreateComment, cw, jw),
		server.NewTypedHandler("social-delete-comment", routeSocialComment, server.DELETE, s.handleDeleteComment, cw, jw),
		server.NewTypedHandler("social-follow", routeSocialFollow, server.POST, s.handleFollow, cw, jw),
		server.NewTypedHandler("social-unfollow", routeSocialUnfollow, server.POST, s.handleUnfollow, cw, jw),
		server.NewTypedHandler("social-get-relationship", routeSocialRelationship, server.GET, s.handleGetRelationship, cw, jw),
		server.NewTypedHandler("social-get-relationships", routeSocialRelationship, server.POST, s.handleGetRelationships, cw, jw),
		server.NewTypedHandler("social-get-followers", routeSocialFollowers, server.GET, s.handleGetFollowers, cw, jw),
		server.NewTypedHandler("social-get-following", routeSocialFollowing, server.GET, s.handleGetFollowing, cw, jw),
		server.NewSimpleHandler("social-search-users", routeSocialUserSearch, server.GET, s.handleSearchUsers, cw, jw),
		server.NewSimpleHandler("social-get-me", routeSocialUserMe, server.GET, s.handleGetMe, cw, jw),
	}
}

// getUserID extracts the authenticated user ID from context
func getUserID(c context.Context) (uint64, bool) {
	if subject := coreauth.GetSubject(c); subject != nil {
		userID, err := strconv.ParseUint(subject.ID, 10, 64)
		if err != nil {
			return 0, false
		}
		return userID, true
	}
	return 0, false
}

// --- Post Handlers ---

func (s *subServer) handleCreatePost(ctx context.Context, req *model.CreatePostRequest) (*model.CreatePostResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	post, err := s.postSvc.CreatePost(ctx, req, userID)
	if err != nil {
		logger.Error(ctx, "failed to create post", "error", err)
		return nil, server.InternalErrorWithCause("failed to create post", err)
	}

	return &model.CreatePostResponse{Post: post}, nil
}

func (s *subServer) handleGetPost(ctx context.Context, req *model.GetPostRequest) (*model.GetPostResponse, error) {
	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}

	var viewerID uint64
	if userID, exists := getUserID(ctx); exists {
		viewerID = userID
	}

	post, err := s.postSvc.GetPost(ctx, req.PostId, viewerID)
	if err != nil {
		logger.Error(ctx, "failed to get post", "error", err)
		return nil, server.NotFound("post not found")
	}

	return &model.GetPostResponse{Post: post}, nil
}

func (s *subServer) handleUpdatePost(ctx context.Context, req *model.UpdatePostRequest) (*model.UpdatePostResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	post, err := s.postSvc.UpdatePost(ctx, req, userID)
	if err != nil {
		logger.Error(ctx, "failed to update post", "error", err)
		return nil, server.InternalErrorWithCause("failed to update post", err)
	}

	return &model.UpdatePostResponse{Post: post}, nil
}

func (s *subServer) handleDeletePost(ctx context.Context, req *model.DeletePostRequest) (*model.DeletePostResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}

	err := s.postSvc.DeletePost(ctx, req.PostId, userID)
	if err != nil {
		logger.Error(ctx, "failed to delete post", "error", err)
		return nil, server.InternalErrorWithCause("failed to delete post", err)
	}

	return &model.DeletePostResponse{Success: true}, nil
}

func (s *subServer) handleLikePost(ctx context.Context, req *model.LikePostRequest) (*model.LikePostResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}

	resp, err := s.postSvc.LikePost(ctx, req.PostId, userID)
	if err != nil {
		logger.Error(ctx, "failed to like post", "error", err)
		return nil, server.InternalErrorWithCause("failed to like post", err)
	}

	return resp, nil
}

func (s *subServer) handleUnlikePost(ctx context.Context, req *model.UnlikePostRequest) (*model.UnlikePostResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}

	resp, err := s.postSvc.UnlikePost(ctx, req.PostId, userID)
	if err != nil {
		logger.Error(ctx, "failed to unlike post", "error", err)
		return nil, server.InternalErrorWithCause("failed to unlike post", err)
	}

	return resp, nil
}

func (s *subServer) handleGetPostLikers(ctx context.Context, req *model.GetPostLikersRequest) (*model.GetPostLikersResponse, error) {
	resp, err := s.postSvc.GetPostLikers(ctx, req)
	if err != nil {
		logger.Error(ctx, "failed to get post likers", "error", err)
		return nil, server.InternalErrorWithCause("failed to get post likers", err)
	}

	return resp, nil
}

func (s *subServer) handleRepostPost(ctx context.Context, req *model.RepostRequest) (*model.RepostResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}

	resp, err := s.postSvc.RepostPost(ctx, req, userID)
	if err != nil {
		logger.Error(ctx, "failed to repost", "error", err)
		return nil, server.InternalErrorWithCause("failed to repost", err)
	}

	return resp, nil
}

func (s *subServer) handleGetUserPosts(ctx context.Context, req *model.ListPostsRequest) (*model.ListPostsResponse, error) {
	if req.Filter == nil {
		req.Filter = &model.PostFilter{}
	}

	authorID := req.Filter.AuthorId
	if authorID == "" {
		return nil, server.BadRequest("author_id is required")
	}

	if _, err := strconv.ParseUint(authorID, 10, 64); err != nil {
		actorInfo, err := actor.GetActorByUsername(ctx, authorID)
		if err != nil {
			logger.Warn(ctx, "failed to resolve username to actor ID", "username", authorID, "error", err)
			return nil, server.NotFound("user not found")
		}
		authorID = strconv.FormatUint(actorInfo.ID, 10)
		req.Filter.AuthorId = authorID
		logger.Debug(ctx, "resolved username to actor ID", "username", authorID, "actorID", authorID)
	}

	var viewerID uint64
	if vID, exists := getUserID(ctx); exists {
		viewerID = vID
	}

	resp, err := s.postSvc.ListPosts(ctx, req, viewerID)
	if err != nil {
		logger.Error(ctx, "failed to get user posts", "error", err)
		return nil, server.InternalErrorWithCause("failed to get user posts", err)
	}

	return resp, nil
}

// --- Comment Handlers ---

func (s *subServer) handleGetPostComments(ctx context.Context, req *model.GetCommentsRequest) (*model.GetCommentsResponse, error) {
	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}

	postID, err := strconv.ParseUint(req.PostId, 10, 64)
	if err != nil {
		return nil, server.BadRequest("invalid post_id")
	}

	limit := int(req.Limit)
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	comments, err := s.commentSvc.GetPostComments(ctx, postID, limit)
	if err != nil {
		logger.Error(ctx, "failed to get comments", "postID", req.PostId, "error", err)
		return nil, server.InternalErrorWithCause("failed to get comments", err)
	}

	return comments, nil
}

func (s *subServer) handleCreateComment(ctx context.Context, req *model.CreateCommentRequest) (*model.CreateCommentResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}

	postID, err := strconv.ParseUint(req.PostId, 10, 64)
	if err != nil {
		return nil, server.BadRequest("invalid post_id")
	}

	if req.Content == "" {
		return nil, server.BadRequest("content is required")
	}

	comment, err := s.commentSvc.CreateComment(ctx, req, postID, userID)
	if err != nil {
		logger.Error(ctx, "failed to create comment", "postID", req.PostId, "userID", userID, "error", err)
		return nil, server.InternalErrorWithCause("failed to create comment", err)
	}

	return &model.CreateCommentResponse{Comment: comment}, nil
}

func (s *subServer) handleDeleteComment(ctx context.Context, req *model.DeleteCommentRequest) (*model.DeleteCommentResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	if req.CommentId == "" {
		return nil, server.BadRequest("comment_id is required")
	}

	commentID, err := strconv.ParseUint(req.CommentId, 10, 64)
	if err != nil {
		return nil, server.BadRequest("invalid comment_id")
	}

	err = s.commentSvc.DeleteComment(ctx, commentID, userID)
	if err != nil {
		logger.Error(ctx, "failed to delete comment", "commentID", req.CommentId, "userID", userID, "error", err)
		return nil, server.InternalErrorWithCause("failed to delete comment", err)
	}

	return &model.DeleteCommentResponse{Success: true}, nil
}

// --- Timeline Handler ---

func (s *subServer) handleGetTimeline(ctx context.Context, req *model.GetTimelineRequest) (*model.GetTimelineResponse, error) {
	logger.Info(ctx, "[GetTimeline] Request received", "type", req.Type, "limit", req.Limit, "cursor", req.Cursor)

	var viewerID uint64
	if userID, exists := getUserID(ctx); exists {
		viewerID = userID
		logger.Info(ctx, "[GetTimeline] Viewer authenticated", "viewerID", viewerID)
	} else {
		logger.Info(ctx, "[GetTimeline] No authentication")
	}

	resp, err := s.timelineSvc.GetTimeline(ctx, req, viewerID)
	if err != nil {
		logger.Error(ctx, "failed to get timeline", "error", err)
		return nil, server.InternalErrorWithCause("failed to get timeline", err)
	}

	logger.Info(ctx, "[GetTimeline] Response ready", "postsCount", len(resp.Posts), "hasMore", resp.HasMore)
	return resp, nil
}

// --- Relationship Handlers ---

func (s *subServer) handleFollow(ctx context.Context, req *model.FollowRequest) (*model.FollowResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	if req.TargetActorId == "" {
		return nil, server.BadRequest("target_actor_id is required")
	}

	logger.Info(ctx, "Follow request", "userID", userID, "targetActorId", req.TargetActorId)

	relationship, err := s.relationshipSvc.Follow(ctx, userID, req.TargetActorId)
	if err != nil {
		logger.Error(ctx, "failed to follow", "error", err, "userID", userID, "targetActorId", req.TargetActorId)
		return nil, server.InternalErrorWithCause("failed to follow", err)
	}

	return &model.FollowResponse{
		Success:      true,
		Relationship: relationship,
	}, nil
}

func (s *subServer) handleUnfollow(ctx context.Context, req *model.UnfollowRequest) (*model.UnfollowResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	if req.TargetActorId == "" {
		return nil, server.BadRequest("target_actor_id is required")
	}

	err := s.relationshipSvc.Unfollow(ctx, userID, req.TargetActorId)
	if err != nil {
		logger.Error(ctx, "failed to unfollow", "error", err, "userID", userID, "targetActorId", req.TargetActorId)
		return nil, server.InternalErrorWithCause("failed to unfollow", err)
	}

	return &model.UnfollowResponse{
		Success: true,
	}, nil
}

func (s *subServer) handleGetRelationship(ctx context.Context, req *model.GetRelationshipRequest) (*model.GetRelationshipResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	if req.TargetActorId == "" {
		return nil, server.BadRequest("target_actor_id is required")
	}

	relationship, err := s.relationshipSvc.GetRelationship(ctx, userID, req.TargetActorId)
	if err != nil {
		logger.Error(ctx, "failed to get relationship", "error", err, "userID", userID, "targetActorId", req.TargetActorId)
		return nil, server.InternalErrorWithCause("failed to get relationship", err)
	}

	return &model.GetRelationshipResponse{
		Relationship: relationship,
	}, nil
}

func (s *subServer) handleGetRelationships(ctx context.Context, req *model.GetRelationshipsRequest) (*model.GetRelationshipsResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	relationships, err := s.relationshipSvc.GetRelationships(ctx, userID, req.TargetActorIds)
	if err != nil {
		logger.Error(ctx, "failed to get relationships", "error", err, "userID", userID, "count", len(req.TargetActorIds))
		return nil, server.InternalErrorWithCause("failed to get relationships", err)
	}

	return &model.GetRelationshipsResponse{
		Relationships: relationships,
	}, nil
}

func (s *subServer) handleGetFollowers(ctx context.Context, req *model.GetFollowersRequest) (*model.GetFollowersResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
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
		logger.Error(ctx, "failed to get followers", "error", err, "actorID", actorID)
		return nil, server.InternalErrorWithCause("failed to get followers", err)
	}

	return &model.GetFollowersResponse{
		Followers:  followers,
		NextCursor: nextCursor,
		Total:      total,
	}, nil
}

func (s *subServer) handleGetFollowing(ctx context.Context, req *model.GetFollowingRequest) (*model.GetFollowingResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
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
		logger.Error(ctx, "failed to get following", "error", err, "actorID", actorID)
		return nil, server.InternalErrorWithCause("failed to get following", err)
	}

	return &model.GetFollowingResponse{
		Following:  following,
		NextCursor: nextCursor,
		Total:      total,
	}, nil
}

// --- User Handlers (SimpleHandler) ---

func (s *subServer) handleSearchUsers(ctx context.Context, req server.Request, resp server.Response) error {
	userID, exists := getUserID(ctx)
	if !exists {
		return server.Unauthorized("authentication required")
	}

	// Parse query parameter 'q' from URL path (includes ?query)
	q := ""
	if fullPath := req.Path(); fullPath != "" {
		if parsed, err := url.Parse(fullPath); err == nil {
			q = parsed.Query().Get("q")
		}
	}
	if q == "" {
		return server.BadRequest("query parameter 'q' is required")
	}

	actors, err := actor.SearchActors(ctx, q, userID)
	if err != nil {
		logger.Error(ctx, "failed to search users", "error", err, "query", q)
		return server.InternalErrorWithCause("failed to search users", err)
	}

	// Convert db.Actor entities to proto Actor items
	items := make([]*model.Actor, len(actors))
	for i, a := range actors {
		items[i] = &model.Actor{
			Id:          fmt.Sprintf("%d", a.ID),
			Username:    a.PreferredUsername,
			DisplayName: a.Name,
			Email:       a.Email,
			ActorId:     a.ID,
		}
	}

	result := &model.ActorList{
		Items: items,
		Total: int64(len(items)),
	}
	data, err := proto.Marshal(result)
	if err != nil {
		logger.Error(ctx, "failed to marshal search response", "error", err)
		return server.InternalErrorWithCause("marshal failed", err)
	}

	resp.SetHeader("Content-Type", "application/protobuf")
	resp.WriteHeader(http.StatusOK)
	resp.Write(data)
	return nil
}

func (s *subServer) handleGetMe(ctx context.Context, req server.Request, resp server.Response) error {
	userID, exists := getUserID(ctx)
	if !exists {
		return server.Unauthorized("authentication required")
	}

	a, err := actor.GetActorByID(ctx, userID)
	if err != nil {
		logger.Error(ctx, "failed to get current user", "error", err, "userID", userID)
		return server.InternalErrorWithCause("failed to get current user", err)
	}

	result := &model.ActorProfile{
		Id:          fmt.Sprintf("%d", a.ID),
		DisplayName: a.Name,
		Username:    a.PreferredUsername,
		Avatar:      a.Icon,
	}
	data, err := proto.Marshal(result)
	if err != nil {
		logger.Error(ctx, "failed to marshal profile response", "error", err)
		return server.InternalErrorWithCause("marshal failed", err)
	}

	resp.SetHeader("Content-Type", "application/protobuf")
	resp.WriteHeader(http.StatusOK)
	resp.Write(data)
	return nil
}
