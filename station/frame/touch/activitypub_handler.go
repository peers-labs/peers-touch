package touch

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/activitypub"
	"github.com/peers-labs/peers-touch/station/frame/touch/auth"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	modelpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
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
	commonWrapper := CommonAccessControlWrapper(RoutersNameActivityPub)
	actorWrapper := CommonAccessControlWrapper(RoutersNameActor)

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
		{
			RouterURL: ActivityPubRouterURLChat,
			Handler:   ChatHandler,
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
	// Get actor profile
	profile, err := activitypub.GetProfile(c, 123)
	if err != nil {
		log.Warnf(c, "Get actor profile failed: %v", err)
		FailedResponse(ctx, err)
		return
	}

	SuccessResponse(ctx, "Actor profile retrieved", profile)
}

func UpdateActorProfile(c context.Context, ctx *app.RequestContext) {
	var params model.ProfileUpdateParams
	if err := ctx.Bind(&params); err != nil {
		log.Warnf(c, "Update profile bound params failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	if err := activitypub.UpdateProfile(c, 123, &params); err != nil {
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
	activitypub.GetActor(c, ctx)
}

// GetUserInbox handles GET requests for user inbox
func GetUserInbox(c context.Context, ctx *app.RequestContext) {
	activitypub.GetInboxActivities(c, ctx)
}

// PostUserInbox handles POST requests for user inbox
func PostUserInbox(c context.Context, ctx *app.RequestContext) {
	activitypub.HandleInboxActivity(c, ctx)
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
