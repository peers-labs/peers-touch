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
	repos     *infrastructure.Repos
	moments   *MomentService
	conv      *domain.PostConverter
	publisher *MomentEventPublisher
}

func NewCommentService(repos *infrastructure.Repos, moments *MomentService, publishers ...*MomentEventPublisher) *CommentService {
	var publisher *MomentEventPublisher
	if len(publishers) > 0 {
		publisher = publishers[0]
	}
	return &CommentService{repos: repos, moments: moments, conv: domain.NewPostConverter(), publisher: publisher}
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
	if blocked, err := postAuthorStationModerated(ctx, s.repos.Moderation, parent); err != nil {
		return nil, err
	} else if blocked {
		return nil, fmt.Errorf("parent post %d not found or not readable", parentPostID)
	}

	// PostClass is derived from the parent's audience — the parent we
	// just loaded passed the visibility check, so its audience kind is
	// authoritative. PUBLIC → public class, anything else → private
	// class. This avoids an extra repo round-trip and the
	// "viewerID=0 filter strips SELF posts" trap that a naive
	// classifyPost lookup would hit.
	postClass := domain.PostClassPrivate
	if parent.Audience == nil || parent.Audience.Kind == model.Audience_PUBLIC {
		postClass = domain.PostClassPublic
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
			Id:                fmt.Sprintf("%d", a.ID),
			Username:          a.PreferredUsername,
			DisplayName:       a.Name,
			AvatarUrl:         a.Icon,
			FederatedHandle:   federatedHandleOf(a),
			HomeStationDomain: homeStationDomainOf(a),
		}
	}

	logger.Info(ctx, "comment.created", "post_id", parentPostID, "comment_id", d.ID, "author_id", authorID)
	if s.publisher != nil {
		s.publisher.PublishCommented(ctx, parentPostID, parseActorID(parent.GetAuthor().GetId()), d.ID, authorID)
	}
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

// ListByPost returns one page of comments for a parent post. Parent post
// readability is checked here, then each comment actor is filtered by
// InteractionVisibility so third-party replies are only shown to common
// connections.
func (s *CommentService) ListByPost(ctx context.Context, parentPostID, viewerID uint64, cursor string, limit int) (*model.GetCommentsResponse, error) {
	c, err := domain.DecodeCursor(cursor)
	if err != nil {
		return nil, fmt.Errorf("invalid cursor: %w", err)
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	parent, err := s.moments.GetMoment(ctx, fmt.Sprintf("%d", parentPostID), viewerID)
	if err != nil {
		return nil, fmt.Errorf("lookup parent post: %w", err)
	}
	if parent == nil {
		return nil, fmt.Errorf("parent post %d not found or not readable", parentPostID)
	}
	if blocked, err := postAuthorStationModerated(ctx, s.repos.Moderation, parent); err != nil {
		return nil, err
	} else if blocked {
		return nil, fmt.Errorf("parent post %d not found or not readable", parentPostID)
	}
	postAuthorID := parseActorID(parent.GetAuthorId())
	visibility, err := buildInteractionVisibility(ctx, s.repos, viewerID, postAuthorID)
	if err != nil {
		return nil, fmt.Errorf("build interaction visibility: %w", err)
	}

	rows, err := s.repos.Comments.ListByPost(ctx, parentPostID, c, limit*3+1)
	if err != nil {
		return nil, err
	}
	comments := make([]*model.Comment, 0, len(rows))
	var lastVisible *domain.Comment
	for _, row := range rows {
		if !visibility.CanSeeActor(row.AuthorID) {
			continue
		}
		if len(comments) >= limit {
			break
		}
		out := s.conv.CommentToProto(row)
		if a, err := actor.GetActorByID(ctx, row.AuthorID); err == nil && a != nil {
			out.Author = &model.PostAuthor{
				Id:                fmt.Sprintf("%d", a.ID),
				Username:          a.PreferredUsername,
				DisplayName:       a.Name,
				AvatarUrl:         a.Icon,
				FederatedHandle:   federatedHandleOf(a),
				HomeStationDomain: homeStationDomainOf(a),
			}
		}
		comments = append(comments, out)
		lastVisible = row
	}
	hasMore := len(rows) > limit*3 || len(comments) == limit
	var nextCursor string
	if hasMore && lastVisible != nil {
		nextCursor = domain.Cursor{LastID: lastVisible.ID, CreatedAt: lastVisible.CreatedAt}.Encode()
	}
	return &model.GetCommentsResponse{
		Comments:   comments,
		NextCursor: nextCursor,
		HasMore:    hasMore,
	}, nil
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
