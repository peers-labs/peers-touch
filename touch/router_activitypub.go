package touch

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-go/touch/activitypub"
)

const (
	ActivityPubRouterURLInbox     RouterURL = "/{user}/inbox"
	ActivityPubRouterURLOutbox    RouterURL = "/{user}/outbox"
	ActivityPubRouterURLFollowers RouterURL = "/{user}/followers"
	ActivityPubRouterURLFollowing RouterURL = "/{user}/following"
	ActivityPubRouterURLLiked     RouterURL = "/{user}/liked"
	ActivityPubRouterURLFollow    RouterURL = "/{user}/follow"
	ActivityPubRouterURLUnfollow  RouterURL = "/{user}/unfollow"
	ActivityPubRouterURLLike      RouterURL = "/{user}/like"
	ActivityPubRouterURLUndo      RouterURL = "/{user}/undo"
	ActivityPubRouterURLActor     RouterURL = "/{user}/actor"

	// ActivityPubRouterURLChat
	// There is no chat-activity in ActivityPub official document. we implement it for chatting.
	ActivityPubRouterURLChat RouterURL = "/{user}/chat"
)

// ActivityPubRouters is a router for ActivityPub endpoints that implements the ActivityPub protocol
// also implements Routers interface
type ActivityPubRouters struct {
}

func (apr *ActivityPubRouters) Routers() []Router {
	return []Router{
		server.NewHandler(ActivityPubRouterURLInbox,
			func(c context.Context, ctx *app.RequestContext) {
				activitypub.HandleInboxActivity(c, ctx)
			}, server.WithMethod(server.POST)),
		server.NewHandler(ActivityPubRouterURLOutbox,
			func(c context.Context, ctx *app.RequestContext) {
				activitypub.GetOutboxActivities(c, ctx)
			}, server.WithMethod(server.GET)),
		server.NewHandler(ActivityPubRouterURLOutbox,
			func(c context.Context, ctx *app.RequestContext) {
				activitypub.CreateOutboxActivity(c, ctx)
			}, server.WithMethod(server.POST)),
		server.NewHandler(ActivityPubRouterURLFollowers,
			func(c context.Context, ctx *app.RequestContext) {
				activitypub.GetFollowers(c, ctx)
			}, server.WithMethod(server.GET)),
		server.NewHandler(ActivityPubRouterURLFollowing,
			func(c context.Context, ctx *app.RequestContext) {
				activitypub.GetFollowing(c, ctx)
			}, server.WithMethod(server.GET)),
		server.NewHandler(ActivityPubRouterURLLiked,
			func(c context.Context, ctx *app.RequestContext) {
				activitypub.GetLiked(c, ctx)
			}, server.WithMethod(server.GET)),

		server.NewHandler(ActivityPubRouterURLActor,
			func(c context.Context, ctx *app.RequestContext) {
				activitypub.GetActor(c, ctx)
			}, server.WithMethod(server.GET)),
		server.NewHandler(ActivityPubRouterURLFollow,
			func(c context.Context, ctx *app.RequestContext) {
				activitypub.CreateFollow(c, ctx)
			}, server.WithMethod(server.POST)),
		server.NewHandler(ActivityPubRouterURLUnfollow,
			func(c context.Context, ctx *app.RequestContext) {
				activitypub.CreateUnfollow(c, ctx)
			}, server.WithMethod(server.POST)),
		server.NewHandler(ActivityPubRouterURLLike,
			func(c context.Context, ctx *app.RequestContext) {
				activitypub.CreateLike(c, ctx)
			}, server.WithMethod(server.POST)),
		server.NewHandler(ActivityPubRouterURLUndo,
			func(c context.Context, ctx *app.RequestContext) {
				activitypub.CreateUndo(c, ctx)
			}, server.WithMethod(server.POST)),
		server.NewHandler(ActivityPubRouterURLChat,
			func(c context.Context, ctx *app.RequestContext) {
				ctx.String(http.StatusOK, "Chat endpoint not implemented yet")
			}, server.WithMethod(server.POST)),
	}
}

func (apr *ActivityPubRouters) Name() string {
	return RoutersNameActivityPub
}

// implements Router interface

// NewActivityPubRouter creates a new router with ActivityPub endpoints
func NewActivityPubRouter() *ActivityPubRouters {
	return &ActivityPubRouters{}
}
