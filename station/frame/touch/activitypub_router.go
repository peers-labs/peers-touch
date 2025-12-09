package touch

import (
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

const (
	// ActivityPubRouterURLActor ActivityPub URLs (all user-scoped)
	// Actor document: canonical ActivityStreams representation ("self") for the given actor
	ActivityPubRouterURLActor RouterPath = "/:actor/actor"
	// ActivityPubRouterURLInbox Actor inbox: server-to-server delivery target for activities addressed to this actor
	ActivityPubRouterURLInbox RouterPath = "/:actor/inbox"
	// ActivityPubRouterURLOutbox Actor outbox: client-to-server publishing endpoint for activities created by this actor
	ActivityPubRouterURLOutbox RouterPath = "/:actor/outbox"
	// ActivityPubRouterURLFollowers Followers collection: who follows this actor (OrderedCollection / paged)
	ActivityPubRouterURLFollowers RouterPath = "/:actor/followers"
	// ActivityPubRouterURLFollowing Following collection: who this actor follows (OrderedCollection / paged)
	ActivityPubRouterURLFollowing RouterPath = "/:actor/following"
	// ActivityPubRouterURLLiked Liked collection: objects this actor has liked (OrderedCollection / paged)
	ActivityPubRouterURLLiked RouterPath = "/:actor/liked"
	// ActivityPubRouterURLFollow Simplified follow action: create a Follow activity
	ActivityPubRouterURLFollow RouterPath = "/:actor/follow"
	// ActivityPubRouterURLUnfollow Simplified unfollow action: create an Undo(Follow) activity
	ActivityPubRouterURLUnfollow RouterPath = "/:actor/unfollow"
	// ActivityPubRouterURLLike Simplified like action: create a Like activity
	ActivityPubRouterURLLike RouterPath = "/:actor/like"
	// ActivityPubRouterURLUndo Simplified undo action: create an Undo activity for a previous action
	ActivityPubRouterURLUndo RouterPath = "/:actor/undo"
	// ActivityPubRouterURLSharedInbox Shared inbox: wide delivery endpoint for public and followers-addressed activities
	ActivityPubRouterURLSharedInbox RouterPath = "/inbox"
	// ActivityPubRouterURLNodeInfo21 NodeInfo 2.1 schema endpoint
	//  - Purpose: Exposes instance metadata used by Fediverse aggregators (e.g., Mastodon/GoToSocial) for discovery.
	//  - Flow: Clients first call `/.well-known/nodeinfo` to obtain a link, then fetch `GET /nodeinfo/2.1`.
	//  - Response: JSON including `version`, `software{name,version}`, `protocols`, `services{inbound,outbound}`,
	//              `openRegistrations`, `usage{users}`, and optional `metadata`.
	//  - Compatibility: Works with hosts that include non-standard ports; links are built using request `scheme` and `host`.
	ActivityPubRouterURLNodeInfo21 RouterPath = "/nodeinfo/2.1"

	// RouterURLActorSignUP Actor Management URLs (Client API)
	// Client sign-up: create a local actor account
	RouterURLActorSignUP RouterPath = "/sign-up"
	// RouterURLActorLogin Client login: obtain session/tokens
	RouterURLActorLogin RouterPath = "/login"
	// RouterURLActorProfile Actor profile: GET/POST to read or update profile attributes
	RouterURLActorProfile RouterPath = "/profile"
	// RouterURLPublicProfile Public actor profile: GET to read extended profile by username
	RouterURLPublicProfile RouterPath = "/:actor/profile"
	// RouterURLActorList Actor list: enumerate local actors (for admin/testing)
	RouterURLActorList RouterPath = "/list"
)

// ActivityPubRouters provides general ActivityPub endpoints
type ActivityPubRouters struct{}

// Ensure ActivityPubRouters implements server.Routers interface
var _ server.Routers = (*ActivityPubRouters)(nil)

// Routers registers all general ActivityPub-related handlers
func (apr *ActivityPubRouters) Handlers() []server.Handler {
	handlerInfos := GetActivityPubHandlers()
	handlers := make([]server.Handler, len(handlerInfos))

	for i, info := range handlerInfos {
		handlers[i] = server.NewHandler(
			info.RouterURL,
			info.Handler,
			server.WithMethod(info.Method),
			server.WithWrappers(info.Wrappers...),
		)
	}

	return handlers
}

func (apr *ActivityPubRouters) Name() string {
	return model.RouteNameActivityPub
}

// NewActivityPubRouter creates a new ActivityPubRouters
func NewActivityPubRouter() *ActivityPubRouters {
	return &ActivityPubRouters{}
}
