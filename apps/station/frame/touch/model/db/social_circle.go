package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

// SocialCircle is a publisher-private group of recipients ("家人"、"老同学")
// used to target Moments via `Audience.kind == CIRCLE`. **Only the owner can
// see the circle's name and member list** — circle membership is private
// metadata of the publisher, not a shared social object (see
// `docs/architecture/social/moments.md §2.3`).
//
// MemberCount is denormalized for fast UI listing; the source of truth is
// `SocialCircleMember`, kept in sync by CircleService.{Add,Remove}Member.
type SocialCircle struct {
	ID      uint64 `gorm:"column:id;primaryKey;autoIncrement:false"`
	OwnerID uint64 `gorm:"column:owner_id;index:idx_scircle_owner;not null"`

	Name        string `gorm:"column:name;type:varchar(64);not null"`
	Emoji       string `gorm:"column:emoji;type:varchar(16)"`
	MemberCount int32  `gorm:"column:member_count;default:0"`

	CreatedAt time.Time  `gorm:"column:created_at"`
	UpdatedAt time.Time  `gorm:"column:updated_at"`
	DeletedAt *time.Time `gorm:"column:deleted_at;index"`
}

func (SocialCircle) TableName() string { return "social_circles" }

func (c *SocialCircle) BeforeCreate(tx *gorm.DB) error {
	if c.ID == 0 {
		c.ID = id.NextID()
	}
	return nil
}

// SocialCircleMember enumerates the members of a circle. Members are
// referenced by DID (not local actor_id) so the same circle can target
// remote actors after federation lands (P5+); local DID resolution is the
// ActorResolver contract's job.
type SocialCircleMember struct {
	CircleID uint64    `gorm:"column:circle_id;primaryKey;autoIncrement:false"`
	ActorDID string    `gorm:"column:actor_did;primaryKey;size:128"`
	AddedAt  time.Time `gorm:"column:added_at;index"`
}

func (SocialCircleMember) TableName() string { return "social_circle_members" }
