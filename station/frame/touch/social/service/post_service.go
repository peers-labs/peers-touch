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
	logger.Info(ctx, "CreatePost", "authorID", authorID, "type", req.Type)

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
		Success:        true,
		NewLikesCount:  count,
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
		Success:        true,
		NewLikesCount:  count,
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
