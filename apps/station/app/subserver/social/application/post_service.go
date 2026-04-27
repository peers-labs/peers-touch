package application

import (
	"context"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

type PostService struct {
	db              *gorm.DB
	postRepo        infrastructure.PostRepository
	postContentRepo infrastructure.PostContentRepository
	postConverter   *domain.PostConverter
}

func NewPostService(
	db *gorm.DB,
	postRepo infrastructure.PostRepository,
	postContentRepo infrastructure.PostContentRepository,
	postConverter *domain.PostConverter,
) *PostService {
	return &PostService{
		db:              db,
		postRepo:        postRepo,
		postContentRepo: postContentRepo,
		postConverter:   postConverter,
	}
}

func (s *PostService) CreatePost(ctx context.Context, req *model.CreatePostRequest, authorID uint64) (*model.Post, error) {
	logger.Info(ctx, "CreatePost", "authorID", authorID, "type", req.Type, "replyTo", req.ReplyToPostId)

	// If this is a reply, create a Comment instead
	if req.ReplyToPostId != "" {
		return s.createComment(ctx, req, authorID)
	}

	if req.Type == model.PostType_TEXT && req.GetText() == nil {
		return nil, fmt.Errorf("text content is required for TEXT post")
	}

	dbPost, dbContent, err := s.postConverter.ProtoToDB(req, authorID)
	if err != nil {
		logger.Error(ctx, "failed to convert proto to db", "error", err)
		return nil, err
	}

	dbPost.ID = domain.Next()
	dbPost.CreatedAt = time.Now()
	dbPost.UpdatedAt = time.Now()

	dbContent.PostID = dbPost.ID

	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(dbPost).Error; err != nil {
			return err
		}
		if err := tx.Create(dbContent).Error; err != nil {
			return err
		}

		// Increment parent post's comments count if this is a reply
		if req.ReplyToPostId != "" {
			parentID := domain.ParseID(req.ReplyToPostId)
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

	post, err := s.postConverter.DBToProto(ctx, dbPost, authorID)
	if err != nil {
		logger.Error(ctx, "failed to convert db to proto", "error", err)
		return nil, err
	}

	logger.Info(ctx, "CreatePost success", "postID", post.Id)
	return post, nil
}

func (s *PostService) createComment(ctx context.Context, req *model.CreatePostRequest, authorID uint64) (*model.Post, error) {
	postID := domain.ParseID(req.ReplyToPostId)

	var content string
	if req.Type == model.PostType_TEXT && req.GetText() != nil {
		content = req.GetText().Text
	} else {
		return nil, fmt.Errorf("only text comments are supported")
	}

	comment := &db.Comment{
		ID:        domain.Next(),
		PostID:    postID,
		AuthorID:  authorID,
		Content:   content,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	err := s.db.Transaction(func(tx *gorm.DB) error {
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
	if err := s.db.Preload("Author").First(comment, comment.ID).Error; err != nil {
		logger.Warn(ctx, "failed to load comment author", "error", err)
	}

	// Convert comment to Post proto (for API compatibility)
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

func (s *PostService) GetPost(ctx context.Context, postID string, viewerID uint64) (*model.Post, error) {
	logger.Debug(ctx, "GetPost", "postID", postID, "viewerID", viewerID)

	id := domain.ParseID(postID)
	dbPost, err := s.postRepo.GetByID(ctx, id)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("post not found")
		}
		logger.Error(ctx, "failed to get post", "error", err)
		return nil, err
	}

	if !canViewPost(dbPost, viewerID) {
		return nil, fmt.Errorf("permission denied")
	}

	post, err := s.postConverter.DBToProto(ctx, dbPost, viewerID)
	if err != nil {
		logger.Error(ctx, "failed to convert db to proto", "error", err)
		return nil, err
	}

	return post, nil
}

func (s *PostService) UpdatePost(ctx context.Context, req *model.UpdatePostRequest, userID uint64) (*model.Post, error) {
	logger.Info(ctx, "UpdatePost", "postID", req.PostId, "userID", userID)

	postID := domain.ParseID(req.PostId)
	dbPost, err := s.postRepo.GetByID(ctx, postID)
	if err != nil {
		return nil, err
	}

	if dbPost.AuthorID != userID {
		return nil, fmt.Errorf("permission denied")
	}

	if req.Content != nil {
		dbContent, err := s.postContentRepo.GetByPostID(ctx, postID)
		if err != nil {
			return nil, err
		}
		dbContent.Text = *req.Content
		if err := s.postContentRepo.Update(ctx, dbContent); err != nil {
			logger.Error(ctx, "failed to update post content", "error", err)
			return nil, err
		}
		dbPost.Content = dbContent
	}

	if req.Visibility != nil {
		dbPost.Visibility = req.Visibility.String()
	}

	dbPost.UpdatedAt = time.Now()
	if err := s.postRepo.Update(ctx, dbPost); err != nil {
		logger.Error(ctx, "failed to update post", "error", err)
		return nil, err
	}

	post, err := s.postConverter.DBToProto(ctx, dbPost, userID)
	if err != nil {
		return nil, err
	}

	logger.Info(ctx, "UpdatePost success", "postID", req.PostId)
	return post, nil
}

func (s *PostService) DeletePost(ctx context.Context, postID string, userID uint64) error {
	logger.Info(ctx, "DeletePost", "postID", postID, "userID", userID)

	id := domain.ParseID(postID)
	dbPost, err := s.postRepo.GetByID(ctx, id)
	if err != nil {
		return err
	}

	if dbPost.AuthorID != userID {
		return fmt.Errorf("permission denied")
	}

	if err := s.postRepo.Delete(ctx, id); err != nil {
		logger.Error(ctx, "failed to delete post", "error", err)
		return err
	}

	logger.Info(ctx, "DeletePost success", "postID", postID)
	return nil
}

func (s *PostService) RepostPost(ctx context.Context, req *model.RepostRequest, userID uint64) (*model.RepostResponse, error) {
	logger.Info(ctx, "RepostPost", "postID", req.PostId, "userID", userID)

	originalPostID := domain.ParseID(req.PostId)

	// Check if original post exists
	_, err := s.postRepo.GetByID(ctx, originalPostID)
	if err != nil {
		return nil, fmt.Errorf("original post not found")
	}

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

	repost, err := s.CreatePost(ctx, createReq, userID)
	if err != nil {
		logger.Error(ctx, "failed to create repost", "error", err)
		return nil, err
	}

	// Update repost count on original post
	err = s.db.Model(&db.Post{}).
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

func (s *PostService) ListPosts(ctx context.Context, req *model.ListPostsRequest, viewerID uint64) (*model.ListPostsResponse, error) {
	logger.Debug(ctx, "ListPosts", "filter", req.Filter, "limit", req.Limit)

	limit := int(req.Limit)
	if limit == 0 {
		limit = 20
	}

	var cursor *infrastructure.Cursor
	if req.Cursor != "" {
		cursor = parseCursor(req.Cursor)
	}

	var posts []*db.Post
	var err error
	if req.Filter != nil && req.Filter.AuthorId != "" {
		authorID := domain.ParseID(req.Filter.AuthorId)
		posts, err = s.postRepo.ListByAuthor(ctx, authorID, cursor, limit)
	} else {
		// TODO: implement global timeline
		posts = []*db.Post{}
	}

	if err != nil {
		logger.Error(ctx, "failed to list posts", "error", err)
		return nil, err
	}

	protoPosts := make([]*model.Post, 0, len(posts))
	for _, dbPost := range posts {
		protoPost, err := s.postConverter.DBToProto(ctx, dbPost, viewerID)
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

func canViewPost(post *db.Post, viewerID uint64) bool {
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

// parseCursor decodes a cursor string into a typed Cursor.
// TODO(P1): implement actual cursor encoding/decoding (currently a stub
// shared with timeline_service).
func parseCursor(cursorStr string) *infrastructure.Cursor {
	_ = cursorStr
	return nil
}
