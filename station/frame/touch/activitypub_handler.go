package touch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol"
	"github.com/peers-labs/peers-touch/station/frame/core/broker"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/activitypub"
	"github.com/peers-labs/peers-touch/station/frame/touch/auth"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	modelpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
	ap "github.com/peers-labs/peers-touch/station/frame/vendors/activitypub"
	anypb "google.golang.org/protobuf/types/known/anypb"
	timestamppb "google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
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
	commonWrapper := CommonAccessControlWrapper(model.RouteNameActivityPub)
	actorWrapper := CommonAccessControlWrapper(model.RouteNameActor)

	return []ActivityPubHandlerInfo{
		// Actor Management Endpoints (Client API)
		{
			RouterURL: RouterURLActorSignUP,
			Handler:   ActorSignup,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
		{
			RouterURL: RouterURLActorLogin,
			Handler:   ActorLogin,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
		{
			RouterURL: RouterURLActorProfile,
			Handler:   GetActorProfile,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
		{
			RouterURL: RouterURLPublicProfile,
			Handler:   PublicProfile,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper}, // Public access
		},
		{
			RouterURL: RouterURLActorProfile,
			Handler:   UpdateActorProfile,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
		{
			RouterURL: RouterURLActorList,
			Handler:   ListActors,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
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
		// NodeInfo schema endpoint
		{
			RouterURL: ActivityPubRouterURLNodeInfo21,
			Handler:   NodeInfoHandler,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
		// Events pull endpoint
		{
			RouterURL: ActivityPubRouterURLEvents,
			Handler:   EventsPull,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
		// Shared Inbox endpoints
		{
			RouterURL: ActivityPubRouterURLSharedInbox,
			Handler:   GetSharedInbox,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
		{
			RouterURL: ActivityPubRouterURLSharedInbox,
			Handler:   PostSharedInbox,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
	}
}

// Handler implementations

func ActorSignup(c context.Context, ctx *app.RequestContext) {
	var params model.ActorSignParams
	if err := ctx.Bind(&params); err != nil {
		log.Warnf(c, "Signup bound params failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	if err := params.Check(); err != nil {
		log.Warnf(c, "Signup checked params failed: %v", err)
		FailedResponse(ctx, err)
		return
	}

	err := activitypub.SignUp(c, &params)
	if err != nil {
		log.Warnf(c, "Signup failed: %v", err)
		FailedResponse(ctx, err)
		return
	}

	SuccessResponse(ctx, "Actor signup successful", nil)
}

func ActorLogin(c context.Context, ctx *app.RequestContext) {
	var params model.ActorLoginParams
	if err := ctx.Bind(&params); err != nil {
		log.Warnf(c, "Login bound params failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	if err := params.Check(); err != nil {
		log.Warnf(c, "Login checked params failed: %v", err)
		FailedResponse(ctx, err)
		return
	}

	// Prepare credentials
	credentials := &auth.Credentials{
		Email:    params.Email,
		Password: params.Password,
	}

	// Get client IP and user agent
	clientIP := ctx.ClientIP()
	userAgent := string(ctx.GetHeader("User-Agent"))

	// Use auth service to handle login with session
	result, err := auth.LoginWithSession(c, credentials, clientIP, userAgent)
	if err != nil {
		log.Warnf(c, "Login failed: %v", err)
		FailedResponse(ctx, err)
		return
	}

	// Set session cookie
	ctx.SetCookie("session_id", result.SessionID, int(24*time.Hour.Seconds()), "/", "", protocol.CookieSameSiteDisabled, false, true)

	// Build standardized proto models
	tokens := &modelpb.AuthTokens{
		Token:        result.AccessToken,
		AccessToken:  result.AccessToken,
		RefreshToken: result.RefreshToken,
		TokenType:    result.TokenType,
		ExpiresAt:    timestamppb.New(result.ExpiresAt),
	}
	user := &modelpb.Actor{
		Id:          toString(result.User["id"]),
		Username:    toString(result.User["name"]),
		DisplayName: toString(result.User["name"]),
		Email:       toString(result.User["email"]),
	}
	actorAny, _ := anypb.New(user)
	data := &modelpb.LoginData{Tokens: tokens, SessionId: result.SessionID, Actor: actorAny}
	SuccessResponse(ctx, "Login successful", data)
}

func GetActorProfile(c context.Context, ctx *app.RequestContext) {
	actorID, err := resolveActorID(c, ctx)
	if err != nil {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	rds, err := store.GetRDS(c)
	if err != nil {
		log.Errorf(c, "Failed to get database connection: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Database connection failed")
		return
	}

	baseURL := baseURLFrom(ctx)
	resp, err := activitypub.GetWebProfileByID(c, rds, actorID, baseURL)
	if err != nil {
		log.Warnf(c, "Get actor profile failed: %v", err)
		FailedResponse(ctx, err)
		return
	}
	SuccessResponse(ctx, "Actor profile retrieved", resp)
}

func PublicProfile(c context.Context, ctx *app.RequestContext) {
	username := ctx.Param("actor")
	if username == "" {
		log.Warnf(c, "Username parameter is required")
		ctx.JSON(http.StatusBadRequest, "Username parameter is required")
		return
	}

	rds, err := store.GetRDS(c)
	if err != nil {
		log.Errorf(c, "Failed to get database connection: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Database connection failed")
		return
	}

	baseURL := baseURLFrom(ctx)
	resp, err := activitypub.GetWebProfile(c, rds, username, baseURL)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			ctx.JSON(http.StatusNotFound, "User not found")
			return
		}
		log.Errorf(c, "Failed to fetch actor profile: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Internal Server Error")
		return
	}

	ctx.JSON(http.StatusOK, resp)
}

func UpdateActorProfile(c context.Context, ctx *app.RequestContext) {
	var params activitypub.UpdateProfileRequest
	if err := ctx.Bind(&params); err != nil {
		log.Warnf(c, "Update profile bound params failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	actorID, err := resolveActorID(c, ctx)
	if err != nil {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	rds, err := store.GetRDS(c)
	if err != nil {
		log.Errorf(c, "Failed to get database connection: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Database connection failed")
		return
	}

	if err := activitypub.UpdateProfileByID(c, rds, actorID, params); err != nil {
		log.Warnf(c, "Update profile failed: %v", err)
		FailedResponse(ctx, err)
		return
	}
	SuccessResponse(ctx, "Profile updated successfully", nil)
}

// ListActors returns actors from preset configuration
func ListActors(c context.Context, ctx *app.RequestContext) {
	actors, err := activitypub.ListActors(c)
	if err != nil {
		log.Warnf(c, "List actors failed: %v", err)
		FailedResponse(ctx, err)
		return
	}
	// Map to proto ActorList
	items := make([]*modelpb.Actor, 0, len(actors))
	for _, a := range actors {
		items = append(items, &modelpb.Actor{Id: a.ID, Username: a.Username, DisplayName: a.DisplayName, Email: a.Username, Inbox: a.Inbox, Outbox: a.Outbox, Endpoints: a.Endpoints})
	}
	SuccessResponse(ctx, "Actor list", &modelpb.ActorList{Items: items, Total: int64(len(items))})
}

func toString(v interface{}) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	default:
		return fmt.Sprintf("%v", t)
	}
}

func resolveActorID(c context.Context, ctx *app.RequestContext) (uint64, error) {
	authHeader := string(ctx.GetHeader("Authorization"))
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return 0, errors.New("no_token")
	}
	token := strings.TrimPrefix(authHeader, "Bearer ")
	rds, err := store.GetRDS(c)
	if err != nil {
		return 0, err
	}
	provider := auth.NewJWTProvider(rds, "your-secret-key", auth.DefaultAccessTokenDuration, auth.DefaultRefreshTokenDuration)
	ti, err := provider.ValidateToken(c, token)
	if err != nil {
		return 0, err
	}
	return ti.ActorID, nil
}

// User ActivityPub Handler Functions

// GetUserActor handles GET requests for user actor
func GetUserActor(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("actor")
	if user == "" {
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}

	rds, err := store.GetRDS(c)
	if err != nil {
		log.Errorf(c, "Failed to get database connection: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Database connection failed")
		return
	}

	baseURL := baseURLFrom(ctx)
	actor, err := activitypub.GetActorData(c, rds, user, baseURL)
	if err != nil {
		log.Warnf(c, "Failed to get actor data: %v", err)
		ctx.JSON(http.StatusNotFound, "Actor not found")
		return
	}

	writeActivityPubResponse(ctx, actor)
}

// GetUserInbox handles GET requests for user inbox
func GetUserInbox(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("actor")
	if user == "" {
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}

	page := string(ctx.Query("page")) == "true"
	rds, err := store.GetRDS(c)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, "Database connection failed")
		return
	}

	baseURL := baseURLFrom(ctx)
	inbox, err := activitypub.FetchInbox(c, rds, user, baseURL, page)
	if err != nil {
		log.Warnf(c, "Failed to fetch inbox: %v", err)
		ctx.JSON(http.StatusInternalServerError, err.Error())
		return
	}

	writeActivityPubResponse(ctx, inbox)
}

// PostUserInbox handles POST requests for user inbox
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

	if err := activitypub.VerifyHTTPSignature(c, method, path, headers, body); err != nil {
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

	rds, err := store.GetRDS(c)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, "Database connection failed")
		return
	}

	baseURL := baseURLFrom(ctx)

	// 3. Process Activity
	// Persist raw activity
	_ = activitypub.PersistInboxActivity(c, rds, user, &activity, baseURL, body)

	// Apply side effects
	switch activity.Type {
	case ap.FollowType:
		_ = activitypub.ApplyFollowInbox(c, rds, user, &activity, baseURL)
		// emit event
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
		_ = activitypub.ApplyUndoInbox(c, rds, user, &activity, baseURL)
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

func getLinkH(item ap.Item) string {
	if item == nil {
		return ""
	}
	if item.IsLink() {
		return string(item.GetLink())
	}
	return string(item.GetID())
}

// GetUserOutbox handles GET requests for user outbox
func GetUserOutbox(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("actor")
	if user == "" {
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}

	page := string(ctx.Query("page")) == "true"
	rds, err := store.GetRDS(c)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, "Database connection failed")
		return
	}

	baseURL := baseURLFrom(ctx)
	outbox, err := activitypub.FetchOutbox(c, rds, user, baseURL, page)
	if err != nil {
		log.Warnf(c, "Failed to fetch outbox: %v", err)
		ctx.JSON(http.StatusInternalServerError, err.Error())
		return
	}

	writeActivityPubResponse(ctx, outbox)
}

// PostUserOutbox handles POST requests for user outbox
func PostUserOutbox(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("actor")
	if user == "" {
		log.Warnf(c, "User parameter is required for outbox activity")
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}

	// 1. Parse Request Body
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

	// 2. Validate Activity
	if activity.Type == "" {
		ctx.JSON(http.StatusBadRequest, "Activity type is required")
		return
	}

	// 3. Get Database Connection
	rds, err := store.GetRDS(c)
	if err != nil {
		log.Errorf(c, "Failed to get database connection: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Database connection failed")
		return
	}

	// 4. Determine Base URL
	baseURL := baseURLFrom(ctx)

	// 5. Dispatch based on Type
	err = activitypub.ProcessActivity(c, rds, user, &activity, baseURL)
	if err != nil {
		log.Errorf(c, "Failed to process activity: %v", err)
		ctx.JSON(http.StatusInternalServerError, fmt.Sprintf("Failed to process activity: %v", err))
		return
	}

	log.Infof(c, "Outbox activity created successfully for user: %s, type: %s", user, activity.Type)
	writeActivityPubResponse(ctx, activity)
}

// GetUserFollowers handles GET requests for user followers
func GetUserFollowers(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("actor")
	if user == "" {
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}

	page := string(ctx.Query("page")) == "true"
	rds, err := store.GetRDS(c)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, "Database connection failed")
		return
	}

	baseURL := baseURLFrom(ctx)
	followers, err := activitypub.FetchFollowers(c, rds, user, baseURL, page)
	if err != nil {
		log.Warnf(c, "Failed to fetch followers: %v", err)
		ctx.JSON(http.StatusInternalServerError, err.Error())
		return
	}

	writeActivityPubResponse(ctx, followers)
}

// GetUserFollowing handles GET requests for user following
func GetUserFollowing(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("actor")
	if user == "" {
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}

	page := string(ctx.Query("page")) == "true"
	rds, err := store.GetRDS(c)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, "Database connection failed")
		return
	}

	baseURL := baseURLFrom(ctx)
	following, err := activitypub.FetchFollowing(c, rds, user, baseURL, page)
	if err != nil {
		log.Warnf(c, "Failed to fetch following: %v", err)
		ctx.JSON(http.StatusInternalServerError, err.Error())
		return
	}

	writeActivityPubResponse(ctx, following)
}

// GetUserLiked handles GET requests for user liked
func GetUserLiked(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("actor")
	if user == "" {
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}

	page := string(ctx.Query("page")) == "true"
	rds, err := store.GetRDS(c)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, "Database connection failed")
		return
	}

	baseURL := baseURLFrom(ctx)
	liked, err := activitypub.FetchLiked(c, rds, user, baseURL, page)
	if err != nil {
		log.Warnf(c, "Failed to fetch liked: %v", err)
		ctx.JSON(http.StatusInternalServerError, err.Error())
		return
	}

	writeActivityPubResponse(ctx, liked)
}

// Shared Inbox Handlers
func GetSharedInbox(c context.Context, ctx *app.RequestContext) {
	page := string(ctx.Query("page")) == "true"
	rds, err := store.GetRDS(c)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, "Database connection failed")
		return
	}

	baseURL := baseURLFrom(ctx)
	inbox, err := activitypub.FetchSharedInbox(c, rds, baseURL, page)
	if err != nil {
		log.Warnf(c, "Failed to fetch shared inbox: %v", err)
		ctx.JSON(http.StatusInternalServerError, err.Error())
		return
	}

	writeActivityPubResponse(ctx, inbox)
}

func PostSharedInbox(c context.Context, ctx *app.RequestContext) {
	// Not implemented fully yet - requires extracting user from signature or body to know context?
	// Shared inbox usually means delivery to multiple local users.
	// For now, return Accepted.
	ctx.JSON(http.StatusAccepted, "Shared Inbox received (not fully implemented)")
}

func NodeInfoHandler(c context.Context, ctx *app.RequestContext) {
	baseURL := baseURLFrom(ctx)
	data := activitypub.GetNodeInfo(baseURL)
	ctx.Header("Content-Type", "application/json; profile=http://nodeinfo.diaspora.software/ns/schema/2.1")
	ctx.JSON(http.StatusOK, data)
}

func writeActivityPubResponse(ctx *app.RequestContext, data interface{}) {
	ctx.Header("Content-Type", "application/activity+json; charset=utf-8")
	ctx.JSON(http.StatusOK, data)
}

// EventsPull provides a simple pull interface for actor events
func EventsPull(c context.Context, ctx *app.RequestContext) {
	actor := ctx.Param("actor")
	if actor == "" {
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
	topic := "actor." + actor
	msgs, err := broker.Get().Pull(c, topic, since, limit, broker.PullOptions{})
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, err.Error())
		return
	}
	ctx.JSON(http.StatusOK, msgs)
}
