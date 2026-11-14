package application

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// Fixture methods exist only in this package's test binary. Production public
// mutations enter FeedLogService with Actor-signed authorization and events.
func (s *MomentService) CreateMoment(ctx context.Context, req *model.CreatePostRequest, author string) (*model.Post, error) {
	if req == nil || author == "" || req.Audience == nil {
		return nil, fmt.Errorf("invalid fixture post")
	}
	if err := domain.ValidateForAuthor(author, req.Audience); err != nil {
		return nil, err
	}
	if err := s.assertAudienceTargetReachable(ctx, author, req.Audience); err != nil {
		return nil, err
	}
	if err := s.validateAttachmentCIDs(ctx, req); err != nil {
		return nil, err
	}
	if req.Type == model.PostType_REPOST {
		post, err := s.GetMoment(ctx, req.GetRepost().GetOriginalPostId(), author)
		if err != nil || post == nil {
			return nil, fmt.Errorf("repost source is not readable: %v", err)
		}
	}
	post, err := s.conv.CreateRequestToDomain(req, author, nil)
	if err != nil {
		return nil, err
	}
	if !post.IsPublic() {
		return nil, fmt.Errorf("legacy private post creation removed; use prepare-private/submit-private routes")
	}
	row, err := s.conv.DomainToPublicDB(post)
	if err != nil {
		return nil, err
	}
	row.AuthorID, err = infrastructure.NewActorIdentity(s.db).RequireID(ctx, author)
	if err != nil {
		return nil, err
	}
	if err := s.db.WithContext(ctx).Create(row).Error; err != nil {
		return nil, err
	}
	post.ID, post.CreatedAt, post.UpdatedAt = row.ID, row.CreatedAt, row.UpdatedAt
	out, err := s.hydratePost(ctx, post, author)
	if s.publisher != nil {
		s.publisher.PublishCreated(ctx, post.ID, author, req.Audience)
	}
	return out, err
}

func (s *MomentService) DeleteMoment(ctx context.Context, postID string, author string) error {
	id := domain.ParseID(postID)
	if id == 0 {
		return fmt.Errorf("invalid post_id %q", postID)
	}
	post, err := s.repos.PublicPosts.GetByID(ctx, id)
	if err != nil || post == nil || post.AuthorPTID != author {
		return err
	}
	if err := s.db.WithContext(ctx).Model(&db.SocialPublicPost{}).Where("id = ?", id).
		Update("deleted_at", gorm.Expr("CURRENT_TIMESTAMP")).Error; err != nil {
		return err
	}
	if s.publisher != nil {
		s.publisher.PublishDeleted(ctx, id, author)
	}
	return nil
}
