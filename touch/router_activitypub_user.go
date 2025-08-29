package touch

import (
	"context"
	"net/http"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	log "github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-go/core/store"
	"github.com/dirty-bro-tech/peers-touch-go/touch/webfinger"
)

const (
	// User-specific ActivityPub endpoints
	ActivityPubRouterURLUserActor     RouterURL = "/users/{username}"
	ActivityPubRouterURLUserInbox     RouterURL = "/users/{username}/inbox"
	ActivityPubRouterURLUserOutbox    RouterURL = "/users/{username}/outbox"
	ActivityPubRouterURLUserFollowers RouterURL = "/users/{username}/followers"
	ActivityPubRouterURLUserFollowing RouterURL = "/users/{username}/following"
	ActivityPubRouterURLUserLiked     RouterURL = "/users/{username}/liked"
)

// UserActivityPubRouters provides user-specific ActivityPub endpoints
type UserActivityPubRouters struct{}

func (uapr *UserActivityPubRouters) Routers() []Router {
	return []Router{
		// User actor endpoint
		server.NewHandler(ActivityPubRouterURLUserActor, GetUserActor,
			server.WithMethod(server.GET)),

		// User inbox endpoints
		server.NewHandler(ActivityPubRouterURLUserInbox, GetUserInbox,
			server.WithMethod(server.GET)),
		server.NewHandler(ActivityPubRouterURLUserInbox, PostUserInbox,
			server.WithMethod(server.POST)),

		// User outbox endpoints
		server.NewHandler(ActivityPubRouterURLUserOutbox, GetUserOutbox,
			server.WithMethod(server.GET)),
		server.NewHandler(ActivityPubRouterURLUserOutbox, PostUserOutbox,
			server.WithMethod(server.POST)),

		// User collections
		server.NewHandler(ActivityPubRouterURLUserFollowers, GetUserFollowers,
			server.WithMethod(server.GET)),
		server.NewHandler(ActivityPubRouterURLUserFollowing, GetUserFollowing,
			server.WithMethod(server.GET)),
		server.NewHandler(ActivityPubRouterURLUserLiked, GetUserLiked,
			server.WithMethod(server.GET)),
	}
}

func (uapr *UserActivityPubRouters) Name() string {
	return "user-activitypub"
}

// NewUserActivityPubRouter creates a new UserActivityPubRouters
func NewUserActivityPubRouter() *UserActivityPubRouters {
	return &UserActivityPubRouters{}
}

// GetUserActor returns the ActivityPub actor representation for a user
func GetUserActor(c context.Context, ctx *app.RequestContext) {
	username := ctx.Param("username")
	if username == "" {
		log.Warnf(c, "[GetUserActor] missing username parameter")
		ctx.JSON(http.StatusBadRequest, map[string]string{
			"error": "missing_parameter",
			"message": "Username parameter is required",
		})
		return
	}

	// Get database connection
	rds, err := store.GetRDS(c)
	if err != nil {
		log.Errorf(c, "[GetUserActor] failed to get database connection: %v", err)
		ctx.JSON(http.StatusInternalServerError, map[string]string{
			"error": "server_error",
			"message": "Internal server error occurred",
		})
		return
	}

	// Create discovery service
	discoveryService := webfinger.NewDiscoveryService(rds, defaultBaseURL)

	// Get ActivityPub actor
	actor, err := discoveryService.GetActivityPubActor(c, username)
	if err != nil {
		log.Warnf(c, "[GetUserActor] failed to get actor for user %s: %v", username, err)
		
		if strings.Contains(err.Error(), "user not found") {
			ctx.JSON(http.StatusNotFound, map[string]string{
				"error": "not_found",
				"message": "User not found",
			})
			return
		}

		ctx.JSON(http.StatusInternalServerError, map[string]string{
			"error": "server_error",
			"message": "Internal server error occurred",
		})
		return
	}

	// Set ActivityPub content type
	ctx.Header("Content-Type", "application/activity+json; charset=utf-8")
	ctx.Header("Access-Control-Allow-Origin", "*")
	ctx.Header("Access-Control-Allow-Methods", "GET")
	ctx.Header("Access-Control-Allow-Headers", "Content-Type")

	ctx.JSON(http.StatusOK, actor)
}

// GetUserInbox returns the user's inbox collection
func GetUserInbox(c context.Context, ctx *app.RequestContext) {
	username := ctx.Param("username")
	if username == "" {
		log.Warnf(c, "[GetUserInbox] missing username parameter")
		ctx.JSON(http.StatusBadRequest, map[string]string{
			"error": "missing_parameter",
			"message": "Username parameter is required",
		})
		return
	}

	// TODO: Implement actual inbox retrieval
	// For now, return an empty ActivityPub collection
	inboxCollection := map[string]interface{}{
		"@context": "https://www.w3.org/ns/activitystreams",
		"type":     "OrderedCollection",
		"id":       ctx.Request.URI().String(),
		"totalItems": 0,
		"orderedItems": []interface{}{},
	}

	ctx.Header("Content-Type", "application/activity+json; charset=utf-8")
	ctx.JSON(http.StatusOK, inboxCollection)
}

// PostUserInbox handles incoming activities to the user's inbox
func PostUserInbox(c context.Context, ctx *app.RequestContext) {
	username := ctx.Param("username")
	if username == "" {
		log.Warnf(c, "[PostUserInbox] missing username parameter")
		ctx.JSON(http.StatusBadRequest, map[string]string{
			"error": "missing_parameter",
			"message": "Username parameter is required",
		})
		return
	}

	// TODO: Implement activity processing
	// For now, just accept the activity
	log.Infof(c, "[PostUserInbox] received activity for user %s", username)

	ctx.Header("Content-Type", "application/activity+json; charset=utf-8")
	ctx.JSON(http.StatusAccepted, map[string]string{
		"status": "accepted",
	})
}

// GetUserOutbox returns the user's outbox collection
func GetUserOutbox(c context.Context, ctx *app.RequestContext) {
	username := ctx.Param("username")
	if username == "" {
		log.Warnf(c, "[GetUserOutbox] missing username parameter")
		ctx.JSON(http.StatusBadRequest, map[string]string{
			"error": "missing_parameter",
			"message": "Username parameter is required",
		})
		return
	}

	// TODO: Implement actual outbox retrieval
	// For now, return an empty ActivityPub collection
	outboxCollection := map[string]interface{}{
		"@context": "https://www.w3.org/ns/activitystreams",
		"type":     "OrderedCollection",
		"id":       ctx.Request.URI().String(),
		"totalItems": 0,
		"orderedItems": []interface{}{},
	}

	ctx.Header("Content-Type", "application/activity+json; charset=utf-8")
	ctx.JSON(http.StatusOK, outboxCollection)
}

// PostUserOutbox handles new activities posted to the user's outbox
func PostUserOutbox(c context.Context, ctx *app.RequestContext) {
	username := ctx.Param("username")
	if username == "" {
		log.Warnf(c, "[PostUserOutbox] missing username parameter")
		ctx.JSON(http.StatusBadRequest, map[string]string{
			"error": "missing_parameter",
			"message": "Username parameter is required",
		})
		return
	}

	// TODO: Implement activity creation and distribution
	// For now, just accept the activity
	log.Infof(c, "[PostUserOutbox] received activity from user %s", username)

	ctx.Header("Content-Type", "application/activity+json; charset=utf-8")
	ctx.JSON(http.StatusCreated, map[string]string{
		"status": "created",
	})
}

// GetUserFollowers returns the user's followers collection
func GetUserFollowers(c context.Context, ctx *app.RequestContext) {
	username := ctx.Param("username")
	if username == "" {
		log.Warnf(c, "[GetUserFollowers] missing username parameter")
		ctx.JSON(http.StatusBadRequest, map[string]string{
			"error": "missing_parameter",
			"message": "Username parameter is required",
		})
		return
	}

	// TODO: Implement actual followers retrieval
	// For now, return an empty ActivityPub collection
	followersCollection := map[string]interface{}{
		"@context": "https://www.w3.org/ns/activitystreams",
		"type":     "OrderedCollection",
		"id":       ctx.Request.URI().String(),
		"totalItems": 0,
		"orderedItems": []interface{}{},
	}

	ctx.Header("Content-Type", "application/activity+json; charset=utf-8")
	ctx.JSON(http.StatusOK, followersCollection)
}

// GetUserFollowing returns the user's following collection
func GetUserFollowing(c context.Context, ctx *app.RequestContext) {
	username := ctx.Param("username")
	if username == "" {
		log.Warnf(c, "[GetUserFollowing] missing username parameter")
		ctx.JSON(http.StatusBadRequest, map[string]string{
			"error": "missing_parameter",
			"message": "Username parameter is required",
		})
		return
	}

	// TODO: Implement actual following retrieval
	// For now, return an empty ActivityPub collection
	followingCollection := map[string]interface{}{
		"@context": "https://www.w3.org/ns/activitystreams",
		"type":     "OrderedCollection",
		"id":       ctx.Request.URI().String(),
		"totalItems": 0,
		"orderedItems": []interface{}{},
	}

	ctx.Header("Content-Type", "application/activity+json; charset=utf-8")
	ctx.JSON(http.StatusOK, followingCollection)
}

// GetUserLiked returns the user's liked collection
func GetUserLiked(c context.Context, ctx *app.RequestContext) {
	username := ctx.Param("username")
	if username == "" {
		log.Warnf(c, "[GetUserLiked] missing username parameter")
		ctx.JSON(http.StatusBadRequest, map[string]string{
			"error": "missing_parameter",
			"message": "Username parameter is required",
		})
		return
	}

	// TODO: Implement actual liked retrieval
	// For now, return an empty ActivityPub collection
	likedCollection := map[string]interface{}{
		"@context": "https://www.w3.org/ns/activitystreams",
		"type":     "OrderedCollection",
		"id":       ctx.Request.URI().String(),
		"totalItems": 0,
		"orderedItems": []interface{}{},
	}

	ctx.Header("Content-Type", "application/activity+json; charset=utf-8")
	ctx.JSON(http.StatusOK, likedCollection)
}