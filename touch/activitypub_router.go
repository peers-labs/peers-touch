package touch

import (
	"github.com/peers-touch/peers-touch-go/core/server"
)

const (
	// ActivityPub URLs (all user-scoped)
	ActivityPubRouterURLActor     RouterPath = "/:username/actor"
	ActivityPubRouterURLInbox     RouterPath = "/:username/inbox"
	ActivityPubRouterURLOutbox    RouterPath = "/:username/outbox"
	ActivityPubRouterURLFollowers RouterPath = "/:username/followers"
	ActivityPubRouterURLFollowing RouterPath = "/:username/following"
	ActivityPubRouterURLLiked     RouterPath = "/:username/liked"
	ActivityPubRouterURLFollow    RouterPath = "/:username/follow"
	ActivityPubRouterURLUnfollow  RouterPath = "/:username/unfollow"
	ActivityPubRouterURLLike      RouterPath = "/:username/like"
	ActivityPubRouterURLUndo      RouterPath = "/:username/undo"
	ActivityPubRouterURLChat      RouterPath = "/:username/chat"
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
	return RoutersNameActivityPub
}

// NewActivityPubRouter creates a new ActivityPubRouters
func NewActivityPubRouter() *ActivityPubRouters {
	return &ActivityPubRouters{}
}
