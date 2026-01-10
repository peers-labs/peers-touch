package service

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"github.com/peers-labs/peers-touch/station/frame/touch/social/repository"
)

func GetTimeline(ctx context.Context, req *model.GetTimelineRequest, viewerID uint64) (*model.GetTimelineResponse, error) {
	logger.Debug(ctx, "GetTimeline", "type", req.Type, "viewerID", viewerID)

	limit := int(req.Limit)
	if limit == 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	var cursor *repository.Cursor
	if req.Cursor != "" {
		cursor = parseCursor(req.Cursor)
	}

	var dbPosts []*db.Post
	var err error

	switch req.Type {
	case model.TimelineType_TIMELINE_HOME:
		if viewerID == 0 {
			return nil, fmt.Errorf("authentication required")
		}
		dbPosts, err = postRepo.ListByFollowing(ctx, viewerID, cursor, limit)

	case model.TimelineType_TIMELINE_USER:
		if req.UserId == "" {
			return nil, fmt.Errorf("user_id is required")
		}
		userID := parseID(req.UserId)
		dbPosts, err = postRepo.ListByAuthor(ctx, userID, cursor, limit)

	case model.TimelineType_TIMELINE_PUBLIC:
		dbPosts, err = postRepo.ListPublic(ctx, cursor, limit)

	default:
		return nil, fmt.Errorf("invalid timeline type")
	}

	if err != nil {
		logger.Error(ctx, "failed to get timeline", "error", err)
		return nil, err
	}

	posts := make([]*model.Post, len(dbPosts))
	for i, dbPost := range dbPosts {
		post, err := postConverter.DBToProto(ctx, dbPost, viewerID)
		if err != nil {
			logger.Error(ctx, "failed to convert post", "error", err, "postID", dbPost.ID)
			continue
		}
		posts[i] = post
	}

	return &model.GetTimelineResponse{
		Posts:      posts,
		NextCursor: generateCursorFromPosts(dbPosts),
		HasMore:    len(dbPosts) == limit,
	}, nil
}

func generateCursorFromPosts(posts []*db.Post) string {
	if len(posts) == 0 {
		return ""
	}
	return ""
}
