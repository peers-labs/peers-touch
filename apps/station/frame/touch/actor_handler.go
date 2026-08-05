// actor_handler.go — Actor management handlers (signup, login, logout, profile, list, search).
//
// Extracted from activitypub_handler.go during the activitypub→actor rename refactoring.
// AP protocol handlers remain in activitypub_handler.go; only client-facing actor
// management endpoints live here.

package touch

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	gate "github.com/peers-labs/peers-touch/station/frame/touch/accessgate"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"github.com/peers-labs/peers-touch/station/frame/touch/auth"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	gatepb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

// ActorHandlerInfo represents a single handler's information for actor management endpoints.
type ActorHandlerInfo struct {
	RouterURL RouterPath
	Handler   func(context.Context, *app.RequestContext)
	Method    server.Method
	Wrappers  []server.Wrapper
}

// GetActorHandlers returns all actor management handler configurations.
// These cover signup, login, logout, profile, list, search, and OAuth login.
func GetActorHandlers() []ActorHandlerInfo {
	actorWrapper := CommonAccessControlWrapper(model.RouteNameActor)
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	jwtWrapper := server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

	commonWrapper := CommonAccessControlWrapper(model.RouteNameActor)

	return []ActorHandlerInfo{
		{
			RouterURL: RouterURLOAuthLogin,
			Handler:   OAuthLogin,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper},
		},

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
			RouterURL: RouterURLAccessAttemptStart,
			Handler:   StartAccessAttempt,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
		{
			RouterURL: RouterURLAccessAttemptStart,
			Handler:   HandleAccessGateOptions,
			Method:    server.OPTIONS,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
		{
			RouterURL: RouterURLAccessGateSubmit,
			Handler:   SubmitAccessGate,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
		{
			RouterURL: RouterURLAccessGateSubmit,
			Handler:   HandleAccessGateOptions,
			Method:    server.OPTIONS,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
		{
			RouterURL: RouterURLAccessDecision,
			Handler:   GetAccessDecision,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
		{
			RouterURL: RouterURLAccessDecision,
			Handler:   HandleAccessGateOptions,
			Method:    server.OPTIONS,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
		{
			RouterURL: RouterURLAccessAttemptCancel,
			Handler:   CancelAccessAttempt,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
		{
			RouterURL: RouterURLAccessAttemptCancel,
			Handler:   HandleAccessGateOptions,
			Method:    server.OPTIONS,
			Wrappers:  []server.Wrapper{actorWrapper},
		},
		{
			RouterURL: RouterURLActorLogout,
			Handler:   ActorLogout,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLActorSessionTakeover,
			Handler:   ActorSessionTakeover,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLActorChangePassword,
			Handler:   ActorChangePassword,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLActorProfile,
			Handler:   GetActorProfile,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{actorWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLPublicProfile,
			Handler:   PublicProfile,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper}, // Public access
		},
		{
			RouterURL: RouterURLFederationProfile,
			Handler:   FederationProfile,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper}, // Public — federation surface
		},
		{
			RouterURL: RouterURLFederationMe,
			Handler:   FederationMe,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{actorWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLFederationVisibility,
			Handler:   FederationUpdateVisibility,
			Method:    server.PUT,
			Wrappers:  []server.Wrapper{actorWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLFederationResolve,
			Handler:   FederationResolve,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{actorWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLFederationHealth,
			Handler:   FederationHealth,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper}, // Public — readiness probe
		},
		{
			RouterURL: RouterURLActorBasicInfo,
			Handler:   GetActorBasicInfo,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper}, // Public access - for Avatar component
		},
		{
			RouterURL: RouterURLActorPublicProfileByID,
			Handler:   GetActorPublicProfileByID,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{actorWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLActorProfile,
			Handler:   UpdateActorProfile,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{actorWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLActorList,
			Handler:   ListActors,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{actorWrapper, jwtWrapper},
		},
		{
			RouterURL: RouterURLActorSearch,
			Handler:   SearchActors,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{actorWrapper, jwtWrapper},
		},
	}
}

// ---------------------------------------------------------------------------
// Handler implementations
// ---------------------------------------------------------------------------

func ActorSignup(c context.Context, ctx *app.RequestContext) {
	var params model.ActorSignRequest
	if err := ctx.Bind(&params); err != nil {
		log.Warnf(c, "Signup bound params failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	if err := params.Check(); err != nil {
		log.Warnf(c, "Signup checked params failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	err := actor.SignUp(c, &params, baseURLFrom(ctx))
	if err != nil {
		log.Warnf(c, "Signup failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	SuccessResponse(c, ctx, "Actor signup successful", nil)
}

// stationLabel returns the human-readable station name from environment.
func stationLabel() string {
	return os.Getenv("PEERS_NODE_LABEL")
}

func StartAccessAttempt(c context.Context, ctx *app.RequestContext) {
	setAccessGateCORSHeaders(ctx)
	if isAccessGatePreflight(ctx) {
		writeAccessGatePreflight(ctx)
		return
	}

	var req gatepb.StartAccessAttemptRequest
	if err := ctx.Bind(&req); err != nil {
		log.Warnf(c, "Access attempt bind failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	decision, err := gate.StartAttempt(c, &req)
	if err != nil {
		log.Warnf(c, "Access attempt start failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	// Include station_label in the JSON response so clients can display a
	// human-readable station name instead of raw IP:port.
	type accessStartResponse struct {
		Decision     *gatepb.AccessDecision `json:"decision"`
		StationLabel string                 `json:"station_label,omitempty"`
	}
	SuccessResponse(c, ctx, "Access attempt started", &accessStartResponse{
		Decision:     decision,
		StationLabel: stationLabel(),
	})
}

func HandleAccessGateOptions(_ context.Context, ctx *app.RequestContext) {
	setAccessGateCORSHeaders(ctx)
	writeAccessGatePreflight(ctx)
}

func setAccessGateCORSHeaders(ctx *app.RequestContext) {
	origin := string(ctx.GetHeader("Origin"))
	if origin == "" {
		origin = "*"
	}

	ctx.Header("Access-Control-Allow-Origin", origin)
	ctx.Header("Access-Control-Allow-Credentials", "true")
	ctx.Header("Access-Control-Allow-Methods", "POST, OPTIONS")
	ctx.Header("Access-Control-Allow-Headers", "Accept, Content-Type, Authorization")
	ctx.Header("Access-Control-Max-Age", "600")
}

func isAccessGatePreflight(ctx *app.RequestContext) bool {
	return string(ctx.Method()) == string(server.OPTIONS)
}

func writeAccessGatePreflight(ctx *app.RequestContext) {
	ctx.Data(http.StatusNoContent, "text/plain", nil)
}

func SubmitAccessGate(c context.Context, ctx *app.RequestContext) {
	setAccessGateCORSHeaders(ctx)
	if isAccessGatePreflight(ctx) {
		writeAccessGatePreflight(ctx)
		return
	}

	var req gatepb.SubmitAccessGateRequest
	if err := ctx.Bind(&req); err != nil {
		log.Warnf(c, "Access gate submit bind failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	switch req.GetType() {
	case gatepb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN:
		submitAccessLogin(c, ctx, &req)
	case gatepb.AccessGateType_ACCESS_GATE_TYPE_INVITE_CODE:
		submitAccessInviteCode(c, ctx, &req)
	default:
		FailedResponse(c, ctx, fmt.Errorf("unsupported access gate type: %s", req.GetType().String()))
	}
}

func GetAccessDecision(c context.Context, ctx *app.RequestContext) {
	setAccessGateCORSHeaders(ctx)
	if isAccessGatePreflight(ctx) {
		writeAccessGatePreflight(ctx)
		return
	}

	var req gatepb.GetAccessDecisionRequest
	if err := ctx.Bind(&req); err != nil {
		log.Warnf(c, "Access decision bind failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	attempt, ok := gate.GetAttempt(c, req.GetAttemptId())
	if !ok {
		FailedResponse(c, ctx, errors.New("access attempt expired or not found"))
		return
	}

	SuccessResponse(c, ctx, "Access decision", &gatepb.GetAccessDecisionResponse{
		Decision: gate.DecisionForAttempt(c, attempt),
	})
}

func ActorLogin(c context.Context, ctx *app.RequestContext) {
	var loginReq model.LoginRequest
	if err := ctx.Bind(&loginReq); err != nil {
		log.Warnf(c, "Login bound params failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	params := model.ActorLoginParams{
		Email:      loginReq.GetEmail(),
		Password:   loginReq.GetPassword(),
		DeviceType: loginReq.GetDeviceType(),
	}
	if err := params.Check(); err != nil {
		log.Warnf(c, "Login checked params failed: %v", err)
		FailedResponse(c, ctx, err)
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
	deviceType := params.DeviceType
	if deviceType == "" {
		deviceType = "desktop" // Default to desktop
	}

	// Use auth service to handle login with session (with kick mechanism)
	result, err := auth.LoginWithSession(c, credentials, clientIP, userAgent, deviceType)
	if err != nil {
		log.Warnf(c, "Login failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	// Update user status
	if userID, ok := result.User["id"].(uint64); ok {
		_ = actor.UpdateActorStatus(c, userID, db.ActorStatusOnline, userAgent)
	}

	// Set session cookie
	ctx.SetCookie("session_id", result.SessionID, int(24*time.Hour.Seconds()), "/", "", protocol.CookieSameSiteDisabled, false, true)

	// Extract numeric actor ID for P2P signaling
	var actorIdNum uint64
	if id, ok := result.User["id"].(uint64); ok {
		actorIdNum = id
	} else if idStr, ok := result.User["id"].(string); ok {
		if parsed, err := strconv.ParseUint(idStr, 10, 64); err == nil {
			actorIdNum = parsed
		}
	}

	if allowed, reason := gate.CheckActorAllowed(c, accessActorRefFromSessionResult(result, actorIdNum)); !allowed {
		_ = auth.LogoutSession(c, result.SessionID)
		log.Warnf(c, "Login blocked by access gate policy: actor_id=%d reason=%s", actorIdNum, reason)
		FailedResponse(c, ctx, errors.New(reason))
		return
	}

	loginResp := loginResponseFromSessionResult(result, actorIdNum)
	if actorIdNum > 0 {
		if act, err := actor.GetActorByID(c, actorIdNum); err == nil && act != nil {
			loginResp.ActorRef = actor.ProtoActorRef(act, baseURLFrom(ctx))
		}
	}
	SuccessResponse(c, ctx, "Login successful", loginResp)
}

func ActorSessionTakeover(c context.Context, ctx *app.RequestContext) {
	subject := coreauth.GetSubject(c)
	if subject == nil {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	userID, err := strconv.ParseUint(subject.ID, 10, 64)
	if err != nil {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid user identity"})
		return
	}

	var req struct {
		DeviceType string `json:"device_type"`
	}
	_ = ctx.Bind(&req)
	if req.DeviceType == "" {
		req.DeviceType = "desktop"
	}

	rds, err := store.GetRDS(c)
	if err != nil {
		log.Warnf(c, "Session takeover failed to get store: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	var user db.Actor
	if err := rds.WithContext(c).Where("id = ?", userID).First(&user).Error; err != nil {
		log.Warnf(c, "Session takeover failed to load actor: %v", err)
		FailedResponse(c, ctx, auth.ErrUserNotFound)
		return
	}

	if allowed, reason := gate.CheckActorAllowed(c, &gatepb.AccessGateActorRef{
		Id:       strconv.FormatUint(uint64(user.ID), 10),
		ActorId:  int64(user.ID),
		Username: user.PreferredUsername,
		Email:    user.Email,
	}); !allowed {
		log.Warnf(c, "Session takeover blocked by access gate policy: actor_id=%d reason=%s", user.ID, reason)
		FailedResponse(c, ctx, errors.New(reason))
		return
	}

	result, err := auth.IssueTokenAndSession(c, &user, ctx.ClientIP(), string(ctx.GetHeader("User-Agent")), req.DeviceType, map[string]interface{}{
		"auth_method": "session_takeover",
	})
	if err != nil {
		log.Warnf(c, "Session takeover failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	_ = actor.UpdateActorStatus(c, userID, db.ActorStatusOnline, string(ctx.GetHeader("User-Agent")))
	ctx.SetCookie("session_id", result.SessionID, int(24*time.Hour.Seconds()), "/", "", protocol.CookieSameSiteDisabled, false, true)

	loginResp := loginResponseFromSessionResult(result, userID)
	if act, err := actor.GetActorByID(c, userID); err == nil && act != nil {
		loginResp.ActorRef = actor.ProtoActorRef(act, baseURLFrom(ctx))
	}
	SuccessResponse(c, ctx, "Session takeover successful", loginResp)
}

func loginResponseFromSessionResult(result *auth.SessionLoginResult, actorIDNum uint64) *model.LoginResponse {
	expiresAt := result.ExpiresAt.Format(time.RFC3339)
	return &model.LoginResponse{
		Tokens: &model.AuthTokens{
			Token:        result.AccessToken,
			AccessToken:  result.AccessToken,
			RefreshToken: result.RefreshToken,
			TokenType:    result.TokenType,
			ExpiresAt:    expiresAt,
		},
		SessionId: result.SessionID,
		Actor: &model.AuthActorInfo{
			Id:          toString(result.User["id"]),
			ActorId:     int64(actorIDNum),
			Username:    toString(result.User["name"]),
			DisplayName: toString(result.User["display_name"]),
			Email:       toString(result.User["email"]),
		},
	}
}

func submitAccessLogin(c context.Context, ctx *app.RequestContext, req *gatepb.SubmitAccessGateRequest) {
	loginReq := req.GetLogin()
	if loginReq == nil {
		FailedResponse(c, ctx, errors.New("login gate requires credentials"))
		return
	}

	params := model.ActorLoginParams{
		Email:      loginReq.GetEmail(),
		Password:   loginReq.GetPassword(),
		DeviceType: loginReq.GetDeviceType(),
	}
	if err := params.Check(); err != nil {
		log.Warnf(c, "Access login checked params failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	deviceType := params.DeviceType
	if deviceType == "" {
		deviceType = "desktop"
	}

	result, err := auth.LoginWithSession(c, &auth.Credentials{
		Email:    params.Email,
		Password: params.Password,
	}, ctx.ClientIP(), string(ctx.GetHeader("User-Agent")), deviceType)
	if err != nil {
		log.Warnf(c, "Access login failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	actorIDNum := actorIDFromSessionResult(result)
	decision, err := gate.CompleteLogin(c, req.GetAttemptId(), accessActorRefFromSessionResult(result, actorIDNum), result.SessionID)
	if err != nil {
		_ = auth.LogoutSession(c, result.SessionID)
		log.Warnf(c, "Access login completion failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	if decision.GetState() != gatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED {
		_ = auth.LogoutSession(c, result.SessionID)
		SuccessResponse(c, ctx, "Access blocked", &gatepb.SubmitAccessGateResponse{Decision: decision})
		return
	}

	_ = actor.UpdateActorStatus(c, actorIDNum, db.ActorStatusOnline, string(ctx.GetHeader("User-Agent")))
	ctx.SetCookie("session_id", result.SessionID, int(24*time.Hour.Seconds()), "/", "", protocol.CookieSameSiteDisabled, false, true)

	loginResp := loginResponseFromSessionResult(result, actorIDNum)
	if actorIDNum > 0 {
		if act, err := actor.GetActorByID(c, actorIDNum); err == nil && act != nil {
			loginResp.ActorRef = actor.ProtoActorRef(act, baseURLFrom(ctx))
		}
	}

	SuccessResponse(c, ctx, "Access granted", &gatepb.SubmitAccessGateResponse{
		Decision:      decision,
		LoginResponse: loginResp,
	})
}

// submitAccessInviteCode redeems an invite code for the attempt and returns the
// re-evaluated decision. An invalid code is reported with a single uniform
// message so a probe cannot distinguish unknown / revoked / expired / exhausted.
func submitAccessInviteCode(c context.Context, ctx *app.RequestContext, req *gatepb.SubmitAccessGateRequest) {
	code := req.GetInviteCode()
	if code == "" {
		FailedResponse(c, ctx, errors.New("invite code gate requires a code"))
		return
	}

	decision, err := gate.CompleteInviteCode(c, req.GetAttemptId(), code)
	if err != nil {
		log.Warnf(c, "Access invite code submit failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	SuccessResponse(c, ctx, "Invite code accepted", &gatepb.SubmitAccessGateResponse{Decision: decision})
}

// CancelAccessAttempt closes a live attempt so an abandoned gate flow leaves a
// terminal record instead of lingering until expiry. It is idempotent.
func CancelAccessAttempt(c context.Context, ctx *app.RequestContext) {
	setAccessGateCORSHeaders(ctx)
	if isAccessGatePreflight(ctx) {
		writeAccessGatePreflight(ctx)
		return
	}

	var req gatepb.CancelAccessAttemptRequest
	if err := ctx.Bind(&req); err != nil {
		log.Warnf(c, "Access cancel bind failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	cancelled, err := gate.CancelAttempt(c, req.GetAttemptId())
	if err != nil {
		log.Warnf(c, "Access cancel failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	SuccessResponse(c, ctx, "Access attempt cancelled", &gatepb.CancelAccessAttemptResponse{Cancelled: cancelled})
}

func actorIDFromSessionResult(result *auth.SessionLoginResult) uint64 {
	if id, ok := result.User["id"].(uint64); ok {
		return id
	}
	if idStr, ok := result.User["id"].(string); ok {
		if parsed, err := strconv.ParseUint(idStr, 10, 64); err == nil {
			return parsed
		}
	}
	return 0
}

func accessActorRefFromSessionResult(result *auth.SessionLoginResult, actorIDNum uint64) *gatepb.AccessGateActorRef {
	return &gatepb.AccessGateActorRef{
		Id:       toString(result.User["id"]),
		ActorId:  int64(actorIDNum),
		Username: toString(result.User["username"]),
		Email:    toString(result.User["email"]),
	}
}

func ActorLogout(c context.Context, ctx *app.RequestContext) {
	// 1. Try to get session_id from cookie or request body
	sessionID := string(ctx.Cookie("session_id"))

	var req struct {
		SessionID string `json:"session_id"`
	}
	if err := ctx.Bind(&req); err == nil && req.SessionID != "" {
		sessionID = req.SessionID
	}

	// 2. Clear from store
	if sessionID != "" {
		_ = auth.LogoutSession(c, sessionID)
	}

	// 3. Update user status to offline
	subject := coreauth.GetSubject(c)
	if subject != nil {
		if userID, err := strconv.ParseUint(subject.ID, 10, 64); err == nil {
			_ = actor.UpdateActorStatus(c, userID, db.ActorStatusOffline, "")
		}
	}

	// 4. Clear session cookie
	ctx.SetCookie("session_id", "", -1, "/", "", protocol.CookieSameSiteDisabled, false, true)

	SuccessResponse(c, ctx, "Logout successful", nil)
}

func ActorChangePassword(c context.Context, ctx *app.RequestContext) {
	subject := coreauth.GetSubject(c)
	if subject == nil {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	userID, err := strconv.ParseUint(subject.ID, 10, 64)
	if err != nil {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid user identity"})
		return
	}

	var req struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := ctx.Bind(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	if req.OldPassword == "" || req.NewPassword == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "old_password and new_password are required"})
		return
	}
	if len(req.NewPassword) < 1 {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "new password too short"})
		return
	}

	if err := auth.ChangePassword(c, userID, req.OldPassword, req.NewPassword); err != nil {
		if err == auth.ErrInvalidCredentials {
			ctx.JSON(http.StatusForbidden, map[string]string{"error": "old password is incorrect"})
			return
		}
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to change password"})
		return
	}

	SuccessResponse(c, ctx, "Password changed successfully", nil)
}

func GetActorProfile(c context.Context, ctx *app.RequestContext) {
	actorID, err := resolveActorID(c, ctx)
	if err != nil {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	baseURL := baseURLFrom(ctx)
	resp, err := actor.GetWebProfileByID(c, actorID, baseURL)
	if err != nil {
		log.Warnf(c, "Get actor profile failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}
	SuccessResponse(c, ctx, "Actor profile retrieved", actor.WebProfileToActorProfileProto(resp))
}

// GetActorPublicProfileByID returns the rich public profile of any actor by
// numeric actor ID. Used by chat detail / contacts detail to render peer
// profile cards that mirror the structure of the user's own profile view.
//
// Returned `ActorProfile` carries only fields intended for public exposure;
// sensitive data (email, password hash, raw keys, session metadata, ...) is
// never serialized into `ActorProfile`. Auth is enforced to prevent the
// endpoint becoming an open enumeration surface.
func GetActorPublicProfileByID(c context.Context, ctx *app.RequestContext) {
	idStr := ctx.Param("id")
	if idStr == "" {
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "actor id is required"})
		return
	}

	baseURL := baseURLFrom(ctx)
	var resp *actor.ProfileResponse
	var err error
	if strings.HasPrefix(idStr, "ptid:") {
		resp, err = actor.GetWebProfileByPTID(c, idStr, baseURL)
	} else {
		actorID, parseErr := strconv.ParseUint(idStr, 10, 64)
		if parseErr != nil {
			ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid actor id"})
			return
		}
		resp, err = actor.GetWebProfileByID(c, actorID, baseURL)
	}
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			ctx.JSON(http.StatusNotFound, map[string]string{"error": "actor not found"})
			return
		}
		log.Warnf(c, "Get peer profile failed: id=%s err=%v", idStr, err)
		FailedResponse(c, ctx, err)
		return
	}
	SuccessResponse(c, ctx, "Peer profile retrieved", actor.WebProfileToActorProfileProto(resp))
}

func PublicProfile(c context.Context, ctx *app.RequestContext) {
	username := ctx.Param("actor")
	if username == "" {
		log.Warnf(c, "Username parameter is required")
		ctx.JSON(http.StatusBadRequest, "Username parameter is required")
		return
	}

	baseURL := baseURLFrom(ctx)
	resp, err := actor.GetWebProfile(c, username, baseURL)
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

// ActorBasicInfoResponse contains only non-sensitive public info for an actor.
// Used by Avatar component to resolve unknown actor's avatar/name.
type ActorBasicInfoResponse struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	Username    string `json:"username"`
	AvatarURL   string `json:"avatar_url"`
	CoverURL    string `json:"cover_url"`
}

// GetActorBasicInfo returns public basic info (displayName, avatarUrl, coverUrl) for an actor by ID.
// This is a public endpoint (no auth required) for Avatar component to resolve unknown actors.
func GetActorBasicInfo(c context.Context, ctx *app.RequestContext) {
	idStr := ctx.Param("id")
	if idStr == "" {
		ctx.JSON(http.StatusBadRequest, "Actor ID is required")
		return
	}

	actorID, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, "Invalid actor ID format")
		return
	}

	baseURL := baseURLFrom(ctx)
	resp, err := actor.GetWebProfileByID(c, actorID, baseURL)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			ctx.JSON(http.StatusNotFound, "Actor not found")
			return
		}
		log.Errorf(c, "Failed to fetch actor basic info: %v", err)
		ctx.JSON(http.StatusInternalServerError, "Internal Server Error")
		return
	}

	// Return only non-sensitive public info
	basicInfo := ActorBasicInfoResponse{
		ID:          resp.ID,
		DisplayName: resp.DisplayName,
		Username:    resp.Username,
		AvatarURL:   resp.Avatar,
		CoverURL:    resp.Header,
	}

	ctx.JSON(http.StatusOK, basicInfo)
}

func UpdateActorProfile(c context.Context, ctx *app.RequestContext) {
	var protoReq model.UpdateProfileRequest
	ct := string(ctx.Request.Header.ContentType())
	if strings.Contains(ct, model.ContentTypeProtobuf) {
		if err := proto.Unmarshal(ctx.Request.Body(), &protoReq); err != nil {
			log.Warnf(c, "Update profile proto unmarshal failed: %v", err)
			ctx.JSON(http.StatusBadRequest, err.Error())
			return
		}
	} else {
		if err := ctx.Bind(&protoReq); err != nil {
			log.Warnf(c, "Update profile bound params failed: %v", err)
			ctx.JSON(http.StatusBadRequest, err.Error())
			return
		}
	}
	params := actor.UpdateProfileRequestFromProto(&protoReq)

	actorID, err := resolveActorID(c, ctx)
	if err != nil {
		ctx.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	if err := actor.UpdateProfileByID(c, actorID, params); err != nil {
		log.Warnf(c, "Update profile failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}
	SuccessResponse(c, ctx, "Profile updated successfully", nil)
}

// ListActors returns actors from preset configuration.
func ListActors(c context.Context, ctx *app.RequestContext) {
	// Get current user ID from context (if authenticated)
	var currentActorID uint64
	if subject := coreauth.GetSubject(c); subject != nil {
		if actorID, err := strconv.ParseUint(subject.ID, 10, 64); err == nil {
			currentActorID = actorID
			log.Infof(c, "[ListActors] Current user actor ID: %d", currentActorID)
		}
	}

	actors, err := actor.ListActors(c, currentActorID)
	if err != nil {
		log.Warnf(c, "List actors failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	// Map to proto ActorList with relationship status
	items := make([]*model.Actor, 0, len(actors))
	for _, a := range actors {
		isFollowing := false
		if currentActorID > 0 {
			isFollowing, _ = actor.IsFollowing(c, currentActorID, a.ID)
		}

		items = append(items, &model.Actor{
			Id:          strconv.FormatUint(a.ID, 10),
			Username:    a.PreferredUsername,
			DisplayName: a.Name,
			Email:       a.Email,
			Inbox:       a.Inbox,
			Outbox:      a.Outbox,
			Endpoints:   nil,
			ActorId:     a.ID,
			IsFollowing: isFollowing,
		})
	}
	SuccessResponse(c, ctx, "Actor list", &model.ActorList{Items: items, Total: int64(len(items))})
}

// SearchActors searches local actors by query (fuzzy match on username and display name).
func SearchActors(c context.Context, ctx *app.RequestContext) {
	query := string(ctx.Query("q"))
	if query == "" {
		FailedResponse(c, ctx, errors.New("query parameter 'q' is required"))
		return
	}

	// Get current user ID from context (if authenticated)
	var excludeActorID uint64
	if subject := coreauth.GetSubject(c); subject != nil {
		if actorID, err := strconv.ParseUint(subject.ID, 10, 64); err == nil {
			excludeActorID = actorID
			log.Infof(c, "[SearchActors] Excluding current user with actor ID: %d", excludeActorID)
		}
	}

	actors, err := actor.SearchActorsAsPreset(c, query, excludeActorID)
	if err != nil {
		log.Warnf(c, "Search actors failed: %v", err)
		FailedResponse(c, ctx, err)
		return
	}

	// Map to proto ActorList
	items := make([]*model.Actor, 0, len(actors))
	for _, a := range actors {
		items = append(items, &model.Actor{
			Id:          a.ID,
			Username:    a.Username,
			DisplayName: a.DisplayName,
			Email:       a.Email,
			Inbox:       a.Inbox,
			Outbox:      a.Outbox,
			Endpoints:   a.Endpoints,
		})
	}
	SuccessResponse(c, ctx, "Search results", &model.ActorList{Items: items, Total: int64(len(items))})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// toString converts an interface value to its string representation.
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

// resolveActorID extracts the authenticated actor's numeric ID from the JWT bearer token.
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
