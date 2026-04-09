package activitypub

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/peers-labs/peers-touch/station/app/subserver/activitypub/federation"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/broker"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	modelpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
	ap "github.com/peers-labs/peers-touch/station/frame/vendors/activitypub"
)

// apHandlers returns all ActivityPub protocol endpoint handlers.
// Paths are prefixed with /activitypub since subserver handlers are mounted directly.
func apHandlers() []server.Handler {
	commonWrapper := touch.CommonAccessControlWrapper(modelpb.RouteNameActivityPub)
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	jwtWrapper := server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

	return []server.Handler{
		// Actor document
		server.NewHTTPHandler("ap-actor", "/activitypub/:actor/actor", server.GET,
			server.HertzHandlerFunc(GetUserActor), commonWrapper),

		// Inbox
		server.NewHTTPHandler("ap-inbox-get", "/activitypub/:actor/inbox", server.GET,
			server.HertzHandlerFunc(GetUserInbox), commonWrapper),
		server.NewHTTPHandler("ap-inbox-post", "/activitypub/:actor/inbox", server.POST,
			server.HertzHandlerFunc(PostUserInbox), commonWrapper, jwtWrapper),

		// Outbox
		server.NewHTTPHandler("ap-outbox-get", "/activitypub/:actor/outbox", server.GET,
			server.HertzHandlerFunc(GetUserOutbox), commonWrapper),
		server.NewHTTPHandler("ap-outbox-post", "/activitypub/:actor/outbox", server.POST,
			server.HertzHandlerFunc(PostUserOutbox), commonWrapper, jwtWrapper),

		// Collections
		server.NewHTTPHandler("ap-followers", "/activitypub/:actor/followers", server.GET,
			server.HertzHandlerFunc(GetUserFollowers), commonWrapper),
		server.NewHTTPHandler("ap-following", "/activitypub/:actor/following", server.GET,
			server.HertzHandlerFunc(GetUserFollowing), commonWrapper),
		server.NewHTTPHandler("ap-liked", "/activitypub/:actor/liked", server.GET,
			server.HertzHandlerFunc(GetUserLiked), commonWrapper),

		// Shared inbox
		server.NewHTTPHandler("ap-shared-inbox-get", "/activitypub/inbox", server.GET,
			server.HertzHandlerFunc(GetSharedInbox), commonWrapper),
		server.NewHTTPHandler("ap-shared-inbox-post", "/activitypub/inbox", server.POST,
			server.HertzHandlerFunc(PostSharedInbox), commonWrapper),

		// NodeInfo
		server.NewHTTPHandler("ap-nodeinfo", "/activitypub/nodeinfo/2.1", server.GET,
			server.HertzHandlerFunc(NodeInfoHandler), commonWrapper),

		// Events pull
		server.NewHTTPHandler("ap-events", "/activitypub/:actor/events", server.GET,
			server.HertzHandlerFunc(EventsPull), commonWrapper),

		// Object replies
		server.NewHTTPHandler("ap-object-replies", "/activitypub/objects/:objectId/replies", server.GET,
			server.HertzHandlerFunc(GetObjectReplies), commonWrapper),

		// Create activity shortcut
		server.NewHTTPHandler("ap-create-activity", "/activitypub/:actor/activity", server.POST,
			server.HertzHandlerFunc(CreateActivity), commonWrapper, jwtWrapper),
	}
}

// --- Handler functions ---

func GetUserActor(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("actor")
	if user == "" {
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}

	baseURL := baseURLFrom(ctx)
	actorData, err := federation.GetActorData(c, user, baseURL)
	if err != nil {
		log.Warnf(c, "Failed to get actor data: %v", err)
		ctx.JSON(http.StatusNotFound, "Actor not found")
		return
	}

	writeActivityPubResponse(ctx, actorData)
}

func GetUserInbox(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("actor")
	if user == "" {
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}

	page := string(ctx.Query("page")) == "true"
	baseURL := baseURLFrom(ctx)
	inbox, err := federation.FetchInbox(c, user, baseURL, page)
	if err != nil {
		log.Warnf(c, "Failed to fetch inbox: %v", err)
		ctx.JSON(http.StatusInternalServerError, err.Error())
		return
	}

	writeActivityPubResponse(ctx, inbox)
}

func PostUserInbox(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("actor")
	if user == "" {
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}

	// 1. Verify HTTP Signature
	headers := make(map[string]string)
	ctx.Request.Header.VisitAll(func(key, value []byte) {
		headers[string(key)] = string(value)
	})
	body, err := ctx.Body()
	if err != nil {
		ctx.JSON(http.StatusBadRequest, "Failed to read request body")
		return
	}
	method := string(ctx.Method())
	path := string(ctx.URI().RequestURI())

	if err := federation.VerifyHTTPSignature(c, method, path, headers, body); err != nil {
		log.Warnf(c, "Signature verification failed: %v", err)
		ctx.JSON(http.StatusUnauthorized, "Invalid HTTP Signature")
		return
	}

	// 2. Parse Activity
	var activity ap.Activity
	if err := json.Unmarshal(body, &activity); err != nil {
		ctx.JSON(http.StatusBadRequest, "Invalid activity JSON")
		return
	}

	baseURL := baseURLFrom(ctx)

	// 3. Persist raw activity
	_ = federation.PersistInboxActivity(c, user, &activity, baseURL, body)

	// 4. Apply side effects
	switch activity.Type {
	case ap.FollowType:
		_ = federation.ApplyFollowInbox(c, user, &activity, baseURL)
		payload := map[string]string{
			"type":       "follow.requested",
			"actor":      getLinkH(activity.Actor),
			"target":     fmt.Sprintf("%s/activitypub/%s/actor", baseURL, user),
			"activityId": string(activity.ID),
		}
		b, _ := json.Marshal(payload)
		_ = broker.Get().Publish(c, "actor."+user, user, map[string]string{"domain": "rel"}, b, broker.PublishOptions{})
		ctx.JSON(http.StatusOK, "Follow received")

	case ap.UndoType:
		_ = federation.ApplyUndoInbox(c, user, &activity, baseURL)
		payload := map[string]string{
			"type":       "follow.undone",
			"actor":      getLinkH(activity.Actor),
			"target":     getLinkH(activity.Object),
			"activityId": string(activity.ID),
		}
		b, _ := json.Marshal(payload)
		_ = broker.Get().Publish(c, "actor."+user, user, map[string]string{"domain": "rel"}, b, broker.PublishOptions{})
		ctx.JSON(http.StatusOK, "Undo received")

	default:
		ctx.JSON(http.StatusOK, "Activity received")
	}
}

func GetUserOutbox(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("actor")
	if user == "" {
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}

	page := string(ctx.Query("page")) == "true"
	baseURL := baseURLFrom(ctx)

	var viewerID uint64
	if id, err := resolveActorID(c, ctx); err == nil {
		viewerID = id
	}

	outbox, err := federation.FetchOutbox(c, user, baseURL, page, viewerID)
	if err != nil {
		log.Warnf(c, "Failed to fetch outbox: %v", err)
		ctx.JSON(http.StatusInternalServerError, err.Error())
		return
	}

	writeActivityPubResponse(ctx, outbox)
}

func PostUserOutbox(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("actor")
	if user == "" {
		log.Warnf(c, "User parameter is required for outbox activity")
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}

	subject := coreauth.GetSubject(c)
	if subject == nil {
		log.Warnf(c, "Authentication required")
		ctx.JSON(http.StatusUnauthorized, "Authentication required")
		return
	}

	actorID, err := strconv.ParseUint(subject.ID, 10, 64)
	if err != nil {
		log.Errorf(c, "Invalid actor ID format: %s", subject.ID)
		ctx.JSON(http.StatusUnauthorized, "Invalid actor ID")
		return
	}

	if err := actor.ValidateActorOwnership(c, actorID, user); err != nil {
		log.Warnf(c, "Actor ownership validation failed: %v", err)
		ctx.JSON(http.StatusForbidden, "Cannot post to another user's outbox")
		return
	}

	dbActor, err := actor.GetActorByID(c, actorID)
	if err != nil {
		log.Errorf(c, "Failed to get actor: %v", err)
		ctx.JSON(http.StatusUnauthorized, "Invalid actor")
		return
	}

	body, err := ctx.Body()
	if err != nil {
		log.Errorf(c, "Failed to read request body: %v", err)
		ctx.JSON(http.StatusBadRequest, "Invalid request body")
		return
	}

	var activity ap.Activity
	if err := json.Unmarshal(body, &activity); err != nil {
		log.Errorf(c, "Failed to parse JSON-LD activity: %v", err)
		ctx.JSON(http.StatusBadRequest, "Invalid JSON-LD activity")
		return
	}

	if activity.Type == "" {
		ctx.JSON(http.StatusBadRequest, "Activity type is required")
		return
	}

	baseURL := baseURLFrom(ctx)

	err = federation.ProcessActivity(c, dbActor.PreferredUsername, &activity, baseURL)
	if err != nil {
		if federation.IsValidationError(err) {
			log.Warnf(c, "Validation error: %v", err)
			ctx.JSON(http.StatusBadRequest, fmt.Sprintf("Validation error: %v", err))
		} else {
			log.Errorf(c, "Failed to process activity: %v", err)
			ctx.JSON(http.StatusInternalServerError, fmt.Sprintf("Failed to process activity: %v", err))
		}
		return
	}

	log.Infof(c, "Outbox activity created successfully for user: %s (ID: %d), type: %s", dbActor.PreferredUsername, dbActor.ID, activity.Type)
	writeActivityPubResponse(ctx, activity)
}

func GetUserFollowers(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("actor")
	if user == "" {
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}

	page := string(ctx.Query("page")) == "true"
	baseURL := baseURLFrom(ctx)
	followers, err := federation.FetchFollowers(c, user, baseURL, page)
	if err != nil {
		log.Warnf(c, "Failed to fetch followers: %v", err)
		ctx.JSON(http.StatusInternalServerError, err.Error())
		return
	}

	writeActivityPubResponse(ctx, followers)
}

func GetUserFollowing(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("actor")
	if user == "" {
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}

	page := string(ctx.Query("page")) == "true"
	baseURL := baseURLFrom(ctx)
	following, err := federation.FetchFollowing(c, user, baseURL, page)
	if err != nil {
		log.Warnf(c, "Failed to fetch following: %v", err)
		ctx.JSON(http.StatusInternalServerError, err.Error())
		return
	}

	writeActivityPubResponse(ctx, following)
}

func GetUserLiked(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("actor")
	if user == "" {
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}

	page := string(ctx.Query("page")) == "true"
	baseURL := baseURLFrom(ctx)
	liked, err := federation.FetchLiked(c, user, baseURL, page)
	if err != nil {
		log.Warnf(c, "Failed to fetch liked: %v", err)
		ctx.JSON(http.StatusInternalServerError, err.Error())
		return
	}

	writeActivityPubResponse(ctx, liked)
}

func GetSharedInbox(c context.Context, ctx *app.RequestContext) {
	page := string(ctx.Query("page")) == "true"
	baseURL := baseURLFrom(ctx)
	inbox, err := federation.FetchSharedInbox(c, baseURL, page)
	if err != nil {
		log.Warnf(c, "Failed to fetch shared inbox: %v", err)
		ctx.JSON(http.StatusInternalServerError, err.Error())
		return
	}

	writeActivityPubResponse(ctx, inbox)
}

func PostSharedInbox(c context.Context, ctx *app.RequestContext) {
	ctx.JSON(http.StatusAccepted, "Shared Inbox received (not fully implemented)")
}

func GetObjectReplies(c context.Context, ctx *app.RequestContext) {
	objectID := ctx.Param("objectId")
	if objectID == "" {
		ctx.JSON(http.StatusBadRequest, "Object ID required")
		return
	}

	page := string(ctx.Query("page")) == "true"
	baseURL := baseURLFrom(ctx)

	var afterID uint64
	if afterStr := string(ctx.Query("after")); afterStr != "" {
		if v, err := strconv.ParseUint(afterStr, 10, 64); err == nil {
			afterID = v
		}
	}

	limit := 10
	if limitStr := string(ctx.Query("limit")); limitStr != "" {
		if v, err := strconv.Atoi(limitStr); err == nil && v > 0 {
			limit = v
		}
	}

	replies, err := federation.FetchObjectReplies(c, objectID, baseURL, page, afterID, limit)
	if err != nil {
		log.Warnf(c, "Failed to fetch object replies: %v", err)
		ctx.JSON(http.StatusInternalServerError, err.Error())
		return
	}

	writeActivityPubResponse(ctx, replies)
}

func CreateActivity(c context.Context, ctx *app.RequestContext) {
	actorName := ctx.Param("actor")
	if actorName == "" {
		ctx.JSON(http.StatusBadRequest, "actor required")
		return
	}
	if _, err := resolveActorID(c, ctx); err != nil {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var in modelpb.ActivityInput
	if err := ctx.Bind(&in); err != nil {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	baseURL := baseURLFrom(ctx)
	postID, actID, err := federation.Create(c, actorName, baseURL, &in)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	resp := &modelpb.ActivityResponse{PostId: postID, ActivityId: actID}
	ctx.JSON(http.StatusOK, resp)
}

func NodeInfoHandler(c context.Context, ctx *app.RequestContext) {
	baseURL := baseURLFrom(ctx)
	data, err := federation.GetNodeInfo(c, baseURL)
	if err != nil {
		log.Warnf(c, "Failed to get node info: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Internal Server Error")
		return
	}
	ctx.Header("Content-Type", "application/json; profile=http://nodeinfo.diaspora.software/ns/schema/2.1")
	ctx.JSON(http.StatusOK, data)
}

func EventsPull(c context.Context, ctx *app.RequestContext) {
	actorName := ctx.Param("actor")
	if actorName == "" {
		ctx.JSON(http.StatusBadRequest, "actor required")
		return
	}
	since := string(ctx.Query("since"))
	limitStr := string(ctx.Query("limit"))
	limit := 50
	if limitStr != "" {
		if v, e := strconv.Atoi(limitStr); e == nil && v > 0 {
			limit = v
		}
	}
	topic := "actor." + actorName
	msgs, err := broker.Get().Pull(c, topic, since, limit, broker.PullOptions{})
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, err.Error())
		return
	}
	ctx.JSON(http.StatusOK, msgs)
}

// --- Helper functions ---

func writeActivityPubResponse(ctx *app.RequestContext, data interface{}) {
	ctx.Header("Content-Type", "application/activity+json; charset=utf-8")
	ctx.JSON(http.StatusOK, data)
}

func getLinkH(item ap.Item) string {
	if item == nil {
		return ""
	}
	if item.IsLink() {
		return string(item.GetLink())
	}
	return string(item.GetID())
}

func resolveActorID(c context.Context, ctx *app.RequestContext) (uint64, error) {
	authHeader := string(ctx.GetHeader("Authorization"))
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return 0, errors.New("no_token")
	}
	token := strings.TrimPrefix(authHeader, "Bearer ")
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	subj, err := provider.Validate(c, token)
	if err != nil {
		return 0, err
	}
	id, _ := strconv.ParseUint(subj.ID, 10, 64)
	return id, nil
}

func baseURLFrom(ctx *app.RequestContext) string {
	scheme := string(ctx.GetHeader("X-Forwarded-Proto"))
	if scheme == "" {
		scheme = string(ctx.URI().Scheme())
	}
	if scheme == "" {
		scheme = "https"
	}

	host := string(ctx.GetHeader("X-Forwarded-Host"))
	if host == "" {
		host = string(ctx.Host())
	}

	if _, _, err := net.SplitHostPort(host); err != nil {
		port := string(ctx.GetHeader("X-Forwarded-Port"))
		if port != "" && port != "80" && port != "443" {
			host = net.JoinHostPort(host, port)
		}
	}

	return fmt.Sprintf("%s://%s", scheme, host)
}
