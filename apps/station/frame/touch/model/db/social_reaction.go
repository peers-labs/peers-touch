package db

import "time"

// SocialReaction is one typed reaction (`Audience` is implicit — a reaction
// is visible iff its target and parent post are) by one actor on one target.
//
// An empty CommentID selects the post. The typed target is part of the
// primary key so liking a comment cannot change a reaction on its parent.
//
// Note: this stores social (Moments) reactions only. Chat-message reactions
// belong to the conversation authority and are modelled as
// ReactionCommittedFact conversation events, not a table in this package.
type SocialReaction struct {
	PostID    string    `gorm:"column:post_id;size:128;primaryKey"`
	CommentID string    `gorm:"column:comment_id;size:128;primaryKey;not null;default:''"`
	ActorID   uint64    `gorm:"column:actor_id;primaryKey;autoIncrement:false;index:idx_sreaction_actor"`
	Kind      string    `gorm:"column:kind;primaryKey;type:varchar(32)"`
	PostClass string    `gorm:"column:post_class;type:varchar(8);not null"`
	CreatedAt time.Time `gorm:"column:created_at;index:idx_sreaction_post_created"`
}

func (SocialReaction) TableName() string { return "social_reactions" }
