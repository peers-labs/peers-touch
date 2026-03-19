package service

import (
	"context"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"github.com/peers-labs/peers-touch/station/frame/touch/social/converter"
	"github.com/peers-labs/peers-touch/station/frame/touch/social/id"
	"github.com/peers-labs/peers-touch/station/frame/touch/social/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

var (
	gormDB          *gorm.DB
	postRepo        repository.PostRepository
	postContentRepo repository.PostContentRepository
	likeRepo        repository.LikeRepository
	postConverter   *converter.PostConverter
)

func init() {
	store.InitTableHooks(func(ctx context.Context, rds *gorm.DB) {
		gormDB = rds
		postRepo = repository.NewPostRepository(rds)
		postContentRepo = repository.NewPostContentRepository(rds)
		likeRepo = repository.NewLikeRepository(rds)
		postConverter = converter.NewPostConverter(likeRepo)
		logger.Info(ctx, "Social service initialized")
	})
}

func CreatePost(ctx context.Context, req *model.CreatePostRequest, authorID uint64) (*model.Post, error) {
	logger.Info(ctx, "CreatePost", "authorID", authorID, "type", req.Type, "replyTo", req.ReplyToPostId)

	// If this is a reply, create a Comment instead
	if req.ReplyToPostId != "" {
		return createComment(ctx, req, authorID)
	}

	if req.Type == model.PostType_TEXT && req.GetText() == nil {
		return nil, fmt.Errorf("text content is required for TEXT post")
	}

	dbPost, dbContent, err := postConverter.ProtoToDB(req, authorID)
	if err != nil {
		logger.Error(ctx, "failed to convert proto to db", "error", err)
		return nil, err
	}

	dbPost.ID = id.Next()
	dbPost.CreatedAt = time.Now()
	dbPost.UpdatedAt = time.Now()

	dbContent.PostID = dbPost.ID

	err = gormDB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(dbPost).Error; err != nil {
			return err
		}
		if err := tx.Create(dbContent).Error; err != nil {
			return err
		}

		// Increment parent post's comments count if this is a reply
		if req.ReplyToPostId != "" {
			parentID := parseID(req.ReplyToPostId)
			if err := tx.Model(&db.Post{}).Where("id = ?", parentID).UpdateColumn("comments_count", gorm.Expr("comments_count + 1")).Error; err != nil {
				logger.Warn(ctx, "failed to increment parent comments count", "error", err)
			}
		}

		return nil
	})

	if err != nil {
		logger.Error(ctx, "failed to create post", "error", err)
		return nil, err
	}

	dbPost.Content = dbContent

	post, err := postConverter.DBToProto(ctx, dbPost, authorID)
	if err != nil {
		logger.Error(ctx, "failed to convert db to proto", "error", err)
		return nil, err
	}

	logger.Info(ctx, "CreatePost success", "postID", post.Id)
	return post, nil
}

func createComment(ctx context.Context, req *model.CreatePostRequest, authorID uint64) (*model.Post, error) {
	postID := parseID(req.ReplyToPostId)

	// Get text content
	var content string
	if req.Type == model.PostType_TEXT && req.GetText() != nil {
		content = req.GetText().Text
	} else {
		return nil, fmt.Errorf("only text comments are supported")
	}

	comment := &db.Comment{
		ID:        id.Next(),
		PostID:    postID,
		AuthorID:  authorID,
		Content:   content,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	err := gormDB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(comment).Error; err != nil {
			return err
		}

		// Increment post's comments count
		if err := tx.Model(&db.Post{}).Where("id = ?", postID).UpdateColumn("comments_count", gorm.Expr("comments_count + 1")).Error; err != nil {
			logger.Warn(ctx, "failed to increment comments count", "error", err)
		}

		return nil
	})

	if err != nil {
		logger.Error(ctx, "failed to create comment", "error", err)
		return nil, err
	}

	// Load author info
	if err := gormDB.Preload("Author").First(comment, comment.ID).Error; err != nil {
		logger.Warn(ctx, "failed to load comment author", "error", err)
	}

	// Convert comment to Post proto (for now, to maintain API compatibility)
	post := &model.Post{
		Id:        fmt.Sprintf("%d", comment.ID),
		AuthorId:  fmt.Sprintf("%d", comment.AuthorID),
		Type:      model.PostType_TEXT,
		CreatedAt: timestamppb.New(comment.CreatedAt),
		UpdatedAt: timestamppb.New(comment.UpdatedAt),
		Content: &model.Post_TextPost{
			TextPost: &model.TextPost{
				Text: comment.Content,
			},
		},
		Stats: &model.PostStats{
			LikesCount: comment.LikesCount,
		},
	}

	if comment.Author != nil {
		post.Author = &model.PostAuthor{
			Id:          fmt.Sprintf("%d", comment.Author.ID),
			Username:    comment.Author.PreferredUsername,
			DisplayName: comment.Author.Name,
			AvatarUrl:   comment.Author.Icon,
		}
	}

	logger.Info(ctx, "CreateComment success", "commentID", comment.ID, "postID", postID)
	return post, nil
}

func GetPost(ctx context.Context, postID string, viewerID uint64) (*model.Post, error) {
	logger.Debug(ctx, "GetPost", "postID", postID, "viewerID", viewerID)

	id := parseID(postID)
	dbPost, err := postRepo.GetByID(ctx, id)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("post not found")
		}
		logger.Error(ctx, "failed to get post", "error", err)
		return nil, err
	}

	if !canViewPost(ctx, dbPost, viewerID) {
		return nil, fmt.Errorf("permission denied")
	}

	post, err := postConverter.DBToProto(ctx, dbPost, viewerID)
	if err != nil {
		logger.Error(ctx, "failed to convert db to proto", "error", err)
		return nil, err
	}

	return post, nil
}

func UpdatePost(ctx context.Context, req *model.UpdatePostRequest, userID uint64) (*model.Post, error) {
	logger.Info(ctx, "UpdatePost", "postID", req.PostId, "userID", userID)

	postID := parseID(req.PostId)
	dbPost, err := postRepo.GetByID(ctx, postID)
	if err != nil {
		return nil, err
	}

	if dbPost.AuthorID != userID {
		return nil, fmt.Errorf("permission denied")
	}

	if req.Content != nil {
		dbContent, err := postContentRepo.GetByPostID(ctx, postID)
		if err != nil {
			return nil, err
		}
		dbContent.Text = *req.Content
		if err := postContentRepo.Update(ctx, dbContent); err != nil {
			logger.Error(ctx, "failed to update post content", "error", err)
			return nil, err
		}
		dbPost.Content = dbContent
	}

	if req.Visibility != nil {
		dbPost.Visibility = req.Visibility.String()
	}

	dbPost.UpdatedAt = time.Now()
	if err := postRepo.Update(ctx, dbPost); err != nil {
		logger.Error(ctx, "failed to update post", "error", err)
		return nil, err
	}

	post, err := postConverter.DBToProto(ctx, dbPost, userID)
	if err != nil {
		return nil, err
	}

	logger.Info(ctx, "UpdatePost success", "postID", req.PostId)
	return post, nil
}

func DeletePost(ctx context.Context, postID string, userID uint64) error {
	logger.Info(ctx, "DeletePost", "postID", postID, "userID", userID)

	id := parseID(postID)
	dbPost, err := postRepo.GetByID(ctx, id)
	if err != nil {
		return err
	}

	if dbPost.AuthorID != userID {
		return fmt.Errorf("permission denied")
	}

	if err := postRepo.Delete(ctx, id); err != nil {
		logger.Error(ctx, "failed to delete post", "error", err)
		return err
	}

	logger.Info(ctx, "DeletePost success", "postID", postID)
	return nil
}

func LikePost(ctx context.Context, postID string, userID uint64) (*model.LikePostResponse, error) {
	logger.Info(ctx, "LikePost", "postID", postID, "userID", userID)

	pid := parseID(postID)

	isLiked, err := likeRepo.IsPostLiked(ctx, userID, pid)
	if err != nil {
		return nil, err
	}
	if isLiked {
		return nil, fmt.Errorf("already liked")
	}

	like := &db.PostLike{
		ID:        id.Next(),
		UserID:    userID,
		PostID:    pid,
		CreatedAt: time.Now(),
	}

	err = gormDB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(like).Error; err != nil {
			return err
		}

		return tx.Model(&db.Post{}).
			Where("id = ?", pid).
			UpdateColumn("likes_count", gorm.Expr("likes_count + 1")).Error
	})

	if err != nil {
		logger.Error(ctx, "failed to like post", "error", err)
		return nil, err
	}

	count, _ := likeRepo.GetPostLikesCount(ctx, pid)

	logger.Info(ctx, "LikePost success", "postID", postID)
	return &model.LikePostResponse{
		Success:       true,
		NewLikesCount: count,
	}, nil
}

func UnlikePost(ctx context.Context, postID string, userID uint64) (*model.UnlikePostResponse, error) {
	logger.Info(ctx, "UnlikePost", "postID", postID, "userID", userID)

	pid := parseID(postID)

	isLiked, err := likeRepo.IsPostLiked(ctx, userID, pid)
	if err != nil {
		return nil, err
	}
	if !isLiked {
		return nil, fmt.Errorf("not liked yet")
	}

	err = gormDB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ? AND post_id = ?", userID, pid).
			Delete(&db.PostLike{}).Error; err != nil {
			return err
		}

		return tx.Model(&db.Post{}).
			Where("id = ?", pid).
			UpdateColumn("likes_count", gorm.Expr("likes_count - 1")).Error
	})

	if err != nil {
		logger.Error(ctx, "failed to unlike post", "error", err)
		return nil, err
	}

	count, _ := likeRepo.GetPostLikesCount(ctx, pid)

	logger.Info(ctx, "UnlikePost success", "postID", postID)
	return &model.UnlikePostResponse{
		Success:       true,
		NewLikesCount: count,
	}, nil
}

func GetPostLikers(ctx context.Context, req *model.GetPostLikersRequest) (*model.GetPostLikersResponse, error) {
	logger.Debug(ctx, "GetPostLikers", "postID", req.PostId)

	postID := parseID(req.PostId)
	limit := int(req.Limit)
	if limit == 0 {
		limit = 20
	}

	var cursor *repository.Cursor
	if req.Cursor != "" {
		cursor = parseCursor(req.Cursor)
	}

	actors, err := likeRepo.GetPostLikers(ctx, postID, cursor, limit)
	if err != nil {
		logger.Error(ctx, "failed to get post likers", "error", err)
		return nil, err
	}

	users := make([]*model.PostAuthor, len(actors))
	for i, actor := range actors {
		users[i] = &model.PostAuthor{
			Id:          fmt.Sprintf("%d", actor.ID),
			Username:    actor.PreferredUsername,
			DisplayName: actor.Name,
			AvatarUrl:   actor.Icon,
		}
	}

	return &model.GetPostLikersResponse{
		Users:      users,
		NextCursor: generateCursor(actors),
		HasMore:    len(actors) == limit,
	}, nil
}

func canViewPost(ctx context.Context, post *db.Post, viewerID uint64) bool {
	if post.Visibility == "public" {
		return true
	}

	if viewerID == 0 {
		return false
	}

	if post.AuthorID == viewerID {
		return true
	}

	if post.Visibility == "private" {
		return false
	}

	return true
}

func parseID(idStr string) uint64 {
	var id uint64
	fmt.Sscanf(idStr, "%d", &id)
	return id
}

func parseCursor(cursorStr string) *repository.Cursor {
	return nil
}

func generateCursor(actors []*db.Actor) string {
	return ""
}

func RepostPost(ctx context.Context, req *model.RepostRequest, userID uint64) (*model.RepostResponse, error) {
	logger.Info(ctx, "RepostPost", "postID", req.PostId, "userID", userID)

	originalPostID := parseID(req.PostId)

	// Check if original post exists
	_, err := postRepo.GetByID(ctx, originalPostID)
	if err != nil {
		return nil, fmt.Errorf("original post not found")
	}

	// Create repost
	var comment string
	if req.Comment != nil {
		comment = *req.Comment
	}

	createReq := &model.CreatePostRequest{
		Type:       model.PostType_REPOST,
		Visibility: model.PostVisibility_PUBLIC,
		Content: &model.CreatePostRequest_Repost{
			Repost: &model.CreateRepostRequest{
				OriginalPostId: req.PostId,
				Comment:        comment,
			},
		},
	}

	repost, err := CreatePost(ctx, createReq, userID)
	if err != nil {
		logger.Error(ctx, "failed to create repost", "error", err)
		return nil, err
	}

	// Update repost count on original post
	err = gormDB.Model(&db.Post{}).
		Where("id = ?", originalPostID).
		UpdateColumn("reposts_count", gorm.Expr("reposts_count + 1")).Error
	if err != nil {
		logger.Error(ctx, "failed to update repost count", "error", err)
	}

	logger.Info(ctx, "RepostPost success", "repostID", repost.Id)
	return &model.RepostResponse{
		Repost: repost,
	}, nil
}

func ListPosts(ctx context.Context, req *model.ListPostsRequest, viewerID uint64) (*model.ListPostsResponse, error) {
	logger.Debug(ctx, "ListPosts", "filter", req.Filter, "limit", req.Limit)

	limit := int(req.Limit)
	if limit == 0 {
		limit = 20
	}

	var cursor *repository.Cursor
	if req.Cursor != "" {
		cursor = parseCursor(req.Cursor)
	}

	// Get author ID from filter
	var posts []*db.Post
	var err error
	if req.Filter != nil && req.Filter.AuthorId != "" {
		authorID := parseID(req.Filter.AuthorId)
		posts, err = postRepo.ListByAuthor(ctx, authorID, cursor, limit)
	} else {
		// If no filter, return empty list for now
		// TODO: implement global timeline
		posts = []*db.Post{}
	}

	if err != nil {
		logger.Error(ctx, "failed to list posts", "error", err)
		return nil, err
	}

	protoPosts := make([]*model.Post, 0, len(posts))
	for _, dbPost := range posts {
		protoPost, err := postConverter.DBToProto(ctx, dbPost, viewerID)
		if err != nil {
			logger.Error(ctx, "failed to convert post", "error", err)
			continue
		}
		protoPosts = append(protoPosts, protoPost)
	}

	return &model.ListPostsResponse{
		Posts:      protoPosts,
		NextCursor: "", // TODO: implement cursor
		HasMore:    len(posts) == limit,
	}, nil
}
