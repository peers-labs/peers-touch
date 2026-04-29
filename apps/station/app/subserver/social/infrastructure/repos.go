package infrastructure

import (
	"context"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"gorm.io/gorm"
)

// Repos bundles all repositories the social subserver needs into a
// single value the subserver wires once and hands to each application
// service. Keeping this as a struct (rather than passing eight
// individual repos through every constructor) avoids fragile
// constructor-argument churn when a new repo is added later.
type Repos struct {
	PublicPosts   domain.PublicPostRepository
	PrivatePosts  domain.PrivatePostRepository
	AudienceGrant domain.AudienceGrantRepository
	Comments      domain.CommentRepository
	Reactions     domain.ReactionRepository
	Circles       domain.CircleRepository

	// Follows is the broader follow-graph repo used by RelationshipService.
	// The narrower `domain.FollowRepository` interface is satisfied by
	// the same instance (Follows implements both).
	Follows FollowRepository
}

// NewRepos constructs every repo against the supplied *gorm.DB. The
// `resolveDID` function is the actor-id → DID resolver used by the
// private-post repo's CUSTOM_DENY fast path. P1 wires the no-op
// default (returns ""); P3 plugs in a real implementation when chat /
// actor surfaces ratify the API.
func NewRepos(gdb *gorm.DB, resolveDID func(context.Context, uint64) (string, error)) *Repos {
	grants := NewAudienceGrantRepository(gdb)
	return &Repos{
		PublicPosts:   NewPublicPostRepository(gdb),
		PrivatePosts:  NewPrivatePostRepository(gdb, grants, resolveDID),
		AudienceGrant: grants,
		Comments:      NewCommentRepository(gdb),
		Reactions:     NewReactionRepository(gdb),
		Circles:       NewCircleRepository(gdb),
		Follows:       NewFollowRepository(gdb),
	}
}
