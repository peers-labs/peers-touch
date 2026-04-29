package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

// PostClassPublic / PostClassPrivate are the two values of
// SocialComment.PostClass / SocialReaction.PostClass — denormalized so a
// comment / reaction row can be served without first joining either of the
// two post tables to ask "which one does this belong to".
const (
	PostClassPublic  = "public"
	PostClassPrivate = "private"
)

// SocialComment is a single-level threaded comment on a Moment. v1 enforces
// at most one level of nesting:
//
//   * a top-level comment has `ParentCommentID == nil`
//   * a reply has `ParentCommentID != nil` and the *parent* comment must
//     have `ParentCommentID == nil` (enforced in CommentService.Create, not
//     in DB constraints — SQLite recursive checks are not portable)
//
// Comments are stored in a single table for both public and private posts
// to keep cursor pagination simple. The `PostClass` column lets the
// application route loads to the correct post repo for visibility checks
// without a double JOIN.
type SocialComment struct {
	ID        uint64 `gorm:"column:id;primaryKey;autoIncrement:false"`
	PostID    uint64 `gorm:"column:post_id;index:idx_scomment_post_created;not null"`
	PostClass string `gorm:"column:post_class;type:varchar(8);not null"`
	AuthorID  uint64 `gorm:"column:author_id;index:idx_scomment_author;not null"`

	// ParentCommentID is set on a 1-level reply. Stored as a pointer so
	// the column is NULL for top-level comments — that lets a uniqueness
	// or filtered index target only top-level rows.
	ParentCommentID *uint64 `gorm:"column:parent_comment_id;index:idx_scomment_parent"`

	TextBody     string `gorm:"column:text_body;type:text;not null"`
	MentionsJSON string `gorm:"column:mentions_json;type:text"`

	EditedAt  *time.Time `gorm:"column:edited_at"`
	CreatedAt time.Time  `gorm:"column:created_at;index:idx_scomment_post_created"`
	UpdatedAt time.Time  `gorm:"column:updated_at"`
	DeletedAt *time.Time `gorm:"column:deleted_at;index"`
}

func (SocialComment) TableName() string { return "social_comments" }

func (c *SocialComment) BeforeCreate(tx *gorm.DB) error {
	if c.ID == 0 {
		c.ID = id.NextID()
	}
	return nil
}
