package infrastructure

import (
	"context"
	"errors"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// commentRepo implements `domain.CommentRepository` against the
// `social_comments` table. Comments are stored in a single table
// regardless of post class — the `PostClass` column lets the
// application layer route hydration to the correct post repo for
// visibility re-check without a UNION across two tables.
type commentRepo struct {
	db       *gorm.DB
	conv     *domain.PostConverter
	identity *ActorIdentity
}

func NewCommentRepository(gdb *gorm.DB) domain.CommentRepository {
	return &commentRepo{db: gdb, conv: domain.NewPostConverter(), identity: NewActorIdentity(gdb)}
}

func (r *commentRepo) Create(ctx context.Context, c *domain.Comment) error {
	row := r.conv.CommentToDB(c)
	authorID, err := r.identity.RequireID(ctx, c.AuthorPTID)
	if err != nil {
		return err
	}
	row.AuthorID = authorID
	if err := r.db.WithContext(ctx).Create(row).Error; err != nil {
		return err
	}
	c.ID = row.ID
	c.CreatedAt = row.CreatedAt
	c.UpdatedAt = row.UpdatedAt
	return nil
}

func (r *commentRepo) GetByID(ctx context.Context, id uint64) (*domain.Comment, error) {
	var row db.SocialComment
	err := r.db.WithContext(ctx).
		Where("id = ? AND deleted_at IS NULL", id).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return r.hydrateOne(ctx, &row)
}

func (r *commentRepo) Delete(ctx context.Context, id uint64, authorPTID string) error {
	authorID, err := r.identity.RequireID(ctx, authorPTID)
	if err != nil {
		return err
	}
	return r.db.WithContext(ctx).
		Model(&db.SocialComment{}).
		Where("id = ? AND author_id = ? AND deleted_at IS NULL", id, authorID).
		Update("deleted_at", gorm.Expr("CURRENT_TIMESTAMP")).Error
}

func (r *commentRepo) ListByPost(ctx context.Context, postID uint64, c domain.Cursor, limit int) ([]*domain.Comment, error) {
	q := r.db.WithContext(ctx).
		Where("post_id = ? AND deleted_at IS NULL", postID)
	if !c.IsZero() {
		q = q.Where("(created_at, id) < (?, ?)", c.CreatedAt, c.LastID)
	}
	var rows []*db.SocialComment
	if err := q.Order("created_at DESC, id DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]*domain.Comment, 0, len(rows))
	for _, row := range rows {
		comment, err := r.hydrateOne(ctx, row)
		if err != nil {
			return nil, err
		}
		out = append(out, comment)
	}
	return out, nil
}

func (r *commentRepo) hydrateOne(ctx context.Context, row *db.SocialComment) (*domain.Comment, error) {
	authorPTID, err := r.identity.ResolveID(ctx, row.AuthorID)
	if err != nil {
		return nil, err
	}
	comment := r.conv.CommentDBToDomain(row)
	comment.AuthorPTID = authorPTID
	return comment, nil
}

func (r *commentRepo) CountByPost(ctx context.Context, postID uint64) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&db.SocialComment{}).
		Where("post_id = ? AND deleted_at IS NULL", postID).
		Count(&count).Error
	return count, err
}
