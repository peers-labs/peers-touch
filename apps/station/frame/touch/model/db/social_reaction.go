package db

import "time"

// SocialReaction is one typed reaction (`Audience` is implicit — a reaction
// is visible iff its parent post is) by one actor on one post.
//
// Composite primary key `(post_id, actor_id, kind)` enforces "at most one of
// each kind per (actor, post)" — the same actor can LOVE *and* LIKE the same
// post, but cannot LIKE it twice.
//
// Note: this stores social (Moments) reactions only. Chat-message reactions
// belong to the conversation authority and are modelled as
// ReactionCommittedFact conversation events, not a table in this package.
type SocialReaction struct {
	PostID    string    `gorm:"column:post_id;size:128;primaryKey"`
	ActorID   uint64    `gorm:"column:actor_id;primaryKey;autoIncrement:false;index:idx_sreaction_actor"`
	Kind      string    `gorm:"column:kind;primaryKey;type:varchar(32)"`
	PostClass string    `gorm:"column:post_class;type:varchar(8);not null"`
	CreatedAt time.Time `gorm:"column:created_at;index:idx_sreaction_post_created"`
}

func (SocialReaction) TableName() string { return "social_reactions" }
