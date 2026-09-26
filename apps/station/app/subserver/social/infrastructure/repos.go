package infrastructure

import (
	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"gorm.io/gorm"
)

// Repos bundles all repositories the social subserver needs into a
// single value the subserver wires once and hands to each application
// service. Keeping this as a struct (rather than passing eight
// individual repos through every constructor) avoids fragile
// constructor-argument churn when a new repo is added later.
type Repos struct {
	PublicPosts domain.PublicPostRepository
	Deliveries  domain.MomentDeliveryRepository
	Comments    domain.CommentRepository
	Reactions   domain.ReactionRepository
	Circles     domain.CircleRepository
	Stats       domain.MomentsStatsRepository

	// Follows is the broader follow-graph repo used by RelationshipService.
	// The narrower `domain.FollowRepository` interface is satisfied by
	// the same instance (Follows implements both).
	Follows    FollowRepository
	Blocks     BlockGraphRepository
	Moderation domain.StationModerationRepository
	Identity   *ActorIdentity
}

// NewRepos constructs every repository and persistence adapter against the
// supplied database. Actor identity translation stays inside this layer.
func NewRepos(gdb *gorm.DB) *Repos {
	identity := NewActorIdentity(gdb)
	return &Repos{
		PublicPosts: NewPublicPostRepository(gdb),
		Deliveries:  NewMomentDeliveryRepository(gdb),
		Comments:    NewCommentRepository(gdb),
		Reactions:   NewReactionRepository(gdb),
		Circles:     NewCircleRepository(gdb),
		Stats:       NewMomentsStatsRepository(gdb, identity),
		Follows:     NewFollowRepository(gdb),
		Blocks:      NewBlockGraphRepository(gdb),
		Moderation:  NewStationModerationRepository(gdb),
		Identity:    identity,
	}
}
