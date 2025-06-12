package touch

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

const (
	ActivityPubRouterURLInbox    RouterURL = "/inbox"
	ActivityPubRouterURLOutbox   RouterURL = "/outbox"
	ActivityPubRouterURLFollow   RouterURL = "/follow"
	ActivityPubRouterURLUnfollow RouterURL = "/unfollow"
	ActivityPubRouterURLLike     RouterURL = "/like"
	ActivityPubRouterURLUndo     RouterURL = "/undo"

	// ActivityPubRouterURLChat
	// There is no chat-activity in ActivityPub official document. we implement it for chatting.
	ActivityPubRouterURLChat RouterURL = "/chat"
)

// ActivityPubRouters is a router for ActivityPub endpoints that implements the ActivityPub protocol
// also implements Routers interface
type ActivityPubRouters struct{}

func (apr *ActivityPubRouters) Routers() []Router {
	return []Router{
		server.NewHandler(ActivityPubRouterURLInbox.Name(), ActivityPubRouterURLInbox.URL(),
			func(c context.Context, ctx *app.RequestContext) {
				ctx.String(http.StatusOK, "hello world, inbox")
			}, server.WithMethod(server.POST)),
		server.NewHandler(ActivityPubRouterURLOutbox.Name(), ActivityPubRouterURLOutbox.URL(),
			func(c context.Context, ctx *app.RequestContext) {
				ctx.String(http.StatusOK, "hello world, outbox")
			}, server.WithMethod(server.POST)),
		server.NewHandler(ActivityPubRouterURLFollow.Name(), ActivityPubRouterURLFollow.URL(),
			func(c context.Context, ctx *app.RequestContext) {
				ctx.String(http.StatusOK, "hello world, follow")
			}, server.WithMethod(server.POST)),
		server.NewHandler(ActivityPubRouterURLUnfollow.Name(), ActivityPubRouterURLUnfollow.URL(),
			func(c context.Context, ctx *app.RequestContext) {
				ctx.String(http.StatusOK, "hello world, unfollow")
			}, server.WithMethod(server.POST)),
		server.NewHandler(ActivityPubRouterURLLike.Name(), ActivityPubRouterURLLike.URL(),
			func(c context.Context, ctx *app.RequestContext) {
				ctx.String(http.StatusOK, "hello world, like")
			}, server.WithMethod(server.POST)),
		server.NewHandler(ActivityPubRouterURLUndo.Name(), ActivityPubRouterURLUndo.URL(),
			func(c context.Context, ctx *app.RequestContext) {
				ctx.String(http.StatusOK, "hello world, undo")
			}, server.WithMethod(server.POST)),
		server.NewHandler(ActivityPubRouterURLChat.Name(), ActivityPubRouterURLChat.URL(),
			func(c context.Context, ctx *app.RequestContext) {
				ctx.String(http.StatusOK, "hello world, undo")
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
