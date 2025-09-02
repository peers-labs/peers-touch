package touch

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-go/touch/activitypub"
)

// ActivityPubHandlerInfo represents a single handler's information
type ActivityPubHandlerInfo struct {
	RouterURL RouterPath
	Handler   func(context.Context, *app.RequestContext)
	Method    server.Method
	Wrappers  []server.Wrapper
}

// GetActivityPubHandlers returns all ActivityPub handler configurations
func GetActivityPubHandlers() []ActivityPubHandlerInfo {
	commonWrapper := CommonAccessControlWrapper(RoutersNameActivityPub)

	return []ActivityPubHandlerInfo{
		// User-specific ActivityPub endpoints
		{
			RouterURL: ActivityPubRouterURLActor,
			Handler:   GetUserActor,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
		{
			RouterURL: ActivityPubRouterURLInbox,
			Handler:   GetUserInbox,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
		{
			RouterURL: ActivityPubRouterURLInbox,
			Handler:   PostUserInbox,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
		{
			RouterURL: ActivityPubRouterURLOutbox,
			Handler:   GetUserOutbox,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
		{
			RouterURL: ActivityPubRouterURLOutbox,
			Handler:   PostUserOutbox,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
		{
			RouterURL: ActivityPubRouterURLFollowers,
			Handler:   GetUserFollowers,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
		{
			RouterURL: ActivityPubRouterURLFollowing,
			Handler:   GetUserFollowing,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
		{
			RouterURL: ActivityPubRouterURLLiked,
			Handler:   GetUserLiked,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
		// Additional ActivityPub endpoints
		{
			RouterURL: ActivityPubRouterURLFollow,
			Handler:   CreateFollowHandler,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
		{
			RouterURL: ActivityPubRouterURLUnfollow,
			Handler:   CreateUnfollowHandler,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
		{
			RouterURL: ActivityPubRouterURLLike,
			Handler:   CreateLikeHandler,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
		{
			RouterURL: ActivityPubRouterURLUndo,
			Handler:   CreateUndoHandler,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
		{
			RouterURL: ActivityPubRouterURLChat,
			Handler:   ChatHandler,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
	}
}

// Handler implementations

func CreateFollowHandler(c context.Context, ctx *app.RequestContext) {
	activitypub.CreateFollow(c, ctx)
}

func CreateUnfollowHandler(c context.Context, ctx *app.RequestContext) {
	activitypub.CreateUnfollow(c, ctx)
}

func CreateLikeHandler(c context.Context, ctx *app.RequestContext) {
	activitypub.CreateLike(c, ctx)
}

func CreateUndoHandler(c context.Context, ctx *app.RequestContext) {
	activitypub.CreateUndo(c, ctx)
}

func ChatHandler(c context.Context, ctx *app.RequestContext) {
	ctx.String(http.StatusOK, "Chat endpoint not implemented yet")
}

// User ActivityPub Handler Functions

// GetUserActor handles GET requests for user actor
func GetUserActor(c context.Context, ctx *app.RequestContext) {
	// TODO: Implement ActivityPub user actor endpoint
	ctx.JSON(200, map[string]interface{}{
		"message": "GetUserActor not implemented yet",
	})
}

// GetUserInbox handles GET requests for user inbox
func GetUserInbox(c context.Context, ctx *app.RequestContext) {
	// TODO: Implement ActivityPub user inbox GET endpoint
	ctx.JSON(200, map[string]interface{}{
		"message": "GetUserInbox not implemented yet",
	})
}

// PostUserInbox handles POST requests for user inbox
func PostUserInbox(c context.Context, ctx *app.RequestContext) {
	// TODO: Implement ActivityPub user inbox POST endpoint
	ctx.JSON(200, map[string]interface{}{
		"message": "PostUserInbox not implemented yet",
	})
}

// GetUserOutbox handles GET requests for user outbox
func GetUserOutbox(c context.Context, ctx *app.RequestContext) {
	// TODO: Implement ActivityPub user outbox GET endpoint
	ctx.JSON(200, map[string]interface{}{
		"message": "GetUserOutbox not implemented yet",
	})
}

// PostUserOutbox handles POST requests for user outbox
func PostUserOutbox(c context.Context, ctx *app.RequestContext) {
	// TODO: Implement ActivityPub user outbox POST endpoint
	ctx.JSON(200, map[string]interface{}{
		"message": "PostUserOutbox not implemented yet",
	})
}

// GetUserFollowers handles GET requests for user followers
func GetUserFollowers(c context.Context, ctx *app.RequestContext) {
	// TODO: Implement ActivityPub user followers endpoint
	ctx.JSON(200, map[string]interface{}{
		"message": "GetUserFollowers not implemented yet",
	})
}

// GetUserFollowing handles GET requests for user following
func GetUserFollowing(c context.Context, ctx *app.RequestContext) {
	// TODO: Implement ActivityPub user following endpoint
	ctx.JSON(200, map[string]interface{}{
		"message": "GetUserFollowing not implemented yet",
	})
}

// GetUserLiked handles GET requests for user liked
func GetUserLiked(c context.Context, ctx *app.RequestContext) {
	// TODO: Implement ActivityPub user liked endpoint
	ctx.JSON(200, map[string]interface{}{
		"message": "GetUserLiked not implemented yet",
	})
}
