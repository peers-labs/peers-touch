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
			Handler:   activitypub.GetActorProfile,
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
		// NodeInfo schema endpoint
		{
			RouterURL: ActivityPubRouterURLNodeInfo21,
			Handler:   activitypub.NodeInfo21,
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
	resp, err := activitypub.GetPTProfile(c, actorID)
	if err != nil {
		log.Warnf(c, "Get actor profile failed: %v", err)
		FailedResponse(ctx, err)
		return
	}
	SuccessResponse(ctx, "Actor profile retrieved", resp)
}

func UpdateActorProfile(c context.Context, ctx *app.RequestContext) {
	var params model.ProfileUpdateParams
	if err := ctx.Bind(&params); err != nil {
		log.Warnf(c, "Update profile bound params failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}
	if err := params.Validate(); err != nil {
		FailedResponse(ctx, err)
		return
	}
	actorID, err := resolveActorID(c, ctx)
	if err != nil {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if err := activitypub.UpdateProfile(c, actorID, &params); err != nil {
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

// User ActivityPub Handler Functions

// GetUserActor handles GET requests for user actor
func GetUserActor(c context.Context, ctx *app.RequestContext) {
	activitypub.GetActor(c, ctx)
}

// GetUserInbox handles GET requests for user inbox
func GetUserInbox(c context.Context, ctx *app.RequestContext) {
	activitypub.GetInboxActivities(c, ctx)
}

// PostUserInbox handles POST requests for user inbox
func PostUserInbox(c context.Context, ctx *app.RequestContext) {
	user := ctx.Param("actor")
	if user == "" {
		ctx.JSON(http.StatusBadRequest, "User parameter is required")
		return
	}
	if err := activitypub.VerifyHTTPSignature(c, ctx); err != nil {
		ctx.JSON(http.StatusUnauthorized, "Invalid HTTP Signature")
		return
	}
	body, err := ctx.Body()
	if err != nil {
		ctx.JSON(http.StatusBadRequest, "Failed to read request body")
		return
	}
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
	_ = activitypub.PersistInboxActivity(c, rds, user, &activity, baseURL, body)
	switch activity.Type {
	case ap.FollowType:
		_ = activitypub.ApplyFollowInbox(c, rds, user, &activity, baseURL)
		// emit event before response
		payload := map[string]string{"type": "follow.requested", "actor": getLinkH(activity.Actor), "target": fmt.Sprintf("%s/activitypub/%s/actor", baseURL, user), "activityId": string(activity.ID)}
		b, _ := json.Marshal(payload)
		_ = broker.Get().Publish(c, "actor."+user, user, map[string]string{"domain": "rel"}, b, broker.PublishOptions{})
		ctx.JSON(http.StatusOK, "Follow received")
	case ap.UndoType:
		_ = activitypub.ApplyUndoInbox(c, rds, user, &activity, baseURL)
		payload := map[string]string{"type": "follow.undone", "actor": getLinkH(activity.Actor), "target": getLinkH(activity.Object), "activityId": string(activity.ID)}
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
	activitypub.GetOutboxActivities(c, ctx)
}

// PostUserOutbox handles POST requests for user outbox
func PostUserOutbox(c context.Context, ctx *app.RequestContext) {
	activitypub.CreateOutboxActivity(c, ctx)
}

// GetUserFollowers handles GET requests for user followers
func GetUserFollowers(c context.Context, ctx *app.RequestContext) {
	activitypub.GetFollowers(c, ctx)
}

// GetUserFollowing handles GET requests for user following
func GetUserFollowing(c context.Context, ctx *app.RequestContext) {
	activitypub.GetFollowing(c, ctx)
}

// GetUserLiked handles GET requests for user liked
func GetUserLiked(c context.Context, ctx *app.RequestContext) {
	activitypub.GetLiked(c, ctx)
}

// Shared Inbox Handlers
func GetSharedInbox(c context.Context, ctx *app.RequestContext) {
	activitypub.GetSharedInbox(c, ctx)
}

func PostSharedInbox(c context.Context, ctx *app.RequestContext) {
	activitypub.PostSharedInbox(c, ctx)
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
