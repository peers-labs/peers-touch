package application

import (
	"context"
	"fmt"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// CommentService handles comments on Moments. v1 supports at most one
// level of reply nesting (`parent_comment_id` may be set to a top-level
// comment, but the parent's parent_comment_id MUST be nil — enforced
// here, not in the DB).
//
// Visibility: a comment is visible iff its parent post is visible to
// the viewer (architecture invariant 9). This service therefore relies
// on MomentService.GetMoment to gate the parent post lookup before
// any comment can be created or read.
type CommentService struct {
	repos   *infrastructure.Repos
	moments *MomentService
	conv    *domain.PostConverter
}

func NewCommentService(repos *infrastructure.Repos, moments *MomentService) *CommentService {
	return &CommentService{repos: repos, moments: moments, conv: domain.NewPostConverter()}
}

// CreateComment validates the parent post exists + is readable + is
// not deleted, then validates the optional reply target (must be a
// top-level comment on the same post). Returns the created comment
// hydrated with author info.
func (s *CommentService) CreateComment(ctx context.Context, req *model.CreateCommentRequest, parentPostID, authorID uint64) (*model.Comment, error) {
	if req == nil {
		return nil, fmt.Errorf("CreateCommentRequest is nil")
	}
	if authorID == 0 {
		return nil, fmt.Errorf("authentication required")
	}
	if req.Content == "" {
		return nil, fmt.Errorf("content is required")
	}

	parent, err := s.moments.GetMoment(ctx, fmt.Sprintf("%d", parentPostID), authorID)
	if err != nil {
		return nil, fmt.Errorf("lookup parent post: %w", err)
	}
	if parent == nil {
		return nil, fmt.Errorf("parent post %d not found or not readable", parentPostID)
	}
	if parent.IsDeleted {
		return nil, fmt.Errorf("parent post %d is deleted", parentPostID)
	}

	postClass, err := s.classifyPost(ctx, parentPostID)
	if err != nil {
		return nil, err
	}

	if req.ReplyToCommentId != "" {
		parentCommentID := domain.ParseID(req.ReplyToCommentId)
		if parentCommentID == 0 {
			return nil, fmt.Errorf("invalid reply_to_comment_id %q", req.ReplyToCommentId)
		}
		parentComment, err := s.repos.Comments.GetByID(ctx, parentCommentID)
		if err != nil {
			return nil, err
		}
		if parentComment == nil {
			return nil, fmt.Errorf("parent comment %d not found", parentCommentID)
		}
		if parentComment.PostID != parentPostID {
			return nil, fmt.Errorf("parent comment belongs to a different post")
		}
		if !parentComment.IsTopLevel() {
			return nil, fmt.Errorf("can only reply to a top-level comment (one-level nesting in v1)")
		}
	}

	d, err := s.conv.CreateCommentRequestToDomain(req, authorID, parentPostID, postClass)
	if err != nil {
		return nil, err
	}
	if err := s.repos.Comments.Create(ctx, d); err != nil {
		return nil, fmt.Errorf("create comment: %w", err)
	}

	if _, err := s.bumpCommentsCount(ctx, parentPostID, postClass, +1); err != nil {
		logger.Warn(ctx, "comment.create: comments_count bump failed", "post_id", parentPostID, "error", err)
	}

	out := s.conv.CommentToProto(d)
	if a, err := actor.GetActorByID(ctx, authorID); err == nil && a != nil {
		out.Author = &model.PostAuthor{
			Id:          fmt.Sprintf("%d", a.ID),
			Username:    a.PreferredUsername,
			DisplayName: a.Name,
			AvatarUrl:   a.Icon,
		}
	}

	logger.Info(ctx, "comment.created", "post_id", parentPostID, "comment_id", d.ID, "author_id", authorID)
	return out, nil
}

// DeleteComment soft-deletes by author. No-op if the caller isn't the
// author.
func (s *CommentService) DeleteComment(ctx context.Context, commentID, authorID uint64) error {
	if authorID == 0 {
		return fmt.Errorf("authentication required")
	}

	c, err := s.repos.Comments.GetByID(ctx, commentID)
	if err != nil {
		return err
	}
	if c == nil {
		return nil
	}

	if err := s.repos.Comments.Delete(ctx, commentID, authorID); err != nil {
		return err
	}
	if _, err := s.bumpCommentsCount(ctx, c.PostID, c.PostClass, -1); err != nil {
		logger.Warn(ctx, "comment.delete: comments_count decrement failed", "post_id", c.PostID, "error", err)
	}
	logger.Info(ctx, "comment.deleted", "comment_id", commentID, "author_id", authorID)
	return nil
}

// ListByPost returns one page of comments for a parent post. Visibility
// is gated by the upstream parent-post check; this service trusts the
// caller to have validated readability before invoking.
func (s *CommentService) ListByPost(ctx context.Context, parentPostID uint64, cursor string, limit int) (*model.GetCommentsResponse, error) {
	c, err := domain.DecodeCursor(cursor)
	if err != nil {
		return nil, fmt.Errorf("invalid cursor: %w", err)
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.repos.Comments.ListByPost(ctx, parentPostID, c, limit+1)
	if err != nil {
		return nil, err
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	comments := make([]*model.Comment, 0, len(rows))
	for _, row := range rows {
		out := s.conv.CommentToProto(row)
		if a, err := actor.GetActorByID(ctx, row.AuthorID); err == nil && a != nil {
			out.Author = &model.PostAuthor{
				Id:          fmt.Sprintf("%d", a.ID),
				Username:    a.PreferredUsername,
				DisplayName: a.Name,
				AvatarUrl:   a.Icon,
			}
		}
		comments = append(comments, out)
	}
	var nextCursor string
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		nextCursor = domain.Cursor{LastID: last.ID, CreatedAt: last.CreatedAt}.Encode()
	}
	return &model.GetCommentsResponse{
		Comments:   comments,
		NextCursor: nextCursor,
		HasMore:    hasMore,
	}, nil
}

// classifyPost looks up the post in either repo to determine its
// PostClass. Returns "" + error if the post isn't found in either
// table.
func (s *CommentService) classifyPost(ctx context.Context, postID uint64) (domain.PostClass, error) {
	if p, err := s.repos.PublicPosts.GetByID(ctx, postID); err != nil {
		return "", err
	} else if p != nil {
		return domain.PostClassPublic, nil
	}
	if p, err := s.repos.PrivatePosts.GetByID(ctx, postID, 0); err != nil {
		return "", err
	} else if p != nil {
		return domain.PostClassPrivate, nil
	}
	return "", fmt.Errorf("post %d not found in either storage class", postID)
}

func (s *CommentService) bumpCommentsCount(ctx context.Context, postID uint64, class domain.PostClass, delta int64) (int64, error) {
	switch class {
	case domain.PostClassPublic:
		return s.repos.PublicPosts.UpdateCommentsCount(ctx, postID, delta)
	case domain.PostClassPrivate:
		return s.repos.PrivatePosts.UpdateCommentsCount(ctx, postID, delta)
	default:
		return 0, fmt.Errorf("unknown post class %q", class)
	}
}
