package application

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

type CommentService struct {
	db *gorm.DB
}

func NewCommentService(db *gorm.DB) *CommentService {
	return &CommentService{db: db}
}

func (s *CommentService) GetPostComments(ctx context.Context, postID uint64, limit int) (*model.GetCommentsResponse, error) {
	var comments []db.Comment

	err := s.db.Where("post_id = ? AND deleted_at IS NULL", postID).
		Order("created_at DESC").
		Limit(limit).
		Find(&comments).Error

	if err != nil {
		logger.Error(ctx, "Failed to get comments", "error", err, "postID", postID)
		return nil, err
	}

	protoComments := make([]*model.Comment, 0, len(comments))
	for i := range comments {
		protoComment, err := s.convertDBCommentToProto(ctx, &comments[i])
		if err != nil {
			logger.Warn(ctx, "Failed to convert comment", "error", err, "commentID", comments[i].ID)
			continue
		}
		protoComments = append(protoComments, protoComment)
	}

	return &model.GetCommentsResponse{
		Comments: protoComments,
		HasMore:  false,
	}, nil
}

func (s *CommentService) CreateComment(ctx context.Context, req *model.CreateCommentRequest, postID uint64, authorID uint64) (*model.Comment, error) {
	now := time.Now()

	dbComment := &db.Comment{
		ID:        domain.Next(),
		PostID:    postID,
		AuthorID:  authorID,
		Content:   req.Content,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if req.ReplyToCommentId != "" {
		replyToID, err := strconv.ParseUint(req.ReplyToCommentId, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("invalid reply_to_comment_id: %w", err)
		}
		dbComment.ReplyToCommentID = &replyToID
	}

	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(dbComment).Error; err != nil {
			return err
		}

		return tx.Model(&db.Post{}).
			Where("id = ?", postID).
			UpdateColumn("comments_count", gorm.Expr("comments_count + 1")).
			Error
	})

	if err != nil {
		logger.Error(ctx, "Failed to create comment", "error", err)
		return nil, err
	}

	return s.convertDBCommentToProto(ctx, dbComment)
}

func (s *CommentService) DeleteComment(ctx context.Context, commentID uint64, userID uint64) error {
	var comment db.Comment
	err := s.db.Where("id = ? AND author_id = ?", commentID, userID).
		First(&comment).Error

	if err != nil {
		return err
	}

	postID := comment.PostID

	err = s.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		if err := tx.Model(&db.Comment{}).
			Where("id = ?", commentID).
			Update("deleted_at", now).Error; err != nil {
			return err
		}

		return tx.Model(&db.Post{}).
			Where("id = ?", postID).
			UpdateColumn("comments_count", gorm.Expr("comments_count - 1")).
			Error
	})

	if err != nil {
		logger.Error(ctx, "Failed to delete comment", "error", err)
		return err
	}

	return nil
}

func (s *CommentService) convertDBCommentToProto(ctx context.Context, dbComment *db.Comment) (*model.Comment, error) {
	var author db.Actor
	if err := s.db.Where("id = ?", dbComment.AuthorID).First(&author).Error; err != nil {
		return nil, err
	}

	replyToCommentID := ""
	if dbComment.ReplyToCommentID != nil {
		replyToCommentID = strconv.FormatUint(*dbComment.ReplyToCommentID, 10)
	}

	return &model.Comment{
		Id:        strconv.FormatUint(dbComment.ID, 10),
		PostId:    strconv.FormatUint(dbComment.PostID, 10),
		AuthorId:  strconv.FormatUint(dbComment.AuthorID, 10),
		Content:   dbComment.Content,
		CreatedAt: timestamppb.New(dbComment.CreatedAt),
		UpdatedAt: timestamppb.New(dbComment.UpdatedAt),
		IsDeleted: dbComment.DeletedAt != nil,
		Author: &model.PostAuthor{
			Id:          strconv.FormatUint(author.ID, 10),
			Username:    author.PreferredUsername,
			DisplayName: author.Name,
			AvatarUrl:   author.Icon,
		},
		LikesCount:       dbComment.LikesCount,
		IsLiked:          false,
		ReplyToCommentId: replyToCommentID,
		RepliesCount:     dbComment.RepliesCount,
	}, nil
}
