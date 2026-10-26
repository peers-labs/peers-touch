package application

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
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
func (s *CommentService) CreateComment(ctx context.Context, req *model.CreateCommentRequest, parentPostID uint64, authorPTID string) (*model.Comment, error) {
	if req == nil {
		return nil, fmt.Errorf("CreateCommentRequest is nil")
	}
	if authorPTID == "" {
		return nil, fmt.Errorf("authentication required")
	}
	if req.Content == "" {
		return nil, fmt.Errorf("content is required")
	}

	parent, err := s.moments.GetMoment(ctx, fmt.Sprintf("%d", parentPostID), authorPTID)
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

	d, err := s.conv.CreateCommentRequestToDomain(req, authorPTID, parentPostID, postClass)
	if err != nil {
		return nil, err
	}
	if err := s.repos.Comments.Create(ctx, d); err != nil {
		return nil, fmt.Errorf("create comment: %w", err)
	}

	if _, err := s.bumpCommentsCount(ctx, parentPostID, postClass, +1); err != nil {
		logger.Warn(ctx, "comment.create: comments_count bump failed", "error", err)
	}

	out := s.conv.CommentToProto(d)
	if a, err := actor.GetActorByPTID(ctx, authorPTID); err == nil && a != nil {
		out.Author = &model.PostAuthor{
			Id:                a.PTID,
			Username:          a.PreferredUsername,
			DisplayName:       a.Name,
			AvatarUrl:         a.Icon,
			FederatedHandle:   federatedHandleOf(a),
			HomeStationDomain: homeStationDomainOf(a),
		}
	}

	logger.Info(ctx, "comment.created")
	if s.publisher != nil {
		s.publisher.PublishCommented(ctx, parentPostID, parent.GetAuthorPtid(), d.ID, authorPTID)
	}
	return out, nil
}

// DeleteComment soft-deletes by author. No-op if the caller isn't the
// author.
func (s *CommentService) DeleteComment(ctx context.Context, commentID uint64, authorPTID string) error {
	if authorPTID == "" {
		return fmt.Errorf("authentication required")
	}

	c, err := s.repos.Comments.GetByID(ctx, commentID)
	if err != nil {
		return err
	}
	if c == nil {
		return nil
	}

	if err := s.repos.Comments.Delete(ctx, commentID, authorPTID); err != nil {
		return err
	}
	if _, err := s.bumpCommentsCount(ctx, c.PostID, c.PostClass, -1); err != nil {
		logger.Warn(ctx, "comment.delete: comments_count decrement failed", "error", err)
	}
	logger.Info(ctx, "comment.deleted")
	return nil
}

func (s *CommentService) GetByPost(
	ctx context.Context,
	parentPostID uint64,
	commentID uint64,
	viewerPTID string,
) (*model.Comment, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	batch, err := NewPublicReadPort(s.repos).Read(ctx, viewerPTID, nil, []uint64{commentID})
	if err != nil {
		return nil, err
	}
	comment := batch.Comments[commentID]
	if comment == nil ||
		comment.PostID != parentPostID {
		return nil, nil
	}
	return s.commentToProtoWith(comment, batch.Authors[comment.AuthorPTID]), nil
}

// ListByPost returns one page of comments for a parent post. Parent post
// readability is checked here, then each comment actor is filtered by
// InteractionVisibility so third-party replies are only shown to common
// connections.
var ErrPublicCommentUnavailable = errors.New("public comment unavailable")

func (s *CommentService) ListByPost(ctx context.Context, parentPostID uint64, viewerPTID string, cursor string, limit int, anchors ...uint64) (*model.GetCommentsResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var anchor uint64
	if len(anchors) > 1 || (len(anchors) == 1 && cursor != "") {
		return nil, fmt.Errorf("cursor and anchor are mutually exclusive")
	}
	if len(anchors) == 1 {
		anchor = anchors[0]
	}
	c, err := domain.DecodeCursor(cursor)
	if err != nil {
		return nil, fmt.Errorf("invalid cursor: %w", err)
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	scanLimit := min(limit*3, 100)
	var rows []*domain.Comment
	if anchor != 0 {
		rows, err = s.repos.Comments.ListPublicWindow(ctx, parentPostID, anchor, scanLimit+1)
	} else {
		rows, err = s.repos.Comments.ListByPost(ctx, parentPostID, c, scanLimit+1)
	}
	if err != nil {
		return nil, err
	}
	hasMore := len(rows) > scanLimit
	if hasMore {
		rows = rows[:scanLimit]
	}
	batch, err := NewPublicReadPort(s.repos).readWithComments(ctx, viewerPTID, []uint64{parentPostID}, rows)
	if err != nil {
		return nil, err
	}
	if batch.Posts[parentPostID] == nil || (anchor != 0 && batch.Comments[anchor] == nil) {
		return nil, ErrPublicCommentUnavailable
	}
	comments := make([]*model.Comment, 0, len(rows))
	var lastScanned *domain.Comment
	for index, row := range rows {
		lastScanned = row
		if batch.Comments[row.ID] != nil {
			comments = append(comments, s.commentToProtoWith(row, batch.Authors[row.AuthorPTID]))
			if len(comments) == limit {
				hasMore = hasMore || index+1 < len(rows)
				break
			}
		}
	}
	var nextCursor string
	if hasMore && lastScanned != nil {
		nextCursor = domain.Cursor{LastID: lastScanned.ID, CreatedAt: lastScanned.CreatedAt}.Encode()
	}
	return &model.GetCommentsResponse{
		Comments:   comments,
		NextCursor: nextCursor,
		HasMore:    hasMore,
	}, nil
}

func (s *CommentService) commentToProtoWith(comment *domain.Comment, authorRecord *db.Actor) *model.Comment {
	result := s.conv.CommentToProto(comment)
	if authorRecord != nil {
		result.Author = &model.PostAuthor{
			Id:                authorRecord.PTID,
			Username:          authorRecord.PreferredUsername,
			DisplayName:       authorRecord.Name,
			AvatarUrl:         authorRecord.Icon,
			FederatedHandle:   federatedHandleOf(authorRecord),
			HomeStationDomain: homeStationDomainOf(authorRecord),
		}
	}
	return result
}

func (s *CommentService) bumpCommentsCount(ctx context.Context, postID uint64, class domain.PostClass, delta int64) (int64, error) {
	switch class {
	case domain.PostClassPublic:
		return s.repos.PublicPosts.UpdateCommentsCount(ctx, postID, delta)
	default:
		return 0, fmt.Errorf("unknown or unreachable post class %q", class)
	}
}
